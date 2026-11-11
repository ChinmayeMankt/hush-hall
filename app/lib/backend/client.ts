// Browser-side connection to Supabase (auth, database functions, realtime).
// If the two public env vars are missing, the app runs in local demo mode
// (BroadcastChannel presence, localStorage history) so it still works offline.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"; // official client

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""; // project URL (public)
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""; // anon key (public; RLS protects data)

// True when a real Supabase project is configured.
export const hasSupabase = URL_.length > 0 && ANON.length > 0; // both needed

let client: SupabaseClient | null = null; // one client per tab

// The shared browser client. Sessions persist in localStorage; magic links use PKCE.
export function supabase(): SupabaseClient {
  if (!hasSupabase) throw new Error("Supabase is not configured (see .env.example)"); // demo mode callers must not get here
  if (!client) client = createClient(URL_, ANON, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }); // created on first use
  return client; // same object everywhere
}

// Current access token (for calling our own server routes), or null if signed out.
export async function accessToken(): Promise<string | null> {
  const { data } = await supabase().auth.getSession(); // cached session (refreshed automatically)
  return data.session?.access_token ?? null; // bearer token
}

// POST JSON to one of our API routes as the signed-in user.
export async function callApi<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const token = await accessToken(); // who is calling
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); // same-origin call
  const data = (await res.json().catch(() => ({}))) as T; // tolerate empty bodies
  return { ok: res.ok, status: res.status, data }; // caller decides what to show
}

// Turn a database error into one of our short reason codes ("desk_taken", "rate_limited", ...).
export function reasonOf(err: { message?: string } | null | undefined): string {
  const m = err?.message ?? ""; // Postgres "raise exception" text arrives as the message
  const known = ["desk_taken", "rate_limited", "unavailable", "not_allowed", "not_found", "not_owner", "topic_not_allowed", "not_signed_in"]; // codes raised in SQL
  return known.find((k) => m.includes(k)) ?? "error"; // generic fallback
}
