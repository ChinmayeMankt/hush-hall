"use client"; // three.js runs in the browser only

// Desk-kit props (plant, mug, books, pencil cup, clock, cat, notebook) drawn on the
// desks of seated people who placed them. Each prop is built once from simple
// three.js shapes, merged into ONE geometry with baked vertex colours, and drawn
// with ONE shared Lambert material (same lighting model as the desks). All copies
// of a prop across the hall are one instanced draw call, so the whole kit costs
// at most 7 draw calls (one per prop) however many desks show it. Only items a
// person has placed right now are drawn; unplaced (but unlocked) items never show.

import { useLayoutEffect, useMemo, useRef } from "react"; // memo + instance matrices
import * as THREE from "three"; // geometry, colours, matrices
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"; // merge parts into one mesh
import type { Member } from "@/lib/presence/types"; // who sits where
import { DESK_SPOTS, type DeskItemId, type SpotId } from "@/lib/deskKit"; // spot + item ids
import { PLACE_BY_SEAT } from "./layout"; // desk positions

const TOP_Y = 0.795; // desk top surface (desk centre 0.76 + half of the 0.07 top)

// ---- The five spots, in desk space: x across the desk (world x, metres from desk
// centre; the green lamp is always at -x and the two old books at +x), z toward the
// far edge (multiplied by the row's facing), y above the desk top, plus a small turn
// so things look set down by hand rather than lined up. They avoid the green lamp,
// the brass plaque, and the open book / laptop in the middle (so a laptop screen
// never hides them), and sit far enough back to be seen from your own chair.
export const SPOT_POS: Record<SpotId, { x: number; z: number; y: number; turn: number }> = {
  "1": { x: -0.68, z: 0.0, y: 0, turn: 0.35 }, // corner by the lamp, far enough back to be seen from the chair
  "2": { x: -0.27, z: 0.27, y: 0, turn: -0.2 }, // back, between the lamp and the middle
  "3": { x: 0.41, z: -0.01, y: 0, turn: 0.1 }, // beside your open book / laptop, in front of the old books
  "4": { x: 0.55, z: 0.2, y: 0.12, turn: -0.12 }, // on top of the desk's two old books
  "5": { x: 0.66, z: -0.06, y: 0, turn: 0.25 }, // corner by the books, far enough back to be seen from the chair
};

// ---- Palette: warm wood, glazed ceramic, paper, soft green, brass ----
const C = {
  cream: "#e9dcc2", // glazed ceramic / paper
  paper: "#f2e8d2", // page edges, sharpened pencil wood
  sage: "#93ad94", // soft green glaze
  leaf: "#6e9a5a", // leaves
  leafLight: "#8fb66f", // young leaves
  stem: "#5d7a45", // stems
  soil: "#3a281b", // potting soil
  tea: "#4b2c19", // tea in the mug
  cork: "#b48c5c", // coaster
  brass: "#c49a4a", // warm metal (matches the desk lamps)
  walnut: "#6b4128", // dark wood
  walnutLight: "#7d5033", // lighter wood
  ink: "#2b1e15", // clock hands, pen body
  green: "#3f5a46", // cloth binding
  oxblood: "#74352c", // cloth binding
  ochre: "#a7834c", // cloth binding
  leather: "#5a3a26", // notebook cover
  ribbon: "#8e3b30", // bookmark ribbon
  catGlaze: "#e3d6bf", // ceramic cat
  catShade: "#cdb999", // ears / tail tip
} as const;

// One part: a shape, a colour, and where it sits inside the prop.
type Part = { g: THREE.BufferGeometry; c: string; p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] };

// Bake a list of parts into one geometry with per-vertex colours.
function bake(parts: Part[]): THREE.BufferGeometry {
  const m = new THREE.Matrix4(); // part transform
  const q = new THREE.Quaternion(); // part rotation
  const out = parts.map(({ g, c, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] }) => {
    const geo = (g.index ? g.toNonIndexed() : g.clone()); // flat list so every part merges the same way
    geo.deleteAttribute("uv"); // not textured: smaller and merge-safe
    q.setFromEuler(new THREE.Euler(...r)); // rotation
    geo.applyMatrix4(m.compose(new THREE.Vector3(...p), q, new THREE.Vector3(...s))); // move into place
    const col = new THREE.Color(c); // written in sRGB like the rest of the scene (three converts to its linear working space)
    const n = geo.getAttribute("position").count; // vertices
    const arr = new Float32Array(n * 3); // rgb per vertex
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; } // one colour per part
    geo.setAttribute("color", new THREE.BufferAttribute(arr, 3)); // baked colour
    g.dispose(); // source shape no longer needed
    return geo; // ready to merge
  });
  const merged = mergeGeometries(out)!; // one mesh per prop
  out.forEach((g) => g.dispose()); // free the pieces
  merged.computeBoundingSphere(); // for any later culling
  return merged; // done
}

