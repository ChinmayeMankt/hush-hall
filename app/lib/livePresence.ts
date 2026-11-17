// Who counts as a real student in a hall, and small labels about them.
//
// Hush Hall shows three kinds of seated people:
//   - real students  : live presence (another tab, or a signed-in account)
//   - demo students  : the locally simulated students in the offline prototype (isDemo)
//   - ambient students: scripted "company" computed from the clock (isAmbient)
//
// Only real students get the live marker, the event-driven presence sounds and
// the "sat down X min ago" label. The two companion kinds must never have them,
// so every check goes through isRealStudent().

import type { Member } from "./presence/types"; // member shape

// True only for a live person, never for a scripted companion (demo or ambient).
export function isRealStudent(m: Pick<Member, "isDemo" | "isAmbient">): boolean {
  return !m.isDemo && !m.isAmbient; // companions are exactly the two flagged kinds
}

// "sat down just now" / "sat down 4 min ago" / "sat down 2 h ago".
// Returns null for companions (which never carry satDownAt) or when it is unknown.
export function satAgoLabel(satDownAt: number | undefined, nowMs: number): string | null {
  if (!satDownAt || !Number.isFinite(satDownAt)) return null; // nothing to show
  const mins = Math.max(0, Math.floor((nowMs - satDownAt) / 60000)); // whole minutes since they sat
  if (mins < 1) return "sat down just now"; // the first minute
  if (mins < 60) return `sat down ${mins} min ago`; // up to an hour
  return `sat down ${Math.floor(mins / 60)} h ago`; // longer sittings
}
