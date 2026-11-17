// Presence sounds: quiet, event-driven sounds that make real students feel
// present. They fire only on real app events — a real student sits, stands or
// goes on a break — never on a random loop.
//
//   sit   -> a soft chair scrape, plus a very short chime
//   stand -> a soft chair scrape and a book closing, plus a very short chime
//   break -> a quiet page rustle or a pen drop
//
// These are deliberately separate from the timer alerts (lib/chime.ts) and the
// background ambience (lib/ambient.ts): the "Presence sounds" setting mutes only
// these, and turning rain or the timer sound off leaves these alone.
// Volume is kept low so the hall stays study-friendly. Output goes through the
// page's one shared AudioContext, which chime.ts already unlocks on first tap.
//
// Future idea (NOT implemented — there is no camera or video anywhere in Hush
// Hall today): a hands-only desk cam over LiveKit, a downward view of just the
// hands and notebook, opt-in per desk and never recorded. It would reuse the
// same "real student only" presence signals that drive the live marker and these
// sounds. Left out of this change on purpose.

import { sharedAudioContext } from "./chime"; // the page's shared, gesture-unlocked AudioContext

const KEY = "hh-presence-sounds"; // localStorage key for the mute setting
let enabled: boolean | null = null; // cached setting (null = not read yet)

// Is the presence-sound setting on? On by default; students can mute it.
export function presenceSoundsEnabled(): boolean {
  if (enabled !== null) return enabled; // cached
  try { enabled = window.localStorage.getItem(KEY) !== "0"; } catch { enabled = true; } // storage blocked: default on
  return enabled;
}

// Remember the student's choice (device-local, like the timer sound).
export function savePresenceSoundsEnabled(on: boolean) {
  enabled = on; // apply at once
  try { window.localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* storage blocked: lasts this visit */ }
}

// ---- synthesis helpers (no audio files, same approach as ambient.ts / chime.ts) ----

// A short buffer of white noise that decays to zero, reused as the base of every
// scrape / rustle / paper sound.
function noise(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.ceil(c.sampleRate * seconds)); // at least one sample
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len); // fade out over the buffer
  return buf;
}

// One filtered noise burst: quick attack, then a decay. The filter shapes it
// from a paper rustle (high) to a chair scrape (mid band).
function fizz(c: AudioContext, o: { at: number; dur: number; peak: number; freq: number; q: number; type: BiquadFilterType }) {
  const src = c.createBufferSource(); // noise
  src.buffer = noise(c, o.dur);
  const filter = c.createBiquadFilter(); // shape
  filter.type = o.type;
  filter.frequency.value = o.freq;
  filter.Q.value = o.q;
  const gain = c.createGain(); // volume envelope
  gain.gain.setValueAtTime(0.0001, o.at);
  gain.gain.exponentialRampToValueAtTime(o.peak, o.at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);
  src.connect(filter).connect(gain).connect(c.destination); // wire to speakers
  src.start(o.at);
  src.stop(o.at + o.dur + 0.03);
}

// One soft note with a quick fade-in and a decaying tail.
function note(c: AudioContext, freq: number, at: number, dur: number, peak: number, type: OscillatorType = "sine") {
  const osc = c.createOscillator(); // tone
  const gain = c.createGain(); // envelope
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.03);
}

// ---- the individual event sounds (all deliberately quiet) ----

function chair(c: AudioContext, at: number) {
  fizz(c, { at, dur: 0.18, peak: 0.05, freq: 620, q: 0.7, type: "bandpass" }); // the scrape of the chair
  note(c, 96, at, 0.12, 0.028); // the faint weight of sitting down
}

function bookClose(c: AudioContext, at: number) {
  note(c, 150, at, 0.13, 0.04); // the low whump of the cover
  fizz(c, { at: at + 0.01, dur: 0.1, peak: 0.03, freq: 2600, q: 0.6, type: "highpass" }); // pages settling
}

function pageRustle(c: AudioContext, at: number) {
  fizz(c, { at, dur: 0.24, peak: 0.03, freq: 2400, q: 0.5, type: "highpass" });
  fizz(c, { at: at + 0.1, dur: 0.16, peak: 0.02, freq: 3200, q: 0.5, type: "highpass" });
}

function penDrop(c: AudioContext, at: number) {
  note(c, 2600, at, 0.03, 0.035, "triangle"); // the first small click
  note(c, 1900, at + 0.055, 0.045, 0.022, "triangle"); // and the tiny bounce
}

// The soft two-note marker for arriving / leaving. Much quieter than the timer chime.
function marker(c: AudioContext, at: number) {
  note(c, 1046.5, at, 0.5, 0.03); // C6
  note(c, 1568, at + 0.12, 0.45, 0.016); // G6
}

// ---- public, event-driven playback ----

// Play one rendered sound unless the student muted presence sounds. Resumes a
// suspended context first (the same one the timer alerts use).
function play(render: (c: AudioContext, at: number) => void) {
  if (!presenceSoundsEnabled()) return; // muted
  try {
    const c = sharedAudioContext(); // shared context (already unlocked by a tap)
    if (!c) return; // unsupported
    const go = () => { try { render(c, c.currentTime + 0.01); } catch { /* one bad node shouldn't break the hall */ } };
    if (c.state === "suspended") c.resume().then(go).catch(() => {}); // wake it, then play
    else go();
  } catch { /* audio blocked or unsupported: silence is fine */ }
}

// A real student sat down: chair scrape + the soft arrival marker.
export function playSitSound() { play((c, at) => { chair(c, at); marker(c, at + 0.04); }); }

// A real student stood up: chair scrape + a book closing + the marker.
export function playStandSound() { play((c, at) => { chair(c, at); bookClose(c, at + 0.06); marker(c, at + 0.05); }); }

// A real student went on a break: a quiet page rustle or a pen drop (either is fine).
export function playBreakSound() { play((c, at) => { if (Math.random() < 0.5) pageRustle(c, at); else penDrop(c, at); }); }