// A lathe (turned) shape from [radius, height] pairs, e.g. a pot or a mug.
const lathe = (pts: [number, number][], seg = 14) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg); // turned profile

// A book: cloth cover box with a cream page block set into it (the front of the book faces -z).
function book(w: number, h: number, d: number, cloth: string, y: number, turn: number): Part[] {
  return [
    { g: new THREE.BoxGeometry(w, h, d), c: cloth, p: [0, y + h / 2, 0], r: [0, turn, 0] }, // cover
    { g: new THREE.BoxGeometry(w * 0.94, h * 0.72, d * 1.02), c: C.paper, p: [Math.sin(turn) * 0.004 + 0.006, y + h / 2, 0], r: [0, turn, 0] }, // pages showing on three sides
  ];
}

// ---- Each prop, built in its own space: origin at the centre of its base on the desk, front toward -z ----
const BUILD: Record<DeskItemId, () => THREE.BufferGeometry> = {
  // Young plant in a glazed ceramic pot: a few stems with soft leaves of two greens.
  plant: () => bake([
    { g: lathe([[0, 0], [0.04, 0], [0.046, 0.006], [0.054, 0.074], [0.059, 0.078], [0.059, 0.085], [0.05, 0.085], [0.05, 0.077], [0, 0.077]]), c: C.sage }, // pot with a rolled rim
    { g: new THREE.CylinderGeometry(0.049, 0.049, 0.006, 14), c: C.soil, p: [0, 0.076, 0] }, // soil
    ...[0, 1, 2, 3, 4, 5, 6].flatMap((i): Part[] => {
      const a = i * 2.4; // spread round the pot (golden-angle-like)
      const tilt = 0.35 + (i % 3) * 0.18; // how far each stem leans out
      const len = 0.05 + (i % 4) * 0.012; // stem length
      const tx = Math.sin(a) * Math.sin(tilt) * len, tz = Math.cos(a) * Math.sin(tilt) * len, ty = Math.cos(tilt) * len; // stem tip offset
      return [
        { g: new THREE.CylinderGeometry(0.0025, 0.003, len, 4), c: C.stem, p: [tx / 2, 0.079 + ty / 2, tz / 2], r: [Math.sin(tilt) * Math.cos(a), 0, -Math.sin(tilt) * Math.sin(a)] }, // stem
        { g: new THREE.SphereGeometry(1, 8, 5), c: i % 2 ? C.leafLight : C.leaf, p: [tx * 1.25, 0.079 + ty + 0.004, tz * 1.25], r: [0, a + Math.PI / 2, tilt * 0.9], s: [0.03, 0.0065, 0.02] }, // leaf at the tip
      ];
    }),
    { g: new THREE.SphereGeometry(1, 8, 5), c: C.leafLight, p: [0, 0.142, 0], r: [0.2, 0.5, 0.1], s: [0.02, 0.006, 0.014] }, // new leaf in the middle
  ]),
  // Sage ceramic mug of tea on a cork coaster.
  mug: () => bake([
    { g: new THREE.CylinderGeometry(0.052, 0.052, 0.006, 16), c: C.cork, p: [0, 0.003, 0] }, // coaster
    { g: lathe([[0, 0.006], [0.034, 0.006], [0.038, 0.012], [0.04, 0.09], [0.036, 0.09], [0.035, 0.016], [0, 0.016]], 16), c: C.sage }, // mug walls with a foot
    { g: new THREE.CylinderGeometry(0.035, 0.035, 0.004, 16), c: C.tea, p: [0, 0.078, 0] }, // tea
    { g: new THREE.TorusGeometry(0.022, 0.0065, 6, 10, Math.PI), c: C.sage, p: [0.04, 0.05, 0], r: [0, 0, -Math.PI / 2] }, // handle (to the right)
  ]),
  // Three cloth-bound books stacked a little unevenly, with a ribbon bookmark.
  books: () => bake([
    ...book(0.2, 0.034, 0.145, C.green, 0, 0), // bottom
    ...book(0.18, 0.028, 0.132, C.oxblood, 0.034, 0.12), // middle
    ...book(0.165, 0.026, 0.12, C.ochre, 0.062, -0.07), // top
    { g: new THREE.BoxGeometry(0.012, 0.002, 0.05), c: C.ribbon, p: [0.03, 0.03, -0.088], r: [0.9, 0, 0] }, // ribbon hanging from the bottom book
  ]),
  // Warm brass pencil cup holding four wooden pencils, tips up, leaning a little apart.
  pencils: () => bake([
    { g: lathe([[0, 0], [0.032, 0], [0.034, 0.004], [0.034, 0.09], [0.036, 0.094], [0.031, 0.094], [0.03, 0.012], [0, 0.012]], 16), c: C.brass }, // brass cup with a rolled lip
    ...[0, 1, 2, 3].flatMap((i): Part[] => {
      const a = i * 1.7 + 0.4; // which way it leans (around the cup)
      const t = 0.14 + (i % 2) * 0.08; // how far it leans
      const len = 0.16 - (i % 3) * 0.012; // slightly different lengths (used pencils)
      const dir = new THREE.Vector3(Math.sin(t) * Math.sin(a), Math.cos(t), Math.sin(t) * Math.cos(a)); // pencil axis
      const rot = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)); // turn +y onto the axis
      const base = new THREE.Vector3(Math.sin(a + Math.PI) * 0.012, 0.014, Math.cos(a + Math.PI) * 0.012); // foot inside the cup, opposite the lean
      const at = (d: number): [number, number, number] => [base.x + dir.x * d, base.y + dir.y * d, base.z + dir.z * d]; // point along the pencil
      const r: [number, number, number] = [rot.x, rot.y, rot.z]; // shared rotation
      return [
        { g: new THREE.CylinderGeometry(0.0055, 0.0055, len, 6), c: [C.ochre, C.green, C.oxblood, C.walnutLight][i], p: at(len / 2), r }, // painted hexagonal body
        { g: new THREE.ConeGeometry(0.0055, 0.018, 6), c: C.paper, p: at(len + 0.009), r }, // sharpened wood
        { g: new THREE.ConeGeometry(0.0016, 0.006, 6), c: C.ink, p: at(len + 0.0155), r }, // graphite tip
      ];
    }),
  ]),
  // Walnut mantel clock with a cream face and brass bezel, facing the student.
  clock: () => bake([
    { g: new THREE.BoxGeometry(0.13, 0.012, 0.06), c: C.walnut, p: [0, 0.006, 0] }, // plinth
    { g: new THREE.BoxGeometry(0.11, 0.075, 0.048), c: C.walnutLight, p: [0, 0.0495, 0] }, // body
    { g: new THREE.CylinderGeometry(0.055, 0.055, 0.048, 18, 1, false, -Math.PI / 2, Math.PI), c: C.walnutLight, p: [0, 0.087, 0], r: [Math.PI / 2, 0, 0] }, // rounded top
    { g: new THREE.CylinderGeometry(0.04, 0.04, 0.004, 20), c: C.paper, p: [0, 0.082, -0.0255], r: [Math.PI / 2, 0, 0] }, // face
    { g: new THREE.TorusGeometry(0.041, 0.0035, 5, 20), c: C.brass, p: [0, 0.082, -0.027] }, // bezel
    { g: new THREE.BoxGeometry(0.003, 0.026, 0.002), c: C.ink, p: [0.005, 0.093, -0.029], r: [0, 0, -0.4] }, // minute hand
    { g: new THREE.BoxGeometry(0.004, 0.017, 0.002), c: C.ink, p: [-0.006, 0.086, -0.029], r: [0, 0, 1.0] }, // hour hand
    { g: new THREE.CylinderGeometry(0.004, 0.004, 0.004, 8), c: C.brass, p: [0, 0.082, -0.03], r: [Math.PI / 2, 0, 0] }, // centre pin
  ]),
  // Curled-up sleeping cat in cream glaze, like a small ceramic figure.
  cat: () => bake([
    { g: new THREE.SphereGeometry(1, 14, 10), c: C.catGlaze, p: [0, 0.034, 0], s: [0.07, 0.036, 0.055] }, // curled body
    { g: new THREE.SphereGeometry(1, 12, 9), c: C.catGlaze, p: [-0.05, 0.045, -0.026], s: [0.03, 0.026, 0.028] }, // head resting on paws
    { g: new THREE.ConeGeometry(0.011, 0.02, 4), c: C.catShade, p: [-0.062, 0.071, -0.016], r: [0.2, 0, 0.25] }, // left ear
    { g: new THREE.ConeGeometry(0.011, 0.02, 4), c: C.catShade, p: [-0.042, 0.071, -0.03], r: [-0.1, 0, -0.2] }, // right ear
    { g: new THREE.TorusGeometry(0.058, 0.011, 6, 14, Math.PI * 0.9), c: C.catGlaze, p: [0.004, 0.012, -0.004], r: [Math.PI / 2, 0, Math.PI * 0.75] }, // tail wrapped round the front
    { g: new THREE.SphereGeometry(1, 8, 6), c: C.catShade, p: [-0.044, 0.012, -0.05], s: [0.012, 0.009, 0.012] }, // tail tip
    { g: new THREE.SphereGeometry(1, 8, 6), c: C.catGlaze, p: [-0.04, 0.012, -0.044], s: [0.016, 0.01, 0.014] }, // tucked paws
  ]),
  // Closed leather notebook with an elastic band and a brass-capped pen on top.
  notebook: () => bake([
    { g: new THREE.BoxGeometry(0.15, 0.018, 0.205), c: C.leather, p: [0, 0.009, 0] }, // cover
    { g: new THREE.BoxGeometry(0.144, 0.013, 0.199), c: C.paper, p: [0.004, 0.009, 0] }, // page block (shows at the edges)
    { g: new THREE.BoxGeometry(0.006, 0.0195, 0.207), c: C.ink, p: [0.055, 0.0095, 0] }, // elastic band
    { g: new THREE.CylinderGeometry(0.0045, 0.0045, 0.13, 8), c: C.ink, p: [-0.012, 0.0235, 0], r: [Math.PI / 2, 0, 0.28], s: [1, 1, 1] }, // pen body
    { g: new THREE.CylinderGeometry(0.0048, 0.0048, 0.035, 8), c: C.brass, p: [-0.024, 0.0235, -0.042], r: [Math.PI / 2, 0, 0.28] }, // brass cap
  ]),
};

