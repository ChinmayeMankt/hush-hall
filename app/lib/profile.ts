// Local profile, settings, usual seat and study history.
// Everything lives in this browser only (localStorage / sessionStorage).

// The student's own profile and settings.
export interface Profile {
  id: string; // per-tab id so several tabs act as different students
  name: string; // display name
  avatar: string; // emoji avatar
  color: string; // lamp colour
  hideFromRequests: boolean; // privacy toggle
  focusMin: number; // Pomodoro focus length in minutes
  breakMin: number; // Pomodoro break length in minutes
  chime: boolean; // gentle chime at phase change (off by default)
}

// One finished study sitting, saved at stand-up.
export interface Sitting {
  at: number; // epoch ms when they stood up
  hallId: string; // where they sat
  seat: string; // which desk
  topic: string; // what they studied
  minutes: number; // focused minutes in this sitting
  note: string; // one-line recap the student wrote
}

const PROFILE_KEY = "hh.profile"; // localStorage key for the remembered profile
const TAB_KEY = "hh.tabProfile"; // sessionStorage key for this tab's profile
const HISTORY_KEY = "hh.history"; // localStorage key for sittings
const SEAT_KEY = "hh.usualSeat"; // localStorage key for usual seat per hall

// Avatars offered in the lobby (calm, library-ish).
export const AVATARS = ["🦉", "📖", "🌿", "☕", "🐢", "🌙", "🪴", "🦊", "🐼", "✏️"];

// Default profile for a first visit.
function freshProfile(): Profile {
  return {
    id: `me-${Math.random().toString(36).slice(2, 10)}`, // random tab id
    name: "", // asked for in the lobby
    avatar: "📖", // default avatar
    color: "#e9d8a6", // default lamp colour
    hideFromRequests: false, // open to requests by default
    focusMin: 25, // classic Pomodoro focus
    breakMin: 5, // classic Pomodoro break
    chime: false, // silent by default
  };
}

// Read JSON safely from storage.
function readJSON<T>(store: Storage, key: string): T | null {
  try {
    const raw = store.getItem(key); // raw string
    return raw ? (JSON.parse(raw) as T) : null; // parse or null
  } catch {
    return null; // corrupted value = start fresh
  }
}

// Load this tab's profile (tab copy first, then remembered profile, then fresh).
export function loadProfile(): Profile {
  const tab = readJSON<Profile>(sessionStorage, TAB_KEY); // this tab's identity
  if (tab) return tab; // already set up in this tab
  const saved = readJSON<Profile>(localStorage, PROFILE_KEY); // remembered settings
  const p = { ...freshProfile(), ...(saved ?? {}) }; // merge onto defaults
  p.id = freshProfile().id; // every tab gets its own id so tabs are different people
  sessionStorage.setItem(TAB_KEY, JSON.stringify(p)); // pin it to this tab
  return p; // ready to use
}

// Save the profile for this tab and remember it for next visit.
export function saveProfile(p: Profile) {
  sessionStorage.setItem(TAB_KEY, JSON.stringify(p)); // this tab
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); // next visit defaults
}

// Read all sittings, newest first.
export function loadHistory(): Sitting[] {
  return (readJSON<Sitting[]>(localStorage, HISTORY_KEY) ?? []).sort((a, b) => b.at - a.at); // newest first
}

// Append one sitting to history.
export function addSitting(s: Sitting) {
  const all = loadHistory(); // existing
  all.unshift(s); // newest first
  localStorage.setItem(HISTORY_KEY, JSON.stringify(all.slice(0, 500))); // keep it bounded
}

// Usual (returning) seat for a hall, if any.
export function usualSeat(hallId: string): string | null {
  return readJSON<Record<string, string>>(localStorage, SEAT_KEY)?.[hallId] ?? null; // seat or null
}

// Remember the seat a student likes in a hall.
export function setUsualSeat(hallId: string, seat: string) {
  const all = readJSON<Record<string, string>>(localStorage, SEAT_KEY) ?? {}; // existing map
  all[hallId] = seat; // update this hall
  localStorage.setItem(SEAT_KEY, JSON.stringify(all)); // persist
}

// Gentle weekly summary: hours and days shown up in the last 7 days.
// No "streak lost" language anywhere; missing a day is just a day.
export function weekSummary(history: Sitting[]) {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago
  const week = history.filter((s) => s.at >= since); // this week's sittings
  const minutes = week.reduce((sum, s) => sum + s.minutes, 0); // total focused minutes
  const days = new Set(week.map((s) => new Date(s.at).toDateString())).size; // distinct days
  return { minutes, days, sittings: week.length }; // summary numbers
}
