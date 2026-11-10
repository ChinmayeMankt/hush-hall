// A very soft two-note chime made with the Web Audio API (no audio files).
// Only plays if the student turned chimes on; silent by default.

export function softChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; // browser audio context
    const ctx = new Ctx(); // new context per chime (simple and short-lived)
    [523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator(); // tone generator
      const gain = ctx.createGain(); // volume control
      osc.type = "sine"; // softest waveform
      osc.frequency.value = freq; // C5 then E5
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.35); // start silent
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + i * 0.35 + 0.05); // gentle fade in
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.35 + 1.2); // long fade out
      osc.connect(gain).connect(ctx.destination); // wire to speakers
      osc.start(ctx.currentTime + i * 0.35); // stagger the two notes
      osc.stop(ctx.currentTime + i * 0.35 + 1.3); // stop after fade
    });
  } catch {
    // audio blocked or unsupported; staying silent is fine
  }
}
