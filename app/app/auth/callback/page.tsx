"use client"; // finishes the magic-link sign-in in the browser

// The email link lands here with a one-time code. The Supabase client swaps
// it for a session (PKCE), then we go to the 18+ sign-up or back to the halls.

import { useEffect, useState } from "react"; // effects
import { supabase, hasSupabase } from "@/lib/backend/client"; // auth
import { loadAccount } from "@/lib/account"; // where to go next

export default function AuthCallback() {
  const [failed, setFailed] = useState(false); // expired / reused link
  const [why, setWhy] = useState<"expired" | "other">("other"); // what the server said went wrong

  useEffect(() => {
    if (!hasSupabase) { window.location.href = "/"; return; } // demo mode has no accounts
    const q = new URLSearchParams(window.location.search); // ?code=...&next=...
    const next = q.get("next")?.startsWith("/") ? q.get("next")! : "/"; // only same-site paths
    const code = q.get("code"); // PKCE code
    const h = new URLSearchParams(window.location.hash.replace(/^#/, "")); // errors can also arrive in the #hash
    const errCode = q.get("error_code") ?? h.get("error_code"); // e.g. otp_expired
    if (errCode === "otp_expired") setWhy("expired"); // link already used or too old
    (async () => {
      const sb = supabase(); // client (may already have exchanged the code on load)
      let { data } = await sb.auth.getSession(); // session yet?
      if (!data.session && code) { await sb.auth.exchangeCodeForSession(code).catch(() => null); data = (await sb.auth.getSession()).data; } // exchange if needed
      if (!data.session) { setFailed(true); return; } // link expired or opened in another browser
      const a = await loadAccount(true); // fresh state
      window.location.replace(a.state === "needs_onboarding" ? "/welcome" : next === "/" ? "/hall/main-reading" : next); // returning people go straight to the Main Reading Hall
    })().catch(() => setFailed(true)); // network / server error: show the retry card, not a spinner
  }, []);

  return failed
    ? <div className="card narrow"><h1>That link didn’t work</h1><p className="muted">{why === "expired" ? "This link has expired or was already used. Some email apps open links automatically, which uses them up. " : "The link only works in the same browser and device where you asked for it. "}<a href="/signin">Go back to sign in</a>, ask for a new email, and type the code from the email there, which works on any device.</p></div>
    : <p className="muted">Opening the library…</p>;
}
