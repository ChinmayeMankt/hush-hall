"use client"; // talks to Supabase Auth in the browser

// Sign in or create an account with a one-time email link (no passwords).
// Sign-up is open to anyone; the 18+ check happens on the next screen.

import { useState } from "react"; // form state
import { hasSupabase, supabase } from "@/lib/backend/client"; // auth
import { loadAccount } from "@/lib/account"; // where to go after the code works

export default function SignIn() {
  const [email, setEmail] = useState(""); // address
  const [stage, setStage] = useState<"form" | "sending" | "sent" | "error">("form"); // progress
  const [code, setCode] = useState(""); // 6-digit code typed from the email (works on any device or browser)
  const [codeBusy, setCodeBusy] = useState(false); // checking the code
  const [codeBad, setCodeBad] = useState(false); // wrong or expired code

  // Send the magic link; it comes back to /auth/callback.
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); // no page reload
    setStage("sending"); // busy
    const next = new URLSearchParams(window.location.search).get("next") ?? "/"; // where to go afterwards
    try {
      const { error } = await supabase().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next.startsWith("/") ? next : "/")}`, shouldCreateUser: true } }); // open sign-up
      setStage(error ? "error" : "sent"); // result
    } catch {
      setStage("error"); // network failure or paused project: same calm message, never stuck on "Sending…"
    }
  };

  // Sign in with the code from the email. Unlike the link, this works even if the email was opened on another device or in an email app's own browser.
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); // no page reload
    setCodeBusy(true); setCodeBad(false); // busy
    try {
      const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" }); // exchange code for a session
      if (error) throw error; // wrong or expired
      const next = new URLSearchParams(window.location.search).get("next") ?? "/"; // where to go afterwards
      const a = await loadAccount(true); // new or returning?
      window.location.replace(a.state === "needs_onboarding" ? "/welcome" : next.startsWith("/") ? next : "/"); // continue
    } catch {
      setCodeBad(true); setCodeBusy(false); // show the calm error line
    }
  };

  if (!hasSupabase) return <div className="card"><h1>Sign in</h1><p className="muted">This copy of Hush Hall runs in demo mode (no server configured), so there are no accounts. <a href="/">Back to the lobby</a></p></div>; // demo

  return (
    <div className="card narrow">
      <h1>Sign in</h1>
      {stage === "sent" ? (
        <>
          <p>Check your inbox for a sign-in email from Hush Hall (look in spam or promotions too).</p>
          <p className="small muted">Open the link on <b>this same device and browser</b>. If the link doesn’t work, or you opened the email on another device, type the code from the email here instead:</p>
          <form onSubmit={verify}>
            <label htmlFor="code">Code from the email</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
            {codeBad && <p className="small muted">That code didn’t work. Check it and try again, or ask for a new email.</p>}
            <div className="actions">
              <button type="submit" className="sage" disabled={codeBusy || code.length < 6}>{codeBusy ? "Checking…" : "Sign in with code"}</button>
              <button type="button" className="ghost small" onClick={() => { setStage("form"); setCode(""); setCodeBad(false); }}>Wrong address? Start again</button>
            </div>
          </form>
        </>
      ) : (
        <form onSubmit={send}>
          <p className="muted small">New or returning, it’s the same: we email you a one-time link. No password to remember.</p>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          {stage === "error" && <p className="small muted">That didn’t send. Check the address and try again in a minute.</p>}
          <div className="actions"><button type="submit" className="sage" disabled={stage === "sending" || !email.includes("@")}>{stage === "sending" ? "Sending…" : "Email me a link"}</button></div>
          <p className="small muted">Hush Hall is for people aged 18 and over. <a href="/rules">House rules</a> · <a href="/privacy">Privacy policy</a></p>
        </form>
      )}
    </div>
  );
}
