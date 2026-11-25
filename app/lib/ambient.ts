// Optional background sounds: a music playlist (mp3 files) plus Web Audio beds
// (filtered noise, no audio files). The student picks one in the hall header.
// Default is "All tracks": every entry in TRACKS, in order, then back to the start.

import { TRACKS, type Track } from "./tracks"; // playlist: add a track there, not here

export type AmbientKind = "off" | "rain" | "waves" | "wind" | "fire" | "brown" | "white" | "music" | string;

// Build the Background menu: Off, All tracks, each named track, then the noise beds.
export const AMBIENT_OPTIONS: { id: AmbientKind; label: string }[] = [
  { id: "off", label: "Off" }, // silence
  { id: "music", label: "All tracks" }, // play every TRACKS entry in order, then wrap
  ...TRACKS.map((t) => ({ id: t.id, label: t.title })), // one option per track, loops that track alone
  { id: "rain", label: "Soft rain" },
  { id: "waves", label: "Ocean waves" },
  { id: "wind", label: "Gentle wind" },
  { id: "fire", label: "Crackling fire" },
  { id: "brown", label: "Brown noise (deep)" },
  { id: "white", label: "White noise" },
];

// True when this choice is the playlist or a single music track (not a noise bed).
export function isMusicKind(kind: AmbientKind) {
  return kind === "music" || TRACKS.some((t) => t.id === kind); // "music" is play-all; ids come from TRACKS
}

// Resolve the list of tracks for a music choice.
function musicListFor(kind: AmbientKind): Track[] | null {
  if (kind === "music") return TRACKS.slice(); // all tracks, in file order
  const one = TRACKS.find((t) => t.id === kind); // a single named track
  return one ? [one] : null; // null means this is not music
}

type Active = { ctx: AudioContext | null; master: GainNode | null; cleanup: () => void };
let active: Active | null = null; // whatever is making sound right now
let activeKind: AmbientKind | null = null; // the choice that started it, so we can skip a restart

const MUSIC_VOLUME = 0.35; // same quiet level as the old single Warm Focus player
const NEXT_PREROLL = 0.08; // start the next track this many seconds before the current one ends

// First-click retry: browsers block play() until a tap, click, or key press.
const GESTURE_EVENTS = ["pointerdown", "keydown", "touchstart"] as const; // same set the chime unlock uses

function noiseSource(ctx: AudioContext, kind: "white" | "brown") {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === "white") data[i] = w * 0.5;
    else { last = (last + 0.02 * w) / 1.02; data[i] = last * 3.5; }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

function wobble(ctx: AudioContext, param: AudioParam, hz: number, depth: number) {
  const lfo = ctx.createOscillator();
  const amount = ctx.createGain();
  lfo.frequency.value = hz;
  amount.gain.value = depth;
  lfo.connect(amount).connect(param);
  lfo.start();
  return lfo;
}

export function stopAmbient() {
  if (!active) { // nothing playing
    activeKind = null; // clear the remembered choice
    return;
  }
  const a = active; // keep a handle for the fade
  active = null; // allow a new sound to start immediately
  activeKind = null; // this choice is no longer live

  if (a.cleanup) a.cleanup(); // pause players, drop listeners, release files
  if (a.ctx && a.master) {
    a.master.gain.cancelScheduledValues(a.ctx.currentTime);
    a.master.gain.setValueAtTime(Math.max(a.master.gain.value, 0.0001), a.ctx.currentTime);
    a.master.gain.exponentialRampToValueAtTime(0.0001, a.ctx.currentTime + 1.2);
    setTimeout(() => { try { a.ctx!.close(); } catch {} }, 1300);
  }
}

// Try to start playback now, and again on the first user gesture if the browser blocks it.
function playWhenAllowed(el: HTMLAudioElement, bag: { gesture: (() => void) | null }) {
  const tryPlay = () => { void el.play().catch(() => {}); }; // autoplay may reject; we retry on a gesture
  tryPlay(); // attempt immediately, same as the old Warm Focus player
  if (bag.gesture) bag.gesture(); // drop any earlier gesture hook
  const handler = () => { // first tap, click or key anywhere
    tryPlay(); // retry inside a real user gesture
    drop(); // one successful arming is enough; play() keeps going once started
  };
  const drop = () => { // remove the listeners
    GESTURE_EVENTS.forEach((e) => window.removeEventListener(e, handler)); // each event
    bag.gesture = null; // so cleanup can tell there is nothing left
  };
  GESTURE_EVENTS.forEach((e) => window.addEventListener(e, handler, { passive: true })); // do not block scrolling
  bag.gesture = drop; // cleanup calls this
  const onPlaying = () => { drop(); }; // once sound is actually coming out, stop listening
  el.addEventListener("playing", onPlaying, { once: true }); // first successful start
}

