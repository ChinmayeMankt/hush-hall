// Private desk notes: a writing area, optional details, and an optional share link.
// Real mode stores rows in Supabase (RLS: own rows). Demo mode uses this browser only.
// A share link is a public read of that one note via get_shared_note(); RLS stays closed.

import { hasSupabase, supabase } from "./backend/client"; // real backend (if configured)

// Places a note can come from (same ids as the database check).
export const NOTE_SOURCES = [
  { id: "chatgpt", label: "ChatGPT" }, // AI chat
  { id: "google", label: "Google" }, // search
  { id: "youtube", label: "YouTube" }, // video
  { id: "book", label: "Book" }, // paper book or textbook
  { id: "other", label: "Other" }, // anything else
] as const;
export type NoteSource = (typeof NOTE_SOURCES)[number]["id"]; // union of ids

// One desk note as the UI uses it.
export type DeskNote = {
  id: string; // row id
  title: string; // short label (may be derived from the first line)
  source: NoteSource | null; // optional source
  url: string | null; // optional http(s) link
  note: string; // free-text writing area
  shareToken: string | null; // public link token, or null if not shared
  createdAt: number; // ms
  updatedAt: number; // ms
};

export const TITLE_MAX = 80; // same as the database
export const NOTE_MAX = 10000; // same as the database (raised in 0005)
const URL_MAX = 500; // same as the database
const LOCAL_KEY = "hh.deskNotes"; // demo-mode storage key

// A link is allowed only when it is http or https (or empty).
export function validNoteUrl(raw: string): boolean {
  const s = raw.trim(); // ignore surrounding spaces
  if (!s) return true; // optional
  if (s.length > URL_MAX) return false; // too long
  try {
    const u = new URL(s); // throws if not a URL
    return u.protocol === "http:" || u.protocol === "https:"; // no javascript: or other schemes
  } catch {
    return false; // not a URL
  }
}

// Trim and cap a title (empty is allowed; the app may derive one).
export function cleanTitle(raw: string): string {
  return raw.trim().slice(0, TITLE_MAX); // length check happens at save
}

// Cap annotation length.
export function cleanNoteBody(raw: string): string {
  return raw.slice(0, NOTE_MAX); // keep inner spaces as typed
}

// Accept a known source, or nothing.
export function cleanSource(raw: string): NoteSource | null {
  return NOTE_SOURCES.some((s) => s.id === raw) ? (raw as NoteSource) : null; // drop unknown values
}

// Title to store: typed title, else the first non-empty line of the body, else "Untitled".
export function derivedTitle(title: string, body: string): string {
  const typed = cleanTitle(title); // what they typed in details
  if (typed) return typed; // they chose a title
  const first = (body.split(/\r?\n/).find((l) => l.trim()) ?? "").trim(); // first written line
  return first.slice(0, TITLE_MAX) || "Untitled"; // fallback when only a link/source is set
}

// Label shown in the list (never blank).
export function displayTitle(n: Pick<DeskNote, "title" | "note">): string {
  return derivedTitle(n.title, n.note); // same rule as save
}

// True when there is something worth storing (body, title, source or link).
export function noteHasContent(draft: NoteDraft): boolean {
  return Boolean(draft.title.trim() || draft.note.trim() || draft.source.trim() || draft.url.trim()); // any field
}

// Demo storage: newest first, kept on this device only.
function localList(): DeskNote[] {
  if (typeof localStorage === "undefined") return []; // server render
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as DeskNote[]; // may throw
    const rows = Array.isArray(parsed) ? parsed : []; // tolerate a bad value
    return rows
      .map((n) => ({ ...n, shareToken: n.shareToken ?? null })) // older demo rows may lack the field
      .sort((a, b) => b.createdAt - a.createdAt); // newest first
  } catch {
    return []; // corrupt storage
  }
}

function localWrite(all: DeskNote[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(all.slice(0, 500))); // keep it bounded
}

// Database row -> app note.
type NoteRow = { id: string; title: string; source: string | null; url: string | null; note: string; share_token?: string | null; created_at: string; updated_at: string }; // columns we read
const toNote = (r: NoteRow): DeskNote => ({
  id: r.id, // uuid
  title: r.title ?? "", // as stored (may be empty)
  source: cleanSource(r.source ?? ""), // only known sources
  url: r.url, // may be null
  note: r.note ?? "", // empty is fine
  shareToken: r.share_token ?? null, // null if not shared or column not loaded
  createdAt: Date.parse(r.created_at), // ms
  updatedAt: Date.parse(r.updated_at), // ms
});

