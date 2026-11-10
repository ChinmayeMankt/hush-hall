// Optional soft rain ambience made with Web Audio (filtered noise, no audio files).
// Off by default; the student turns it on in the hall header.

let ctx: AudioContext | null = null; // shared audio context
let gain: GainNode | null = null; // master volume for the rain

// Start the rain sound with a slow fade-in.
export function startRain() {
  if (ctx) return; // already playing
  ctx = new AudioContext(); // audio engine
  const len = ctx.sampleRate * 2; // 2 seconds of noise, looped
  const buf = ctx.createBuffer(1, len, ctx.sampleRate); // mono buffer
  const data = buf.getChannelData(0); // samples
  let last = 0; // brown-noise integrator
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; // brown noise = soft, low rumble
    data[i] = last * 3.5; // normalise loudness
  }
  const src = ctx.createBufferSource(); // player
  src.buffer = buf; // our noise
  src.loop = true; // endless
  const lp = ctx.createBiquadFilter(); // soften highs
  lp.type = "lowpass"; // low-pass filter
  lp.frequency.value = 1200; // gentle patter, no hiss
  gain = ctx.createGain(); // volume
  gain.gain.setValueAtTime(0.0001, ctx.currentTime); // start silent
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 3); // 3 s fade-in
  src.connect(lp).connect(gain).connect(ctx.destination); // wire up
  src.start(); // play
}

// Fade out and stop.
export function stopRain() {
  if (!ctx || !gain) return; // nothing playing
  const c = ctx; // keep reference for the timeout
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.5); // 1.5 s fade-out
  setTimeout(() => c.close(), 1600); // release audio after the fade
  ctx = null; // reset
  gain = null; // reset
}
