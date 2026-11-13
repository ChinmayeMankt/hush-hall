// Optional background sounds made with Web Audio (filtered noise, no audio files).
// Off by default; the student picks one in the hall header.

export type AmbientKind = "off" | "rain" | "waves" | "wind" | "fire" | "brown" | "white"; // background choices

export const AMBIENT_OPTIONS: { id: AmbientKind; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "rain", label: "Soft rain" },
  { id: "waves", label: "Ocean waves" },
  { id: "wind", label: "Gentle wind" },
  { id: "fire", label: "Crackling fire" },
  { id: "brown", label: "Brown noise (deep)" },
  { id: "white", label: "White noise" },
];

type Active = { ctx: AudioContext; master: GainNode; cleanup: () => void }; // one running ambience
let active: Active | null = null; // what's playing now

// Looping noise: white = bright hiss, brown = soft low rumble.
function noiseSource(ctx: AudioContext, kind: "white" | "brown") {
  const len = ctx.sampleRate * 2; // 2 seconds, looped
  const buf = ctx.createBuffer(1, len, ctx.sampleRate); // mono buffer
  const data = buf.getChannelData(0); // samples
  let last = 0; // brown-noise integrator
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1; // white sample
    if (kind === "white") data[i] = w * 0.5; // plain white noise
    else { last = (last + 0.02 * w) / 1.02; data[i] = last * 3.5; } // brown noise
  }
  const src = ctx.createBufferSource(); // player
  src.buffer = buf; // our noise
  src.loop = true; // endless
  return src;
}

// Slow wobble on any AudioParam (waves swell, wind drifts).
function wobble(ctx: AudioContext, param: AudioParam, hz: number, depth: number) {
  const lfo = ctx.createOscillator(); // slow oscillator
  const amount = ctx.createGain(); // how far it swings
  lfo.frequency.value = hz; // speed
  amount.gain.value = depth; // size
  lfo.connect(amount).connect(param); // wobble the param
  lfo.start(); // run
  return lfo;
}

// Stop whatever is playing, with a short fade-out.
export function stopAmbient() {
  if (!active) return; // nothing playing
  const a = active; // keep reference for the timeout
  active = null; // reset first so a new sound can start right away
  a.master.gain.cancelScheduledValues(a.ctx.currentTime); // drop pending ramps
  a.master.gain.setValueAtTime(Math.max(a.master.gain.value, 0.0001), a.ctx.currentTime); // start from here
  a.master.gain.exponentialRampToValueAtTime(0.0001, a.ctx.currentTime + 1.2); // fade out
  setTimeout(() => { a.cleanup(); void a.ctx.close(); }, 1300); // release audio after the fade
}

// Start a background sound (replaces any current one). Call from a click/tap so the browser allows it.
export function startAmbient(kind: AmbientKind) {
  stopAmbient(); // one at a time
  if (kind === "off") return; // silent
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; // Safari fallback
  if (!AC) return; // unsupported
  const ctx = new AC(); // audio engine
  void ctx.resume(); // make sure it's running
  const master = ctx.createGain(); // overall volume
  master.gain.setValueAtTime(0.0001, ctx.currentTime); // start silent
  master.connect(ctx.destination); // to speakers
  const stoppers: (() => void)[] = []; // things to stop on cleanup
  let target = 0.12; // loudness once faded in

  if (kind === "rain") {
    const src = noiseSource(ctx, "brown"); // soft patter
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1200; // no hiss
    src.connect(lp).connect(master); src.start(); stoppers.push(() => src.stop());
  } else if (kind === "waves") {
    const src = noiseSource(ctx, "brown"); // wash
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700; // deep wash
    const swell = ctx.createGain(); swell.gain.value = 0.55; // base level
    const lfo = wobble(ctx, swell.gain, 0.11, 0.45); // slow in-and-out, about every 9 s
    src.connect(lp).connect(swell).connect(master); src.start(); stoppers.push(() => { src.stop(); lfo.stop(); });
    target = 0.2;
  } else if (kind === "wind") {
    const src = noiseSource(ctx, "brown"); // body of the wind
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 450; bp.Q.value = 0.8; // airy band
    const lfo = wobble(ctx, bp.frequency, 0.07, 220); // pitch drifts up and down
    src.connect(bp).connect(master); src.start(); stoppers.push(() => { src.stop(); lfo.stop(); });
    target = 0.3;
  } else if (kind === "fire") {
    const src = noiseSource(ctx, "brown"); // low roar
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 400; // warm
    const bed = ctx.createGain(); bed.gain.value = 0.5; // quieter than crackles
    src.connect(lp).connect(bed).connect(master); src.start(); stoppers.push(() => src.stop());
    let alive = true; // crackle loop switch
    const crackle = () => {
      if (!alive) return; // stopped
      const dur = 0.015 + Math.random() * 0.04; // short pop
      const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate); // pop buffer
      const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); // fading burst
      const s = ctx.createBufferSource(); s.buffer = b; // player
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1500 + Math.random() * 2000; // snap
      const g = ctx.createGain(); g.gain.value = 0.25 + Math.random() * 0.5; // varied loudness
      s.connect(hp).connect(g).connect(master); s.start(); // pop
      setTimeout(crackle, 60 + Math.random() * 520); // next pop at a random time
    };
    crackle(); stoppers.push(() => { alive = false; });
    target = 0.22;
  } else if (kind === "brown") {
    const src = noiseSource(ctx, "brown"); // deep, steady
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500; // very soft
    src.connect(lp).connect(master); src.start(); stoppers.push(() => src.stop());
    target = 0.25;
  } else { // white
    const src = noiseSource(ctx, "white"); // steady hiss
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5000; // take the harsh edge off
    src.connect(lp).connect(master); src.start(); stoppers.push(() => src.stop());
    target = 0.06;
  }

  master.gain.exponentialRampToValueAtTime(target, ctx.currentTime + 3); // 3 s fade-in
  active = { ctx, master, cleanup: () => stoppers.forEach((f) => { try { f(); } catch { /* already stopped */ } }) };
}

// Old name kept so nothing else breaks.
export const startRain = () => startAmbient("rain");
export const stopRain = stopAmbient;
