// Bare-foot shape for the "Shoes and socks off" wardrobe choice.
//
// VRoid builds every body foot to sit inside a shoe: a smooth block with a
// slightly pointed front and the toes only painted on. With the shoes hidden
// that reads as a sock or a doll's foot, especially from the side. This
// module makes a barefoot copy of the body skin geometry, used only by
// barefoot clones (shoes-on characters keep the original geometry, untouched):
//
//  - forefoot: the front of the shoe block is pulled back to the ball of the
//    foot and widened to the ball's width, so the foot is no longer pointed;
//  - toes: five small rounded toes per foot are added in front of it, as real
//    geometry, so they read individually in silhouette from the side and the
//    three-quarter view. The big toe points straight along the foot with a
//    small gap to the second toe; the others are graded shorter (the tips
//    follow the natural oblique line), curl very slightly (knuckle up, pad on
//    the floor) and turn a touch toward the big toe, like a relaxed real foot;
//  - arch: the inner (medial) edge of the sole is lifted a few millimetres
//    under the midfoot, so the inner side shows a soft arch instead of a flat slab.
//
// Everything is done once per character at load time, in the skeleton's bind
// space, and the toes are skinned 100% to the toe bone (the old toe block was
// skinned to the same foot and toe bones), so the shape follows the foot in
// every pose: standing, walking, seated and kneeling. The toes are merged into
// the body mesh, so barefoot characters cost no extra draw call; together the
// ten toes add 1,560 vertices and 2,640 triangles per barefoot character
// (the barefoot body copy is shared by every barefoot clone of that character).
//
// The toes use the body skin material, with UVs on a small "toe swatch" that
// scripts/paint_bare_toes.py paints into an unused corner of each character's
// bare-body texture (public/looks/*.body-bare.webp): the character's own foot
// skin, a rosy pad underneath and at the tip, and a small pale nail on top.

import * as THREE from "three"; // math + geometry
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"; // body + toes in one buffer

// The toe swatch in the 1024 px bare-body texture, in texels (x right, y down,
// glTF UV origin top-left). Columns run once round a toe (bottom -> inner side ->
// top -> outer side -> bottom), rows run from the toe tip (TIP_ROW) back along the
// toe for SWATCH_WIDTHS toe widths (ROOT_ROW, and anything further back).
// scripts/paint_bare_toes.py paints exactly this layout; keep the two in step.
export const TOE_SWATCH = { left: 246, right: 302, tipRow: 699, rootRow: 733, size: 1024 } as const; // texels
export const SWATCH_WIDTHS = 2.6; // how many toe widths back from the tip the swatch covers
export const SWATCH_POW = 0.7; // row = (distance from tip / SWATCH_WIDTHS) ^ SWATCH_POW

// One generated toe, in bind space.
interface Toe { base: THREE.Vector3; dir: THREE.Vector3; side: THREE.Vector3; len: number; buried: number; w: number; h: number; curl: number; s: number; nail: number }

// One foot of the rig: skeleton bone indices.
export interface FootBones { foot: number; toes: number }

const RING = 12; // vertices round each toe (plus one seam copy)
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }; // smoothstep

// Toe layout, as fractions of the ball width (big toe first, medial -> lateral).
const TOE_W = [0.28, 0.19, 0.18, 0.17, 0.16]; // widths
const TOE_GAP = [0.014, -0.004, -0.004, -0.004]; // gaps after each toe (a small one after the big toe)
const TOE_LEN = [1, 0.92, 0.82, 0.72, 0.62]; // length from the root line, relative to the big toe
const TOE_TURN = [0, -0.035, 0.0, 0.04, 0.09]; // turn toward the big toe (radians; the second toe turns a touch away, so the small gap after the big toe opens toward the tips)
const TOE_CURL = [0.04, 0.3, 0.32, 0.3, 0.26]; // knuckle lift, fraction of the toe's thickness
const INSTEP_SMOOTH = 0.06; // how far (fraction of the foot length) the top line is smoothed along the foot
const INSTEP_DOME = 0.012; // extra convex fullness over the midfoot (fraction of the foot length)
const INSTEP_SIDE = 0.3; // widest point of the sides, as a fraction of the top height
const INSTEP_ARCH = 1.8; // arch across the top: 1 = gable (VRoid's ridge), 2 = half ellipse
const INSTEP_FLOOR = 0.88; // width where the sides meet the floor, as a fraction of the widest point
const INSTEP_LEVELS = 2; // subdivisions of the top of the foot
const TOE_FLAT = [0.8, 0.74, 0.73, 0.72, 0.72]; // thickness / width (the big toe the fullest)

