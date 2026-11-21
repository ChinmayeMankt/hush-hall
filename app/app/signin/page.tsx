"use client"; // talks to Supabase Auth in the browser

// Sign in or create an account with a one-time email link (no passwords).
// Sign-up is open to anyone; the 18+ check happens on the next screen.

import { useEffect, useState } from "react"; // form state
import { hasSupabase, supabase } from "@/lib/backend/client"; // auth
import { loadAccount } from "@/lib/account"; // where to go after the code works

// A one-tap shortcut to the person's inbox for the common mail providers.
function mailApp(email: string): { name: string; url: string } | null {
  const d = email.trim().toLowerCase().split("@")[1] ?? ""; // domain
  if (d === "gmail.com" || d === "googlemail.com") return { name: "Gmail", url: "https://mail.google.com/" };
  if (/^(outlook|hotmail|live|msn)\./.test(d)) return { name: "Outlook", url: "https://outlook.live.com/mail/" };
  if (/^yahoo\./.test(d) || d === "ymail.com") return { name: "Yahoo Mail", url: "https://mail.yahoo.com/" };
  if (d === "icloud.com" || d === "me.com") return { name: "iCloud Mail", url: "https://www.icloud.com/mail" };
  return null; // other providers: no shortcut
}

export default function SignIn() {
  const [email, setEmail] = useState(""); // address
  const [stage, setStage] = useState<"form" | "sending" | "sent" | "error">("form"); // progress
  const [code, setCode] = useState(""); // 6-digit code typed from the email (works on any device or browser)
  const [codeBusy, setCodeBusy] = useState(false); // checking the code
  const [codeBad, setCodeBad] = useState(false); // wrong or expired code
  const [guest, setGuest] = useState(false); // already at a desk as a guest on this device?
  useEffect(() => { loadAccount().then((a) => setGuest(a.state !== "signed_out" && a.guest)).catch(() => {}); }, []); // check once

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
      window.location.replace(a.state === "needs_onboarding" ? "/welcome" : next.startsWith("/") && next !== "/" ? next : "/hall/main-reading"); // returning people go straight to the Main Reading Hall
    } catch {
      setCodeBad(true); setCodeBusy(false); // show the calm error line
    }
  };

  if (!hasSupabase) return <div className="card"><h1>Sign in</h1><p className="muted">This copy of Hush Hall runs in demo mode (no server configured), so there are no accounts. <a href="/">Back to the lobby</a></p></div>; // demo

  return (
    <div className="card narrow">
      <h1>{stage === "sent" ? "Check your email" : "Enter the library"}</h1>
      {stage === "sent" ? (
        <>
          <p>We sent a link to <b>{email.trim()}</b>. Tap it and you’re in the Main Reading Hall. (Look in spam or promotions too.)</p>
          {mailApp(email) && <p><a className="btn sage" href={mailApp(email)!.url} target="_blank" rel="noreferrer">Open {mailApp(email)!.name}</a></p>}
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
          <p className="muted small">New or returning, it’s the same: type your email and we send a one-tap link. No password, no forms to fill first.</p>
          {guest && <p className="small muted">You’re studying here as a guest. Signing in to another account leaves your guest desk behind. To keep its hours and desk items, use <a href="/me#save-desk">Save your desk with email</a> instead.</p>}
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          {stage === "error" && <p className="small muted">That didn’t send. Check the address and try again in a minute.</p>}
          <div className="actions"><button type="submit" className="sage" disabled={stage === "sending" || !email.includes("@")}>{stage === "sending" ? "Sending…" : "Send my link"}</button></div>
          <p className="small muted">Hush Hall is for people aged 18 and over. <a href="/rules">House rules</a> · <a href="/privacy">Privacy policy</a></p>
          <p className="small muted">No account? You don’t need one. <a href="/">Take a desk with just a nickname</a>.</p>
        </form>
      )}
    </div>
  );
}
