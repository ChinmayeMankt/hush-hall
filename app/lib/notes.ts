// Private desk notes: titles, sources, links and annotations for the owner only.
// Real mode stores rows in Supabase (RLS: own rows). Demo mode uses this browser only.

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
  title: string; // short label
  source: NoteSource | null; // optional source
  url: string | null; // optional http(s) link
  note: string; // free-text annotation
  createdAt: number; // ms
  updatedAt: number; // ms
};

const TITLE_MAX = 80; // same as the database
const NOTE_MAX = 2000; // same as the database
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

// Trim and cap a title; empty after trim is invalid.
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

// Demo storage: newest first, kept on this device only.
function localList(): DeskNote[] {
  if (typeof localStorage === "undefined") return []; // server render
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as DeskNote[]; // may throw
    return Array.isArray(parsed) ? parsed.sort((a, b) => b.createdAt - a.createdAt) : []; // newest first
  } catch {
    return []; // corrupt storage
  }
}

function localWrite(all: DeskNote[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(all.slice(0, 500))); // keep it bounded
}

// Database row -> app note.
type NoteRow = { id: string; title: string; source: string | null; url: string | null; note: string; created_at: string; updated_at: string }; // columns we read
const toNote = (r: NoteRow): DeskNote => ({
  id: r.id, // uuid
  title: r.title, // as stored
  source: cleanSource(r.source ?? ""), // only known sources
  url: r.url, // may be null
  note: r.note ?? "", // empty is fine
  createdAt: Date.parse(r.created_at), // ms
  updatedAt: Date.parse(r.updated_at), // ms
});

// Load my notes, newest first. Other people's notes are never returned (RLS).
export async function listNotes(): Promise<DeskNote[]> {
  if (!hasSupabase) return localList(); // demo
  const { data, error } = await supabase().from("desk_notes").select("id,title,source,url,note,created_at,updated_at").order("created_at", { ascending: false }).limit(500); // own rows only
  if (error || !data) return []; // fail quietly; the dialog can say it didn't load
  return (data as NoteRow[]).map(toNote); // newest first from the query
}

// Fields the form sends when adding or editing a note.
export type NoteDraft = { title: string; source: string; url: string; note: string }; // raw form values

// Validate and save. Returns a short reason when the row is refused.
export async function saveNote(draft: NoteDraft, id?: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const title = cleanTitle(draft.title); // required
  const source = cleanSource(draft.source); // optional
  const urlRaw = draft.url.trim(); // optional
  const note = cleanNoteBody(draft.note); // optional
  if (!title) return { ok: false, reason: "Give the note a short title." }; // required
  if (!validNoteUrl(urlRaw)) return { ok: false, reason: "Links must start with http:// or https://." }; // reject other schemes
  const url = urlRaw ? urlRaw.slice(0, URL_MAX) : null; // store null when empty
  if (!hasSupabase) {
    const all = localList(); // current demo list
    if (id) {
      const next = all.map((n) => (n.id === id ? { ...n, title, source, url, note, updatedAt: Date.now() } : n)); // edit in place
      localWrite(next); // persist
      return { ok: true, id }; // same id
    }
    const created: DeskNote = { id: `local-${Date.now()}`, title, source, url, note, createdAt: Date.now(), updatedAt: Date.now() }; // new demo row
    localWrite([created, ...all]); // newest first
    return { ok: true, id: created.id }; // new id
  }
  const row = { title, source, url, note, updated_at: new Date().toISOString() }; // columns to write
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

// Remove one of my notes.
export async function deleteNote(id: string): Promise<boolean> {
  if (!hasSupabase) {
    localWrite(localList().filter((n) => n.id !== id)); // drop from this browser
    return true; // demo always succeeds
  }
  const { error } = await supabase().from("desk_notes").delete().eq("id", id); // RLS: own row only
  return !error; // false if it didn't go through
}