// Make the barefoot copy of one body-skin mesh's geometry, or null if the mesh has no feet.
export function bareFeetGeometry(mesh: THREE.SkinnedMesh, feet: FootBones[]): THREE.BufferGeometry | null {
  const g0 = mesh.geometry; // shared body geometry (left untouched)
  if (!g0.attributes.position || !g0.attributes.skinIndex || !g0.attributes.skinWeight || !g0.attributes.uv || !g0.attributes.normal) return null; // not a VRoid body mesh
  const n0 = g0.attributes.position.count; // original vertices (their indices stay the same below; new ones come after)
  const g = subdivideInsteps(mesh, feet) ?? g0; // finer mesh over the top of each foot, so the soft instep below is a real curve, not facets
  const pos = g.attributes.position as THREE.BufferAttribute; // mesh-local rest positions
  const si = g.attributes.skinIndex as THREE.BufferAttribute, sw = g.attributes.skinWeight as THREE.BufferAttribute; // skinning
  const n = pos.count; // vertices
  const P = new Float32Array(n * 3), v = new THREE.Vector3(); // bind-space positions
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
  const joint = (b: number) => new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[b].clone().invert()); // bone origin in bind space
  const P0 = P.slice(); // rest positions before reshaping (to weld seams when re-shading)
  const reshade = new Float32Array(n); // 0..1: how much of each vertex's normal is recomputed from the new shape
  const fixedN = new Map<number, THREE.Vector3>(); // vertex -> set normal (bind space)
  const toes: THREE.BufferGeometry[] = []; // generated toe geometry, per foot
  let touched = false; // any foot found
  for (const [k, fb] of feet.entries()) {
    const other = feet[1 - k]; // the other foot (tells which way is the inner side)
    const JT = joint(fb.toes), JF = joint(fb.foot); // toe and ankle joints
    const fwd = JT.clone().sub(JF).setY(0).normalize(); // along the foot, heel -> toes
    const med = new THREE.Vector3(fwd.z, 0, -fwd.x); // across the foot
    if (other && med.dot(joint(other.toes).sub(JT)) < 0) med.negate(); // point toward the other foot (inner, big-toe side)
    // Vertices of this foot (mostly skinned to its foot and toe bones).
    const ids: number[] = [], wt: number[] = [];
    for (let i = 0; i < n; i++) {
      let w = 0; // weight on this foot
      for (let c = 0; c < 4; c++) { const b = si.getComponent(i, c); if (b === fb.foot || b === fb.toes) w += sw.getComponent(i, c); }
      if (w >= 0.5) { ids.push(i); wt.push(w); }
    }
    if (ids.filter((i) => i < n0).length < 30) continue; // no foot on this mesh
    touched = true;
    const U = (i: number) => (P[i * 3] - JT.x) * fwd.x + (P[i * 3 + 2] - JT.z) * fwd.z; // along the foot from the toe joint (m)
    const S = (i: number) => (P[i * 3] - JT.x) * med.x + (P[i * 3 + 2] - JT.z) * med.z; // across, + = inner side
    let soleY = Infinity, uTip = -Infinity, uHeel = Infinity; // foot extents
    for (const i of ids) { if (i >= n0) continue; soleY = Math.min(soleY, P[i * 3 + 1]); uTip = Math.max(uTip, U(i)); uHeel = Math.min(uHeel, U(i)); }
    const L = uTip - uHeel; // foot length
    // Ball of the foot: widest part just behind the toe joint, and its thickness.
    let sMed = -Infinity, sLat = Infinity, hTop = 0;
    for (const i of ids) { if (i >= n0) continue; const u = U(i); if (u > -0.07 * L && u < 0.02 * L) { sMed = Math.max(sMed, S(i)); sLat = Math.min(sLat, S(i)); hTop = Math.max(hTop, P[i * 3 + 1] - soleY); } }
    const Wb = sMed - sLat; // ball width
    if (!(Wb > 0.02) || !(L > 0.08)) continue; // implausible: leave this foot alone
    // Where the toes start: an oblique line, furthest forward under the big toe.
    const uR0 = uTip - 0.135 * L; // toe root at the big toe (toes about a fifth of the foot, as on a real foot)
    const lat = (s: number) => Math.min(1, Math.max(0, (sMed - s) / Wb)); // 0 inner edge .. 1 outer edge
    const uRoot = (s: number) => uR0 - 0.075 * L * Math.pow(lat(s), 1.3); // root line, sweeping back toward the little toe
    // Local width of the block along the foot (for widening the old pointed front).
    const BIN = 0.02 * L, bins = new Map<number, [number, number, number]>(); // u bin -> [min s, max s, max height]
    for (const i of ids) { if (i >= n0) continue; const b = Math.round(U(i) / BIN), r = bins.get(b) ?? [Infinity, -Infinity, 0]; r[0] = Math.min(r[0], S(i)); r[1] = Math.max(r[1], S(i)); r[2] = Math.max(r[2], P[i * 3 + 1] - soleY); bins.set(b, r); }
    const width = (u: number): [number, number, number] => { // local [min s, max s, top] at u, interpolated between bins (smooth, no jags)
      const f = u / BIN, b0 = Math.floor(f), t = f - b0, A = bins.get(b0), B = bins.get(b0 + 1);
      if (!A || !B) return (A ?? B ?? [sLat, sMed, hTop]) as [number, number, number];
      return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    };
    let uBall = 0, wMax = 0; // the widest point of the forefoot: widening starts there
    for (const [b, r] of bins) if (b * BIN > -0.12 * L && b * BIN < uR0 && r[1] - r[0] > wMax) { wMax = r[1] - r[0]; uBall = b * BIN; }
    // 3) Toes (laid out first: the forefoot is shaped to meet them).
    const tw = TOE_W.map((f) => f * Wb); // widths
    const span = tw.reduce((a, b) => a + b, 0) + TOE_GAP.reduce((a, b) => a + b, 0) * Wb; // all five side by side
    let edge = sMed - 0.5 * (Wb - span); // inner edge of the big toe (row centred on the ball)
    const bigRoot = uRoot(edge - tw[0] / 2), bigLen = uTip - 0.006 * L - bigRoot; // big toe: ends where the old foot ended
    const parts: Toe[] = [];
    const buried = 0.045 * L; // each toe starts inside the ball, so the joint never opens
    for (let t = 0; t < 5; t++) {
      const sc = edge - tw[t] / 2; // toe centre, across
      edge -= tw[t] + (TOE_GAP[t] ?? 0) * Wb; // next toe's inner edge
      const root = uRoot(sc), len = bigLen * TOE_LEN[t]; // where it starts, how far it reaches
      const dir = fwd.clone().multiplyScalar(Math.cos(TOE_TURN[t])).addScaledVector(med, Math.sin(TOE_TURN[t])); // a touch toward the big toe
      const base = JT.clone().addScaledVector(fwd, root).addScaledVector(med, sc).setY(soleY).addScaledVector(dir, -buried); // floor point under the toe's start
      const h = Math.min(tw[t] * TOE_FLAT[t], 0.95 * hTop); // thickness
      parts.push({ base, dir, side: new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(med.dot(new THREE.Vector3(fwd.z, 0, -fwd.x)) > 0 ? 1 : -1), len: len + buried, buried, w: tw[t], h, curl: TOE_CURL[t], s: sc, nail: t ? 1.3 : 1 });
    }
    // Height the forefoot comes down to at the toe roots, across the foot: just under each toe's top.
    const rootTop = (s: number) => { let best = parts[0], d = Infinity; for (const t of parts) if (Math.abs(t.s - s) < d) { d = Math.abs(t.s - s); best = t; } return 0.8 * best.h; }; // inside the toe: only the web shows between toes
    // 4) Reshape the body's own foot.
    for (const [j, i] of ids.entries()) {
      const u = U(i), s = S(i), w = wt[j]; // this vertex
      let du = 0, ds = 0, dy = 0; // offsets
      const h0 = P[i * 3 + 1] - soleY; // height above the sole
      // Forefoot: the old toe block is folded back into a short wall just past the
      // toe roots (inside the toes; it shows only as the web between them), the
      // front is as wide as the ball (no pointed tip), and the top slopes down from
      // the ball to the toes.
      const uA = uR0 - 0.035 * L * Math.pow(lat(s), 1.3) + 0.008 * L; // the web line (less oblique than the toe roots, so the fold stays smooth; still inside every toe)
      const folded = u > uA; // part of the old toe block
      if (folded) du = uA + (u - uA) * 0.06 - u; // folded back
      if (u > uBall) {
        const c = smooth(uBall, Math.max(uA, uBall + 0.01), u); // fades in from the ball
        const [lo, hi, top] = width(u); // local width and height there
        const t = hi - lo > 1e-4 ? Math.min(1, Math.max(0, (s - lo) / (hi - lo))) : 0.5; // 0 outer .. 1 inner
        ds = c * (sLat + t * Wb * 0.96 + 0.02 * Wb - s); // spread to the ball's width (a hair inside it)
        if (folded) ds = sLat + (0.08 + t * 0.84) * Wb - s; // the web: well inside the outer toes' rounded sides
        const sNew = s + ds; // where it ends up across
        const k = smooth(uBall, uA, Math.min(u, uA)); // 0 at the ball .. 1 at the web
        const f = 1 + k * (Math.min(1, rootTop(sNew) / Math.max(top, 1e-3)) - 1); // height scale: the toes' height at the web
        dy += h0 * (f - 1); // lower the top (the sole stays on the floor)
        if (folded) dy = Math.min(Math.max(h0 + dy, 0.42 * rootTop(sNew)), rootTop(sNew)) - h0; // never above the toes, nor out under their rounded undersides
      }
      // Arch: lift the inner edge of the sole under the midfoot.
      const mid = Math.exp(-(((u - (uHeel + 0.47 * L)) / (0.17 * L)) ** 2)); // midfoot bell
      const arch = mid * smooth(0.0, 0.9, (s - (sLat + 0.5 * Wb)) / (0.5 * Wb)); // inner side of the midfoot
      dy += 0.05 * Wb * arch * (1 - smooth(0.12 * hTop, 0.5 * hTop, h0)); // inner, low vertices only
      reshade[i] = w * Math.max(smooth(uBall - 0.08 * L, uBall, u), smooth(0.05, 0.4, arch)); // re-shade what moved
      if (folded) { const under = (g.attributes.normal as THREE.BufferAttribute).getY(i) < 0; fixedN.set(i, new THREE.Vector3(0, under ? -1 : 1, 0).addScaledVector(fwd, 0.5).normalize()); } // the web: a calm, even normal (the folded triangles are too crumpled to shade from), facing down on the sole side
      P[i * 3] += w * (fwd.x * du + med.x * ds); P[i * 3 + 2] += w * (fwd.z * du + med.z * ds); P[i * 3 + 1] += w * dy; // apply (blended by the skin weight)
    }
    // 5) Soft instep: VRoid's shoe-shaped block is a faceted gable on top (a
    // ridge down the middle, hard edges to the sides), with a steep front of the
    // ankle and a flat plateau over the midfoot in side view. The top surface is
    // laid onto a smooth shape instead: along the foot one gentle convex line
    // from the ankle to the toes, across it a soft arch from the widest point of
    // each side over the top (a touch higher on the big-toe side, as on a real
    // foot). Only the foot moves: it fades out below the ankle joint and before
    // the toe web, and the sole and the lower sides stay where they are.
    {
      const JFu = (JF.x - JT.x) * fwd.x + (JF.z - JT.z) * fwd.z, hJ = JF.y - soleY; // ankle joint along the foot, and its height
      const G = 0.01 * L, NG = Math.ceil((uTip - uHeel) / G) + 1; // sampling grid along the foot
      const lo = new Float64Array(NG).fill(NaN), hi = new Float64Array(NG).fill(NaN), top = new Float64Array(NG).fill(NaN); // raw envelopes
      for (let j = 0; j < NG; j++) {
        const uj = uHeel + j * G; let a = Infinity, b = -Infinity;
        for (const i of ids) if (i < n0 && Math.abs(U(i) - uj) < 0.035 * L) { a = Math.min(a, S(i)); b = Math.max(b, S(i)); }
        if (b <= a) continue;
        lo[j] = a; hi[j] = b; let t = -Infinity; const c = 0.5 * (a + b), hw = 0.5 * (b - a);
        for (const i of ids) if (i < n0 && Math.abs(U(i) - uj) < 0.035 * L && Math.abs(S(i) - c) < 0.4 * hw) t = Math.max(t, P[i * 3 + 1] - soleY); // the top, near the middle
        if (t > -Infinity) top[j] = t; else continue;
        let a2 = Infinity, b2 = -Infinity; // the side walls at mid height (VRoid's sole sticks out below them, like a shoe's)
        for (const i of ids) { if (i >= n0 || Math.abs(U(i) - uj) > 0.035 * L) continue; const hh = P[i * 3 + 1] - soleY; if (hh > 0.22 * t && hh < 0.6 * t) { a2 = Math.min(a2, S(i)); b2 = Math.max(b2, S(i)); } }
        if (b2 - a2 > 0.5 * (b - a)) { lo[j] = a2; hi[j] = b2; }
      }
      const blur = (src: Float64Array, sg: number) => { const o = new Float64Array(NG); for (let j = 0; j < NG; j++) { let sw = 0, sv = 0; for (let k = 0; k < NG; k++) { if (Number.isNaN(src[k])) continue; const ww = Math.exp(-(((k - j) / sg) ** 2) / 2); sw += ww; sv += ww * src[k]; } o[j] = sw ? sv / sw : 0; } return o; }; // gaussian along the foot
      const Ht = blur(top, INSTEP_SMOOTH * L / G), Cl = blur(lo, 3), Ch = blur(hi, 3); // smooth top line, sides
      const at = (arr: Float64Array, u: number) => { const f = Math.min(NG - 1, Math.max(0, (u - uHeel) / G)), j0 = Math.floor(f), j1 = Math.min(NG - 1, j0 + 1), t = f - j0; return arr[j0] + (arr[j1] - arr[j0]) * t; }; // sample
      const uS = JFu + 0.12 * L, uE = uR0 + 0.008 * L; // from the front of the ankle to the toe web
      const nb0 = new THREE.Matrix3().getNormalMatrix(mesh.bindMatrix), nv = new THREE.Vector3(), nrm0 = g.attributes.normal as THREE.BufferAttribute; // original normals, bind space
      for (let i = 0; i < n; i++) {
        let w = 0; for (let c = 0; c < 4; c++) { const b = si.getComponent(i, c); if (b === fb.foot || b === fb.toes) w += sw.getComponent(i, c); }
        if (w < 0.2) continue; // not this foot
        const u = U(i), s = S(i), h = P[i * 3 + 1] - soleY; // where it is now
        const F = smooth(0.2, 0.75, w) * smooth(uS, uS + 0.22 * L, u) * (1 - smooth(uE - 0.12 * L, uE - 0.03 * L, u)) * (1 - smooth(0.8 * hJ, 0.98 * hJ, h)); // strength
        if (F <= 0) continue;
        const t = Math.min(1, Math.max(0, (u - uS) / (uE - uS))); // 0 at the ankle .. 1 at the web
        const H = at(Ht, u) + INSTEP_DOME * L * Math.sin(Math.PI * t) ** 1.5; // the soft convex top line
        const c = 0.5 * (at(Cl, u) + at(Ch, u)), hw = Math.max(0.5 * (at(Ch, u) - at(Cl, u)), 1e-4); // centre and half width of the side walls
        const yb = INSTEP_SIDE * H; // height of the widest point of the sides
        const xr = (s - c) / hw, x = Math.max(-1, Math.min(1, xr)); // across, -1 outer .. +1 inner (the walls)
        const ny = nv.fromBufferAttribute(nrm0, i).applyMatrix3(nb0).normalize().y; // faces up?
        const arch = Math.pow(Math.max(0, 1 - Math.abs(x) ** INSTEP_ARCH), 1 / INSTEP_ARCH) * (1 + 0.06 * x); // soft arch across, a touch higher inside
        const hT = yb + (H - yb) * arch; // the smooth top here
        const k = F * smooth(-0.3, 0.2, ny) * smooth(0.7 * yb, 1.25 * yb, h) * (1 - smooth(0.82, 1.0, Math.abs(x))); // only the top, not the sole or the lower sides
        P[i * 3 + 1] += Math.min((hT - h) * k, 0.025 * L * smooth(uS + 0.06 * L, uS + 0.24 * L, u)); // never pushed up at the ankle (trouser cuffs)
        // Lower sides: curve in to the sole (a real foot is narrower where it meets the floor), no slab edge.
        if (h < yb) { const xm = INSTEP_FLOOR + (1 - INSTEP_FLOOR) * Math.sqrt(Math.max(0, 1 - (1 - h / yb) ** 2)); if (Math.abs(xr) > xm) { const ds = (Math.sign(xr) * xm - xr) * hw * F; P[i * 3] += med.x * ds; P[i * 3 + 2] += med.z * ds; } } // the sole edge tucks under the wall
        reshade[i] = Math.max(reshade[i], F);
      }
    }
    toes.push(toeGeometry(parts, fb.toes, g));
  }
  if (!touched) return null; // nothing to do
  // Normals where the shape changed: smooth normals of the new surface, welded
  // across VRoid's split seams (same rest position = same point), blended into
  // the original normals so shading stays continuous with the rest of the foot.
  const idx = g.index; // triangles
  const key = (i: number) => `${Math.round(P0[i * 3] * 1e5)},${Math.round(P0[i * 3 + 1] * 1e5)},${Math.round(P0[i * 3 + 2] * 1e5)}`; // weld key
  const acc = new Map<string, THREE.Vector3>(); // summed face normals per point
  const ta = new THREE.Vector3(), tb = new THREE.Vector3(), tc = new THREE.Vector3(); // scratch
  const tri = idx ? idx.count / 3 : n / 3; // triangle count
  for (let f = 0; f < tri; f++) {
    const a = idx ? idx.getX(f * 3) : f * 3, b = idx ? idx.getX(f * 3 + 1) : f * 3 + 1, c = idx ? idx.getX(f * 3 + 2) : f * 3 + 2; // corners
    if (!reshade[a] && !reshade[b] && !reshade[c]) continue; // untouched area
    ta.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]); tb.set(P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]); tc.crossVectors(ta, tb); // area-weighted face normal
    for (const k of [a, b, c]) { const kk = key(k); const s0 = acc.get(kk); if (s0) s0.add(tc); else acc.set(kk, tc.clone()); }
  }
  const nb = new THREE.Matrix3().getNormalMatrix(mesh.bindMatrix), ni = new THREE.Matrix3().getNormalMatrix(mesh.bindMatrixInverse); // mesh <-> bind for normals
  const nrm = g.attributes.normal as THREE.BufferAttribute; // original normals
  const newN = new Float32Array(n * 3); // result (bind space -> mesh space below)
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(nrm, i).applyMatrix3(nb).normalize(); // original, bind space
    const m = reshade[i], sN = m ? acc.get(key(i)) : undefined; // recomputed
    if (sN && sN.lengthSq() > 0) v.lerp(ta.copy(sN).normalize(), m).normalize(); // blend
    const fx = fixedN.get(i); if (fx) v.copy(fx); // the folded web
    v.applyMatrix3(ni).normalize(); newN[i * 3] = v.x; newN[i * 3 + 1] = v.y; newN[i * 3 + 2] = v.z;
  }
  const out = g.clone(); // copies every attribute (the shoes-on geometry stays as it was)
  (out.attributes.normal as THREE.BufferAttribute).copyArray(newN); // new shading on the reshaped forefoot and arch
  const op = out.attributes.position as THREE.BufferAttribute; // reshaped positions, back to mesh space
  const inv = mesh.bindMatrixInverse; // bind -> mesh
  for (let i = 0; i < n; i++) { v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(inv); op.setXYZ(i, v.x, v.y, v.z); }
  for (const t of toes) { const p = t.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(inv); p.setXYZ(i, v.x, v.y, v.z); } t.attributes.normal.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(inv)); }
  const merged = mergeGeometries([out, ...toes], false); // one buffer, one draw call
  out.dispose(); toes.forEach((t) => t.dispose()); if (g !== g0) g.dispose(); // temporaries
  return merged;
}

