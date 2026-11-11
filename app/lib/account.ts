// The signed-in student's account: profile, settings, desk sittings, history,
// usual desks, reports and notices. One interface, two backends:
//  - Supabase (the real app): data lives in Postgres behind row-level security;
//  - demo mode (no env vars): the old local-only behaviour in localStorage.

import { hasSupabase, supabase, reasonOf } from "./backend/client"; // real backend (if configured)
import * as local from "./profile"; // demo-mode storage helpers
import type { Profile, Sitting } from "./profile"; // shared shapes
import type { Member } from "./presence/types"; // reported person

// Report reasons offered in the UI (same list as the database check).
export const REPORT_REASONS = [
  { id: "harassment", label: "Harassment or bullying" }, // urgent
  { id: "sexual", label: "Sexual content" }, // urgent
  { id: "hate", label: "Hate or slurs" }, // urgent
  { id: "under18", label: "This person seems under 18" }, // urgent; also pauses their rooms until reviewed
  { id: "spam", label: "Spam or advertising" }, // normal
  { id: "other", label: "Something else" }, // normal
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["id"]; // union of ids

// Where the account is in sign-up.
export type AccountState =
  | { state: "signed_out" } // needs to sign in
  | { state: "needs_onboarding"; email: string } // signed in, no profile yet (18+ check pending)
  | { state: "ready"; profile: Profile; email: string; isModerator: boolean }; // can use the halls

// Result of trying to take a desk.
export type SitResult = { ok: true; sittingId: string } | { ok: false; reason: string }; // reason: desk_taken, topic_not_allowed, ...

// Database row -> app profile.
type ProfileRow = { id: string; nickname: string; avatar: string; color: string; hide_from_requests: boolean; focus_min: number; break_min: number; chime: boolean; rooms_suspended: boolean }; // columns we read
const toProfile = (r: ProfileRow): Profile => ({ id: r.id, name: r.nickname, avatar: r.avatar, color: r.color, hideFromRequests: r.hide_from_requests, focusMin: r.focus_min, breakMin: r.break_min, chime: r.chime, roomsPaused: r.rooms_suspended }); // rename fields

// ---------------------------------------------------------------------------
// Load the account (and remember it for this tab).
// ---------------------------------------------------------------------------
let cached: AccountState | null = null; // last loaded state
export async function loadAccount(force = false): Promise<AccountState> {
  if (cached && !force) return cached; // reuse within the tab
  if (!hasSupabase) { const p = local.loadProfile(); cached = { state: "ready", profile: p, email: "", isModerator: false }; return cached; } // demo: always "ready"
  const sb = supabase(); // client
  const { data: s } = await sb.auth.getSession(); // stored session
  const user = s.session?.user; // who
  if (!user) { cached = { state: "signed_out" }; return cached; } // not signed in
  const { data: row } = await sb.from("profiles").select("id,nickname,avatar,color,hide_from_requests,focus_min,break_min,chime,rooms_suspended").eq("id", user.id).maybeSingle(); // my profile (RLS: own row only)
  if (!row) { cached = { state: "needs_onboarding", email: user.email ?? "" }; return cached; } // finish sign-up first
  const { error: modErr } = await sb.rpc("mod_queue", { p_status: "none" }); // cheap moderator check (empty result for moderators, error for others)
  cached = { state: "ready", profile: toProfile(row as ProfileRow), email: user.email ?? "", isModerator: !modErr }; // ready
  return cached; // done
}

// Save settings (nickname, avatar, lamp colour, privacy, rhythm, chime).
export async function saveProfile(p: Profile): Promise<boolean> {
  if (cached?.state === "ready") cached = { ...cached, profile: p }; // keep the cache in step
  if (!hasSupabase) { local.saveProfile(p); return true; } // demo
  const { error } = await supabase().from("profiles").update({ nickname: p.name.trim().slice(0, 24), avatar: p.avatar, color: p.color, hide_from_requests: p.hideFromRequests, focus_min: p.focusMin, break_min: p.breakMin, chime: p.chime }).eq("id", p.id); // settings columns only (DB grants enforce this)
  return !error; // false = not saved (e.g. nickname blocked)
}

// Sign out (real mode).
export async function signOut() {
  cached = null; // forget
  if (hasSupabase) await supabase().auth.signOut(); // end the session
}

// ---------------------------------------------------------------------------
// History and the weekly summary.
// ---------------------------------------------------------------------------
type SittingRow = { id: string; hall_id: string; seat: string; topic: string; started_at: string; last_seen_at: string; ended_at: string | null; focused_minutes: number; recap: string | null }; // columns
export async function loadHistory(): Promise<Sitting[]> {
  if (!hasSupabase) return local.loadHistory(); // demo
  const { data } = await supabase().from("sittings").select("id,hall_id,seat,topic,started_at,last_seen_at,ended_at,focused_minutes,recap").order("started_at", { ascending: false }).limit(500); // my sittings (RLS)
  return ((data ?? []) as SittingRow[]).map((r) => ({ id: r.id, at: Date.parse(r.ended_at ?? r.last_seen_at), hallId: r.hall_id, seat: r.seat, topic: r.topic, minutes: r.focused_minutes, note: r.recap ?? "" })); // newest first
}

// ---------------------------------------------------------------------------
// Desks: sit, keep alive, stand up; usual desk per hall.
// ---------------------------------------------------------------------------
export async function sitDown(hallId: string, seat: string, topic: string): Promise<SitResult> {
  if (!hasSupabase) return { ok: true, sittingId: `local-${Date.now()}` }; // demo: tabs settle clashes themselves
  const { data, error } = await supabase().rpc("sit_down", { p_hall: hallId, p_seat: seat, p_topic: topic }); // one active sitting per desk (SQL unique index)
  return error ? { ok: false, reason: reasonOf(error) } : { ok: true, sittingId: data as string }; // claimed or not
}

// Heartbeat while seated; also banks focus minutes so a closed tab still counts. False = desk lost.
export async function heartbeat(sittingId: string, minutes: number): Promise<boolean> {
  if (!hasSupabase) return true; // demo
  const { data, error } = await supabase().rpc("heartbeat_sitting", { p_id: sittingId, p_focused_minutes: Math.round(minutes) }); // keep my desk
  return !error && data === true; // still mine?
}

// Stand up with a recap. Returns the minutes saved (capped at real time by the database).
export async function standUp(sittingId: string, minutes: number, recap: string, info: Omit<Sitting, "at" | "minutes" | "note">): Promise<number> {
  if (!hasSupabase) { local.addSitting({ ...info, at: Date.now(), minutes, note: recap }); return minutes; } // demo
  const { data } = await supabase().rpc("stand_up", { p_id: sittingId, p_focused_minutes: Math.round(minutes), p_recap: recap }); // save
  return typeof data === "number" ? data : minutes; // saved minutes
}

// Best-effort "I left" when the tab closes (keepalive request survives page unload).
export function releaseOnUnload(sittingId: string, minutes: number, token: string | null) {
  if (!hasSupabase || !token) return; // demo or signed out
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/stand_up`; // PostgREST function endpoint
  fetch(url, { method: "POST", keepalive: true, headers: { "content-type": "application/json", apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", authorization: `Bearer ${token}` }, body: JSON.stringify({ p_id: sittingId, p_focused_minutes: Math.round(minutes), p_recap: "" }) }).catch(() => {}); // fire and forget
}

export async function usualSeat(hallId: string): Promise<string | null> {
  if (!hasSupabase) return local.usualSeat(hallId); // demo
  const { data } = await supabase().from("usual_seats").select("seat").eq("hall_id", hallId).maybeSingle(); // my row (RLS)
  return (data as { seat: string } | null)?.seat ?? null; // seat or none
}

export async function setUsualSeat(hallId: string, seat: string, userId: string) {
  if (!hasSupabase) { local.setUsualSeat(hallId, seat); return; } // demo
  await supabase().from("usual_seats").upsert({ user_id: userId, hall_id: hallId, seat }); // one per hall
}

// People seated per hall, for the lobby doors (real mode only; demo shows its demo students).
export async function hallCounts(): Promise<Record<string, number> | null> {
  if (!hasSupabase) return null; // demo
  const { data } = await supabase().rpc("hall_counts"); // non-stale active sittings
  return Object.fromEntries(((data ?? []) as { hall_id: string; seated: number }[]).map((r) => [r.hall_id, r.seated])); // hall -> count
}

// ---------------------------------------------------------------------------
// Reports and notices.
// ---------------------------------------------------------------------------
export async function fileReport(target: Member, reason: ReportReason, note: string, hallId: string | null, roomId: string | null): Promise<boolean> {
  if (!hasSupabase || target.isDemo) { // demo students / demo mode: keep on this device only
    const key = "hh.reports"; // local storage key
    const all = JSON.parse(localStorage.getItem(key) ?? "[]"); // existing reports
    all.push({ id: target.id, name: target.name, reason, note, hallId, at: Date.now() }); // add one
    localStorage.setItem(key, JSON.stringify(all)); // save
    return true; // "noted"
  }
  const { error } = await supabase().rpc("file_report", { p_reported: target.id, p_reason: reason, p_note: note.slice(0, 500), p_hall: hallId, p_room: roomId, p_topic: target.topic }); // private queue
  return !error; // filed?
}

// Private notices for me (e.g. after a moderator warning). Read once, then dismissed.
export async function loadNotices(): Promise<{ id: string; body: string }[]> {
  if (!hasSupabase) return []; // demo
  const { data } = await supabase().from("account_notices").select("id,body").is("read_at", null).order("created_at"); // unread
  return (data ?? []) as { id: string; body: string }[]; // list
}
export async function dismissNotice(id: string) {
  if (hasSupabase) await supabase().from("account_notices").update({ read_at: new Date().toISOString() }).eq("id", id); // mark read
}
