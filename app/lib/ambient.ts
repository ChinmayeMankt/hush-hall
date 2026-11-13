// Optional background sounds made with Web Audio (filtered noise, no audio files).
// Off by default; the student picks one in the hall header.

export type AmbientKind = "off" | "rain" | "waves" | "wind" | "fire" | "brown" | "white" | "music";

export const AMBIENT_OPTIONS: { id: AmbientKind; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "rain", label: "Soft rain" },
  { id: "waves", label: "Ocean waves" },
  { id: "wind", label: "Gentle wind" },
  { id: "fire", label: "Crackling fire" },
  { id: "brown", label: "Brown noise (deep)" },
  { id: "white", label: "White noise" },
  { id: "music", label: "Warm Focus" },
];

type Active = { ctx: AudioContext | null; master: GainNode | null; cleanup: () => void };
let active: Active | null = null;

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
  if (!active) return;
  const a = active;
  active = null;

  if (a.cleanup) a.cleanup();
  if (a.ctx && a.master) {
    a.master.gain.cancelScheduledValues(a.ctx.currentTime);
    a.master.gain.setValueAtTime(Math.max(a.master.gain.value, 0.0001), a.ctx.currentTime);
    a.master.gain.exponentialRampToValueAtTime(0.0001, a.ctx.currentTime + 1.2);
    setTimeout(() => { try { a.ctx!.close(); } catch {} }, 1300);
  }
}

export function startAmbient(kind: AmbientKind) {
  stopAmbient();
  if (kind === "off") return;

  if (kind === "music") {
    const audio = new Audio("/warm-focus.mp3");
    audio.loop = true;
    audio.volume = 0.35;
    audio.play().catch(() => {});
    active = {
      ctx: null,
      master: null,
      cleanup: () => { audio.pause(); audio.src = ""; },
    };
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