// Build the toes of one foot as a geometry with the same attributes as the body.
function toeGeometry(parts: Toe[], bone: number, like: THREE.BufferGeometry): THREE.BufferGeometry {
  const P: number[] = [], N: number[] = [], UV: number[] = [], I: number[] = []; // buffers
  const up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), q = new THREE.Vector3(), d = new THREE.Vector3(); // scratch
  const sw = TOE_SWATCH, Z = sw.size; // swatch texels
  for (const t of parts) {
    const a0 = t.w / 2, b0 = t.h / 2; // half width, half thickness
    const rT = 0.62 * t.w, rR = 0.5 * t.w; // tip and root rounding lengths
    // Stations along the toe: rounded root, body, rounded tip (denser at the ends).
    const xs: number[] = [];
    for (let k = 0; k <= 2; k++) xs.push(rR * (1 - Math.cos((k / 2) * Math.PI / 2))); // root cap (inside the foot: coarse)
    for (let k = 1; k <= 4; k++) xs.push(rR + (t.len - rT - rR) * (k / 4)); // body
    for (let k = 1; k <= 5; k++) xs.push(t.len - rT + rT * Math.sin((k / 5) * Math.PI / 2)); // tip cap
    const start = P.length / 3; // first vertex of this toe
    const center = (x: number, o: THREE.Vector3) => { // centreline point at x
      const s = Math.min(1, Math.max(0, (x - t.buried) / (t.len - t.buried))); // 0 at the toe root .. 1 at the tip
      const lift = t.curl * t.h * Math.sin(Math.PI * Math.pow(s, 0.8)) * (1 - 0.35 * s); // knuckle up, pad down
      return o.copy(t.base).addScaledVector(t.dir, x).addScaledVector(up, 0.86 * b0 + lift + 0.0004);
    };
    for (const x of xs) {
      const cap = x < rR ? Math.sqrt(Math.max(0, 1 - ((rR - x) / rR) ** 2)) : x > t.len - rT ? Math.sqrt(Math.max(0, 1 - ((x - (t.len - rT)) / rT) ** 2)) : 1; // rounded ends
      const s = Math.min(1, Math.max(0, (x - t.buried) / (t.len - t.buried))); // along the visible toe
      const bulb = 1 + 0.05 * Math.exp(-(((s - 0.8) / 0.18) ** 2)); // slightly fuller toe pad near the tip
      const flare = 1 + 0.16 * smooth(0.35, 0, s); // wider and fuller where the toe grows out of the foot (soft web, no "glued-on" look)
      const hf = 1 + 0.5 * (flare - 1); // thicker too, growing upward only (the pad stays on the floor)
      const a = a0 * cap * bulb * flare, b = b0 * cap * hf; // section size here
      center(x, p); p.addScaledVector(up, 0.86 * b0 * cap * (hf - 1)); // centre
      center(x + 1e-4, q); d.copy(q).sub(p).normalize(); // local axis (for the end normals)
      const fromTip = (Math.max(0, t.len - x) / t.w) * t.nail; // toe widths back from the tip (lesser toes: a smaller nail)
      const row = sw.tipRow + Math.pow(Math.min(1, fromTip / SWATCH_WIDTHS), SWATCH_POW) * (sw.rootRow - sw.tipRow); // swatch row (more texels near the tip, where the nail is)
      for (let r = 0; r <= RING; r++) {
        const th = (r / RING) * Math.PI * 2; // 0 = underneath, PI = on top
        const sx = Math.sin(th), cy = -Math.cos(th); // unit circle (side, up)
        const ex = Math.sign(sx) * Math.pow(Math.abs(sx), 0.88), ey = Math.sign(cy) * Math.pow(Math.abs(cy), 0.88); // soft-square section (superellipse)
        const yy = ey < 0 ? ey * 0.86 : ey; // flatter underneath (the pad)
        P.push(p.x + t.side.x * a * ex, p.y + b * yy, p.z + t.side.z * a * ex); // vertex
        const nx = Math.sign(sx) * Math.pow(Math.abs(sx), 1.2) / a0, ny = Math.sign(cy) * Math.pow(Math.abs(cy), 1.2) / (b0 * (cy < 0 ? 0.86 : 1)); // section normal (approx.)
        const nn = new THREE.Vector3(t.side.x * nx, ny, t.side.z * nx).normalize(); // across the toe
        const along = x < rR ? -Math.sqrt(Math.max(0, 1 - cap * cap)) : x > t.len - rT ? Math.sqrt(Math.max(0, 1 - cap * cap)) : 0; // end caps tilt toward the axis
        nn.multiplyScalar(Math.sqrt(1 - along * along)).addScaledVector(d, along).normalize();
        N.push(nn.x, nn.y, nn.z);
        const col = Math.min(1, Math.max(0, 0.5 + (r / RING - 0.5) * t.nail)); // round the toe (lesser toes: the nail covers less of it)
        UV.push((sw.left + col * (sw.right - sw.left)) / Z, row / Z); // swatch texel
      }
    }
    const flip = t.side.dot(d.set(t.dir.z, 0, -t.dir.x)) < 0; // mirrored section (one foot): swap the winding so faces point out
    for (let k = 0; k < xs.length - 1; k++) for (let r = 0; r < RING; r++) { // quads between stations
      const a = start + k * (RING + 1) + r, b = a + RING + 1; // this station, next station
      if (flip) I.push(a, b, a + 1, a + 1, b, b + 1); else I.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry(); // same attribute set as the body, so they merge
  const count = P.length / 3;
  for (const [name, src] of Object.entries(like.attributes) as [string, THREE.BufferAttribute][]) {
    const Arr = src.array.constructor as new (n: number) => THREE.TypedArray; // same array type as the body
    const arr = new Arr(count * src.itemSize); // zeros
    if (name === "position") arr.set(P); else if (name === "normal") arr.set(N); else if (name === "uv") arr.set(UV);
    else if (name === "skinIndex") for (let i = 0; i < count; i++) arr[i * 4] = bone; // the toe bone
    else if (name === "skinWeight") for (let i = 0; i < count; i++) arr[i * 4] = src.normalized ? (arr instanceof Uint8Array ? 255 : 65535) : 1; // fully on it
    else if (name === "tangent") for (let i = 0; i < count; i++) { arr[i * 4] = 1; arr[i * 4 + 3] = 1; } // unused placeholder
    else if (name.startsWith("uv")) arr.set(UV.slice(0, count * 2)); // extra UV sets: same swatch
    geo.setAttribute(name, new THREE.BufferAttribute(arr, src.itemSize, src.normalized));
  }
  geo.setIndex(I); // triangles (merged into the body's index buffer)
  return geo;
}

// Split the triangles over the top of each foot (behind the toe web, below the
// ankle) into 4, INSTEP_LEVELS times, so the soft instep shape is sampled
// finely enough to read as a curve. Neighbouring triangles that share a split
// edge are split to match (no T-junctions, so no cracks when skinned). New
// vertices are appended after the originals and get averaged attributes; skin
// weights are merged by bone. Returns null when nothing was split.
function subdivideInsteps(mesh: THREE.SkinnedMesh, feet: FootBones[]): THREE.BufferGeometry | null {
  let g = mesh.geometry, out: THREE.BufferGeometry | null = null;
  const joint = (b: number) => new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[b].clone().invert()); // bone origin in bind space
  const frames = feet.map((fb) => { const JT = joint(fb.toes), JF = joint(fb.foot); return { fb, JT, JF, fwd: JT.clone().sub(JF).setY(0).normalize() }; });
  for (let level = 0; level < INSTEP_LEVELS; level++) {
    const pos = g.attributes.position as THREE.BufferAttribute, si = g.attributes.skinIndex as THREE.BufferAttribute, sw = g.attributes.skinWeight as THREE.BufferAttribute;
    const n = pos.count, v = new THREE.Vector3();
    const inside = new Uint8Array(n); // on the top-of-foot region
    for (const { fb, JT, JF, fwd } of frames) {
      // foot length and the toe-root line (same rule as bareFeetGeometry)
      let uTip = -Infinity, uHeel = Infinity; const U = new Float32Array(n), H = new Float32Array(n), on = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        let w = 0; for (let c = 0; c < 4; c++) { const b = si.getComponent(i, c); if (b === fb.foot || b === fb.toes) w += sw.getComponent(i, c); }
        if (w < 0.2) continue;
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix); U[i] = (v.x - JT.x) * fwd.x + (v.z - JT.z) * fwd.z; H[i] = v.y; on[i] = 1;
        if (w >= 0.5) { uTip = Math.max(uTip, U[i]); uHeel = Math.min(uHeel, U[i]); }
      }
      const L = uTip - uHeel; if (!(L > 0.08)) continue;
      const uEnd = uTip - 0.135 * L - 0.075 * L - 0.01 * L; // behind every toe root (the web fold starts there)
      const uBeg = (JF.x - JT.x) * fwd.x + (JF.z - JT.z) * fwd.z - 0.05 * L; // a little behind the ankle joint
      for (let i = 0; i < n; i++) if (on[i] && U[i] > uBeg && U[i] < uEnd && H[i] < JF.y) inside[i] = 1;
    }
    const idx = g.index; if (!idx) return out;
    const key = (i: number) => `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`; // weld key (seams)
    const K = new Array<string>(n); for (let i = 0; i < n; i++) K[i] = key(i);
    const ek = (a: number, b: number) => (K[a] < K[b] ? K[a] + "|" + K[b] : K[b] + "|" + K[a]);
    const T = idx.count / 3, split = new Set<string>();
    for (let t = 0; t < T; t++) { const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2); if (inside[a] && inside[b] && inside[c]) { split.add(ek(a, b)); split.add(ek(b, c)); split.add(ek(c, a)); } }
    if (!split.size) return out;
    const mids = new Map<string, number>(), pairs: [number, number][] = []; // index pair -> new vertex
    const mid = (a: number, b: number) => { const k = a < b ? a + "," + b : b + "," + a; let m = mids.get(k); if (m === undefined) { m = n + pairs.length; mids.set(k, m); pairs.push([a, b]); } return m; };
    const I: number[] = [], groups = g.groups.length ? g.groups : [{ start: 0, count: idx.count, materialIndex: 0 }], newGroups: { start: number; count: number; materialIndex?: number }[] = [];
    for (const gr of groups) {
      const start = I.length;
      for (let t = gr.start / 3; t < (gr.start + gr.count) / 3; t++) {
        const V = [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)], E = [split.has(ek(V[0], V[1])), split.has(ek(V[1], V[2])), split.has(ek(V[2], V[0]))];
        const ns = E.filter(Boolean).length;
        if (ns === 0) { I.push(...V); continue; }
        if (ns === 3) { const ab = mid(V[0], V[1]), bc = mid(V[1], V[2]), ca = mid(V[2], V[0]); I.push(V[0], ab, ca, ab, V[1], bc, ca, bc, V[2], ab, bc, ca); continue; }
        const r = ns === 1 ? E.indexOf(true) : (E.indexOf(false) + 1) % 3; // rotate: the split edge first (1), or the unsplit edge last (2)
        const a = V[r], b = V[(r + 1) % 3], c = V[(r + 2) % 3];
        if (ns === 1) { const ab = mid(a, b); I.push(a, ab, c, ab, b, c); }
        else { const ab = mid(a, b), bc = mid(b, c); I.push(ab, b, bc, a, ab, bc, a, bc, c); }
      }
      newGroups.push({ start, count: I.length - start, materialIndex: gr.materialIndex });
    }
    const m = pairs.length, N = n + m, res = new THREE.BufferGeometry();
    for (const [name, src] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
      const Arr = src.array.constructor as new (n: number) => THREE.TypedArray, it = src.itemSize;
      const attr = new THREE.BufferAttribute(new Arr(N * it), it, src.normalized);
      for (let i = 0; i < n; i++) for (let c = 0; c < it; c++) attr.setComponent(i, c, src.getComponent(i, c));
      if (name === "skinIndex" || name === "skinWeight") { res.setAttribute(name, attr); continue; } // merged below
      for (let k = 0; k < m; k++) { const [a, b] = pairs[k]; for (let c = 0; c < it; c++) attr.setComponent(n + k, c, 0.5 * (src.getComponent(a, c) + src.getComponent(b, c))); }
      if (name === "normal") for (let k = 0; k < m; k++) { v.fromBufferAttribute(attr, n + k).normalize(); attr.setXYZ(n + k, v.x, v.y, v.z); }
      res.setAttribute(name, attr);
    }
    const rsi = res.attributes.skinIndex as THREE.BufferAttribute, rsw = res.attributes.skinWeight as THREE.BufferAttribute;
    for (let k = 0; k < m; k++) { // skin weights: average by bone, keep the four largest
      const acc = new Map<number, number>();
      for (const e of pairs[k]) for (let c = 0; c < 4; c++) { const w = sw.getComponent(e, c); if (w > 0) acc.set(si.getComponent(e, c), (acc.get(si.getComponent(e, c)) ?? 0) + 0.5 * w); }
      const best = [...acc.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4), tot = best.reduce((s0, p) => s0 + p[1], 0) || 1;
      for (let c = 0; c < 4; c++) { rsi.setComponent(n + k, c, best[c]?.[0] ?? 0); rsw.setComponent(n + k, c, (best[c]?.[1] ?? 0) / tot); }
    }
    for (const [name, list] of Object.entries(g.morphAttributes)) (res.morphAttributes as Record<string, THREE.BufferAttribute[]>)[name] = (list as THREE.BufferAttribute[]).map((src) => { // morphs (none on these bodies; kept for safety)
      const a = src as THREE.BufferAttribute, arr = new Float32Array(N * a.itemSize); const attr = new THREE.BufferAttribute(arr, a.itemSize);
      for (let i = 0; i < n; i++) for (let c = 0; c < a.itemSize; c++) attr.setComponent(i, c, a.getComponent(i, c));
      for (let k = 0; k < m; k++) for (let c = 0; c < a.itemSize; c++) attr.setComponent(n + k, c, 0.5 * (a.getComponent(pairs[k][0], c) + a.getComponent(pairs[k][1], c)));
      return attr;
    });
    res.morphTargetsRelative = g.morphTargetsRelative;
    res.setIndex(I); if (g.groups.length) for (const gr of newGroups) res.addGroup(gr.start, gr.count, gr.materialIndex);
    if (out) out.dispose(); out = res; g = res;
  }
  return out;
}