// Built geometries, shared by every desk (created on first use).
const cache = new Map<DeskItemId, THREE.BufferGeometry>(); // item -> geometry
function geometryFor(id: DeskItemId): THREE.BufferGeometry {
  let g = cache.get(id); // already built?
  if (!g) { g = BUILD[id](); if (id === "cat") g.scale(1.3, 1.3, 1.3); cache.set(id, g); } // build once (the cat a little larger so it reads at a glance)
  return g; // shared
}

// One material for every prop (baked colours, scene lighting).
let sharedMat: THREE.MeshLambertMaterial | null = null; // created on first use
function material(): THREE.MeshLambertMaterial {
  if (!sharedMat) sharedMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }); // no textures; both sides so thin open shapes never show a hole
  return sharedMat; // shared
}

// One placed copy of a prop in world space.
type Placed = { x: number; y: number; z: number; ry: number };

// Where an item sits in the world for a seat + spot.
export function placeOf(seat: string, spot: SpotId): Placed | null {
  const p = PLACE_BY_SEAT.get(seat); // desk
  if (!p) return null; // unknown seat
  const s = SPOT_POS[spot]; // spot on the desk
  return { x: p.x + s.x, y: TOP_Y + s.y, z: p.deskZ + p.facing * s.z, ry: (p.facing > 0 ? 0 : Math.PI) + s.turn }; // fronts face the student
}

