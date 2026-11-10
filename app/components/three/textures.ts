// Procedural canvas textures: no image files, no downloads, nothing to license.
// Each function draws once into a small canvas and returns a three.js texture.

import * as THREE from "three"; // texture classes

// Make a canvas of the given size and hand back its 2D context.
function canvas(w: number, h: number) {
  const c = document.createElement("canvas"); // offscreen canvas
  c.width = w; // pixel width
  c.height = h; // pixel height
  return { c, g: c.getContext("2d")! }; // canvas + context
}

// Seeded random so textures look the same on every load.
function rng(seed: number) {
  let s = seed >>> 0; // 32-bit state
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); // LCG in [0,1)
}

// Warm wooden floor planks.
export function plankTexture() {
  const { c, g } = canvas(512, 512); // texture canvas
  const r = rng(7); // fixed seed
  const plankH = 64; // plank width in pixels
  for (let y = 0; y < 512; y += plankH) {
    const shade = 0.82 + r() * 0.22; // per-plank brightness variation
    g.fillStyle = `rgb(${Math.round(120 * shade)},${Math.round(78 * shade)},${Math.round(48 * shade)})`; // warm brown
    g.fillRect(0, y, 512, plankH); // plank body
    for (let k = 0; k < 14; k++) {
      g.strokeStyle = `rgba(60,35,20,${0.08 + r() * 0.1})`; // grain line
      g.beginPath(); // start line
      const gy = y + r() * plankH; // grain height
      g.moveTo(0, gy); // left
      g.bezierCurveTo(170, gy + r() * 6 - 3, 340, gy + r() * 6 - 3, 512, gy); // gentle wave
      g.stroke(); // draw
    }
    g.fillStyle = "rgba(40,22,12,0.55)"; // seam between planks
    g.fillRect(0, y, 512, 2); // seam
    const cut = r() * 512; // butt joint position
    g.fillRect(cut, y, 2, plankH); // joint
  }
  const t = new THREE.CanvasTexture(c); // to texture
  t.wrapS = t.wrapT = THREE.RepeatWrapping; // tile it
  t.repeat.set(5, 4); // planks across the hall
  t.colorSpace = THREE.SRGBColorSpace; // correct colours
  t.anisotropy = 4; // sharper at glancing angles
  return t; // done
}

// Deep green rug with a soft gold border.
export function rugTexture() {
  const { c, g } = canvas(256, 256); // texture canvas
  g.fillStyle = "#2f4a3a"; // bottle green
  g.fillRect(0, 0, 256, 256); // base
  g.strokeStyle = "#7d6840"; // muted old-gold border
  g.lineWidth = 4; // border width
  g.strokeRect(14, 14, 228, 228); // outer border
  g.lineWidth = 2; // inner line
  g.strokeRect(26, 26, 204, 204); // inner border
  g.fillStyle = "rgba(184,149,90,0.18)"; // faint pattern
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    g.beginPath(); // diamond motif
    g.arc(48 + i * 32, 48 + j * 32, 5, 0, Math.PI * 2); // small dot
    g.fill(); // draw
  }
  const t = new THREE.CanvasTexture(c); // to texture
  t.colorSpace = THREE.SRGBColorSpace; // correct colours
  return t; // done
}

// Brass number plaque, e.g. "B4".
export function plaqueTexture(label: string) {
  const { c, g } = canvas(128, 64); // small canvas
  const grad = g.createLinearGradient(0, 0, 0, 64); // brass sheen
  grad.addColorStop(0, "#e9c77b"); // light brass
  grad.addColorStop(1, "#a9803c"); // darker brass
  g.fillStyle = grad; // fill
  g.fillRect(0, 0, 128, 64); // plate
  g.strokeStyle = "#6e4f22"; // engraved edge
  g.lineWidth = 4; // edge width
  g.strokeRect(4, 4, 120, 56); // edge
  g.fillStyle = "#3b2a12"; // engraved text
  g.font = "bold 36px Georgia, serif"; // bookish numerals
  g.textAlign = "center"; // centre text
  g.textBaseline = "middle"; // vertical centre
  g.fillText(label, 64, 35); // label
  const t = new THREE.CanvasTexture(c); // to texture
  t.colorSpace = THREE.SRGBColorSpace; // correct colours
  return t; // done
}

