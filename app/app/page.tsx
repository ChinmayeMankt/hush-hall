"use client"; // lobby reads localStorage, so it renders in the browser

// Entrance / lobby: set a name and avatar, see a gentle weekly summary,
// then pick a public hall to walk into.

import { useEffect, useState } from "react"; // React state + effects
import { HALLS, demoMembers } from "@/lib/halls"; // hall catalogue + demo occupants
import { AVATARS, loadHistory, loadProfile, saveProfile, weekSummary, type Profile, type Sitting } from "@/lib/profile"; // local profile + history

export default function Lobby() {
  const [profile, setProfile] = useState<Profile | null>(null); // null until loaded in the browser
  const [history, setHistory] = useState<Sitting[]>([]); // past sittings

  // Load profile and history once on mount (browser only).
  useEffect(() => {
    setProfile(loadProfile()); // this tab's identity
    setHistory(loadHistory()); // local history
  }, []);

  // Update one profile field and persist it.
  const patch = (p: Partial<Profile>) => {
    if (!profile) return; // not loaded yet
    const next = { ...profile, ...p }; // merge change
    setProfile(next); // re-render
    saveProfile(next); // persist
  };

  if (!profile) return <p className="muted">Opening the doors…</p>; // first paint before storage loads

  const week = weekSummary(history); // gentle weekly numbers
  const ready = profile.name.trim().length > 0; // need a name before entering a hall

  return (
    <div>
      {/* Greeting */}
      <section className="hero">
        <h1>Welcome to the library.</h1>
        <p className="muted">Pick a hall, take a desk, write what you are working on. Everyone here is studying quietly.</p>
      </section>

      <div className="grid2">
        {/* Library card: name, avatar, privacy */}
        <section className="card">
          <h2>Your library card</h2>
          <label htmlFor="name">Nickname (shown on your desk with your avatar and topic, nothing else)</label>
          <input id="name" type="text" maxLength={24} placeholder="e.g. Owl" value={profile.name} onChange={(e) => patch({ name: e.target.value })} />
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
        </section>

        {/* Gentle week summary: no streak-loss language, no red */}
        <section className="card">
          <h2>This week</h2>
          {week.sittings === 0 ? (
            <p className="muted">Nothing logged yet this week. Any desk, any time, is a good start.</p>
          ) : (
            <p>
              {Math.floor(week.minutes / 60)} h {week.minutes % 60} min of focus across {week.days} {week.days === 1 ? "day" : "days"}. Nice, steady work.
            </p>
          )}
          {/* Recent sittings */}
          {history.length > 0 && (
            <ul className="history small muted">
              {history.slice(0, 4).map((s) => (
                <li key={s.at}>
                  {new Date(s.at).toLocaleDateString()} · {s.topic} · {s.minutes} min{s.note ? ` · “${s.note}”` : ""}
                </li>
              ))}
            </ul>
          )}
          <p className="small muted">A shareable weekly “study wrapped” card comes in a later version.</p>
        </section>
      </div>

      {/* Hall doors */}
      <h2 style={{ marginTop: 28 }}>Public halls</h2>
      {!ready && <p className="muted small">Write a name on your library card to walk in.</p>}
      <div className="grid2">
        {HALLS.map((h) => (
          <a key={h.id} href={ready ? `/hall/${h.id}` : undefined} className="card door" aria-disabled={!ready} style={ready ? undefined : { opacity: 0.6, pointerEvents: "none" }}>
            <h3>{h.name}</h3>
            <div className="muted small">{h.mood}</div>
            <div className="rule small">{h.rule}</div>
            <div className="small" style={{ marginTop: 6 }}>{demoMembers(h.id).length}+ studying now</div>
          </a>
        ))}
      </div>
    </div>
  );
}