// Load the upcoming track only after the current one has started, so the first file stays light.
function preloadNext(state: MusicState) {
  if (state.list.length < 2) return; // a single looping track has no neighbour
  const nextIndex = (state.index + 1) % state.list.length; // wrap to the start after the last track
  const track = state.list[nextIndex]; // the file we will need next
  if (state.next && state.nextIndex === nextIndex) return; // already warming this one
  if (state.next) { // drop a stale preloaded element
    state.next.pause(); // stop it if it had started
    state.next.src = ""; // release the file
  }
  const el = new Audio(track.file); // create only now, after the current track is playing
  el.preload = "auto"; // fetch it in the background
  el.volume = MUSIC_VOLUME; // same quiet level as the current track
  state.next = el; // keep it ready
  state.nextIndex = nextIndex; // remember which list slot this is
  state.startedNext = false; // the preroll has not fired yet
}

// Move to the already-preloaded (or freshly created) next track and wrap the list.
function advance(state: MusicState) {
  const nextIndex = (state.index + 1) % state.list.length; // wrap after the last track
  const prev = state.current; // the track that just ended
  let nxt = state.next; // may already be playing from the preroll
  if (!nxt || state.nextIndex !== nextIndex) { // preload missed; make the element now
    const track = state.list[nextIndex]; // next file
    nxt = new Audio(track.file); // create it
    nxt.preload = "auto"; // start loading
    nxt.volume = MUSIC_VOLUME; // same level
  }
  unbind(prev); // drop listeners on the old element
  prev.pause(); // make sure it is silent
  prev.src = ""; // release the finished file
  state.current = nxt; // this is now the live player
  state.index = nextIndex; // we are on this list slot
  state.next = null; // will be filled again after play starts
  state.nextIndex = -1; // no preload yet
  state.startedNext = false; // reset the preroll flag
  bindCurrent(state); // listen for end and preroll on the new current
  if (nxt.paused) void nxt.play().catch(() => {}); // start it if the preroll did not
}

// A running playlist: one or more tracks, with a current player and an optional preloaded next.
type MusicState = {
  list: Track[]; // the tracks in play order (all of TRACKS, or a single one)
  index: number; // which list slot is current
  current: HTMLAudioElement; // the player that should be audible
  next: HTMLAudioElement | null; // preloaded neighbour, created after current starts
  nextIndex: number; // list slot of `next`, or -1
  startedNext: boolean; // true once the preroll has started `next`
  gesture: (() => void) | null; // removes the first-click listeners
};

function unbind(el: HTMLAudioElement) {
  el.onended = null; // no more advance from this element
  el.ontimeupdate = null; // no more preroll
}

function bindCurrent(state: MusicState) {
  const el = state.current; // the live player
  el.volume = MUSIC_VOLUME; // keep both tracks at the same quiet level
  el.loop = state.list.length === 1; // a single chosen track loops on itself
  el.preload = "auto"; // the current file should be ready
  el.onended = () => { // natural end (not used when loop is true)
    if (el.loop) return; // the browser restarts a looping element itself
    advance(state); // go to the next track, or wrap
  };
  el.ontimeupdate = () => { // watch the last moments of the current track
    if (state.list.length < 2) return; // nothing to overlap
    if (state.startedNext) return; // already handed off
    if (!state.next) return; // still waiting for preload
    const d = el.duration; // may be NaN until metadata arrives
    if (!Number.isFinite(d) || d <= 0) return; // not ready
    if (d - el.currentTime > NEXT_PREROLL) return; // too early
    state.startedNext = true; // only once
    state.next.volume = MUSIC_VOLUME; // match the current level
    void state.next.play().catch(() => {}); // start a little early so the join stays tight
  };
  const onPlaying = () => { preloadNext(state); }; // fetch the neighbour only after this one is actually playing
  el.addEventListener("playing", onPlaying, { once: true }); // first start of this element
  if (!el.paused) preloadNext(state); // already playing (preroll handoff)
}

