"use client"; // lobby reads the session / localStorage, so it renders in the browser

// Entrance / lobby: library card (nickname, avatar, privacy), a gentle "this
// week" summary that only counts what you did, and doors to the public halls.
// Real mode: you sign in first (and finish the 18+ sign-up); demo mode: local only.

import { useEffect, useState } from "react"; // React state + effects
import { HALLS, demoMembers } from "@/lib/halls"; // hall catalogue + demo occupants
import { AVATARS, weekSummary, showUpSummary, type Profile, type Sitting } from "@/lib/profile"; // shapes + summaries
import { loadAccount, saveProfile, loadHistory, hallCounts, loadNotices, dismissNotice, type AccountState } from "@/lib/account"; // account backend
import { hasSupabase } from "@/lib/backend/client"; // real or demo

export default function Lobby() {
  const [acct, setAcct] = useState<AccountState | null>(null); // null until loaded
  const [profile, setProfile] = useState<Profile | null>(null); // my library card
  const [history, setHistory] = useState<Sitting[]>([]); // past sittings
  const [counts, setCounts] = useState<Record<string, number> | null>(null); // people seated per hall (real mode)
  const [notices, setNotices] = useState<{ id: string; body: string }[]>([]); // private notices
  const [saved, setSaved] = useState<"" | "saving" | "saved" | "not_saved">(""); // nickname save state
  // After "Delete account" the browser lands here with ?deleted=1: say it plainly once.
  const [deleted, setDeleted] = useState(false); // show the "account deleted" line?
  useEffect(() => { setDeleted(new URLSearchParams(window.location.search).get("deleted") === "1"); }, []); // read the flag after mount

  // Load account, history, hall counts and notices once on mount.
  useEffect(() => {
    loadAccount().then(async (a) => {
      if (a.state === "needs_onboarding") { window.location.href = "/welcome"; return; } // finish sign-up first
      setAcct(a); // signed out / ready
      if (a.state !== "ready") return; // nothing else to load
      setProfile(a.profile); // card
      const [h, c, n] = await Promise.all([loadHistory(), hallCounts(), loadNotices()]); // in parallel
      setHistory(h); setCounts(c); setNotices(n); // show
    });
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

  if (!acct) return <p className="muted">Opening the doors…</p>; // first paint

  // Signed out (real mode): a calm welcome with one way in.
  if (acct.state === "signed_out") return (
    <div>
      <section className="hero">
        <h1>Welcome to the library.</h1>
        {deleted && <p className="small">Your account and its data have been deleted.</p>}
        <p className="muted">Take a numbered desk in a quiet hall, write what you’re working on, and study next to other people. No chat, no feeds, no guilt.</p>
        <p><a className="btn sage" href="/signin">Sign in or create an account</a></p>
        <p className="small muted">Hush Hall is for people aged 18 and over. Your desk shows only your nickname, avatar and topic. <a href="/rules">House rules</a> · <a href="/privacy">Privacy policy</a></p>
      </section>
    </div>
  );

  if (!profile) return <p className="muted">Opening the doors…</p>; // ready state but card not set yet
  const week = weekSummary(history); // this week
  const show = showUpSummary(history); // positive-only counts
  const ready = profile.name.trim().length > 0; // need a name before entering a hall

  return (
    <div>
      {/* Greeting */}
      <section className="hero">
        <h1>Welcome back to the library.</h1>
        <p className="muted">Pick a hall, take a desk, write what you are working on. Everyone here is studying quietly.</p>
      </section>

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
      <h2 style={{ marginTop: 28 }}>Public halls</h2>
      {!ready && <p className="muted small">Write a name on your library card to walk in.</p>}
      <div className="grid2">
        {HALLS.map((h) => {
          const n = counts ? counts[h.id] ?? 0 : demoMembers(h.id).length; // real count, or demo students
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
  );
}
