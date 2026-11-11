"use client"; // the hall is fully interactive and uses browser APIs

// The hall: rows of numbered desks, the sit -> topic -> timer -> recap ritual,
// quiet join requests, block/report, hide-from-requests, hall hopping, an
// optional walk around the 3D hall on foot, and a full-screen hall.
// Presence goes through getPresence(), so the backend can change later.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"; // React hooks
import Desk from "./Desk"; // one desk tile
import { BreakCard, DeskCard, RecapDialog, SitDialog, FloorDialog, WardrobeDialog } from "./Dialogs"; // paper dialogs
import { HALLS, ROWS, DESKS_PER_ROW, demoMembers, hallById } from "@/lib/halls"; // hall data
import { getPresence, type JoinRequest, type Member, type Phase, type WalkState } from "@/lib/presence"; // presence layer
import { ENTRANCE, standSpot } from "./three/walk"; // where a walk starts (tiny module: no three.js)
import type { Profile } from "@/lib/profile"; // profile shape
import { parseLook, lookString, HAS_NECK } from "./three/looks"; // wardrobe (tiny module: no three.js)
import { modelFor } from "./three/models"; // which character I am (for the wardrobe's neck option)
import { loadAccount, saveProfile, saveLook, sitDown, heartbeat, standUp as saveStandUp, releaseOnUnload, usualSeat, setUsualSeat, fileReport, type ReportReason } from "@/lib/account"; // account: Supabase or demo storage
import { hasSupabase, accessToken } from "@/lib/backend/client"; // real backend?
import { loadMyRoom, type Room } from "@/lib/rooms"; // small study rooms
import RoomPanel from "./RoomPanel"; // room members, leave/remove, voice
import { ReportDialog } from "./Dialogs"; // report with a reason
import { softChime } from "@/lib/chime"; // optional gentle sound
import { startRain, stopRain } from "@/lib/ambient"; // optional rain ambience
import { hasWebGL, prefersReducedMotion } from "@/lib/env"; // capability checks
import dynamic from "next/dynamic"; // lazy-load the 3D bundle
import { prefetchModels } from "./three/models"; // tiny module: start character downloads before the 3D bundle arrives

// The 3D hall is loaded only in the browser and only when used (keeps the 2D view light).
const Hall3D = dynamic(() => import("./three/Hall3D"), { ssr: false, loading: () => <div className="hall3d loading">Lighting the lamps…</div> }); // lazy 3D

// Format milliseconds as mm:ss for the clock.
function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000)); // whole seconds left, never negative
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; // e.g. 24:59
}

