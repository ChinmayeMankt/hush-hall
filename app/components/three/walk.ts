// Walking around the hall: pace, solid furniture, and calm motion helpers.
// World units are metres. Desks, chairs, plants and walls are flat boxes on the
// floor; the walker is a small circle that slides along them instead of
// stopping dead or shaking, so bumping a desk feels like brushing past it.

import { PLACES, PLACE_BY_SEAT, ROOM } from "./layout"; // desk positions + room size

// Pace and feel (a calm library walk, not a game sprint).
export const WALK_SPEED = 1.0; // metres per second at full stick / key (an unhurried indoor walk)
export const ACCEL = 3.2; // how quickly you get up to pace (1/s, exponential); ~0.3 s to feel moving
export const DECEL = 4.5; // how quickly you come to rest (a touch quicker than starting, like real feet)
export const TURN = 6.0; // how quickly the body turns toward where it walks (1/s)
export const BODY_R = 0.26; // walker's footprint radius (shoulder half-width plus a little air)

// One solid floor rectangle (axis-aligned, in the floor plane).
interface Box { x0: number; x1: number; z0: number; z1: number } // min/max corners

// Desk and chair sizes, matching Desks.tsx.
const DESK_W = 1.7, DESK_D = 0.86; // desk top footprint

// Build the solid boxes once: every desk, every chair (covering both its tucked-in and pushed-out spots), and the potted plants.
const BOXES: Box[] = [
  ...PLACES.map((p) => ({ x0: p.x - DESK_W / 2, x1: p.x + DESK_W / 2, z0: p.deskZ - DESK_D / 2, z1: p.deskZ + DESK_D / 2 })), // desks
  ...PLACES.map((p) => { const a = p.chairZ + p.facing * 0.27, b = p.chairZ - p.facing * 0.52; return { x0: p.x - 0.3, x1: p.x + 0.4, z0: Math.min(a, b), z1: Math.max(a, b) }; }), // chairs (and whoever sits in them)
  ...[ROOM.minX + 0.7, -6.6, 6.6, ROOM.maxX - 0.8].map((x) => ({ x0: x - 0.4, x1: x + 0.4, z0: ROOM.minZ + 0.4, z1: ROOM.minZ + 1.25 })), // plants by the back wall
];

// Walkable floor inside the walls (bookshelves line the back, left and front walls).
export const FLOOR = { minX: ROOM.minX + 0.85, maxX: ROOM.maxX - 0.5, minZ: ROOM.minZ + 0.85, maxZ: ROOM.maxZ - 0.85 }; // inner bounds for the body centre

// Move a position out of every solid box and inside the walls.
// Pushing out along the shortest way lets you glide along a desk edge instead of sticking to it.
export function collide(p: { x: number; z: number }, r = BODY_R) {
  for (let pass = 0; pass < 2; pass++) { // two passes settle corners where two boxes meet
    for (const b of BOXES) {
      const cx = Math.min(Math.max(p.x, b.x0), b.x1), cz = Math.min(Math.max(p.z, b.z0), b.z1); // closest point on the box
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz; // offset from it
      if (d2 >= r * r) continue; // not touching
      if (d2 > 1e-10) { const d = Math.sqrt(d2); p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r; continue; } // touching an edge: slide out along the normal
      const out = [p.x - b.x0, b.x1 - p.x, p.z - b.z0, b.z1 - p.z]; // centre inside the box: distances to each side
      const i = out.indexOf(Math.min(...out)); // nearest side
      if (i === 0) p.x = b.x0 - r; else if (i === 1) p.x = b.x1 + r; else if (i === 2) p.z = b.z0 - r; else p.z = b.z1 + r; // step out that way
    }
    p.x = Math.min(Math.max(p.x, FLOOR.minX), FLOOR.maxX); // left/right walls
    p.z = Math.min(Math.max(p.z, FLOOR.minZ), FLOOR.maxZ); // back/front walls
  }
  return p; // same object, adjusted
}

// Where you start walking from the hall entrance: the front centre aisle, facing the desks.
export const ENTRANCE = { x: 0, z: 5.4, ry: Math.PI }; // ry = PI looks toward -z (into the room)

// Where you stand after leaving a desk: just behind your chair, in the aisle, turned away from the desk.
export function standSpot(seat: string) {
  const p = PLACE_BY_SEAT.get(seat); // desk place
  if (!p) return { ...ENTRANCE }; // unknown seat: use the entrance
  const spot = collide({ x: p.x, z: p.chairZ - p.facing * 0.85 }); // straight behind the chair, pushed clear of furniture
  return { x: spot.x, z: spot.z, ry: p.facing > 0 ? Math.PI : 0 }; // face the aisle (away from the desk)
}

// Shortest signed angle from a to b (radians), so turning never goes "the long way round".
export function angleTo(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2); // raw difference
  if (d > Math.PI) d -= Math.PI * 2; // wrap down
  if (d < -Math.PI) d += Math.PI * 2; // wrap up
  return d; // in -PI..PI
}

// Frame-rate independent smoothing factor for a rate (1/s) over dt seconds.
export const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt); // 0..1

// A body on foot, shared between whoever moves it (keys or network) and the avatar that draws it.
export interface Body {
  x: number; z: number; ry: number; // floor position and facing
  speed: number; // current ground speed (m/s), drives how much stride the legs use
  moved: number; // metres walked so far (the legs' step cycle follows real distance, so feet don't slide)
  hidden?: boolean; // true until the first position is known (remote walkers)
}