// Soft radial glow for fake lamp light pools (cheaper than real lights).
export function glowTexture() {
  const { c, g } = canvas(128, 128); // small canvas
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64); // centre to edge
  grad.addColorStop(0, "rgba(255,214,140,0.9)"); // warm centre
  grad.addColorStop(0.4, "rgba(255,190,110,0.35)"); // falloff
  grad.addColorStop(1, "rgba(255,170,90,0)"); // fade to nothing
  g.fillStyle = grad; // fill
  g.fillRect(0, 0, 128, 128); // draw
  const t = new THREE.CanvasTexture(c); // to texture
  t.colorSpace = THREE.SRGBColorSpace; // correct colours
  return t; // done
}

// Dark soft blob used as a fake contact shadow under desks and avatars.
export function shadowTexture() {
  const { c, g } = canvas(64, 64); // tiny canvas
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32); // centre to edge
  grad.addColorStop(0, "rgba(20,10,5,0.55)"); // dark centre
  grad.addColorStop(1, "rgba(20,10,5,0)"); // fade out
  g.fillStyle = grad; // fill
  g.fillRect(0, 0, 64, 64); // draw
  return new THREE.CanvasTexture(c); // to texture (alpha only, no colour space needed)
}

// Night window glass with rain streaks and droplets (scrolled when rain is on).
export function rainGlassTexture() {
  const { c, g } = canvas(128, 256); // tall canvas
  const grad = g.createLinearGradient(0, 0, 0, 256); // night sky
  grad.addColorStop(0, "#1b2a44"); // deep blue top
  grad.addColorStop(1, "#2c3f5c"); // lighter near the horizon
  g.fillStyle = grad; // fill
  g.fillRect(0, 0, 128, 256); // sky
  const r = rng(3); // fixed seed
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(255,220,160,${0.15 + r() * 0.35})`; // far warm city lights
    g.beginPath(); // dot
    g.arc(r() * 128, 150 + r() * 100, 1 + r() * 1.5, 0, Math.PI * 2); // small light
    g.fill(); // draw
  }
  for (let i = 0; i < 60; i++) {
    const x = r() * 128; // streak x
    const y = r() * 256; // streak y
    g.strokeStyle = `rgba(200,220,255,${0.12 + r() * 0.2})`; // pale rain streak
    g.lineWidth = 1; // thin
    g.beginPath(); // line
    g.moveTo(x, y); // top
    g.lineTo(x + r() * 2 - 1, y + 8 + r() * 18); // down
    g.stroke(); // draw
  }
  const t = new THREE.CanvasTexture(c); // to texture
  t.wrapS = t.wrapT = THREE.RepeatWrapping; // allow scrolling
  t.colorSpace = THREE.SRGBColorSpace; // correct colours
  return t; // done
}

// ---------- Anime-style faces ----------
// A face is painted onto the head sphere's own texture (equirectangular UVs).
// For three.js SphereGeometry, u = 0.25 faces +z, so the face is centred at x = W/4.
// Textures are cached per (skin, mood, brow, eye) combination and shared by avatars.

export type FaceMood = "open" | "down" | "happy"; // idle, heads-down focus, smiling stretch

const faceCache = new Map<string, THREE.CanvasTexture>(); // shared face textures

export function faceTexture(skin: string, mood: FaceMood, brow: string, eye: string) {
  const key = `${skin}|${mood}|${brow}|${eye}`; // cache key
  const hit = faceCache.get(key); // cached?
  if (hit) return hit; // reuse
  const W = 512, H = 256; // equirect canvas: 1 px = same arc both ways
  const { c, g } = canvas(W, H); // drawing surface
  const cx = W / 4; // face centre (u = 0.25 → +z)
  g.fillStyle = skin; // base skin
  g.fillRect(0, 0, W, H); // whole head

  // Soft blush on the cheeks.
  for (const s of [-1, 1]) {
    const bx = cx + s * 36, by = 174; // cheek position
    const grad = g.createRadialGradient(bx, by, 0, bx, by, 13); // soft spot
    grad.addColorStop(0, "rgba(255,120,130,0.45)"); // pink centre
    grad.addColorStop(1, "rgba(255,120,130,0)"); // fade
    g.fillStyle = grad; // fill
    g.beginPath(); g.ellipse(bx, by, 15, 8, 0, 0, Math.PI * 2); g.fill(); // blush ellipse
  }

  // Eyebrows: short soft arcs in the hair colour.
  g.strokeStyle = brow; // hair-coloured brows
  g.lineCap = "round"; // soft ends
  g.lineWidth = 3.2; // brow thickness
  for (const s of [-1, 1]) {
    g.beginPath(); // one brow
    const bx = cx + s * 30; // brow centre
    const lift = mood === "happy" ? -3 : mood === "down" ? 1 : 0; // raised when happy, relaxed when focused
    g.moveTo(bx - 11, 129 + lift + (s > 0 ? 1 : 3)); // inner/outer end
    g.quadraticCurveTo(bx, 122 + lift, bx + 11, 129 + lift + (s > 0 ? 3 : 1)); // gentle arch
    g.stroke(); // draw
  }

  // Eyes.
  for (const s of [-1, 1]) {
    const ex = cx + s * 30, ey = 152; // eye centre
    if (mood === "happy") {
      g.strokeStyle = "#2a1a12"; g.lineWidth = 3.5; // closed smiling eye
      g.beginPath(); g.moveTo(ex - 13, ey + 4); g.quadraticCurveTo(ex, ey - 10, ex + 13, ey + 4); g.stroke(); // ^ shape
      continue; // next eye
    }
    g.save(); // clip to the eye shape
    g.beginPath(); g.ellipse(ex, ey, 13.5, mood === "down" ? 10 : 16.5, 0, 0, Math.PI * 2); g.clip(); // eye opening
    g.fillStyle = "#fffaf3"; g.fillRect(ex - 15, ey - 18, 30, 36); // white
    const iy = mood === "down" ? ey + 4 : ey + 1; // iris looks down when focusing
    const ig = g.createLinearGradient(0, iy - 10, 0, iy + 10); // iris gradient
    ig.addColorStop(0, "#1a0f0a"); ig.addColorStop(1, eye); // dark top, warm bottom (anime style)
    g.fillStyle = ig; g.beginPath(); g.ellipse(ex, iy, 10.5, 13.5, 0, 0, Math.PI * 2); g.fill(); // iris
    g.fillStyle = "#120a06"; g.beginPath(); g.ellipse(ex, iy, 4.4, 5.6, 0, 0, Math.PI * 2); g.fill(); // pupil
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(ex - 4, iy - 5, 3.4, 0, Math.PI * 2); g.fill(); // big highlight
    g.beginPath(); g.arc(ex + 4, iy + 5, 1.6, 0, Math.PI * 2); g.fill(); // small highlight
    if (mood === "down") { g.fillStyle = skin; g.fillRect(ex - 15, ey - 18, 30, 12); } // lowered lid
    g.restore(); // end clip
    g.strokeStyle = "#1e120c"; g.lineWidth = 3.4; // upper lash line
    g.beginPath(); // lash arc
    const top = mood === "down" ? ey - 5 : ey - 13; // lid height
    g.moveTo(ex - 13, ey - (mood === "down" ? 1 : 4)); g.quadraticCurveTo(ex, top - 3, ex + 13, ey - (mood === "down" ? 1 : 4)); g.stroke(); // lash
    g.lineWidth = 2.2; g.beginPath(); g.moveTo(ex + s * 12, ey - 4); g.lineTo(ex + s * 17, ey - 8); g.stroke(); // little outer flick
  }

  // Nose: a tiny soft shadow tick.
  g.strokeStyle = "rgba(120,60,40,0.45)"; g.lineWidth = 2; // soft nose line
  g.beginPath(); g.moveTo(cx + 1, 168); g.quadraticCurveTo(cx + 3, 173, cx - 1, 174); g.stroke(); // tick

  // Mouth: small calm line, a small smile, or a happy open smile.
  g.strokeStyle = "#8a3a34"; g.lineWidth = 2.4; // lip colour
  if (mood === "happy") {
    g.fillStyle = "#9a3e3a"; g.beginPath(); g.moveTo(cx - 8, 184); g.quadraticCurveTo(cx, 196, cx + 8, 184); g.closePath(); g.fill(); // open smile
    g.fillStyle = "#f08a8a"; g.beginPath(); g.ellipse(cx, 190, 3.5, 2, 0, 0, Math.PI * 2); g.fill(); // tongue hint
  } else {
    g.beginPath(); g.moveTo(cx - 6, 185); g.quadraticCurveTo(cx, mood === "down" ? 186 : 189, cx + 6, 185); g.stroke(); // calm or soft smile
  }

  const t = new THREE.CanvasTexture(c); // to texture
  t.colorSpace = THREE.SRGBColorSpace; // correct colours
  t.anisotropy = 4; // crisper when viewed at an angle
  faceCache.set(key, t); // cache
  return t; // done
}