export default function HallView({ hallId }: { hallId: string }) {
  const hall = hallById(hallId)!; // validated by the route
  const presence = useMemo(() => getPresence(), []); // shared provider for this tab
  const demos = useMemo(() => (hasSupabase ? [] : demoMembers(hallId)), [hallId]); // simulated students only in offline demo mode (real halls show real people only)

  // ---- my state ----
  const [profile, setProfile] = useState<Profile | null>(null); // local profile
  const [seat, setSeat] = useState<string | null>(null); // where I sit, null = standing
  const [topic, setTopic] = useState(""); // my public topic
  const [phase, setPhase] = useState<Phase>("idle"); // focus / break / idle
  const [phaseStart, setPhaseStart] = useState(0); // real ms when current phase started
  const [phaseEndsAt, setPhaseEndsAt] = useState<number | null>(null); // real ms when it ends
  const [focusedMs, setFocusedMs] = useState(0); // virtual focused ms this sitting
  const [plan, setPlan] = useState({ f: 25, b: 5 }); // current Pomodoro rhythm
  const [speed, setSpeed] = useState(1); // demo time multiplier (?speed=60 => 1 s = 1 min)
  const [now, setNow] = useState(() => Date.now()); // clock tick

  // ---- hall state ----
  const [others, setOthers] = useState<Member[]>([]); // real people in other tabs
  const [blocked, setBlocked] = useState<Set<string>>(new Set()); // locally blocked ids (incl. demos)
  const [usual, setUsual] = useState<string | null>(null); // my returning seat here

  // ---- dialogs & notes ----
  const [sitAt, setSitAt] = useState<string | null>(null); // desk whose sit dialog is open
  const [cardFor, setCardFor] = useState<Member | null>(null); // desk card being viewed
  const [recapOpen, setRecapOpen] = useState(false); // recap dialog
  const [breakHidden, setBreakHidden] = useState(false); // user dismissed the break card
  const [inbox, setInbox] = useState<JoinRequest[]>([]); // requests shown now
  const [held, setHeld] = useState<JoinRequest[]>([]); // requests held quietly during focus
  const [room, setRoom] = useState<Room | { id?: undefined; name: string } | null>(null); // current small study room (real: from the database; demo: just a name)
  const [sittingId, setSittingId] = useState<string | null>(null); // database id of my current sitting (real mode)
  const [reportFor, setReportFor] = useState<Member | null>(null); // report dialog target
  const [toast, setToast] = useState<string | null>(null); // one quiet message at a time

  // ---- view settings ----
  const [webgl, setWebgl] = useState(false); // can this device draw 3D?
  const [view, setView] = useState<"3d" | "2d">("2d"); // which hall view is shown
  const [reduced, setReduced] = useState(false); // prefers-reduced-motion
  const [rain, setRain] = useState(false); // rain ambience (off by default)
  const [forceHover, setForceHover] = useState<string | null>(null); // ?hover=B1 for previews

  // ---- walking + full screen ----
  const [walk, setWalk] = useState<{ x: number; z: number; ry: number; n: number; pitch?: number } | null>(null); // on foot: where this walk started (n = which walk); null = not walking
  const [recapThen, setRecapThen] = useState<"walk" | null>(null); // after the recap: just stand, or stand and walk
  const [fs, setFs] = useState(false); // the hall is in browser full screen
  const [helpOn, setHelpOn] = useState(true); // short walking help, fades after a little while
  const rootRef = useRef<HTMLDivElement>(null); // what goes full screen (scene + overlays + dialogs together)
  const stick = useRef({ x: 0, y: 0 }).current; // on-screen move pad (touch), shared with the 3D hall
  const sentWalk = useRef<{ w: WalkState; at: number } | null>(null); // last position sent to the hall
  const [floor, setFloor] = useState<string | null>(null); // sitting on the floor with this topic (only while on foot)
  const [floorAsk, setFloorAsk] = useState(false); // the "sit on the floor" topic dialog is open
  const [lastFloorTopic, setLastFloorTopic] = useState(""); // offered again next time
  const [quick, setQuick] = useState(false); // touch: "Quicker" walk toggle (Shift does it on a keyboard)
  const [wardrobe, setWardrobe] = useState(false); // wardrobe dialog open

  const phaseRef = useRef(phase); // latest phase for presence callbacks
  phaseRef.current = phase; // keep it current every render

  // Show a quiet message for a few seconds.
  const say = useCallback((msg: string) => {
    setToast(msg); // show
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500); // hide after 3.5 s
  }, []);

  // Load the account (sign-in / 18+ sign-up first in real mode), usual seat, room and options on mount.
  useEffect(() => {
    let live = true; // ignore results after unmount
    loadAccount().then(async (a) => {
      if (!live) return; // navigated away
      if (a.state === "signed_out") { window.location.href = `/signin?next=${encodeURIComponent(`/hall/${hallId}`)}`; return; } // sign in first
      if (a.state === "needs_onboarding") { window.location.href = "/welcome"; return; } // finish sign-up (18+) first
      const p = a.profile; // my profile
      if (!p.name.trim()) p.name = "Guest"; // demo fallback name if they skipped the lobby
      setProfile(p); // store it
      setPlan({ f: p.focusMin, b: p.breakMin }); // last rhythm
      setUsual(await usualSeat(hallId)); // returning seat
      const r = await loadMyRoom(p.id); // still in a study room from before?
      if (live && r) setRoom(r); // show it
    });
    const q = new URLSearchParams(window.location.search); // URL options
    const sp = Number(q.get("speed")); // demo speed
    if (sp > 0 && !hasSupabase) setSpeed(sp); // fast timers only in offline demos (real history must be real minutes)
    const ok = hasWebGL(); // 3D possible?
    setWebgl(ok); // remember
    const saved = (q.get("view") ?? localStorage.getItem("hh.view")) as "3d" | "2d" | null; // URL or saved choice
    setView(ok && saved !== "2d" ? "3d" : "2d"); // 3D by default when available
    setForceHover(q.get("hover")); // optional forced hover
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)"); // OS motion setting
    setReduced(prefersReducedMotion()); // initial value
    const onMq = () => setReduced(mq.matches); // live updates
    mq.addEventListener("change", onMq); // listen
    return () => { live = false; mq.removeEventListener("change", onMq); }; // cleanup
  }, [hallId]);

  // Rain ambience follows the toggle; always stops when leaving the hall.
  useEffect(() => {
    if (rain) startRain(); else stopRain(); // follow toggle
    return () => stopRain(); // stop on unmount
  }, [rain]);

  // Switch between the 3D hall and the simple card view, and remember it.
  const chooseView = (v: "3d" | "2d") => {
    setView(v); // show it
    localStorage.setItem("hh.view", v); // remember for next time
  };

  // Build my presence record from current state.
  const me: Member | null = useMemo(() => {
    if (!profile) return null; // not ready
    return {
      id: profile.id, // tab id
      name: profile.name, // name
      avatar: profile.avatar, // avatar
      color: profile.color, // lamp colour
      seat, // desk or null
      topic: seat ? topic : walk && floor ? floor : topic, // public topic (my floor topic while sitting on the floor)
      phase, // timer phase
      phaseEndsAt, // countdown end
      hideFromRequests: profile.hideFromRequests, // privacy toggle
      walking: !!walk && !seat, // on foot in the aisles (never while holding a desk)
      floor: !!walk && !seat && floor !== null, // sitting on the floor to study
      look: profile.look ?? "", // wardrobe
      lastSeen: Date.now(), // refreshed by the provider
    };
  }, [profile, seat, topic, phase, phaseEndsAt, walk, floor]); // walk/floor included so others learn when I start/stop walking or sit on the floor

  // Join the hall once my profile is ready; leave on unmount or tab close.
  const joined = useRef(false); // guard against double join
  useEffect(() => {
    if (!me || joined.current) return; // wait for profile
    joined.current = true; // mark joined
    presence.join(hallId, me); // enter the hall
    const offMembers = presence.onMembers(setOthers); // live desks
    const offReq = presence.onRequest((r) => {
      if (phaseRef.current === "focus") setHeld((h) => [...h, r]); // never interrupt focus
      else setInbox((i) => [...i, r]); // show now
    });
    const offRes = presence.onResponse(async (res) => {
      if (res.accepted) { // accepted: open the room both of us are now in
        const r = hasSupabase ? await loadMyRoom(me.id) : null; // real room from the database
        setRoom(r ?? { name: res.roomName ?? "Study room" }); // demo: just the name
        say("Request accepted. You’re in a small study room now."); // quiet confirmation
      } else say("They’d rather study solo right now. No worries."); // declined, gently
    });
    const bye = () => presence.leave(); // tell others when the tab closes
    window.addEventListener("pagehide", bye); // fires on close and navigation
    return () => {
      offMembers(); offReq(); offRes(); // unsubscribe
      window.removeEventListener("pagehide", bye); // stop listening
      presence.leave(); // leave the hall
      joined.current = false; // allow re-join (React strict mode remount)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me === null, hallId]);

  // Push my state whenever it changes.
  useEffect(() => {
    if (me && joined.current) presence.update(me); // broadcast
  }, [me, presence]);

  // Walking position for the hall: a few times a second while moving, once when I stop,
  // and an occasional refresh while standing still (keeps presence light and calm).
  const onMove = useCallback((w: WalkState) => { // called every frame by the 3D hall while I walk
    const now = performance.now(), last = sentWalk.current; // timing
    const posed = !last || last.w.pose !== w.pose; // started or stopped moving
    const shifted = !!last && (Math.hypot(w.x - last.w.x, w.z - last.w.z) > 0.05 || Math.abs(w.ry - last.w.ry) > 0.12); // moved or turned noticeably
    const due = !!last && now - last.at > (w.pose === "walking" ? 400 : 1500); // setting: about 2.5 updates a second while walking
    if (posed || (due && shifted)) { presence.walk(w); sentWalk.current = { w: { ...w }, at: now }; } // announce
  }, [presence]);

  // Not walking any more (sat down, stopped, or left): clear my position for everyone.
  useEffect(() => {
    if (!walk || seat) { presence.walk(null); sentWalk.current = null; setFloor(null); setQuick(false); } // nothing to show on foot (and no floor sit without a walk)
  }, [walk, seat, presence]);

  // G (while walking): sit on the floor here, or get up again. Ignored while typing or in a dialog.
  useEffect(() => {
    if (!walk || seat) return; // only on foot
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null; // where the key went
      if (e.code !== "KeyG" || e.ctrlKey || e.metaKey || e.altKey || (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable)) || document.querySelector(".veil")) return; // not ours
      if (floor !== null) setFloor(null); else setFloorAsk(true); // get up, or ask for the topic first
    };
    window.addEventListener("keydown", down); // listen
    return () => window.removeEventListener("keydown", down); // cleanup
  }, [walk, seat, floor]);

  // Walking help fades on its own after a short while (no lingering text over the scene).
  useEffect(() => {
    if (!walk) return; // only while walking
    setHelpOn(true); // show at the start of each walk
    rootRef.current?.querySelector(".hall3d-wrap")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); // small screens: bring the whole scene (and the move pad) into view
    const t = window.setTimeout(() => setHelpOn(false), 9000); // setting: 9 s
    return () => clearTimeout(t); // cleanup
  }, [walk]);

  // Full screen: follow the browser's state (Esc exits on its own) and offer the F key as a shortcut.
  const toggleFs = useCallback(() => { // button and F key share this
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); // leave full screen
    else rootRef.current?.requestFullscreen?.().catch(() => say("Full screen isn’t available in this browser.")); // enter (scene, notes and dialogs together)
  }, [say]);
  useEffect(() => {
    const onFs = () => setFs(document.fullscreenElement === rootRef.current); // entered or left (incl. Esc)
    const onKey = (e: KeyboardEvent) => { // F = full screen on/off
      const t = e.target as HTMLElement | null; // focused element
      if (e.code !== "KeyF" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return; // only a plain F
      if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable)) return; // typing
      if (document.querySelector(".veil") || !document.querySelector(".hall3d-wrap")) return; // a dialog is up, or the 3D hall isn't shown
      e.preventDefault(); toggleFs(); // toggle
    };
    document.addEventListener("fullscreenchange", onFs); window.addEventListener("keydown", onKey); // listen
    return () => { document.removeEventListener("fullscreenchange", onFs); window.removeEventListener("keydown", onKey); }; // cleanup
  }, [toggleFs]);

  // Real mode: keep my desk alive every minute and bank focus time, so a
  // closed laptop still counts the minutes and the desk frees itself later.
  const focusNowRef = useRef(0); // latest focused minutes (read by the timers below)
  useEffect(() => {
    if (!sittingId || !hasSupabase) return; // only while seated for real
    const t = setInterval(async () => {
      const ok = await heartbeat(sittingId, focusNowRef.current); // still my desk?
      if (!ok) { setSeat(null); setSittingId(null); setPhase("idle"); setPhaseEndsAt(null); say("Your desk was released while you were away. Pick a desk to sit again."); } // gently stand up
    }, 60000); // setting: once a minute (desks count as empty after 3 minutes without one)
    const bye = async () => releaseOnUnload(sittingId, focusNowRef.current, await accessToken()); // closing the tab frees the desk now
    window.addEventListener("pagehide", bye); // fires on close and navigation
    return () => { clearInterval(t); window.removeEventListener("pagehide", bye); }; // cleanup
  }, [sittingId, say]);

  // 1-second clock tick while seated.
  useEffect(() => {
    if (!seat) return; // no clock while standing
    const t = setInterval(() => setNow(Date.now()), 1000); // tick
    return () => clearInterval(t); // cleanup
  }, [seat]);

  // Start a phase with a duration in (virtual) minutes.
  const startPhase = useCallback((p: Phase, minutes: number) => {
    const start = Date.now(); // real start
    setPhase(p); // set phase
    setPhaseStart(start); // remember start
    setPhaseEndsAt(minutes > 0 ? start + (minutes * 60000) / speed : null); // real end, scaled for demo
    setBreakHidden(false); // show the break card again on each new break
  }, [speed]);

  // Add focus time elapsed in the current focus phase to the sitting total.
  const bankFocus = useCallback(() => {
    if (phase !== "focus") return 0; // only focus time counts
    const end = Math.min(Date.now(), phaseEndsAt ?? Date.now()); // stop at phase end
    const add = Math.max(0, end - phaseStart) * speed; // virtual ms
    setFocusedMs((f) => f + add); // accumulate
    return add; // return for immediate use
  }, [phase, phaseEndsAt, phaseStart, speed]);

  // Focused minutes so far this sitting (sent with each heartbeat).
  focusNowRef.current = (focusedMs + (phase === "focus" ? Math.max(0, Math.min(now, phaseEndsAt ?? now) - phaseStart) * speed : 0)) / 60000; // banked + running

  // Phase transitions when a timer runs out.
  useEffect(() => {
    if (!phaseEndsAt || now < phaseEndsAt) return; // still running
    if (phase === "focus") {
      bankFocus(); // save focus time
      if (profile?.chime) softChime(); // optional soft chime
      startPhase("break", plan.b); // gentle break
    } else if (phase === "break") {
      if (profile?.chime) softChime(); // optional soft chime
      setPhase("idle"); // wait for the student to choose the next round
      setPhaseEndsAt(null); // no countdown while idle
    }
  }, [now, phaseEndsAt, phase, plan.b, profile?.chime, bankFocus, startPhase]);

  // Release held requests once focus ends (break or idle).
  useEffect(() => {
    if (phase !== "focus" && held.length) {
      setInbox((i) => [...i, ...held]); // show them now
      setHeld([]); // clear the hold
    }
  }, [phase, held]);

  // Combine demo + real members into a seat map, skipping blocked people.
  const seatMap = useMemo(() => {
    const map = new Map<string, Member>(); // seat -> member
    [...demos, ...others].forEach((m) => {
      if (m.seat && !blocked.has(m.id) && !map.has(m.seat)) map.set(m.seat, m); // first claim wins
    });
    if (me?.seat) map.set(me.seat, me); // my own desk always shows me
    return map; // ready for rendering
  }, [demos, others, blocked, me]);

  // Other people walking in the aisles (no desk), minus anyone I blocked.
  const walkersList = useMemo(() => others.filter((m) => m.walking && !m.seat && !blocked.has(m.id)), [others, blocked]); // on foot

  // In the 3D view, start downloading the characters seated students need right
  // away, in parallel with the 3D bundle (the avatars reuse these downloads).
  useEffect(() => {
    if (view === "3d" && webgl) prefetchModels([...seatMap.values(), ...walkersList, ...(walk && me ? [me] : [])]); // each file is fetched once, repeats are free (walkers and my own walking figure too)
  }, [view, webgl, seatMap, walkersList, walk, me]); // re-check when someone starts walking

  // If another tab claimed my desk at the same moment, the lower id keeps it.
  useEffect(() => {
    if (!seat || !profile || hasSupabase) return; // only while seated, demo mode only (the database settles real clashes)
    const clash = others.find((o) => o.seat === seat && o.id < profile.id); // deterministic tie-break
    if (clash) { setSeat(null); setPhase("idle"); setPhaseEndsAt(null); say(`Desk ${seat} was just taken. Pick another one?`); } // stand back up
  }, [others, seat, profile, say]);

  // Update profile settings (privacy toggle, chime) and persist.
  const patchProfile = (p: Partial<Profile>) => {
    if (!profile) return; // not ready
    const next = { ...profile, ...p }; // merge
    setProfile(next); // re-render
    saveProfile(next).then((ok) => { if (!ok) say("That change wasn’t saved. Try a different nickname?"); }); // persist (database or local)
  };

  // Tap on a desk: sit if vacant and I am standing; open desk card if occupied.
  const onDesk = (s: string) => {
    const who = seatMap.get(s); // occupant
    if (!who) {
      if (seat) { say("You already have a desk. Stand up first to move."); return; } // one desk at a time
      setSitAt(s); // open sit dialog
    } else if (who.id !== profile?.id) setCardFor(who); // look at someone else's desk
  };

  // Stand up from the floor (button, G, or trying to walk); the walk carries on from there.
  const getUp = useCallback(() => setFloor(null), []); // the avatar eases back up

  // Save a wardrobe choice: show it right away, then store it (quietly say so if it couldn't be saved).
  const dress = async (l: ReturnType<typeof parseLook>) => {
    setWardrobe(false); // close
    if (!profile) return; // not ready
    const look = lookString(l); // short stored form
    setProfile({ ...profile, look }); // everyone (incl. me) sees it on the next update
    const ok = await saveLook(profile, look); // keep it for next time
    if (!ok) say("Your wardrobe shows for now, but couldn’t be saved yet."); // e.g. database not updated
  };

  // Ritual step 2-3: write topic, sit, start the timer.
  const sit = async (t: string, f: number, b: number, remember: boolean) => {
    if (!sitAt || !profile) return; // guard
    const at = sitAt; // the desk being claimed
    const res = await sitDown(hallId, at, t); // the database makes sure one person per desk
    if (!res.ok) { // couldn't claim it
      setSitAt(null); // close the dialog
      say(res.reason === "desk_taken" ? `Desk ${at} was just taken. Pick another one?` : res.reason === "topic_not_allowed" ? "That topic can’t be shown on a desk. Try wording it differently?" : "Couldn’t sit down just now. Check your connection and try again."); // calm reason
      return; // stay standing
    }
    setSittingId(res.sittingId); // for heartbeat + stand up
    setSeat(at); // take the desk
    setTopic(t); // public topic
    setPlan({ f, b }); // rhythm
    setFocusedMs(0); // fresh sitting
    patchProfile({ focusMin: f, breakMin: b }); // remember rhythm
    if (remember) { setUsualSeat(hallId, at, profile.id); setUsual(at); } // returning seat
    setSitAt(null); // close dialog
    setWalk(null); // sitting ends a walk (the camera eases into the seat view)
    startPhase("focus", f); // start focusing right away
  };

  // Ritual step 4: stand up with a short recap.
  const standUp = async (note: string) => {
    if (!seat) return; // not seated
    const thenWalk = recapThen === "walk" && view === "3d" && webgl; // stand and walk on, or just stand
    const from = seat; // the desk I'm leaving (to stand just behind its chair)
    const extra = bankFocus(); // count the running focus phase
    const wanted = Math.round((focusedMs + extra) / 60000); // total (virtual in demo) minutes
    const minutes = await saveStandUp(sittingId ?? "", wanted, note, { hallId, seat, topic }); // save history (database caps at real time)
    setRecapOpen(false); // close recap
    setSeat(null); setSittingId(null); setTopic(""); setPhase("idle"); setPhaseEndsAt(null); setFocusedMs(0); // back to the aisle (a study room stays open until you leave it)
    if (!room?.id) setRoom(null); // demo rooms end with the sitting, as before
    setRecapThen(null); // reset the choice
    if (thenWalk) setWalk({ ...standSpot(from), n: Date.now(), pitch: 0.55 }); // step out behind my chair and walk on (the desk is already free); camera a little higher to see over the desk
    say(minutes > 0 ? `Saved: ${minutes} min on ${topic}.` : "Saved. See you at your desk soon."); // quiet confirmation
  };

  // Send a join request (demo students answer by themselves after a moment).
  const request = (target: Member, note: string) => {
    setCardFor(null); // close the card
    if (target.isDemo) {
      say(`Request sent to ${target.name}.`); // feedback
      window.setTimeout(() => { setRoom({ name: `${target.name} & ${profile?.name}` }); say(`${target.name} accepted. You’re in a small study room now.`); }, 2500); // simulated accept
      return;
    }
    presence.sendRequest(target.id, note).then((r) => { // server checks hide/block/rate limits
      say(r.ok ? `Request sent to ${target.name}. They’ll see it when they’re not mid-focus.` : r.reason === "rate_limited" ? "You’ve sent a few requests recently. Try again in a little while." : `Not sent. ${target.name} isn’t taking requests right now.`); // calm feedback (never says "blocked")
    });
  };

  // Answer an incoming request.
  const answer = async (r: JoinRequest, ok: boolean) => {
    setInbox((i) => i.filter((x) => x.id !== r.id)); // remove the note right away
    const res = await presence.respond(r, ok); // tell the sender (real: the database opens the room)
    if (!ok) return; // "Not now" needs nothing else
    if (!res) { say("That request can’t be accepted any more."); return; } // sender left, or rooms unavailable
    const real = hasSupabase && profile ? await loadMyRoom(profile.id) : null; // the room we're both in now
    setRoom(real ?? { name: `${r.from.name} & ${profile?.name}` }); // demo: just a name
  };

  // Block someone: their desk and requests disappear for me.
  const block = (m: Member) => {
    presence.block(m.id).then(async () => { if (room?.id && profile) setRoom(await loadMyRoom(profile.id)); }); // server-side block; shared rooms change, so re-read mine
    setBlocked((b) => new Set(b).add(m.id)); // local view (covers demo students too)
    setInbox((i) => i.filter((x) => x.from.id !== m.id)); // drop their notes
    setCardFor(null); // close the card
    say(`${m.name} is blocked. You won’t see their desk or requests.`); // confirm
  };

  // Report someone: a reason is required; the report goes to the private
  // moderator queue and the reported person never learns who sent it.
  const report = async (m: Member, reason: ReportReason, note: string) => {
    setReportFor(null); // close the dialog
    const ok = await fileReport(m, reason, note, hallId, room?.id ?? null); // database (or this device in demo)
    say(ok ? (hasSupabase && !m.isDemo ? "Thanks. A moderator will look at this. They won’t be told who reported them." : "Thanks. Report noted (demo: kept on this device only).") : "That report didn’t go through. Please try again."); // confirm
  };

  if (!profile || !me) return <p className="muted">Walking in…</p>; // first paint

  // Derived values for the focus bar.
  const left = phaseEndsAt ? phaseEndsAt - now : 0; // real ms left in phase
  const total = phaseEndsAt ? phaseEndsAt - phaseStart : 1; // real ms in phase
  const pct = phaseEndsAt ? Math.min(100, Math.max(0, ((now - phaseStart) / total) * 100)) : 0; // progress %
  const liveCount = seatMap.size; // desks in use (incl. me)
  const walking = !!walk && !seat; // on foot now
  const canFs = typeof document !== "undefined" && !!document.fullscreenEnabled; // browser allows full screen (not iPhone Safari)
  const hint3d = `Tap a free desk to sit, or someone’s desk to see their topic.${hasSupabase ? "" : " Demo: open another tab to see live presence."}`; // shorter line over the 3D scene
  const hint = `Tap a vacant desk to sit. Tap someone’s desk to see their topic or ask to study together.${hasSupabase ? "" : " Demo mode: open another tab to see live presence. (A few desks are local demo students.)"}`; // standing hint

  return (
    <div className={`hall-root ${fs ? "is-fs" : ""}`} ref={rootRef}>
      {/* Hall header: name, rule, privacy toggle, hop to another hall */}
      <div className="hall-head">
        <div>
          <h1>{hall.name}</h1>
          <div className="rule">{hall.rule} · {liveCount} of {ROWS.length * DESKS_PER_ROW} desks taken</div>
        </div>
        <div className="row">
          <span className="toggle">
            <input type="checkbox" checked={profile.hideFromRequests} onChange={(e) => patchProfile({ hideFromRequests: e.target.checked })} />
            Hide me from requests
          </span>
          <span className="toggle">
            <input type="checkbox" checked={profile.chime} onChange={(e) => patchProfile({ chime: e.target.checked })} />
            Soft chime
          </span>
          <span className="toggle">
            <input type="checkbox" checked={rain} onChange={(e) => setRain(e.target.checked)} />
            Soft rain
          </span>
          {webgl && (
            <button className="ghost small" onClick={() => chooseView(view === "3d" ? "2d" : "3d")}>{view === "3d" ? "Simple view" : "3D hall"}</button>
          )}
          {/* Hall hopping: only while standing, so a sitting always ends with a recap */}
          <select aria-label="Move to another hall" value={hallId} disabled={!!seat} title={seat ? "Stand up to hop halls" : "Move to another hall"} onChange={(e) => { window.location.href = `/hall/${e.target.value}`; }} style={{ width: "auto" }}>
            {HALLS.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <a href="/" className="small">Lobby</a>
        </div>
      </div>

      {/* Study room status after an accepted request */}
      {room && (room.id ? (
        <RoomPanel room={room as Room} myId={profile.id} onChange={setRoom} say={say} onReport={(m) => setReportFor({ id: m.id, name: m.name, avatar: m.avatar, color: "#e9d8a6", seat: null, topic: "", phase: "idle", phaseEndsAt: null, hideFromRequests: true, lastSeen: Date.now() })} />
      ) : (
        <div className="room-banner">
          <b>Study room:</b> {room.name}. Demo mode: you stay at your desks and there is no voice (the real app opens a small voice room, muted by default, push-to-talk, never recorded).{" "}
          <button className="ghost small" onClick={() => setRoom(null)}>Leave room</button>
        </div>
      ))}

      {/* 3D reading room when WebGL is available and chosen */}
      {view === "3d" && webgl ? (
        <div className="hall3d-wrap">
          <Hall3D seatMap={seatMap} myId={profile.id} mySeat={seat} reduced={reduced} rain={rain} onPick={onDesk} hoverSeat={forceHover} me={me} walk={seat ? null : walk} walkers={walkersList} onMove={onMove} stick={stick} floor={floor} onGetUp={getUp} quick={quick} />
          {/* Calm frame controls, top-left: walk on foot, and full screen */}
          <div className="frame-ctl">
            {!seat && (walking
              ? <button className="ghost small" onClick={() => setWalk(null)}>Stop walking</button>
              : <button className="ghost small" onClick={() => setWalk({ ...ENTRANCE, n: Date.now() })}>Walk around</button>)}
            {walking && (floor !== null
              ? <button className="ghost small" onClick={getUp} title="Get up (G)">Get up</button>
              : <button className="ghost small" onClick={() => setFloorAsk(true)} title="Sit on the floor here to study (G)">Sit on the floor</button>)}
            {walking && floor === null && <button className={`ghost small touch-only ${quick ? "on" : ""}`} aria-pressed={quick} onClick={() => setQuick((v) => !v)}>{quick ? "Usual pace" : "Quicker"}</button>}
            <button className="ghost small" onClick={() => setWardrobe(true)}>Wardrobe</button>
            {canFs && <button className="ghost small" onClick={toggleFs} title="Full screen (F). Esc to leave.">{fs ? "Exit full screen" : "Full screen"}</button>}
          </div>
          {/* One short line of help: while walking (fades), or the usual standing hint */}
          {walking ? <div className={`hint3d ${helpOn ? "" : "faded"}`}>{floor !== null ? <>Sitting on the floor · <span className="kb-only">G or any walking key to get up · </span><span className="touch-only">use the pad to get up · </span>tap a free desk to move there</> : <><span className="kb-only">WASD or arrows to walk · Shift for a quicker pace · drag to look · Q/E to turn · G to sit on the floor · </span><span className="touch-only">Use the pad to walk · drag to look · </span>tap a free desk to sit</>}</div> : !seat && <div className="hint3d">{hint3d}</div>}
          {/* Touch: a small move pad (shown on touch screens only) */}
          {walking && <MovePad stick={stick} />}
          {/* Minimal timer HUD sits inside the 3D frame, top-right, like a paper note */}
          {seat && (
            <div className="hud3d">
              <div className="small muted">{phase === "focus" ? "Deep focus" : phase === "break" ? "Short break" : "Ready when you are"} · Desk {seat}</div>
              <div className="hud-clock">{phaseEndsAt ? mmss(phaseEndsAt - now) : "--:--"}</div>
              <div className="small hud-topic">{topic}</div>
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                {held.length > 0 && <span className="small muted">A note waits for your break</span>}
                {phase === "focus" && <button className="ghost small" onClick={() => { bankFocus(); startPhase("break", plan.b); }}>Break</button>}
                {phase !== "focus" && <button className="sage small" onClick={() => startPhase("focus", plan.f)}>{phase === "idle" ? "Next round" : "Back to focus"}</button>}
                <button className="ghost small" onClick={() => { setRecapThen(null); setRecapOpen(true); }}>Stand up</button>
                <button className="ghost small" onClick={() => { setRecapThen("walk"); setRecapOpen(true); }}>Walk around</button>
              </div>
            </div>
          )}
        </div>
      ) : (
      /* Floor plan: rows of desks with a centre aisle (simple 2D view and WebGL fallback) */
      <div className="floor">
        {ROWS.map((r) => (
          <div className="desk-row" key={r}>
            <div className="row-label">{r}</div>
            {Array.from({ length: DESKS_PER_ROW }, (_, i) => `${r}${i + 1}`).flatMap((s, i) => {
              const tile = (
                <Desk key={s} seat={s} occupant={seatMap.get(s) ?? null} isMine={s === seat} isUsual={s === usual && !seat} onClick={() => onDesk(s)} />
              ); // one desk
              return i === 2 ? [tile, <div key={`${r}-aisle`} className="aisle" />] : [tile]; // aisle after desk 3
            })}
          </div>
        ))}
      </div>
      )}
      {!seat && !(view === "3d" && webgl) && <p className="muted small" style={{ marginTop: 10 }}>{hint}</p>}

      {/* Bottom focus bar while seated (2D view) */}
      {seat && !(view === "3d" && webgl) && (
        <div className="focusbar">
          <div className="inner">
            <div>
              <div className="small" style={{ opacity: 0.8 }}>Desk {seat} · {phase === "focus" ? "Focusing" : phase === "break" ? "Break" : "Ready when you are"}</div>
              <div className="topic-line">{topic}</div>
              <div className={`progress ${phase === "break" ? "break" : ""}`}><div style={{ width: `${pct}%` }} /></div>
            </div>
            <div className="clock" aria-live="off">{phaseEndsAt ? mmss(left) : "--:--"}</div>
            <div className="row">
              {held.length > 0 && <span className="small" style={{ opacity: 0.8 }}>A note is waiting for your break</span>}
              {phase === "focus" && <button className="ghost" onClick={() => { bankFocus(); startPhase("break", plan.b); }}>Take a break</button>}
              {phase !== "focus" && <button className="sage" onClick={() => startPhase("focus", plan.f)}>{phase === "idle" ? "Start next round" : "Back to focus"}</button>}
              <button className="ghost" onClick={() => setRecapOpen(true)}>Stand up</button>
            </div>
          </div>
        </div>
      )}

      {/* Quiet join-request notes (never shown mid-focus) */}
      {inbox.length > 0 && (
        <div className="notes">
          {inbox.map((r) => (
            <div className="note" key={r.id}>
              <div><b>{r.from.avatar} {r.from.name}</b> <span className="muted small">(desk {r.from.seat ?? "aisle"})</span> asks to study together.</div>
              {r.note && <div className="small" style={{ margin: "4px 0" }}>“{r.note}”</div>}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="sage" onClick={() => answer(r, true)}>Accept</button>
                <button className="ghost" onClick={() => answer(r, false)}>Not now</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialogs */}
      {floorAsk && <FloorDialog defaultTopic={lastFloorTopic || topic} onCancel={() => setFloorAsk(false)} onSit={(t) => { setFloorAsk(false); setLastFloorTopic(t); setFloor(t); }} />}
      {wardrobe && <WardrobeDialog look={parseLook(profile.look)} hasNeck={HAS_NECK.has(modelFor(profile.id, profile.color, profile.name).file)} onCancel={() => setWardrobe(false)} onSave={dress} />}
      {sitAt && <SitDialog seat={sitAt} defaultFocus={plan.f} defaultBreak={plan.b} onCancel={() => setSitAt(null)} onSit={sit} />}
      {cardFor && (
        <DeskCard
          member={cardFor}
          canRequest={!cardFor.hideFromRequests && phase !== "focus" && !room && !profile.roomsPaused}
          reason={profile.roomsPaused ? "Study rooms are paused on your account for now." : cardFor.hideFromRequests ? `${cardFor.name} isn’t taking study-room requests right now.` : room ? "You’re already in a study room." : "You’re mid-focus. Requests can wait until your break."}
          onRequest={(n) => request(cardFor, n)}
          onBlock={() => block(cardFor)}
          onReport={() => { setReportFor(cardFor); setCardFor(null); }}
          onClose={() => setCardFor(null)}
        />
      )}
      {recapOpen && <RecapDialog topic={topic} minutes={Math.round((focusedMs + (phase === "focus" ? Math.max(0, Math.min(now, phaseEndsAt ?? now) - phaseStart) * speed : 0)) / 60000)} onSave={standUp} onBack={() => { setRecapOpen(false); setRecapThen(null); }} />}
      {seat && phase === "break" && !breakHidden && <BreakCard clock={mmss(left)} compact={view === "3d" && webgl} onSkip={() => startPhase("focus", plan.f)} onHide={() => setBreakHidden(true)} />}
      {reportFor && <ReportDialog member={reportFor} onCancel={() => setReportFor(null)} onSend={(reason, note) => report(reportFor, reason, note)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

// A small round move pad for touch screens: drag the knob to walk (up = forward).
function MovePad({ stick }: { stick: { x: number; y: number } }) { // writes into the shared stick object
  const [knob, setKnob] = useState({ x: 0, y: 0 }); // knob offset in pixels (for drawing)
  const origin = useRef<{ x: number; y: number } | null>(null); // pad centre on screen while touched
  const R = 40; // setting: knob travel radius in pixels
  const move = (e: React.PointerEvent) => { // finger moved on the pad
    if (!origin.current) return; // not touched
    let dx = e.clientX - origin.current.x, dy = e.clientY - origin.current.y; // offset from centre
    const d = Math.hypot(dx, dy); // distance
    if (d > R) { dx *= R / d; dy *= R / d; } // keep inside the pad
    setKnob({ x: dx, y: dy }); // draw
    stick.x = dx / R; stick.y = -dy / R; // up on screen = forward
  };
  const end = () => { origin.current = null; setKnob({ x: 0, y: 0 }); stick.x = 0; stick.y = 0; }; // let go: stop
  useEffect(() => end, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="move-pad" aria-label="Move" onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; move(e); }} onPointerMove={(e) => { e.stopPropagation(); move(e); }} onPointerUp={end} onPointerCancel={end}>
      <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