// All copies of one prop, drawn as one instanced mesh.
function Batch({ geo, mat, at, lift = 0 }: { geo: THREE.BufferGeometry; mat: THREE.Material; at: Placed[]; lift?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null); // the instanced mesh
  useLayoutEffect(() => {
    const mesh = ref.current; // mounted mesh
    if (!mesh) return; // not yet
    const m = new THREE.Matrix4(); // per-copy transform
    const q = new THREE.Quaternion(); // per-copy turn
    const one = new THREE.Vector3(1, 1, 1); // no scaling
    at.forEach((a, i) => { q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a.ry); mesh.setMatrixAt(i, m.compose(new THREE.Vector3(a.x, a.y + lift, a.z), q, one)); }); // place each copy
    mesh.count = at.length; // draw only these
    mesh.instanceMatrix.needsUpdate = true; // upload
  }, [at, lift]);
  return <instancedMesh ref={ref} args={[geo, mat, Math.max(1, at.length)]} frustumCulled={false} raycast={() => null} />; // clicks pass through to the desk
}

// Props on every occupied desk whose person placed items. Others see the arrangement
// of whoever sits there; mine moves with me because it comes from my own state.
export default function DeskKit({ seatMap }: { seatMap: Map<string, Member> }) {
  const groups = useMemo(() => {
    const by = new Map<DeskItemId, Placed[]>(); // item -> copies
    for (const [seat, m] of seatMap) { // each occupied desk
      if (!m.deskKit) continue; // nothing placed
      for (const s of DESK_SPOTS) { // five spots
        const id = m.deskKit[s.id]; // item here
        if (!id || !BUILD[id]) continue; // empty or unknown
        const at = placeOf(seat, s.id); // world spot
        if (at) by.set(id, [...(by.get(id) ?? []), at]); // add a copy
      }
    }
    return [...by.entries()]; // [item, copies][]
  }, [seatMap]);

  return (
    <group>
      {groups.map(([id, at]) => <Batch key={`${id}:${at.length}`} geo={geometryFor(id)} mat={material()} at={at} />)}
    </group>
  );
}
