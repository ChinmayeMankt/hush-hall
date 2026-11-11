"use client"; // reads the signed-in user's own data

// My study log: totals that only count what you did, the list of sittings
// with recaps, rhythm/chime settings, sign out, and "delete my data".

import { useEffect, useState } from "react"; // React hooks
import { loadAccount, loadHistory, saveProfile, signOut } from "@/lib/account"; // account backend
import { callApi, hasSupabase } from "@/lib/backend/client"; // delete route
import { showUpSummary, weekSummary, type Profile, type Sitting } from "@/lib/profile"; // summaries
import { hallById } from "@/lib/halls"; // hall names

export default function Me() {
  const [profile, setProfile] = useState<Profile | null>(null); // my card
  const [history, setHistory] = useState<Sitting[]>([]); // sittings
  const [confirm, setConfirm] = useState(""); // typed DELETE
  const [msg, setMsg] = useState(""); // status line

  // Load my account and history.
  useEffect(() => {
    loadAccount().then(async (a) => {
      if (a.state === "signed_out") { window.location.href = "/signin?next=/me"; return; } // sign in first
      if (a.state === "needs_onboarding") { window.location.href = "/welcome"; return; } // finish sign-up
      setProfile(a.profile); setHistory(await loadHistory()); // show
    });
  }, []);

  // Change one setting and save it.
  const patch = async (p: Partial<Profile>) => { if (!profile) return; const next = { ...profile, ...p }; setProfile(next); setMsg((await saveProfile(next)) ? "Saved." : "Not saved, please try again."); }; // persist

  // Delete everything (real mode).
  const del = async () => {
    const r = await callApi<{ ok?: boolean }>("/api/account/delete", { confirm }); // server deletes the login; data cascades
    if (!r.ok) { setMsg("Couldn’t delete just now. Please try again."); return; } // failed
    await signOut(); window.location.href = "/"; // gone
  };

  if (!profile) return <p className="muted">Opening your log…</p>; // loading
  const week = weekSummary(history); // this week
  const show = showUpSummary(history); // positive-only counts
  return (
    <div>
      <h1>My study log</h1>
      <div className="grid2">
        <section className="card">
          <h2>So far</h2>
          <p>This week: {Math.floor(week.minutes / 60)} h {week.minutes % 60} min across {week.days} {week.days === 1 ? "day" : "days"}.</p>
          <p className="muted small">All time: {Math.floor(show.totalMinutes / 60)} h {show.totalMinutes % 60} min over {show.totalDays} {show.totalDays === 1 ? "day" : "days"} of showing up.{show.run >= 2 ? ` ${show.run} days in a row right now.` : ""}</p>
          <p className="small muted">Missed days don’t count against anything here. Every sitting adds; nothing resets.</p>
        </section>
        <section className="card">
          <h2>Settings</h2>
          <label htmlFor="rhythm">Usual rhythm</label>
          <select id="rhythm" value={`${profile.focusMin}/${profile.breakMin}`} onChange={(e) => { const [f, b] = e.target.value.split("/").map(Number); patch({ focusMin: f, breakMin: b }); }}>
            <option value="25/5">25 min focus · 5 min break</option>
            <option value="50/10">50 min focus · 10 min break</option>
            <option value="15/3">15 min focus · 3 min break</option>
          </select>
          <span className="toggle" style={{ marginTop: 10 }}><input type="checkbox" checked={profile.chime} onChange={(e) => patch({ chime: e.target.checked })} /> Soft chime when a phase ends</span>
          <span className="toggle"><input type="checkbox" checked={profile.hideFromRequests} onChange={(e) => patch({ hideFromRequests: e.target.checked })} /> Hide me from study-room requests</span>
          {msg && <p className="small muted">{msg}</p>}
          {hasSupabase && <div className="actions"><button className="ghost small" onClick={async () => { await signOut(); window.location.href = "/"; }}>Sign out</button></div>}
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Sittings</h2>
        {history.length === 0 ? <p className="muted">No sittings yet. Any desk, any time.</p> : (
          <ul className="history small">
            {history.map((s) => <li key={s.id ?? s.at}>{new Date(s.at).toLocaleString()} · {hallById(s.hallId)?.name ?? s.hallId} desk {s.seat} · {s.topic} · {s.minutes} min{s.note ? ` · “${s.note}”` : ""}</li>)}
          </ul>
        )}
      </section>

      {hasSupabase && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Delete my data</h2>
          <p className="small muted">This deletes your account, your sittings and recaps, usual desks, blocks, requests, room memberships, and reports you filed. It can’t be undone.</p>
          <label htmlFor="confirm">Type DELETE to confirm</label>
          <input id="confirm" type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <div className="actions"><button className="ghost" disabled={confirm !== "DELETE"} onClick={del}>Delete my account and data</button></div>
        </section>
      )}
    </div>
  );
}
