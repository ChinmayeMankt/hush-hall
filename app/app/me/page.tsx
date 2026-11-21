"use client"; // reads the signed-in user's own data

// My study log: totals that only count what you did, the list of sittings
// with recaps, rhythm/chime settings, sign out, and "delete account".

import { useEffect, useState } from "react"; // React hooks
import { loadAccount, loadHistory, saveProfile, signOut } from "@/lib/account"; // account backend
import { callApi, hasSupabase } from "@/lib/backend/client"; // delete route
import { showUpSummary, weekSummary, type Profile, type Sitting } from "@/lib/profile"; // summaries
import { hallById } from "@/lib/halls"; // hall names
import { ALERT_OPTIONS, getAlertSound, playAlert, saveAlertSound, type AlertSound } from "@/lib/chime"; // timer alert sounds
import { saveDeskWithEmail, confirmEmailCode } from "@/lib/guest"; // guests: attach an email to the same account

export default function Me() {
  const [profile, setProfile] = useState<Profile | null>(null); // my card
  const [history, setHistory] = useState<Sitting[]>([]); // sittings
  const [confirm, setConfirm] = useState(""); // typed DELETE
  const [msg, setMsg] = useState(""); // status line
  const [loadFailed, setLoadFailed] = useState(false); // could not load my log
  const [alertSound, setAlertSound] = useState<AlertSound>("ping"); // timer sound (saved on this device)
  useEffect(() => { setAlertSound(getAlertSound()); }, []); // load saved choice
  // Account deletion is two calm steps: open the panel, then type DELETE and confirm.
  const [delOpen, setDelOpen] = useState(false); // second step shown?
  const [delBusy, setDelBusy] = useState(false); // request in flight
  const [delMsg, setDelMsg] = useState(""); // result line next to the button
  // Guests (no email yet): an optional, quiet "save your desk with email" card.
  const [guest, setGuest] = useState(false); // signed in without an email?
  const [saveEmail, setSaveEmail] = useState(""); // address typed
  const [saveStage, setSaveStage] = useState<"form" | "sending" | "sent" | "taken" | "error" | "done">("form"); // progress
  const [saveCode, setSaveCode] = useState(""); // code from the email (any device)
  const [codeBad, setCodeBad] = useState(false); // wrong or expired code
  const [outAsk, setOutAsk] = useState(false); // guest pressed "Sign out": ask once, because a guest can't sign back in

  // Load my account and history.
  useEffect(() => {
    loadAccount().then(async (a) => {
      if (a.state === "signed_out") { window.location.href = "/signin?next=/me"; return; } // sign in first
      if (a.state === "needs_onboarding") { window.location.href = a.guest ? "/" : "/welcome"; return; } // finish sign-up (guests: the 18+ box on the front page)
      setGuest(a.guest); // show the save-with-email card for guests only
      setProfile(a.profile); setHistory(await loadHistory()); // show
    }).catch(() => setLoadFailed(true)); // don't hang on the loading line
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

  if (loadFailed) return <p className="muted">Couldn’t open your log just now. <button className="ghost small" onClick={() => window.location.reload()}>Try again</button></p>; // load failed
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
          <label htmlFor="alertsound" style={{ marginTop: 10 }}>Timer sound (when a focus or break ends)</label>
          <select id="alertsound" value={alertSound} onChange={(e) => { const v = e.target.value as AlertSound; setAlertSound(v); saveAlertSound(v); playAlert(v); }}>
            {ALERT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <span className="small muted">Saved on this device.</span>
          <span className="toggle"><input type="checkbox" checked={profile.hideFromRequests} onChange={(e) => patch({ hideFromRequests: e.target.checked })} /> Hide me from study-room requests</span>
          {msg && <p className="small muted">{msg}</p>}
          {hasSupabase && <div className="actions"><button className="ghost small" onClick={async () => { if (guest && !outAsk) { setOutAsk(true); return; } await signOut(); window.location.href = "/"; }}>{guest && outAsk ? "Sign out anyway" : "Sign out"}</button></div>}
          {guest && outAsk && <p className="small muted">You’re a guest, so there’s no way to sign back in to this desk later. Its hours and desk items stay with this account unless you save it with an email below first.</p>}
        </section>
      </div>

      {/* Guests only: keep this desk (hours, study days, desk items) by adding an email to the same account. Optional; never shown during focus. */}
      {guest && (
        <section className="card" id="save-desk" style={{ marginTop: 16 }}>
          <h2>Save your desk with email</h2>
          {saveStage === "done" ? <p className="small">Saved. Your desk, hours and desk items now stay with {saveEmail.trim()}, and you can sign in with it on any device.</p>
            : saveStage === "sent" ? (
              <form onSubmit={async (e) => { e.preventDefault(); setCodeBad(false); if (await confirmEmailCode(saveEmail, saveCode)) { setSaveStage("done"); setGuest(false); } else setCodeBad(true); }}>
                <p className="small">We sent a confirmation to <b>{saveEmail.trim()}</b>. Tap the link in it on this device, or type the code from it here.</p>
                <label htmlFor="savecode">Code from the email</label>
                <input id="savecode" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={saveCode} onChange={(e) => setSaveCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
                {codeBad && <p className="small muted">That code didn’t work. Check it, or tap the link in the email instead.</p>}
                <div className="actions"><button type="submit" className="sage small" disabled={saveCode.length < 6}>Confirm</button><button type="button" className="ghost small" onClick={() => { setSaveStage("form"); setSaveCode(""); }}>Use another address</button></div>
              </form>
            ) : (
              <form onSubmit={async (e) => { e.preventDefault(); setSaveStage("sending"); setSaveStage(await saveDeskWithEmail(saveEmail).catch(() => "error" as const)); }}>
                <p className="small muted">You’re here as a guest. If you like, add an email so this same desk, with its hours and desk items, stays yours on any device. Optional, and nothing changes if you don’t.</p>
                <label htmlFor="saveemail">Email</label>
                <input id="saveemail" type="email" autoComplete="email" value={saveEmail} onChange={(e) => { setSaveEmail(e.target.value); if (saveStage !== "sending") setSaveStage("form"); }} placeholder="you@example.com" />
                {saveStage === "taken" && <p className="small muted">That email already has a Hush Hall account. You can sign in with it instead, but this guest desk won’t move across.</p>}
                {saveStage === "error" && <p className="small muted">That didn’t send. Check the address and try again in a minute.</p>}
                <div className="actions"><button type="submit" className="sage small" disabled={saveStage === "sending" || !saveEmail.includes("@")}>{saveStage === "sending" ? "Sending…" : "Save my desk"}</button></div>
              </form>
            )}
        </section>
      )}

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
          <p className="small muted">This permanently deletes your Hush Hall account: your login and email address (if you added one), profile and settings, sittings and recaps, desk notes and any share links, timetable, study days and desk items, usual desks, walking position, blocks, requests, study-room memberships, notices, and reports you filed or that were filed about you. It can’t be undone. <a href="/privacy#delete">Privacy policy</a></p>
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
