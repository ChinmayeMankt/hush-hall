"use client"; // the hall is fully interactive and uses browser APIs

// The hall: rows of numbered desks, the sit -> topic -> timer -> recap ritual,
// quiet join requests, block/report, hide-from-requests, and hall hopping.
// Presence goes through getPresence(), so the backend can change later.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"; // React hooks
import Desk from "./Desk"; // one desk tile
import { BreakCard, DeskCard, RecapDialog, SitDialog } from "./Dialogs"; // paper dialogs
import { HALLS, ROWS, DESKS_PER_ROW, demoMembers, hallById } from "@/lib/halls"; // hall data
import { getPresence, type JoinRequest, type Member, type Phase } from "@/lib/presence"; // presence layer
import { addSitting, loadProfile, saveProfile, setUsualSeat, usualSeat, type Profile } from "@/lib/profile"; // local storage helpers
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
  const demos = useMemo(() => demoMembers(hallId), [hallId]); // simulated students

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
  const [room, setRoom] = useState<string | null>(null); // current small study room name
  const [toast, setToast] = useState<string | null>(null); // one quiet message at a time

  // ---- view settings ----
  const [webgl, setWebgl] = useState(false); // can this device draw 3D?
  const [view, setView] = useState<"3d" | "2d">("2d"); // which hall view is shown
  const [reduced, setReduced] = useState(false); // prefers-reduced-motion
  const [rain, setRain] = useState(false); // rain ambience (off by default)
  const [forceHover, setForceHover] = useState<string | null>(null); // ?hover=B1 for previews

  const phaseRef = useRef(phase); // latest phase for presence callbacks
  phaseRef.current = phase; // keep it current every render

  // Show a quiet message for a few seconds.
  const say = useCallback((msg: string) => {
    setToast(msg); // show
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500); // hide after 3.5 s
  }, []);

  // Load profile, usual seat and demo speed on mount.
  useEffect(() => {
    const p = loadProfile(); // this tab's profile
    if (!p.name.trim()) p.name = "Guest"; // fallback name if they skipped the lobby
    setProfile(p); // store it
    setPlan({ f: p.focusMin, b: p.breakMin }); // last rhythm
    setUsual(usualSeat(hallId)); // returning seat
    const q = new URLSearchParams(window.location.search); // URL options
    const sp = Number(q.get("speed")); // demo speed
    if (sp > 0) setSpeed(sp); // apply if given
    const ok = hasWebGL(); // 3D possible?
    setWebgl(ok); // remember
    const saved = (q.get("view") ?? localStorage.getItem("hh.view")) as "3d" | "2d" | null; // URL or saved choice
    setView(ok && saved !== "2d" ? "3d" : "2d"); // 3D by default when available
    setForceHover(q.get("hover")); // optional forced hover
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)"); // OS motion setting
    setReduced(prefersReducedMotion()); // initial value
    const onMq = () => setReduced(mq.matches); // live updates
    mq.addEventListener("change", onMq); // listen
    return () => mq.removeEventListener("change", onMq); // cleanup
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
      topic, // public topic
      phase, // timer phase
      phaseEndsAt, // countdown end
      hideFromRequests: profile.hideFromRequests, // privacy toggle
      lastSeen: Date.now(), // refreshed by the provider
    };
  }, [profile, seat, topic, phase, phaseEndsAt]);

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
    const offRes = presence.onResponse((res) => {
      if (res.accepted) { setRoom(res.roomName ?? "Study room"); say("Request accepted. You’re in a small study room now."); } // accepted
      else say("They’d rather study solo right now. No worries."); // declined, gently
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

  // In the 3D view, start downloading the characters seated students need right
  // away, in parallel with the 3D bundle (the avatars reuse these downloads).
  useEffect(() => {
    if (view === "3d" && webgl) prefetchModels(seatMap.values()); // each file is fetched once, repeats are free
  }, [view, webgl, seatMap]);

  // If another tab claimed my desk at the same moment, the lower id keeps it.
  useEffect(() => {
    if (!seat || !profile) return; // only while seated
    const clash = others.find((o) => o.seat === seat && o.id < profile.id); // deterministic tie-break
    if (clash) { setSeat(null); setPhase("idle"); setPhaseEndsAt(null); say(`Desk ${seat} was just taken. Pick another one?`); } // stand back up
  }, [others, seat, profile, say]);

  // Update profile settings (privacy toggle, chime) and persist.
  const patchProfile = (p: Partial<Profile>) => {
    if (!profile) return; // not ready
    const next = { ...profile, ...p }; // merge
    setProfile(next); // re-render
    saveProfile(next); // persist
  };

  // Tap on a desk: sit if vacant and I am standing; open desk card if occupied.
  const onDesk = (s: string) => {
    const who = seatMap.get(s); // occupant
    if (!who) {
      if (seat) { say("You already have a desk. Stand up first to move."); return; } // one desk at a time
      setSitAt(s); // open sit dialog
    } else if (who.id !== profile?.id) setCardFor(who); // look at someone else's desk
  };

  // Ritual step 2-3: write topic, sit, start the timer.
  const sit = (t: string, f: number, b: number, remember: boolean) => {
    if (!sitAt || !profile) return; // guard
    setSeat(sitAt); // take the desk
    setTopic(t); // public topic
    setPlan({ f, b }); // rhythm
    setFocusedMs(0); // fresh sitting
    patchProfile({ focusMin: f, breakMin: b }); // remember rhythm
    if (remember) { setUsualSeat(hallId, sitAt); setUsual(sitAt); } // returning seat
    setSitAt(null); // close dialog
    startPhase("focus", f); // start focusing right away
  };

  // Ritual step 4: stand up with a short recap.
  const standUp = (note: string) => {
    if (!seat) return; // not seated
    const extra = bankFocus(); // count the running focus phase
    const minutes = Math.round((focusedMs + extra) / 60000); // total virtual minutes
    addSitting({ at: Date.now(), hallId, seat, topic, minutes, note }); // save history
    setRecapOpen(false); // close recap
    setSeat(null); setTopic(""); setPhase("idle"); setPhaseEndsAt(null); setFocusedMs(0); setRoom(null); // back to the aisle
    say(minutes > 0 ? `Saved: ${minutes} min on ${topic}.` : "Saved. See you at your desk soon."); // quiet confirmation
  };

  // Send a join request (demo students answer by themselves after a moment).
  const request = (target: Member, note: string) => {
    setCardFor(null); // close the card
    if (target.isDemo) {
      say(`Request sent to ${target.name}.`); // feedback
      window.setTimeout(() => { setRoom(`${target.name} & ${profile?.name}`); say(`${target.name} accepted. You’re in a small study room now.`); }, 2500); // simulated accept
      return;
    }
    const sent = presence.sendRequest(target.id, note); // real tab
    say(sent ? `Request sent to ${target.name}. They’ll see it when they’re not mid-focus.` : `Not sent. ${target.name} may not be taking requests, or you’ve sent a few recently. Try again in a little while.`); // feedback
  };

  // Answer an incoming request.
  const answer = (r: JoinRequest, ok: boolean) => {
    presence.respond(r, ok); // tell the sender
    setInbox((i) => i.filter((x) => x.id !== r.id)); // remove the note
    if (ok) setRoom(`${r.from.name} & ${profile?.name}`); // join the room
  };

  // Block someone: their desk and requests disappear for me.
  const block = (m: Member) => {
    presence.block(m.id); // provider-level block
    setBlocked((b) => new Set(b).add(m.id)); // local view (covers demo students too)
    setInbox((i) => i.filter((x) => x.from.id !== m.id)); // drop their notes
    setCardFor(null); // close the card
    say(`${m.name} is blocked. You won’t see their desk or requests.`); // confirm
  };

  // Report someone (prototype: stored locally only; real app sends to moderators).
  const report = (m: Member) => {
    const key = "hh.reports"; // local storage key
    const all = JSON.parse(localStorage.getItem(key) ?? "[]"); // existing reports
    all.push({ id: m.id, name: m.name, hallId, at: Date.now() }); // add one
    localStorage.setItem(key, JSON.stringify(all)); // save
    setCardFor(null); // close
    say("Thanks. Report noted (prototype: kept on this device only)."); // confirm
  };

  if (!profile || !me) return <p className="muted">Walking in…</p>; // first paint

  // Derived values for the focus bar.
  const left = phaseEndsAt ? phaseEndsAt - now : 0; // real ms left in phase
  const total = phaseEndsAt ? phaseEndsAt - phaseStart : 1; // real ms in phase
  const pct = phaseEndsAt ? Math.min(100, Math.max(0, ((now - phaseStart) / total) * 100)) : 0; // progress %
  const liveCount = seatMap.size; // desks in use (incl. me)

  return (
    <div>
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
      {room && (
        <div className="room-banner">
          <b>Study room:</b> {room}. Prototype: you stay at your desks. In v1 you’d move to a small audio room (mic muted by default, push-to-talk, never recorded).{" "}
          <button className="ghost small" onClick={() => setRoom(null)}>Leave room</button>
        </div>
      )}

      {/* 3D reading room when WebGL is available and chosen */}
      {view === "3d" && webgl ? (
        <div className="hall3d-wrap">
          <Hall3D seatMap={seatMap} myId={profile.id} mySeat={seat} reduced={reduced} rain={rain} onPick={onDesk} hoverSeat={forceHover} />
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
                <button className="ghost small" onClick={() => setRecapOpen(true)}>Stand up</button>
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
      {!seat && <p className="muted small" style={{ marginTop: 10 }}>Tap a vacant desk to sit. Tap someone’s desk to see their topic or ask to study together. Open another tab to see live presence. (A few desks are local demo students.)</p>}

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
      {sitAt && <SitDialog seat={sitAt} defaultFocus={plan.f} defaultBreak={plan.b} onCancel={() => setSitAt(null)} onSit={sit} />}
      {cardFor && (
        <DeskCard
          member={cardFor}
          canRequest={!cardFor.hideFromRequests && phase !== "focus" && !room}
          reason={cardFor.hideFromRequests ? `${cardFor.name} isn’t taking study-room requests right now.` : room ? "You’re already in a study room." : "You’re mid-focus. Requests can wait until your break."}
          onRequest={(n) => request(cardFor, n)}
          onBlock={() => block(cardFor)}
          onReport={() => report(cardFor)}
          onClose={() => setCardFor(null)}
        />
      )}
      {recapOpen && <RecapDialog topic={topic} minutes={Math.round((focusedMs + (phase === "focus" ? Math.max(0, Math.min(now, phaseEndsAt ?? now) - phaseStart) * speed : 0)) / 60000)} onSave={standUp} onBack={() => setRecapOpen(false)} />}
      {seat && phase === "break" && !breakHidden && <BreakCard clock={mmss(left)} compact={view === "3d" && webgl} onSkip={() => startPhase("focus", plan.f)} onHide={() => setBreakHidden(true)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
