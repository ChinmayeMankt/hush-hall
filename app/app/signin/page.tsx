"use client"; // talks to Supabase Auth in the browser

// Sign in or create an account with a one-time email link (no passwords).
// Sign-up is open to anyone; the 18+ check happens on the next screen.

import { useState } from "react"; // form state
import { hasSupabase, supabase } from "@/lib/backend/client"; // auth

export default function SignIn() {
  const [email, setEmail] = useState(""); // address
  const [stage, setStage] = useState<"form" | "sending" | "sent" | "error">("form"); // progress

  // Send the magic link; it comes back to /auth/callback.
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); // no page reload
    setStage("sending"); // busy
    const next = new URLSearchParams(window.location.search).get("next") ?? "/"; // where to go afterwards
    const { error } = await supabase().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next.startsWith("/") ? next : "/")}`, shouldCreateUser: true } }); // open sign-up
    setStage(error ? "error" : "sent"); // result
  };

  if (!hasSupabase) return <div className="card"><h1>Sign in</h1><p className="muted">This copy of Hush Hall runs in demo mode (no server configured), so there are no accounts. <a href="/">Back to the lobby</a></p></div>; // demo

  return (
    <div className="card narrow">
      <h1>Sign in</h1>
      {stage === "sent" ? (
        <p>Check your inbox for a sign-in link from Hush Hall. You can close this tab; the link opens the library.</p>
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
