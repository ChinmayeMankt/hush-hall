// Guest entry: walk in with just a nickname and the 18+ box, no email.
// A guest is a real Supabase account made with Anonymous Sign-Ins, so every
// rule in the database (desks, notes, desk kit, block, report, bans) applies
// to them exactly as to email accounts. Later, a guest can quietly attach an
// email to the same account so their hours and desk items carry over.

import { hasSupabase, supabase, callApi } from "./backend/client"; // browser Supabase client + our API helper
import { loadAccount } from "./account"; // refresh the cached account after changes
import type { Member } from "./presence/types"; // what the 3D hall draws

// Result of trying to enter as a guest; reason is a short code the form turns into a calm line.
export type GuestResult = { ok: true } | { ok: false; reason: "adult" | "nickname" | "nickname_not_allowed" | "guest_off" | "rate_limited" | "error" }; // ok, or why not

// Enter as a guest: sign in without an email (if not signed in yet), then let the server make the profile after the 18+ box.
export async function enterAsGuest(nickname: string, avatar: string, color: string, adult: boolean): Promise<GuestResult> {
  if (!adult) return { ok: false, reason: "adult" }; // the 18+ box must be ticked by the person
  if (!nickname.trim()) return { ok: false, reason: "nickname" }; // a nickname is needed for the desk
  if (!hasSupabase) return { ok: true }; // offline demo: no accounts, the lobby saves the name locally
  const sb = supabase(); // shared client
  const { data: s } = await sb.auth.getSession(); // already signed in (e.g. a guest whose profile step failed)?
  if (!s.session) { // nobody signed in yet
    const { error } = await sb.auth.signInAnonymously(); // a new account with no email or password
    if (error) return { ok: false, reason: /disabled|not enabled/i.test(error.message) ? "guest_off" : error.status === 429 ? "rate_limited" : "error" }; // switched off in Supabase, too many tries, or other
  }
  const r = await callApi<{ ok?: boolean; reason?: string }>("/api/onboarding", { guest: true, adult: true, nickname, avatar, color, acceptTerms: true }); // server re-checks and makes the profile
  if (!r.ok && r.data.reason === "nickname_not_allowed") return { ok: false, reason: "nickname_not_allowed" }; // blocked word in the nickname
  if (!r.ok) return { ok: false, reason: "error" }; // anything else
  await loadAccount(true); // refresh the cached account (now "ready")
  return { ok: true }; // in
}

// Save a guest's desk with an email: Supabase sends a confirmation email; once confirmed, the same account keeps an email.
export async function saveDeskWithEmail(email: string): Promise<"sent" | "taken" | "error"> {
  const { error } = await supabase().auth.updateUser({ email: email.trim() }, { emailRedirectTo: `${window.location.origin}/auth/callback?next=/me` }); // attach the email to this same account
  if (!error) return "sent"; // email on its way
  return /already|exists|registered/i.test(error.message) ? "taken" : "error"; // that address already has its own account, or another problem
}

// Confirm the email with the code from the message (works on any device, like the sign-in code).
export async function confirmEmailCode(email: string, code: string): Promise<boolean> {
  const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email_change" }); // the email-change code
  if (error) return false; // wrong or expired
  await supabase().auth.refreshSession(); // new token without the guest flag
  await loadAccount(true); // refresh the cached account
  return true; // saved
}

// Real people seated in a hall, for the front page before anyone signs in.
// Only desk, avatar, lamp colour and wardrobe come back: no nickname, no topic.
type PreviewRow = { user_id: string; seat: string; avatar: string; color: string; look: string | null }; // columns from hall_preview()
export async function hallPreview(hallId: string): Promise<Member[]> {
  if (!hasSupabase) return []; // offline demo has its own demo students
  const { data, error } = await supabase().rpc("hall_preview", { p_hall: hallId }); // anyone may call it (migration 0007)
  if (error || !data) return []; // database not updated yet: the hall still shows its labelled companions
  return (data as PreviewRow[]).map((r) => ({
    id: r.user_id, // same id as inside, so each person keeps the same character
    name: "A student", // nicknames stay inside the hall
    avatar: r.avatar, // emoji
    color: r.color, // lamp colour
    seat: r.seat, // desk number
    topic: "Topic shown inside", // topics stay inside the hall
    phase: "focus", // drawn studying
    phaseEndsAt: null, // no timer shown
    hideFromRequests: true, // no requests from the front page
    look: r.look ?? "", // wardrobe
    lastSeen: Date.now(), // fresh
  })); // ready for the 3D hall
}
