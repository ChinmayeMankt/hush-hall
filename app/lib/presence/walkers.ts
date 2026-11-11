// Live positions of people walking around the hall.
// Providers write here when a position update arrives; the 3D hall reads it
// every frame. Kept outside React state so frequent updates cause no re-render.

import type { WalkState } from "./types"; // position + facing + pose

// One remote walker's latest sample, with the time it arrived (for smoothing).
export interface WalkSample extends WalkState {
  at: number; // performance.now() when the sample arrived
}

// id -> latest sample (only other people; my own position lives in the 3D hall).
export const walkers = new Map<string, WalkSample>(); // shared, mutable on purpose

// Store a new sample for one person. ageMs = how old the sample already was when
// it arrived (database reads are a moment behind), so motion prediction stays right.
export function setWalker(id: string, w: WalkState | null, ageMs = 0) {
  if (!w) { walkers.delete(id); return; } // stopped walking: forget the position
  walkers.set(id, { ...w, at: performance.now() - Math.min(Math.max(ageMs, 0), 3000) }); // newest sample, dated when it was taken (age capped at 3 s)
}

// Make a received payload safe: finite numbers, kept inside the hall, known pose.
export function cleanWalk(raw: unknown): WalkState | null {
  const w = raw as Partial<WalkState> | null; // untrusted shape from another tab or person
  if (!w || typeof w !== "object") return null; // nothing usable
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null); // finite number or null
  const x = num(w.x), z = num(w.z), ry = num(w.ry); // read the numbers
  if (x === null || z === null || ry === null) return null; // malformed: ignore
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)); // keep inside a range
  return { x: clamp(x, -11, 11), z: clamp(z, -8, 8), ry: clamp(ry, -100, 100), pose: w.pose === "walking" ? "walking" : "idle" }; // safe copy
}