// Start a playlist or a single looping track. Does not pause when the tab is hidden.
function startMusic(list: Track[]) {
  if (!list.length) return; // nothing to play
  const current = new Audio(list[0].file); // first track only; later tracks wait until this starts
  current.volume = MUSIC_VOLUME; // quiet study level
  current.preload = "auto"; // load the first file now
  const state: MusicState = {
    list, // the sequence we will walk
    index: 0, // start at the first entry
    current, // live player
    next: null, // not preloaded yet
    nextIndex: -1, // no neighbour yet
    startedNext: false, // preroll has not run
    gesture: null, // filled by playWhenAllowed
  };
  bindCurrent(state); // end, preroll, and preload hooks
  playWhenAllowed(current, state); // play now, or on the first click/tap/key
  active = {
    ctx: null, // music uses HTML audio, not Web Audio
    master: null, // volume is set on the element
    cleanup: () => { // release everything
      if (state.gesture) state.gesture(); // drop first-click listeners
      unbind(state.current); // drop end/preroll hooks
      state.current.pause(); // silence
      state.current.src = ""; // release the file
      if (state.next) { // drop a preloaded neighbour
        state.next.pause(); // silence
        state.next.src = ""; // release
      }
    },
  };
}

export function startAmbient(kind: AmbientKind) {
  if (kind === activeKind && active) return; // already on this choice; do not restart mid-track
  stopAmbient(); // one bed at a time
  if (kind === "off") { // user asked for silence
    activeKind = "off"; // remember, so a later "off" is a no-op too
    return;
  }

  const list = musicListFor(kind); // playlist or one track, or null
  if (list) { // this is music
    activeKind = kind; // remember the choice before play starts (even if autoplay is blocked)
    startMusic(list); // All tracks, or a single looping track
    return;
  }

  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  void ctx.resume();
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.connect(ctx.destination);
  const stoppers: (() => void)[] = [];
  let target = 0.12;
  activeKind = kind; // noise bed is now the live choice

  if (kind === "rain") {
    const src = noiseSource(ctx, "brown");
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1200;
    src.connect(lp).connect(master); src.start(); stoppers.push(() => src.stop());
  } else if (kind === "waves") {
    const src = noiseSource(ctx, "brown");
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700;
    const swell = ctx.createGain(); swell.gain.value = 0.55;
    const lfo = wobble(ctx, swell.gain, 0.11, 0.45);
    src.connect(lp).connect(swell).connect(master); src.start(); stoppers.push(() => { src.stop(); lfo.stop(); });
    target = 0.2;
  } else if (kind === "wind") {
    const src = noiseSource(ctx, "brown");
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 450; bp.Q.value = 0.8;
    const lfo = wobble(ctx, bp.frequency, 0.07, 220);
    src.connect(bp).connect(master); src.start(); stoppers.push(() => { src.stop(); lfo.stop(); });
    target = 0.3;
  } else if (kind === "fire") {
    const src = noiseSource(ctx, "brown");
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 400;
    const bed = ctx.createGain(); bed.gain.value = 0.5;
    src.connect(lp).connect(bed).connect(master); src.start(); stoppers.push(() => src.stop());
    let alive = true;
    const crackle = () => {
      if (!alive) return;
      const dur = 0.015 + Math.random() * 0.04;
      const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
      const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = ctx.createBufferSource(); s.buffer = b;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1500 + Math.random() * 2000;
      const g = ctx.createGain(); g.gain.value = 0.25 + Math.random() * 0.5;
      s.connect(hp).connect(g).connect(master); s.start();
      setTimeout(crackle, 60 + Math.random() * 520);
    };
    crackle(); stoppers.push(() => { alive = false; });
    target = 0.22;
  } else if (kind === "brown") {
    const src = noiseSource(ctx, "brown");
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500;
    src.connect(lp).connect(master); src.start(); stoppers.push(() => src.stop());
    target = 0.25;
  } else { // white
    const src = noiseSource(ctx, "white");
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5000;
    src.connect(lp).connect(master); src.start(); stoppers.push(() => src.stop());
    target = 0.06;
  }

  master.gain.exponentialRampToValueAtTime(target, ctx.currentTime + 3);
  active = { ctx, master, cleanup: () => stoppers.forEach((f) => { try { f(); } catch {} }) };
}

export const startRain = () => startAmbient("rain");
export const stopRain = stopAmbient;
