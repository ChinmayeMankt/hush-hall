// Page-turn presence sounds: a lightweight, hall-wide scheduler that plays one
// soft page turn now and then for a real, seated student.
//
// Rules (see the feature request):
//   - Real students only: callers pass candidates from the live presence list
//     and exclude scripted companions (isRealStudent) before they get here.
//   - Follows the "Presence sounds" toggle (localStorage key hh-presence-sounds).
//   - Hard global rate limit: at most ONE page turn per 25-30 s in this hall,
//     however many students are seated. The gap is randomised, never fixed.
//   - Distance falloff: the turn is scaled by how far the chosen desk is from
//     the listener and skipped entirely when it is too far to hear.
//   - Random desk + random gap, so it never settles into a pattern or rhythm.
//   - Uses the shared AudioContext; the recorded mp3 is fetched and decoded once
//     (about 70 KB) and reused for every play. Does not touch the sit/stand or
//     break sounds in presenceSounds.ts.
//
// This is deliberately decoupled from the 3D render loop: it works the same in
// the simple 2D view, for reduced-motion users, and while walking.

import { presenceSoundsEnabled } from "./presenceSounds"; // the shared mute setting
import { sharedAudioContext } from "./chime"; // the page's gesture-unlocked AudioContext

// One real, seated student who could be turning a page, at their chair position.
export interface PageTurnCandidate {
  seat: string; // desk label, e.g. "B4"
  x: number; // chair x (metres)
  z: number; // chair z (metres)
}

// Where the sound is heard from (my chair if seated, my body if walking).
export interface Listener {
  x: number;
  z: number;
}

export interface PageTurnView {
  candidates: PageTurnCandidate[]; // real seated students right now (may be empty)
  listener: Listener; // where I am
}

const SRC = "/page-turn.mp3"; // copied into public/ and referenced by this path
const BASE_GAIN = 0.03; // overall loudness: deliberately under the sit/stand sounds
const NEAR_M = 3; // full volume within this distance (metres)
const FAR_M = 15; // silent at or beyond this distance (metres)
const MIN_GAP_MS = 25000; // hard global limit: at most one page turn per ...
const MAX_GAP_MS = 30000; // ... randomised 25-30 s window, hall-wide
const TICK_MS = 1500; // how often we consider a turn (cheap: a short list scan)

let buffer: AudioBuffer | null = null; // decoded mp3 (shared for the page)
let bufferGain = 1; // peak-normalisation so the file's own loudness can't surprise us
let loading = false; // a decode is already in flight
let nextAllowed = 0; // epoch ms before which no page turn may play

// Fetch and decode the mp3 once into the shared context. Safe to call often.
export function preloadPageTurn(): void {
  if (buffer || loading) return; // already decoded or decoding
  const c = sharedAudioContext(); // same context the other sounds use
  if (!c) return; // no Web Audio: page turns simply stay silent
  loading = true;
  fetch(SRC)
    .then((r) => r.arrayBuffer())
    .then((bytes) => c.decodeAudioData(bytes))
    .then((decoded) => {
      buffer = decoded; // ready for the next turn
      let peak = 0; // loudest sample across channels
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const d = decoded.getChannelData(ch);
        for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
      }
      bufferGain = peak > 0.001 ? 1 / peak : 1; // scale so its peak equals BASE_GAIN below
    })
    .catch(() => { /* missing file or decode blocked: stay silent */ })
    .finally(() => { loading = false; });
}

// How audible a sound from (x, z) is from the listener's spot: 0..1.
function falloff(x: number, z: number, l: Listener): number {
  const d = Math.hypot(x - l.x, z - l.z); // distance to the desk
  if (d >= FAR_M) return 0; // too far to hear: skip
  const t = (FAR_M - d) / (FAR_M - NEAR_M); // 1 near, 0 at the edge
  return Math.min(1, Math.max(0, t)); // clamp
}

// Consider one page turn. Returns true if a sound actually played.
export function playPageTurn(candidates: PageTurnCandidate[], listener: Listener): boolean {
  if (!presenceSoundsEnabled()) return false; // muted by the student
  if (Date.now() < nextAllowed) return false; // hard global rate limit
  // Only desks close enough to make a sound, from where I am.
  const audible = candidates.filter((c) => falloff(c.x, c.z, listener) > 0);
  if (!audible.length) return false; // nobody near enough: stay quiet
  const c = sharedAudioContext();
  if (!c || !buffer) { preloadPageTurn(); return false; } // not loaded yet; load for next time
  const pick = audible[(Math.random() * audible.length) | 0]; // a random nearby student
  const g = falloff(pick.x, pick.z, listener); // distance shape 0..1
  const gain = BASE_GAIN * bufferGain * g * g; // peak-normalised, then a natural squared drop with distance
  const src = c.createBufferSource(); // one-shot playback of the recorded turn
  src.buffer = buffer;
  const gn = c.createGain(); // its own volume
  gn.gain.value = gain;
  src.connect(gn).connect(c.destination);
  const start = () => { try { src.start(); } catch { /* already stopped: ignore */ } };
  if (c.state === "suspended") c.resume().then(start).catch(() => {}); // wake, then play
  else start();
  // Lock the hall for the next 25-30 s (randomised, so it never becomes a rhythm).
  nextAllowed = Date.now() + MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
  return true;
}

// Start the hall's page-turn loop. `view()` returns the real seated students and
// where I am, read fresh on every tick. Returns a stop function.
export function startPageTurns(view: () => PageTurnView): () => void {
  preloadPageTurn(); // warm the decode so the first turn is not missed
  if (nextAllowed === 0) nextAllowed = Date.now() + 4000 + Math.random() * 6000; // don't drop a page turn the instant you walk in
  const timer = setInterval(() => {
    try {
      const { candidates, listener } = view(); // current hall + my position
      if (candidates.length) playPageTurn(candidates, listener); // rate-limit handles the rest
    } catch { /* one bad tick must not stop the loop */ }
  }, TICK_MS);
  return () => clearInterval(timer); // stop on unmount or when muted
}
