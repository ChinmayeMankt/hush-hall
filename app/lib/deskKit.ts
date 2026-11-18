// Quiet desk kit: the one place for its rules and numbers, plus loading and
// saving. The database (supabase/migrations/0006_desk_kit.sql) holds the same
// numbers in desk_kit_catalog() and enforces them; supabase/tests/desk_kit_test.sql
// checks the two lists match. Change both together.
//
// Rules in plain words:
//  - A study day = a sitting of 25+ focused minutes that ends through the recap
//    step. At most one study day per local calendar day.
//  - Toward the kit, at most 150 minutes (2.5 h) count per local day. The Hours
//    panel still shows every minute.
//  - Items unlock by total study days and are never taken away. No streaks.
//  - Unlocks and the 5-spot arrangement belong to the person and move with them
//    to any desk. Others see the arrangement of whoever sits at a desk.
// No three.js here, so the 2D view and dialogs can import it cheaply.

import { hasSupabase, supabase } from "./backend/client"; // real backend (if configured)

// ---- Rules ----

export const STUDY_DAY_MIN_MINUTES = 25; // setting: a sitting needs this many focused minutes to make a study day
export const DAILY_COUNTED_CAP_MIN = 150; // setting: at most 2.5 h per local day count toward the kit

// Every desk item, in unlock order. `days` = total study days needed.
export const DESK_ITEMS = [
  { id: "plant", name: "Small plant", days: 1, line: "A seedling in a glazed pot" }, // first reward, after the first study day
  { id: "mug", name: "Mug", days: 3, line: "A sage ceramic mug on a cork coaster" }, // day 3
  { id: "books", name: "Book stack", days: 7, line: "Three cloth-bound books with a ribbon" }, // day 7
  { id: "lamp", name: "Reading lamp", days: 14, line: "A small brass lamp with a paper shade" }, // day 14
  { id: "clock", name: "Desk clock", days: 21, line: "A walnut mantel clock" }, // day 21
  { id: "cat", name: "Sleeping cat", days: 30, line: "A curled-up ceramic cat" }, // day 30
  { id: "notebook", name: "Notebook & pen", days: 45, line: "A leather notebook with a brass pen" }, // day 45
] as const;

export type DeskItemId = (typeof DESK_ITEMS)[number]["id"]; // "plant" | "mug" | ...
export const ITEM_BY_ID = new Map<string, (typeof DESK_ITEMS)[number]>(DESK_ITEMS.map((i) => [i.id, i])); // quick lookup

// The five fixed spots on every desk (ids match the database).
export const DESK_SPOTS = [
  { id: "1", label: "Corner by the lamp" }, // desk corner on the green-lamp side
  { id: "2", label: "Back, beside the lamp" }, // far side, between the lamp and the middle
  { id: "3", label: "Beside your book" }, // just right of your open book or laptop (book side)
  { id: "4", label: "On the old books" }, // on top of the desk's own two books
  { id: "5", label: "Corner by the books" }, // desk corner on the book side
] as const;
export type SpotId = (typeof DESK_SPOTS)[number]["id"]; // "1".."5"
export type DeskSpots = Partial<Record<SpotId, DeskItemId>>; // spot -> item (missing = empty)

// My kit as the UI uses it.
export type DeskKit = { studyDays: number; unlocked: DeskItemId[]; spots: DeskSpots };

// What finishing a sitting through the recap tells the hall.
export type FinishResult = { minutes: number; studyDays: number; counted: boolean; newItems: DeskItemId[] };

// ---- Pure helpers ----

// Items earned by a study-day total (used by demo mode; the database does this for real accounts).
export function itemsForDays(days: number): DeskItemId[] {
  return DESK_ITEMS.filter((i) => i.days <= days).map((i) => i.id); // in unlock order
}

// The next item and when it arrives, or null once everything is unlocked.
export function nextUnlock(days: number): { item: (typeof DESK_ITEMS)[number]; at: number } | null {
  const n = DESK_ITEMS.find((i) => i.days > days); // first not yet earned
  return n ? { item: n, at: n.days } : null; // e.g. mug at 3
}

// Keep only valid spots and known items, each item once (optionally only unlocked ones).
export function cleanSpots(raw: unknown, unlocked?: readonly string[]): DeskSpots {
  const out: DeskSpots = {}; // cleaned arrangement
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out; // not an object
  const used = new Set<string>(); // items already placed
  for (const s of DESK_SPOTS) { // spots in order
    const v = (raw as Record<string, unknown>)[s.id]; // item id at this spot
    if (typeof v !== "string" || !ITEM_BY_ID.has(v) || used.has(v)) continue; // empty, unknown or duplicate
    if (unlocked && !unlocked.includes(v)) continue; // not unlocked (demo safety)
    out[s.id] = v as DeskItemId; // keep
    used.add(v); // once only
  }
  return out; // ready
}

// Same arrangement? (Used to skip needless saves and re-renders.)
export function sameSpots(a: DeskSpots | undefined, b: DeskSpots | undefined): boolean {
  return DESK_SPOTS.every((s) => (a?.[s.id] ?? null) === (b?.[s.id] ?? null)); // compare all five
}

