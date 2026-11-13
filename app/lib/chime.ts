// Timer alert sounds made with the Web Audio API (no audio files).
// The student picks one (or "Off"); the choice is remembered on this device.
//
// Browsers (Chrome, Safari, iOS) block audio until the page has had a tap or click,
// and a context created later by a timer stays "suspended" (silent). So we keep ONE
// shared context, unlock it on the student's first tap/click/key, and resume it before playing.

export type AlertSound = "off" | "ping" | "chime" | "bell" | "bowl" | "marimba" | "beep"; // timer alert choices

export const ALERT_OPTIONS: { id: AlertSound; label: string }[] = [
  { id: "ping", label: "Ping (ting)" },
  { id: "chime", label: "Soft chime" },
  { id: "bell", label: "Bell" },
  { id: "bowl", label: "Singing bowl" },
  { id: "marimba", label: "Marimba" },
  { id: "beep", label: "Gentle beep" },
  { id: "off", label: "Off (silent)" },
];

const KEY = "hh-alert-sound"; // localStorage key
export const DEFAULT_ALERT: AlertSound = "ping"; // plays unless the student turns it off

export function getAlertSound(): AlertSound {
  try {
    const v = window.localStorage.getItem(KEY) as AlertSound | null; // saved choice
    return ALERT_OPTIONS.some((o) => o.id === v) ? (v as AlertSound) : DEFAULT_ALERT; // fall back safely
  } catch { return DEFAULT_ALERT; } // storage blocked
}

export function saveAlertSound(s: AlertSound) {
  try { window.localStorage.setItem(KEY, s); } catch { /* storage blocked: choice lasts this visit only */ }
}

let ctx: AudioContext | null = null; // shared audio context, reused for every sound

function getCtx(): AudioContext | null {
  if (ctx && ctx.state !== "closed") return ctx; // reuse
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; // Safari fallback
  if (!Ctx) return null; // no Web Audio support
  ctx = new Ctx(); // create once
  return ctx;
}

// Call from a real user gesture (click, tap, key) so later timer-driven sounds are allowed to play.
export function unlockAudio() {
  try {
    const c = getCtx();
    if (c && c.state === "suspended") void c.resume(); // allowed because we're inside a gesture
  } catch { /* audio unsupported; staying silent is fine */ }
}

// Unlock audio on the first tap, click or key press anywhere on the page. Returns a cleanup function.
export function unlockAudioOnFirstGesture() {
  const events = ["pointerdown", "keydown", "touchstart"] as const; // any gesture counts
  const handler = () => { unlockAudio(); events.forEach((e) => window.removeEventListener(e, handler)); }; // once
  events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
  return () => events.forEach((e) => window.removeEventListener(e, handler)); // cleanup
}

// One note: quick fade-in, then a decaying tail.
function tone(c: AudioContext, freq: number, start: number, dur: number, peak: number, type: OscillatorType = "sine") {
  const t = c.currentTime + start; // when it starts
  const osc = c.createOscillator(); // tone generator
  const gain = c.createGain(); // volume envelope
  osc.type = type; // wave shape
  osc.frequency.value = freq; // pitch
  gain.gain.setValueAtTime(0.0001, t); // start silent
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.01); // quick attack
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur); // decay
  osc.connect(gain).connect(c.destination); // wire to speakers
  osc.start(t); // play
  osc.stop(t + dur + 0.05); // stop after the tail
}

function playNotes(c: AudioContext, s: AlertSound) {
  switch (s) {
    case "ping": // bright "ting": two high partials, short ring
      tone(c, 1760, 0, 1.0, 0.28); tone(c, 2637, 0, 0.6, 0.12); break;
    case "chime": // two soft notes, C5 then E5
      tone(c, 523.25, 0, 1.2, 0.2); tone(c, 659.25, 0.35, 1.2, 0.2); break;
    case "bell": // bell-like inharmonic partials, long ring
      [1, 2.76, 5.4, 8.93].forEach((m, i) => tone(c, 440 * m, 0, 2.2 / (1 + i * 0.6), 0.2 / (1 + i * 0.7))); break;
    case "bowl": // singing bowl: low, warm, slow fade
      tone(c, 220, 0, 3.2, 0.22); tone(c, 441, 0, 2.6, 0.1); tone(c, 662, 0, 2.0, 0.05); break;
    case "marimba": // three quick rising notes
      [523.25, 659.25, 783.99].forEach((f, i) => tone(c, f, i * 0.14, 0.45, 0.22, "triangle")); break;
    case "beep": // two short gentle beeps
      tone(c, 880, 0, 0.18, 0.1, "square"); tone(c, 880, 0.26, 0.18, 0.1, "square"); break;
    default: break; // "off"
  }
}

// Play a sound. With no argument, plays the student's saved choice (this is what the timer calls).
export function playAlert(sound?: AlertSound) {
  try {
    const s = sound ?? getAlertSound(); // chosen sound
    if (s === "off") return; // silent
    const c = getCtx();
    if (!c) return; // unsupported
    if (c.state === "suspended") c.resume().then(() => playNotes(c, s)).catch(() => {}); // wake it first, then play
    else playNotes(c, s);
  } catch { /* audio blocked or unsupported; staying silent is fine */ }
}
