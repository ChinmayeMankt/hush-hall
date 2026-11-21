"use client"; // the front page reads the session / localStorage, so it renders in the browser

// Front page: the live 3D Main Reading Hall right away, with one gentle card
// over it. New visitors type a nickname, tick the 18+ box and take a desk as a
// guest (no email). People with an account can still sign in. Signed-in
// people get a "welcome back" card, and their lobby (library card, this week,
// halls) sits below the hall as before.

import { useEffect, useRef, useState } from "react"; // React state + effects
import { HALLS, demoMembers, MAIN_HALL } from "@/lib/halls"; // hall catalogue + demo occupants
import { AVATARS, weekSummary, showUpSummary, type Profile, type Sitting } from "@/lib/profile"; // shapes + summaries
import { loadAccount, saveProfile, loadHistory, hallCounts, loadNotices, dismissNotice, type AccountState } from "@/lib/account"; // account backend
import { enterAsGuest } from "@/lib/guest"; // nickname-only entry
import { LAMP_COLORS_SIGNUP, suggestNickname } from "@/lib/signupOptions"; // lamp colours + ready-made nicknames
import { hasSupabase } from "@/lib/backend/client"; // real or demo
import HallPreview from "@/components/HallPreview"; // the live 3D hall on the front page

// Where to go after entering: a hall page passed in ?next=, or the Main Reading Hall, opening a desk.
function destination(desk: string | null): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? ""; // e.g. /hall/science-wing
  const base = /^\/hall\/[a-z-]+$/.test(next) ? next : `/hall/${MAIN_HALL}`; // only hall pages, never another site
  return `${base}?desk=${encodeURIComponent(desk ?? "any")}`; // the hall opens the sit step for this desk (or a free one)
}

