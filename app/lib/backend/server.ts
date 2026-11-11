// Server-only Supabase helpers for our API routes. Uses the service-role key,
// which bypasses row-level security, so it must never reach the browser:
// this file is imported only from app/api/* route handlers.

import "server-only"; // build fails if a client component imports this
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js"; // official client

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""; // project URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""; // anon key (for acting as the user)
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""; // secret key (server only)

// True when the server can talk to Supabase with admin rights.
export const serverConfigured = URL_.length > 0 && ANON.length > 0 && SERVICE.length > 0; // all three needed

// Admin client (bypasses RLS). Only for steps a user can't do themselves: creating the profile after the 18+ check, deleting an account, reading room membership for voice tokens.
export function admin(): SupabaseClient {
  return createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } }); // stateless per request
}

// Client that acts as the calling user (RLS and SQL checks apply as usual).
export function asUser(token: string): SupabaseClient {
  return createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }); // user's JWT on every call
}

// Read and verify the bearer token on a request. Returns the user, or null.
export async function userFrom(req: Request): Promise<{ user: User; token: string } | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""; // "Bearer <jwt>"
  if (!token) return null; // signed out
  const { data, error } = await admin().auth.getUser(token); // Supabase verifies the JWT
  if (error || !data.user) return null; // invalid or expired
  return { user: data.user, token }; // verified
}

// Small JSON response helper.
export const json = (body: unknown, status = 200) => Response.json(body, { status }); // e.g. json({ ok: true })
