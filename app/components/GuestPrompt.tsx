"use client"; // small form in the browser

// The one identity step for visitors: a nickname (with a ready-made one), an
// optional emoji avatar, and one 18+ box. It only appears when a visitor does
// something that needs a name, like taking a desk. No email, no password.

import { useEffect, useState } from "react"; // form state
import { AVATARS } from "@/lib/profile"; // emoji avatars
import { LAMP_COLORS_SIGNUP, suggestNickname } from "@/lib/signupOptions"; // lamp colours + nickname ideas
import { enterAsGuest } from "@/lib/guest"; // sign in without email + make the profile

export function GuestPrompt({ desk, onCancel, onEntered }: { desk: string | null; onCancel: () => void; onEntered: () => void }) {
  const [nick, setNick] = useState(""); // nickname typed
  const [avatar, setAvatar] = useState(AVATARS[0]); // emoji avatar
  const [adult, setAdult] = useState(false); // 18+ and house rules box (NOT pre-ticked)
  const [busy, setBusy] = useState(false); // entering
  const [msg, setMsg] = useState(""); // calm error line
  useEffect(() => { setNick(suggestNickname()); }, []); // a ready-made nickname, so there is one less decision

  // Enter: no email, just the nickname and the 18+ box.
  const enter = async (e: React.FormEvent) => {
    e.preventDefault(); // no reload
    if (busy) return; // once
    setBusy(true); setMsg(""); // busy
    const r = await enterAsGuest(nick, avatar, LAMP_COLORS_SIGNUP[0], adult).catch(() => ({ ok: false as const, reason: "error" as const })); // sign in + make the card
    if (r.ok) { onEntered(); return; } // in: the hall reloads with this desk
    setBusy(false); // let them try again
    setMsg(r.reason === "adult" ? "Please tick the box to confirm you’re 18 or older." : r.reason === "nickname" ? "Please write a nickname for your desk." : r.reason === "nickname_not_allowed" ? "That nickname can’t be used. Try another?" : r.reason === "guest_off" ? "Guest entry isn’t switched on yet. You can sign in with email for now." : r.reason === "rate_limited" ? "Too many new guests from this network just now. Please try again in a little while." : "Something went wrong. Please try again."); // calm, specific line
  };

  return (
    <div className="veil" role="dialog" aria-modal="true">
      <form className="dialog guest-prompt" onSubmit={enter}>
        <h2>{desk ? `Take desk ${desk}` : "Pick a name for your desk"}</h2>
        <p className="muted small">No email needed. Your desk shows only your nickname, avatar and topic.</p>
        {/* Nickname, with a button for another suggestion */}
        <label htmlFor="guest-nick">Nickname</label>
        <div className="row" style={{ gap: 6 }}>
          <input id="guest-nick" type="text" autoFocus required maxLength={24} value={nick} onChange={(e) => setNick(e.target.value)} placeholder="e.g. Owl" autoComplete="off" />
          <button type="button" className="ghost small" onClick={() => setNick(suggestNickname())} title="Suggest another nickname" aria-label="Suggest another nickname">↻</button>
        </div>
        {/* Optional avatar (a default is already picked) */}
        <div className="avatars guest-avatars" role="group" aria-label="Avatar">
          {AVATARS.map((a) => <button key={a} type="button" className={`avatar-pick ${avatar === a ? "on" : ""}`} onClick={() => setAvatar(a)} aria-label={`avatar ${a}`}>{a}</button>)}
        </div>
        {/* The one 18+ box */}
        <label className="toggle guest-adult">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>I’m 18 or older and agree to the <a href="/rules" target="_blank">house rules</a> and <a href="/privacy" target="_blank">privacy policy</a>.</span>
        </label>
        {msg && <p className="small muted">{msg}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onCancel}>Just looking</button>
          <button type="submit" className="sage" disabled={busy || !adult || !nick.trim()}>{busy ? "One moment…" : desk ? `Take desk ${desk}` : "Walk in"}</button>
        </div>
        <p className="small muted" style={{ margin: "10px 0 0" }}>Have an account? <a href="/signin">Sign in</a></p>
      </form>
    </div>
  );
}
