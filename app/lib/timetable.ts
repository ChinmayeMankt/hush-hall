// Private weekly timetable: day, start, end, subject. Owner only.
// Real mode stores rows in Supabase (RLS: own rows). Demo mode uses this browser only.

import { hasSupabase, supabase } from "./backend/client"; // real backend (if configured)
import { WEEKDAY_LABELS } from "./studyStats"; // Mon…Sun labels

export const TIMETABLE_DAYS = WEEKDAY_LABELS; // 0 = Monday … 6 = Sunday

// One planned slot on the weekly grid.
export type TimetableSlot = {
  id: string; // row id
  day: number; // 0 = Monday … 6 = Sunday
  startMin: number; // minutes from midnight
  endMin: number; // minutes from midnight, after start
  subject: string; // what they plan to study
};

const LOCAL_KEY = "hh.timetable"; // demo-mode storage key
const SUBJECT_MAX = 80; // same as the database

// "HH:MM" <-> minutes from midnight.
export function minToTime(min: number): string {
  const h = Math.floor(Math.max(0, min) / 60); // hour
  const m = Math.max(0, min) % 60; // minute
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; // 09:30
}
export function timeToMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim()); // from <input type="time">
  if (!m) return null; // not a time
  const hh = Number(m[1]), mm = Number(m[2]); // parts
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null; // out of range
  return hh * 60 + mm; // minutes
}

// Demo list, Monday-first then start time.
function localList(): TimetableSlot[] {
  if (typeof localStorage === "undefined") return []; // server render
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as TimetableSlot[]; // may throw
    return Array.isArray(parsed) ? sortSlots(parsed) : []; // ordered
  } catch {
    return []; // corrupt storage
  }
}
function localWrite(all: TimetableSlot[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(all.slice(0, 80))); // keep it bounded
}
function sortSlots(all: TimetableSlot[]): TimetableSlot[] {
  return [...all].sort((a, b) => a.day - b.day || a.startMin - b.startMin); // day, then time
}

type SlotRow = { id: string; day: number; start_min: number; end_min: number; subject: string }; // columns
const toSlot = (r: SlotRow): TimetableSlot => ({ id: r.id, day: r.day, startMin: r.start_min, endMin: r.end_min, subject: r.subject }); // rename

// Load my timetable. Other people's slots are never returned (RLS).
export async function listSlots(): Promise<TimetableSlot[]> {
  if (!hasSupabase) return localList(); // demo
  const { data, error } = await supabase().from("timetable_slots").select("id,day,start_min,end_min,subject").order("day").order("start_min").limit(80); // own rows
  if (error || !data) return []; // table missing or unread: empty list
  return sortSlots((data as SlotRow[]).map(toSlot)); // day, then time
}

// Add one slot. Returns a short reason when refused.
export async function addSlot(day: number, startMin: number, endMin: number, subject: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const sub = subject.trim().slice(0, SUBJECT_MAX); // required label
  if (day < 0 || day > 6) return { ok: false, reason: "Pick a day of the week." }; // 0–6
  if (startMin < 0 || startMin > 1439 || endMin < 1 || endMin > 1440 || endMin <= startMin) return { ok: false, reason: "The end time needs to be after the start time." }; // range
  if (!sub) return { ok: false, reason: "Add a short subject." }; // required
  if (!hasSupabase) {
    const created: TimetableSlot = { id: `local-${Date.now()}`, day, startMin, endMin, subject: sub }; // demo row
    localWrite(sortSlots([...localList(), created])); // persist
    return { ok: true, id: created.id }; // new id
  }
  const { data: who } = await supabase().auth.getUser(); // signed-in owner
  if (!who.user) return { ok: false, reason: "Sign in to save a timetable." }; // session gone
  const { data, error } = await supabase().from("timetable_slots").insert({ user_id: who.user.id, day, start_min: startMin, end_min: endMin, subject: sub }).select("id").maybeSingle(); // own row
  if (error || !data) return { ok: false, reason: "Couldn’t save that slot. Try again?" }; // table missing or other error
  return { ok: true, id: (data as { id: string }).id }; // new id
}

// Remove one of my slots.
export async function deleteSlot(id: string): Promise<boolean> {
  if (!hasSupabase) {
    localWrite(localList().filter((s) => s.id !== id)); // drop from this browser
    return true; // demo always succeeds
  }
  const { error } = await supabase().from("timetable_slots").delete().eq("id", id); // RLS: own row only
  return !error; // false if it didn't go through
}