export default function Lobby() {
  const [acct, setAcct] = useState<AccountState | null>(null); // null until loaded
  const [failed, setFailed] = useState(false); // could not reach the library
  const [profile, setProfile] = useState<Profile | null>(null); // my library card
  const [history, setHistory] = useState<Sitting[]>([]); // past sittings
  const [counts, setCounts] = useState<Record<string, number> | null>(null); // people seated per hall (real mode)
  const [notices, setNotices] = useState<{ id: string; body: string }[]>([]); // private notices
  const [saved, setSaved] = useState<"" | "saving" | "saved" | "not_saved">(""); // nickname save state
  // After "Delete account" the browser lands here with ?deleted=1: say it plainly once.
  const [deleted, setDeleted] = useState(false); // show the "account deleted" line?
  useEffect(() => { setDeleted(new URLSearchParams(window.location.search).get("deleted") === "1"); }, []); // read the flag after mount

  // Guest card: nickname, avatar, one 18+ box, and the desk tapped in the hall (if any).
  const [nick, setNick] = useState(""); // nickname typed (starts with a friendly suggestion)
  const [avatar, setAvatar] = useState(AVATARS[0]); // emoji avatar
  const [adult, setAdult] = useState(false); // 18+ and house rules box (NOT pre-ticked)
  const [desk, setDesk] = useState<string | null>(null); // desk tapped in the hall, if any
  const [busy, setBusy] = useState(false); // entering
  const [msg, setMsg] = useState(""); // calm error line
  const nickRef = useRef<HTMLInputElement>(null); // to focus the nickname box when a desk is tapped
  useEffect(() => { setNick((n) => n || suggestNickname()); }, []); // suggestion after mount (no server/client mismatch)

  // Load account, history, hall counts and notices once on mount.
  useEffect(() => {
    loadAccount().then(async (a) => {
      if (a.state === "needs_onboarding" && !a.guest) { window.location.href = "/welcome"; return; } // email account: finish the 18+ sign-up first
      setAcct(a); // signed out / guest without a card yet / ready
      if (a.state !== "ready") return; // nothing else to load
      setProfile(a.profile); // card
      const [h, c, n] = await Promise.all([loadHistory(), hallCounts(), loadNotices()]); // in parallel
      setHistory(h); setCounts(c); setNotices(n); // show
    }).catch(() => setFailed(true)); // never hang on "Opening the doors…"
  }, []);

  // Update one profile field and persist it (debounced for typing in the nickname).
  const timer = useState<{ t: ReturnType<typeof setTimeout> | null }>({ t: null })[0]; // debounce holder
  const patch = (p: Partial<Profile>) => {
    if (!profile) return; // not loaded yet
    const next = { ...profile, ...p }; // merge change
    setProfile(next); // re-render
    if (!hasSupabase) { saveProfile(next); return; } // demo: localStorage is instant, save right away
    if (timer.t) clearTimeout(timer.t); // restart debounce
    setSaved("saving"); // quiet status
    timer.t = setTimeout(async () => setSaved((await saveProfile(next)) ? "saved" : "not_saved"), 500); // save after typing pauses
  };

  // Tapping a desk in the hall: remember it for the guest, or walk a signed-in person straight to it.
  const pickDesk = (s: string) => {
    if (acct?.state === "ready") { window.location.href = destination(s); return; } // already in: go and sit
    setDesk(s); // remember the desk
    nickRef.current?.focus(); // the card is the next step
  };

  // Enter as a guest: no email, just the nickname and the 18+ box.
  const enter = async (e: React.FormEvent) => {
    e.preventDefault(); // no reload
    if (busy) return; // once
    setBusy(true); setMsg(""); // busy
    const r = await enterAsGuest(nick, avatar, LAMP_COLORS_SIGNUP[0], adult).catch(() => ({ ok: false as const, reason: "error" as const })); // sign in without email + make the card
    if (r.ok) { window.location.href = destination(desk); return; } // into the hall
    setBusy(false); // let them try again
    setMsg(r.reason === "adult" ? "Please tick the box to confirm you’re 18 or older." : r.reason === "nickname" ? "Please write a nickname for your desk." : r.reason === "nickname_not_allowed" ? "That nickname can’t be used. Try another?" : r.reason === "guest_off" ? "Guest entry isn’t switched on yet. You can sign in with email for now." : r.reason === "rate_limited" ? "Too many new guests from this network just now. Please try again in a little while." : "Something went wrong. Please try again."); // calm, specific line
  };

  // The card that floats over the hall.
  let card: React.ReactNode; // depends on where the visitor is
  if (failed) card = <p className="small">Couldn’t open the doors just now. <button className="ghost small" onClick={() => window.location.reload()}>Try again</button></p>; // load failed
  else if (!acct) card = <p className="small muted">Opening the doors…</p>; // first paint
  else if (acct.state === "ready") card = ( // signed in already
    <div>
      <h1 className="landing-title">Welcome back{profile?.name.trim() ? `, ${profile.name.trim()}` : ""}.</h1>
      <p className="small muted">Your desk is waiting. Tap a free desk in the hall, or go straight in.</p>
      <div className="actions"><a className="btn sage" href={`/hall/${MAIN_HALL}?desk=any`}>Take a desk</a><a className="small" href="#lobby" style={{ alignSelf: "center" }}>Your lobby ↓</a></div>
    </div>
  );
  else card = ( // a new visitor (or a guest whose card wasn't made yet)
    <form onSubmit={enter}>
      <h1 className="landing-title">Take a desk.</h1>
      {deleted && <p className="small">Your account and its data have been deleted.</p>}
      <p className="small muted">A quiet library where people study side by side. No chat, no feeds, no guilt. Just pick a name.</p>
      <label htmlFor="nick">Nickname (shown on your desk)</label>
      <div className="row" style={{ gap: 6 }}>
        <input id="nick" ref={nickRef} type="text" required maxLength={24} value={nick} onChange={(e) => setNick(e.target.value)} placeholder="e.g. Owl" autoComplete="off" />
        <button type="button" className="ghost small" onClick={() => setNick(suggestNickname())} title="Suggest another nickname">↻</button>
      </div>
      <div className="avatars landing-avatars" role="group" aria-label="Avatar">
        {AVATARS.map((a) => <button key={a} type="button" className={`avatar-pick ${avatar === a ? "on" : ""}`} onClick={() => setAvatar(a)} aria-label={`avatar ${a}`}>{a}</button>)}
      </div>
      <label className="toggle landing-adult">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
        <span>I’m 18 or older and agree to the <a href="/rules" target="_blank">house rules</a> and <a href="/privacy" target="_blank">privacy policy</a>.</span>
      </label>
      {msg && <p className="small muted">{msg}</p>}
      <div className="actions"><button type="submit" className="sage" disabled={busy || !adult || !nick.trim()}>{busy ? "One moment…" : desk ? `Take desk ${desk}` : "Take a desk"}</button></div>
      <p className="small muted landing-foot">No email needed. Your desk shows only your nickname, avatar and topic. Have an account? <a href="/signin">Sign in</a></p>
    </form>
  );

  // Signed-in lobby below the hall (library card, this week, halls), as before.
  const ready = !!profile && profile.name.trim().length > 0; // need a name before entering a hall
  const week = weekSummary(history); // this week
  const show = showUpSummary(history); // positive-only counts

  return (
    <div>
      {/* The live hall with the card over it */}
      <HallPreview onPickDesk={pickDesk}>{card}</HallPreview>

      {/* Below the hall: the signed-in lobby */}
      {acct?.state === "ready" && profile && (
        <div id="lobby" className="landing-lobby">
        {/* Private notices (e.g. after a moderator review). Calm, dismissible, no details about anyone else. */}
        {notices.map((n) => (
          <div key={n.id} className="card notice">
            <p className="small">{n.body} <a href="/rules">House rules</a></p>
            <button className="ghost small" onClick={() => { dismissNotice(n.id); setNotices((l) => l.filter((x) => x.id !== n.id)); }}>OK</button>
          </div>
        ))}

        <div className="grid2">
          {/* Library card: name, avatar, privacy */}
          <section className="card">
            <h2>Your library card</h2>
            <label htmlFor="name">Nickname (shown on your desk with your avatar and topic, nothing else)</label>
            <input id="name" type="text" maxLength={24} placeholder="e.g. Owl" value={profile.name} onChange={(e) => patch({ name: e.target.value })} />
            {saved === "not_saved" && <p className="small muted">That nickname wasn’t saved. Try a different one?</p>}
            <label>Avatar</label>
            <div className="avatars">
              {AVATARS.map((a) => (
                <button key={a} type="button" className={`avatar-pick ${profile.avatar === a ? "on" : ""}`} onClick={() => patch({ avatar: a })} aria-label={`avatar ${a}`}>
                  {a}
                </button>
              ))}
            </div>
            <label>Privacy</label>
            <span className="toggle">
              <input type="checkbox" checked={profile.hideFromRequests} onChange={(e) => patch({ hideFromRequests: e.target.checked })} />
              Hide me from study-room requests
            </span>
            {hasSupabase && <p className="small muted" style={{ marginTop: 10 }}><a href="/me">My study log &amp; account</a> · <a href="/privacy">Privacy</a>{acct.state === "ready" && acct.isModerator && <> · <a href="/mod">Report queue</a></>}</p>}
          </section>

          {/* Gentle week summary: counts what you did, never what you missed */}
          <section className="card">
            <h2>This week</h2>
            {week.sittings === 0 ? (
              <p className="muted">Nothing logged yet this week. Any desk, any time, is a good start.</p>
            ) : (
              <p>
                {Math.floor(week.minutes / 60)} h {week.minutes % 60} min of focus across {week.days} {week.days === 1 ? "day" : "days"}. Nice, steady work.
              </p>
            )}
            {show.thisMonth > 0 && <p className="small muted">You showed up on {show.thisMonth} {show.thisMonth === 1 ? "day" : "days"} this month{show.run >= 2 ? `, including ${show.run} days in a row` : ""}.</p>}
            {/* Recent sittings */}
            {history.length > 0 && (
              <ul className="history small muted">
                {history.slice(0, 4).map((s) => (
                  <li key={s.id ?? s.at}>
                    {new Date(s.at).toLocaleDateString()} · {s.topic} · {s.minutes} min{s.note ? ` · “${s.note}”` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Hall doors */}
        <h2 style={{ marginTop: 28 }}>Halls</h2>
        {!ready && <p className="muted small">Write a name on your library card to walk in.</p>}
        <div className="grid2">
          {HALLS.map((h) => {
            const n = counts ? counts[h.id] ?? 0 : demoMembers(h.id).length; // real count, or demo students
            if (h.comingSoon) return ( // locked hall: visible, not enterable
              <div key={h.id} className="card door locked" aria-disabled="true" style={{ opacity: 0.65, cursor: "default" }}>
                <h3>🔒 {h.name}</h3>
                <div className="muted small">{h.mood}</div>
                <div className="small" style={{ marginTop: 6 }}>Coming soon</div>
              </div>
            );
            return (
              <a key={h.id} href={ready ? `/hall/${h.id}` : undefined} className="card door" aria-disabled={!ready} style={ready ? undefined : { opacity: 0.6, pointerEvents: "none" }}>
                <h3>{h.name}</h3>
                <div className="muted small">{h.mood}</div>
                <div className="rule small">{h.rule}</div>
                <div className="small" style={{ marginTop: 6 }}>{counts ? (n === 0 ? "Quiet right now. Be the first lamp on." : `${n} studying now`) : `${n}+ studying now (demo)`}</div>
              </a>
            );
          })}
        </div>
        {!hasSupabase && <p className="small muted" style={{ marginTop: 16 }}>Demo mode: no server is configured, so everything stays in this browser.</p>}
        </div>
      )}
    </div>
  );
}