// Load my notes, newest first. Other people's notes are never returned (RLS).
export async function listNotes(): Promise<DeskNote[]> {
  if (!hasSupabase) return localList(); // demo
  const { data, error } = await supabase().from("desk_notes").select("id,title,source,url,note,share_token,created_at,updated_at").order("created_at", { ascending: false }).limit(500); // own rows only
  if (error || !data) {
    // If 0005 is not applied yet, retry without share_token so the list still loads.
    const retry = await supabase().from("desk_notes").select("id,title,source,url,note,created_at,updated_at").order("created_at", { ascending: false }).limit(500); // older columns only
    if (retry.error || !retry.data) return []; // fail quietly; the dialog can say it didn't load
    return (retry.data as NoteRow[]).map(toNote); // no share tokens yet
  }
  return (data as NoteRow[]).map(toNote); // newest first from the query
}

// Fields the writing area sends when adding or editing a note.
export type NoteDraft = { title: string; source: string; url: string; note: string }; // raw values

// Validate and save. Returns a short reason when the row is refused.
export async function saveNote(draft: NoteDraft, id?: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const source = cleanSource(draft.source); // optional
  const urlRaw = draft.url.trim(); // optional
  const note = cleanNoteBody(draft.note); // optional writing
  const title = derivedTitle(draft.title, note); // optional typed title, else first line, else Untitled
  if (!validNoteUrl(urlRaw)) return { ok: false, reason: "Links must start with http:// or https://." }; // reject other schemes
  const url = urlRaw ? urlRaw.slice(0, URL_MAX) : null; // store null when empty
  if (!hasSupabase) {
    const all = localList(); // current demo list
    if (id) {
      const next = all.map((n) => (n.id === id ? { ...n, title, source, url, note, updatedAt: Date.now() } : n)); // edit in place (keep shareToken)
      localWrite(next); // persist
      return { ok: true, id }; // same id
    }
    const created: DeskNote = { id: `local-${Date.now()}`, title, source, url, note, shareToken: null, createdAt: Date.now(), updatedAt: Date.now() }; // new demo row
    localWrite([created, ...all]); // newest first
    return { ok: true, id: created.id }; // new id
  }
  const row = { title, source, url, note, updated_at: new Date().toISOString() }; // columns to write (never touches share_token)
  if (id) {
    const { error } = await supabase().from("desk_notes").update(row).eq("id", id); // RLS: own row only
    if (error) return { ok: false, reason: "Couldn’t save that note. Try again?" }; // keep it calm
    return { ok: true, id }; // updated
  }
  const { data: who } = await supabase().auth.getUser(); // signed-in owner
  if (!who.user) return { ok: false, reason: "Sign in to save notes on your desk." }; // session gone
  const { data, error } = await supabase().from("desk_notes").insert({ ...row, user_id: who.user.id }).select("id").maybeSingle(); // owner is the signed-in user
  if (error || !data) return { ok: false, reason: "Couldn’t save that note. Try again?" }; // keep it calm
  return { ok: true, id: (data as { id: string }).id }; // new id
}

// Remove one of my notes (and its share link, if any).
export async function deleteNote(id: string): Promise<boolean> {
  if (!hasSupabase) {
    localWrite(localList().filter((n) => n.id !== id)); // drop from this browser
    return true; // demo always succeeds
  }
  const { error } = await supabase().from("desk_notes").delete().eq("id", id); // RLS: own row only
  return !error; // false if it didn't go through
}

// Make a long url-safe token (unguessable; the database also checks the shape).
export function newShareToken(): string {
  const bytes = new Uint8Array(24); // 24 random bytes
  crypto.getRandomValues(bytes); // browser or Node crypto
  let bin = ""; // raw string for base64
  for (const b of bytes) bin += String.fromCharCode(b); // one char per byte
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); // base64url, no padding (~32 chars)
}

// Public path for a shared note (the page itself is /n/<token>).
export function sharePath(token: string): string {
  return `/n/${encodeURIComponent(token)}`; // safe in a URL
}

// Absolute link for copy/share.
export function shareUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : ""; // current site
  return `${origin}${sharePath(token)}`; // full URL
}

// Turn sharing on for one of my notes. Returns the token, or a short reason.
export async function shareNote(id: string): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  if (!hasSupabase) return { ok: false, reason: "Sharing is available on the live app once you’re signed in." }; // demo has no public page
  const token = newShareToken(); // fresh unguessable token
  const { error } = await supabase().from("desk_notes").update({ share_token: token, updated_at: new Date().toISOString() }).eq("id", id); // own row only
  if (error) return { ok: false, reason: "Couldn’t share that note. Try again?" }; // column missing or other error
  return { ok: true, token }; // ready to copy
}

// Turn sharing off for one of my notes (the old link stops working).
export async function unshareNote(id: string): Promise<boolean> {
  if (!hasSupabase) return true; // nothing to clear in demo
  const { error } = await supabase().from("desk_notes").update({ share_token: null, updated_at: new Date().toISOString() }).eq("id", id); // own row only
  return !error; // false if it didn't go through
}
