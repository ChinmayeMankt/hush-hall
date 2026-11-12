"use client"; // finishes the magic-link sign-in in the browser

// The email link lands here with a one-time code. The Supabase client swaps
// it for a session (PKCE), then we go to the 18+ sign-up or back to the halls.

import { useEffect, useState } from "react"; // effects
import { supabase, hasSupabase } from "@/lib/backend/client"; // auth
import { loadAccount } from "@/lib/account"; // where to go next

export default function AuthCallback() {
  const [failed, setFailed] = useState(false); // expired / reused link

  useEffect(() => {
    if (!hasSupabase) { window.location.href = "/"; return; } // demo mode has no accounts
    const q = new URLSearchParams(window.location.search); // ?code=...&next=...
    const next = q.get("next")?.startsWith("/") ? q.get("next")! : "/"; // only same-site paths
    const code = q.get("code"); // PKCE code
    (async () => {
      const sb = supabase(); // client (may already have exchanged the code on load)
      let { data } = await sb.auth.getSession(); // session yet?
      if (!data.session && code) { await sb.auth.exchangeCodeForSession(code).catch(() => null); data = (await sb.auth.getSession()).data; } // exchange if needed
      if (!data.session) { setFailed(true); return; } // link expired or opened in another browser
      const a = await loadAccount(true); // fresh state
      window.location.replace(a.state === "needs_onboarding" ? "/welcome" : next); // continue
    })().catch(() => setFailed(true)); // network / server error: show the retry card, not a spinner
  }, []);

  return failed
    ? <div className="card narrow"><h1>That link didn’t work</h1><p className="muted">Sign-in links work once and expire after a while. Open the newest one in the same browser, or <a href="/signin">ask for a new link</a>.</p></div>
    : <p className="muted">Opening the library…</p>;
}
