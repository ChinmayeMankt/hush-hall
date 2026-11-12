// Study-time helpers: today and this week in Asia/Kolkata (IST), plus a 7-day list.
// Hours come from desk sittings (focused minutes already stored on each sitting).
// Copy is never-shaming: totals only add up; nothing here resets or is "lost".

import type { Sitting } from "./profile"; // history rows

const IST_MS = (5 * 60 + 30) * 60 * 1000; // IST is UTC+5:30, no daylight-saving

// Shift a UTC instant so getUTC* returns IST clock parts.
function istParts(ms: number) {
  const d = new Date(ms + IST_MS); // look at the IST clock
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), day: d.getUTCDate(), dow: d.getUTCDay() }; // year, month, date, weekday (0 = Sunday)
}

// Midnight IST of the day that contains `ms`, as a UTC epoch.
export function startOfIstDay(ms: number): number {
  const p = istParts(ms); // IST calendar day
  return Date.UTC(p.y, p.mo, p.day) - IST_MS; // IST midnight in UTC
}

// Monday 00:00 IST of the week that contains `ms` (week is Monday–Sunday).
export function startOfIstWeek(ms: number): number {
  const start = startOfIstDay(ms); // today IST midnight
  const dow = istParts(ms).dow; // 0 = Sunday … 6 = Saturday
  const fromMon = (dow + 6) % 7; // Monday = 0, Sunday = 6
  return start - fromMon * 24 * 60 * 60 * 1000; // Monday midnight IST
}

// Short hour label, e.g. "12.5 h", "45 min", "0 h".
export function formatStudyHours(minutes: number): string {
  const m = Math.max(0, Math.round(minutes)); // whole minutes
  if (m <= 0) return "0 h"; // nothing logged
  if (m < 60) return `${m} min`; // under an hour, say minutes
  const h = Math.round(m / 6) / 10; // one decimal hour
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`; // "12 h" or "12.5 h"
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const; // IST week order

// One day in the 7-day bar list.
export type DayHours = { start: number; label: string; minutes: number }; // midnight, weekday, total

// Totals for me: today, this IST week, and the last 7 IST days ending today.
export function studyStats(history: Sitting[], extraMinutes = 0, now = Date.now()) {
  const todayStart = startOfIstDay(now); // today 00:00 IST
  const weekStart = startOfIstWeek(now); // this Monday 00:00 IST
  const today = history.filter((s) => s.at >= todayStart).reduce((sum, s) => sum + s.minutes, 0) + extraMinutes; // today's focused minutes (live sitting added once)
  const week = history.filter((s) => s.at >= weekStart).reduce((sum, s) => sum + s.minutes, 0) + extraMinutes; // this Mon–Sun
  const days: DayHours[] = []; // last 7 IST days, oldest first
  for (let i = 6; i >= 0; i--) {
    const start = todayStart - i * 24 * 60 * 60 * 1000; // that day's midnight
    const end = start + 24 * 60 * 60 * 1000; // next midnight
    const label = WEEKDAY_LABELS[(istParts(start).dow + 6) % 7]; // Mon…Sun
    let min = history.filter((s) => s.at >= start && s.at < end).reduce((sum, s) => sum + s.minutes, 0); // sittings that ended/landed that day
    if (i === 0) min += extraMinutes; // live sitting counts on today
    days.push({ start, label, minutes: min }); // one bar
  }
  return { today, week, days }; // all in focused minutes
}