// Short sentence for the desk card / 2D tile: "Small plant, Mug". Empty string if nothing placed.
export function spotsSummary(spots: DeskSpots | undefined): string {
  return DESK_SPOTS.map((s) => spots?.[s.id]).filter(Boolean).map((id) => ITEM_BY_ID.get(id!)!.name).join(", "); // names in spot order
}

// The person's IANA time zone, e.g. "Asia/Kolkata" (the database checks it and falls back to Asia/Kolkata).
export function localTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata"; } catch { return "Asia/Kolkata"; } // browser setting
}

// Today's local date as YYYY-MM-DD (demo mode only).
function localDay(ms = Date.now()): string {
  const d = new Date(ms); // browser local time
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; // e.g. 2026-11-18
}

// ---- Demo mode storage (this browser only) ----

const LOCAL_KEY = "hh.deskKit"; // localStorage key
type LocalKit = { days: Record<string, number>; unlocked: DeskItemId[]; spots: DeskSpots }; // local date -> counted minutes

// Read the demo kit.
function readLocal(): LocalKit {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}") as Partial<LocalKit>; // saved or empty
    const unlocked = (raw.unlocked ?? []).filter((i) => ITEM_BY_ID.has(i)); // known items only
    return { days: raw.days ?? {}, unlocked, spots: cleanSpots(raw.spots, unlocked) }; // tidy
  } catch {
    return { days: {}, unlocked: [], spots: {} }; // unreadable: start fresh
  }
}

// Save the demo kit.
function writeLocal(k: LocalKit) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(k)); // this browser only
}

// Demo: record a finished sitting the same way the database does.
function finishLocal(minutes: number): Omit<FinishResult, "minutes"> {
  const k = readLocal(); // current kit
  if (minutes < STUDY_DAY_MIN_MINUTES) return { studyDays: Object.keys(k.days).length, counted: false, newItems: [] }; // too short
  const day = localDay(); // local calendar date
  k.days[day] = Math.min(DAILY_COUNTED_CAP_MIN, (k.days[day] ?? 0) + minutes); // capped per day
  const total = Object.keys(k.days).length; // study days so far
  const newItems = itemsForDays(total).filter((i) => !k.unlocked.includes(i)); // just earned
  k.unlocked = [...k.unlocked, ...newItems]; // never removed
  writeLocal(k); // keep
  return { studyDays: total, counted: true, newItems }; // for the recap note
}

// ---- Loading and saving ----

// My kit (study days, unlocked items, arrangement). Never throws: an empty kit on error.
export async function loadMyDeskKit(): Promise<DeskKit> {
  if (!hasSupabase) { const k = readLocal(); return { studyDays: Object.keys(k.days).length, unlocked: k.unlocked, spots: k.spots }; } // demo
  const { data, error } = await supabase().rpc("my_desk_kit"); // totals + unlocks + layout (own only)
  if (error || !data) return { studyDays: 0, unlocked: [], spots: {} }; // e.g. migration 0006 not applied yet
  const d = data as { study_days?: number; unlocked?: string[]; spots?: unknown }; // raw JSON
  const unlocked = (d.unlocked ?? []).filter((i): i is DeskItemId => ITEM_BY_ID.has(i)); // known items
  return { studyDays: d.study_days ?? 0, unlocked, spots: cleanSpots(d.spots, unlocked) }; // tidy
}

// Save my arrangement. Returns what was saved, or null if it didn't go through.
export async function saveDeskSpots(spots: DeskSpots, unlocked: readonly DeskItemId[]): Promise<DeskSpots | null> {
  const clean = cleanSpots(spots, unlocked); // only unlocked items, each once
  if (!hasSupabase) { const k = readLocal(); writeLocal({ ...k, spots: clean }); return clean; } // demo
  const { data, error } = await supabase().rpc("set_desk_layout", { p_spots: clean }); // checked again in SQL
  if (error) return null; // not saved
  return cleanSpots(data, unlocked); // what the database kept
}

// Finish a sitting through the recap: saves it (like stand_up) and records the
// study day if it qualifies. Falls back to plain stand_up if 0006 isn't applied.
export async function finishSitting(sittingId: string, minutes: number, recap: string): Promise<FinishResult> {
  const m = Math.round(minutes); // whole minutes
  if (!hasSupabase) return { minutes: m, ...finishLocal(m) }; // demo (history is saved by the caller)
  const sb = supabase(); // client
  const { data, error } = await sb.rpc("finish_sitting", { p_id: sittingId, p_focused_minutes: m, p_recap: recap, p_tz: localTimeZone() }); // save + count
  if (!error && data) {
    const d = data as { minutes?: number; study_days?: number; counted?: boolean; new_items?: string[] }; // raw JSON
    return { minutes: d.minutes ?? 0, studyDays: d.study_days ?? 0, counted: !!d.counted, newItems: (d.new_items ?? []).filter((i): i is DeskItemId => ITEM_BY_ID.has(i)) }; // tidy
  }
  const { data: saved } = await sb.rpc("stand_up", { p_id: sittingId, p_focused_minutes: m, p_recap: recap }); // older database: save as before
  return { minutes: (saved as number | null) ?? 0, studyDays: 0, counted: false, newItems: [] }; // nothing unlocked
}
