"use client"; // reads the signed-in user's own data

// My study log: totals that only count what you did, the list of sittings
// with recaps, rhythm/chime settings, sign out, and "delete account".

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
  // Account deletion is two calm steps: open the panel, then type DELETE and confirm.
  const [delOpen, setDelOpen] = useState(false); // second step shown?
  const [delBusy, setDelBusy] = useState(false); // request in flight
  const [delMsg, setDelMsg] = useState(""); // result line next to the button

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

  // Delete the account and everything tied to it (real mode). The server
  // deletes the login; the database removes every related row with it.
  const del = async () => {
    if (confirm !== "DELETE" || delBusy) return; // only after the typed confirmation, once
    setDelBusy(true); setDelMsg(""); // busy, clear old message
    const r = await callApi<{ ok?: boolean }>("/api/account/delete", { confirm }); // server deletes the login; data cascades
    if (!r.ok) { setDelBusy(false); setDelMsg("Couldn’t delete just now. Nothing was removed. Please try again, or email us from the privacy policy page."); return; } // failed: say so plainly
    await signOut(); window.location.href = "/?deleted=1"; // signed out and gone
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

      {/* Delete account: a clear, two-step, permanent action (Google Play requires an in-app way) */}
      {hasSupabase && (
        <section className="card" id="delete-account" style={{ marginTop: 16 }}>
          <h2>Delete account</h2>
          <p className="small muted">This permanently deletes your Hush Hall account: your login and email address, profile and settings, sittings and recaps, usual desks, walking position, blocks, requests, study-room memberships, notices, and reports you filed or that were filed about you. It can’t be undone. <a href="/privacy#delete">Privacy policy</a></p>
          {!delOpen ? (
            <div className="actions"><button className="ghost" onClick={() => setDelOpen(true)}>Delete my account…</button></div>
          ) : (
            <>
              <label htmlFor="confirm">Type DELETE to confirm</label>
              <input id="confirm" type="text" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <div className="actions">
                <button className="ghost" disabled={confirm !== "DELETE" || delBusy} onClick={del}>{delBusy ? "Deleting…" : "Permanently delete my account"}</button>
                <button className="ghost small" disabled={delBusy} onClick={() => { setDelOpen(false); setConfirm(""); setDelMsg(""); }}>Keep my account</button>
              </div>
              {delMsg && <p className="small muted">{delMsg}</p>}
            </>
          )}
        </section>
      )}
    </div>
  );
}
