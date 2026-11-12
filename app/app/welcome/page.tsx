"use client"; // sign-up form

// Finish sign-up: date of birth (18+ only, not stored), house rules (box not
// pre-ticked), nickname, avatar and lamp colour. The server re-checks the age.

import { useEffect, useState } from "react"; // form state
import { loadAccount } from "@/lib/account"; // session state
import { callApi } from "@/lib/backend/client"; // onboarding route
import { AVATARS, LAMP_COLORS_SIGNUP } from "@/lib/signupOptions"; // choices
import { ageOn, MIN_AGE } from "@/lib/legal"; // age helper

export default function Welcome() {
  const [email, setEmail] = useState(""); // shown for reassurance
  const [dob, setDob] = useState(""); // YYYY-MM-DD from the date input
  const [nickname, setNickname] = useState(""); // desk name
  const [avatar, setAvatar] = useState(AVATARS[0]); // emoji
  const [color, setColor] = useState(LAMP_COLORS_SIGNUP[0]); // lamp
  const [rules, setRules] = useState(false); // NOT pre-ticked
  const [msg, setMsg] = useState(""); // calm error line
  const [busy, setBusy] = useState(false); // submitting
  const [refused, setRefused] = useState(false); // under 18

  // Only signed-in people without a profile belong here.
  useEffect(() => {
    loadAccount(true).then((a) => {
      if (a.state === "signed_out") window.location.href = "/signin"; // sign in first
      else if (a.state === "ready") window.location.href = "/"; // already done
      else setEmail(a.email); // show which address
    }).catch(() => setMsg("Couldn’t reach the library just now. Please reload and try again.")); // calm error line
  }, []);

  // Submit to the server (which applies the same 18+ rule and stores no birth date).
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); // no reload
    const age = ageOn(dob); // quick local check for a friendly message
    if (age === null) { setMsg("Please enter your date of birth."); return; } // invalid
    setBusy(true); setMsg(""); // busy
    const r = await callApi<{ ok?: boolean; reason?: string }>("/api/onboarding", { birthDate: dob, nickname, avatar, color, acceptTerms: rules }); // server decides
    setBusy(false); // done
    if (r.data.reason === "under18") { setRefused(true); return; } // account removed server-side
    if (!r.ok) { setMsg(r.data.reason === "nickname_not_allowed" ? "That nickname can’t be used. Try another?" : r.data.reason === "terms" ? "Please read and accept the house rules to continue." : "Something went wrong. Please try again."); return; } // calm
    await loadAccount(true); // refresh cache
    window.location.href = "/"; // into the lobby
  };

  if (refused) return <div className="card narrow"><h1>Hush Hall is for 18+ for now</h1><p className="muted">We can’t create an account for people under 18 yet, so nothing was saved and the sign-in was removed. Thank you for understanding.</p></div>; // plain message

  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>Your library card</h1>
      {email && <p className="small muted">Signed in as {email}</p>}
      <label htmlFor="dob">Date of birth</label>
      <input id="dob" type="date" required value={dob} onChange={(e) => setDob(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
      <p className="small muted">Hush Hall is for people aged {MIN_AGE}+. We use your date of birth only for this check and don’t store it.</p>
      <label htmlFor="nick">Nickname (shown on your desk)</label>
      <input id="nick" type="text" required maxLength={24} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. Owl" />
      <p className="small muted">Your desk shows only your nickname, avatar and current topic. Please don’t use your real full name.</p>
      <label>Avatar</label>
      <div className="avatars">
        {AVATARS.map((a) => <button key={a} type="button" className={`avatar-pick ${avatar === a ? "on" : ""}`} onClick={() => setAvatar(a)} aria-label={`avatar ${a}`}>{a}</button>)}
      </div>
      <label>Desk lamp</label>
      <div className="avatars">
        {LAMP_COLORS_SIGNUP.map((c) => <button key={c} type="button" className={`avatar-pick ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`lamp colour ${c}`} />)}
      </div>
      <span className="toggle" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} />
        I’ve read and agree to the <a href="/rules" target="_blank">house rules, terms</a> and <a href="/privacy" target="_blank">privacy policy</a>.
      </span>
      {msg && <p className="small muted">{msg}</p>}
      <div className="actions"><button type="submit" className="sage" disabled={busy || !rules || !nickname.trim() || !dob}>{busy ? "One moment…" : "Walk in"}</button></div>
    </form>
  );
}
