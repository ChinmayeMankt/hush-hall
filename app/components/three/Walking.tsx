"use client"; // three.js runs in the browser only

// People on foot in the 3D hall.
//  - WalkAvatar: draws one anime VRM character standing or walking. The sample
//    models ship without animation clips, so the walk is made live from the
//    character's own skeleton: legs step with a two-bone IK whose feet stay
//    planted on the floor (the step cycle follows real distance walked, so
//    there is no sliding or moonwalking), hips rise and sway a little over each
//    planted foot, the pelvis and shoulders counter-twist, arms swing opposite
//    the legs with relaxed hands, and the head stays level. Standing still
//    shifts weight gently and breathes. Faces, materials and meshes are the
//    same shared ones the seated students use: nothing about the look changes.
//  - LocalWalker: moves my own body from keys / the on-screen pad, with gentle
//    acceleration, soft collisions and a third-person camera that follows.
//  - RemoteWalker: smooths another person's few-times-a-second updates into
//    continuous motion.

import { useEffect, useMemo, useRef, useState } from "react"; // React hooks
import { useFrame, useThree } from "@react-three/fiber"; // render loop
import * as THREE from "three"; // math
import { loadTemplate, instantiate, type Instance } from "./vrm"; // shared VRM loading + cheap clones
import { hash, modelFor } from "./models"; // same character picker as the seated students
import { SKIN_TINTS, HAIR_TINTS, ik2, orient, curlFingers, PALM_DOWN } from "./VrmAvatar"; // same tints and IK helpers as seated students
import { WALK_SPEED, QUICK_SPEED, ACCEL, DECEL, TURN, FLOOR_R, collide, aisleAssist, angleTo, ease, type Body } from "./walk"; // pace, collisions, walkway guidance, smoothing
import { ROOM } from "./layout"; // room size (keeps the camera inside the walls)
import { walkers } from "@/lib/presence/walkers"; // other people's latest positions
import type { WalkState } from "@/lib/presence/types"; // what gets announced
import { parseLook } from "./looks"; // wardrobe choices

// Gait shape (fractions of the character's own hip height, so tall and short models both look right).
const STEP = 0.62; // one step = 0.62 x hip height (about 0.5 m on these models): unhurried
const STANCE = 0.62; // share of each leg's cycle with the foot planted on the floor (real walking ≈ 0.6)
const LIFT = 0.075; // how high a foot clears the floor mid-swing (metres)

// Rest measurements of one character, taken once before any posing.
interface Rest {
  ankleY: number; // ankle height above the floor when standing
  footSide: number; // how far each foot sits from the centre line
  armLen: number; // shoulder -> wrist length
  footQ: { left: THREE.Quaternion; right: THREE.Quaternion }; // each foot's rest orientation relative to the body (keeps soles flat)
}

// Measure the clone in its rest pose (root at the origin, unrotated).
function measure(inst: Instance): Rest {
  const { root, bones: B } = inst; // shortcuts
  root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.updateWorldMatrix(true, true); // clean rest pose
  const v = new THREE.Vector3(), w = new THREE.Vector3(); // scratch
  const ankleY = B.leftFoot ? B.leftFoot.getWorldPosition(v).y : 0.08; // ankle height
  const footSide = B.leftUpperLeg ? Math.abs(B.leftUpperLeg.getWorldPosition(v).x) * 0.95 : 0.09; // hip width -> foot spacing
  const sh = B.leftUpperArm?.getWorldPosition(v), wr = B.leftHand?.getWorldPosition(w); // shoulder + wrist
  const armLen = sh && wr ? sh.distanceTo(wr) : 0.5; // arm length (T-pose: straight)
  const fq = (b?: THREE.Object3D) => (b ? b.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()); // foot rest orientation (root is identity here)
  return { ankleY, footSide, armLen, footQ: { left: fq(B.leftFoot), right: fq(B.rightFoot) } }; // all measurements
}

// Scratch objects for posing (own set, separate from the seated avatar's).
const S = { f: new THREE.Vector3(), l: new THREE.Vector3(), t: new THREE.Vector3(), p: new THREE.Vector3(), sh: new THREE.Vector3(), d: new THREE.Vector3(), n: new THREE.Vector3(), u: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), q3: new THREE.Quaternion(), q4: new THREE.Quaternion(), rq: new THREE.Quaternion() }; // vectors + quaternions
const UP = new THREE.Vector3(0, 1, 0); // world up
const smooth = (u: number) => u * u * (3 - 2 * u); // ease-in-out 0..1

// Props for one walking figure.
interface AvatarProps {
  id: string; // member id (same seed as at a desk, so the same character walks)
  name?: string; // demo students get fixed looks
  color: string; // lamp colour (part of the seed)
  body: Body; // where the figure is; moved by LocalWalker or RemoteWalker
  reduced: boolean; // prefers-reduced-motion: walking still moves (you asked for it), idle fidgets stop
  anchor?: THREE.Vector3; // optional point kept above the head, for a calm name tag
  look?: string; // wardrobe choices (looks.ts string; empty = the character as approved)
}

// One anime character on foot.
export function WalkAvatar({ id, name, color, body, reduced, anchor, look }: AvatarProps) {
  const k = useMemo(() => hash(id + color), [id, color]); // seed, identical to the seated avatar's
  const model = modelFor(id, color, name); // which character file
  const [inst, setInst] = useState<{ i: Instance; rest: Rest } | null>(null); // loaded clone + its measurements

  // Load (shared cache) and clone with the same tints this person has at a desk.
  useEffect(() => {
    let live = true; // ignore late results after unmount
    loadTemplate(model.file).then((t) => {
      if (!live) return; // gone meanwhile
      const skin = SKIN_TINTS[(k >>> 4) % SKIN_TINTS.length], hair = HAIR_TINTS[(k >>> 8) % HAIR_TINTS.length]; // same picks as VrmAvatar
      const i = instantiate(t, { skin: skin ? new THREE.Color(skin) : undefined, hair: hair ? new THREE.Color(hair) : undefined }, parseLook(look)); // own bones, shared look, dressed as they chose
      setInst({ i, rest: measure(i) }); // measure before any pose
    }).catch((e) => console.warn("VRM load failed for a walker", e)); // nothing drawn rather than a broken figure
    return () => { live = false; }; // cleanup
  }, [model.file, k, look]); // a wardrobe change re-dresses the clone

  const t0 = (k % 1000) / 100; // per-person time offset so idles don't sync up
  const wS = useRef(0); // smoothed 0..1 "how much walking" (blends idle <-> walk)
  const qS = useRef(0); // smoothed 0..1 "how brisk" (normal walk <-> quicker walk)
  const fS = useRef(body.floor ? 1 : 0); // smoothed 0..1 "how far down on the floor" (sitting down / getting up takes about a second)
  const ph = useRef({ cyc: 0, moved: body.moved }); // step cycle, advanced by real distance (so a longer brisk stride never makes the feet jump)
  const blinkAt = useRef(2 + (k % 3)); // next blink time
  const props = useRef<THREE.Group>(null); // floor cushion + open book (shown while sitting on the floor)

  useFrame(({ clock }, dt) => {
    if (!inst) return; // still loading
    const { i: { root, bones: B, sign, hipsY, setExpression }, rest } = inst; // shortcuts
    root.visible = !body.hidden; // remote figures stay hidden until their first position arrives
    if (props.current) props.current.visible = !body.hidden && fS.current > 0.02; // cushion and book only around a floor sit
    if (body.hidden) return; // nothing to pose
    const t = clock.elapsedTime; // seconds
    const dts = Math.min(dt, 0.1); // clamp long frames (tab switches)
    fS.current += ((body.floor ? 1 : 0) - fS.current) * (reduced ? 1 : ease(2.4, dts)); // ease down to / up from the floor (instant with reduced motion)
    const e = smooth(Math.min(1, Math.max(0, fS.current))); // eased floor weight
    const up = 1 - e; // standing weight
    wS.current += (Math.min(1, body.speed / WALK_SPEED) * up - wS.current) * ease(6, dts); // blend toward walking or standing (never walking on the floor)
    qS.current += (Math.min(1, Math.max(0, (body.speed - WALK_SPEED) / (QUICK_SPEED - WALK_SPEED))) - qS.current) * ease(3, dts); // brisk walk blend
    const w = wS.current, idle = 1 - w, q = qS.current; // walk, idle and brisk weights
    const D = 2 * STEP * (1 + 0.16 * q) * hipsY, A = STANCE * D; // distance per full cycle (a slightly longer stride when brisk), and foot travel while planted (= body travel, so feet stay put)
    ph.current.cyc += (body.moved - ph.current.moved) / D; ph.current.moved = body.moved; // advance the step cycle by distance actually walked
    const cyc = ph.current.cyc; // step cycle
    const TAU = Math.PI * 2; // full turn
    const f = S.f.set(Math.sin(body.ry), 0, Math.cos(body.ry)); // forward on the floor
    const l = S.l.set(Math.cos(body.ry), 0, -Math.sin(body.ry)); // the character's left on the floor
    const fid = reduced ? 0 : 1; // idle fidgets on/off
    const mix = (a: number, b: number) => a * up + b * e; // standing value -> floor value

    // Whole body: weight over the planted foot, a soft bob, slight knee bend so legs never lock.
    // On the floor: kneeling seiza on a cushion, sitting back on the heels (modest in
    // every outfit, skirts included), so the hips rest about 0.34 m up.
    const sway = up * (w * 0.018 * Math.cos(TAU * (cyc - 0.31)) + idle * fid * 0.012 * Math.sin(t * 0.55 + t0)); // side-to-side (walk sway + slow idle weight shift)
    const bob = -0.012 - 0.03 * w - 0.008 * q + 0.012 * w * Math.cos(2 * TAU * (cyc - 0.31)); // hips highest over each planted foot (a touch lower when brisk)
    root.position.set(body.x + l.x * sway, mix(bob, 0.34 - hipsY), body.z + l.z * sway); // place the body (down on the cushion when sitting)
    root.rotation.set(0, body.ry + (sign < 0 ? Math.PI : 0), 0); // VRM 0.x models face -z at rest
    const set = (b: THREE.Object3D | undefined, x: number, y = 0, z = 0) => b?.rotation.set(x * sign, y, z * sign); // body-frame -> raw-bone rotation (same rule as the seated pose)
    const tw = 0.09 * w * (1 + 0.3 * q) * Math.cos(TAU * cyc); // pelvis twist toward the forward leg (a little more when brisk)
    const breath = fid * Math.sin((t + t0) * 1.3) * 0.012; // slow breathing
    const look = up * idle * fid * 0.12 * Math.sin(t * 0.17 + t0); // standing still: the head drifts to look around a little
    const read = e * (0.04 * Math.sin(t * 0.21 + t0) * fid); // on the floor: the eyes drift slowly across the page
    set(B.hips, 0, -tw); // pelvis turns with the stepping leg
    set(B.spine, mix(0.03 * w + 0.03 * q, 0.12) + breath * 0.5, tw * 0.6); set(B.chest, mix(0.01, 0.08) + breath * 0.5, tw * 0.8); set(B.upperChest, mix(0, 0.04)); // shoulders counter-twist, slight forward carriage (a natural lean when brisk; curled over the book on the floor)
    set(B.neck, mix(0, 0.16), -tw * 0.2); set(B.head, mix(0.02, 0.26), -tw * 0.2 + look); // head level while walking, tipped toward the book on the floor
    set(B.leftEye, e * 0.1, read); set(B.rightEye, e * 0.1, read); // eyes ahead, or down at the page
    root.updateWorldMatrix(true, true); // fresh matrices before IK
    root.getWorldQuaternion(S.rq); // body orientation (for flat feet)

    // Legs: each foot planted while the body passes over it, then lifted and swung forward.
    // On the floor: kneeling, knees forward on the cushion, feet folded under the hips.
    const legFwd = { left: 0, right: 0 }; // where each foot is (for the arm swing)
    for (const s of [1, -1] as const) {
      const L = s > 0 ? "left" : "right"; // side name
      const ul = B[`${L}UpperLeg`], lo = B[`${L}LowerLeg`], ft = B[`${L}Foot`]; // leg chain
      if (!ul || !lo || !ft) continue; // model without legs (never for these samples)
      const p = (((cyc + (s > 0 ? 0 : 0.5)) % 1) + 1) % 1; // this leg's phase 0..1 (legs half a cycle apart)
      let fwd: number, lift = 0; // foot offset along the walk, and height
      if (p < STANCE) fwd = A * (0.5 - p / STANCE); // planted: slides back exactly as fast as the body moves forward (stays still on the floor)
      else { const u = (p - STANCE) / (1 - STANCE); fwd = A * (-0.5 + smooth(u)); lift = LIFT * Math.sin(Math.PI * u); } // swing: lift, carry forward, set down softly
      legFwd[L] = fwd / (A / 2); // -1 (behind) .. 1 (ahead)
      const tgt = S.t.set(body.x + l.x * s * rest.footSide + f.x * fwd * w, rest.ankleY + lift * w, body.z + l.z * s * rest.footSide + f.z * fwd * w); // standing ankle target on the floor
      if (e > 0) { // floor: this ankle tucked under the hips, foot lying on its top
        const side = s * rest.footSide * 0.85; // a little narrower than standing (knees close together)
        S.p.set(body.x + l.x * side - f.x * 0.1, 0.13, body.z + l.z * side - f.z * 0.1); // ankle just behind the hips, resting on the cushion
        tgt.lerp(S.p, e); // glide between standing and kneeling
      }
      const pole = S.p.copy(f).addScaledVector(UP, 0.1 * up).normalize(); // knees bend forward (standing and kneeling alike)
      ik2(ul, lo, ft, tgt, pole); // place the leg
      ft.parent!.getWorldQuaternion(S.q).invert(); // world -> leg space
      S.q2.copy(S.rq).multiply(rest.footQ[L]); // the foot's rest orientation, turned with the body (sole flat)
      if (e > 0) S.q2.premultiply(S.q3.setFromAxisAngle(l, 2.8 * e)); // floor: foot turned over, toes pointing back along the cushion, sole up (eased)
      ft.quaternion.copy(S.q).multiply(S.q2); // sole flat on the floor (or resting on its edge), pointing where it should
      ft.updateWorldMatrix(false, true); // refresh toes
    }

    // Arms: hang relaxed, swing opposite the legs, elbows soft and pointing back.
    // On the floor: both hands hold the open book in the lap.
    const bookC = S.sh.set(body.x + f.x * 0.32, 0.45, body.z + f.z * 0.32); // book centre, held just above the lap
    if (props.current) { props.current.position.set(body.x, 0, body.z); props.current.rotation.set(0, body.ry, 0); } // cushion + book follow the body
    for (const s of [1, -1] as const) {
      const L = s > 0 ? "left" : "right"; // side name
      const ua = B[`${L}UpperArm`], lo = B[`${L}LowerArm`], hd = B[`${L}Hand`]; // arm chain
      if (!ua || !lo || !hd) continue; // model without arms
      const swing = w * (1 + 0.35 * q) * (0.02 - 0.13 * legFwd[L]); // forward when the same-side leg is behind (a little more when brisk; swings a little further forward than back, like real arms)
      const sh = ua.getWorldPosition(S.v); // shoulder joint
      const tgt = S.t.copy(sh).addScaledVector(UP, -rest.armLen * 0.93 + 0.012 * (swing / 0.15) ** 2).addScaledVector(l, s * 0.05).addScaledVector(f, 0.03 + swing); // wrist beside the thigh, a little forward
      if (e > 0) tgt.lerp(S.p.copy(bookC).addScaledVector(l, s * 0.15).addScaledVector(UP, -0.02), e); // floor: wrist at the book's edge
      const pole = S.p.copy(f).multiplyScalar(-1).addScaledVector(l, s * 0.5).addScaledVector(UP, -e * 0.6).normalize(); // elbows back and slightly out (down beside the body on the floor)
      ik2(ua, lo, hd, tgt, pole); // place the arm
      const fin = B[`${L}MiddleProximal`]; // finger root (wrist -> knuckle = "hand forward")
      if (fin) {
        S.d.copy(UP).multiplyScalar(-1).addScaledVector(f, 0.12 + swing * 0.5).multiplyScalar(up).addScaledVector(S.u.copy(f).addScaledVector(UP, 0.35).normalize(), e); // fingers down beside the thigh, or forward along the book's edge
        S.n.copy(l).multiplyScalar(-s).addScaledVector(f, -0.2).multiplyScalar(up).addScaledVector(S.u.set(0, 1, 0).addScaledVector(l, -s * 0.4), e); // palm toward the thigh, or up under the book
        orient(hd, fin.position, PALM_DOWN, S.d, S.n); // turn the hand
      }
      curlFingers(B, L, 0.75 + 0.15 * e); // relaxed fingers (curled round the book on the floor)
    }

    // Face: the same calm expression and blinking as at the desk.
    let blink = 0; // 0 open .. 1 closed
    if (!reduced) {
      if (t > blinkAt.current + 0.16) blinkAt.current = t + 2.5 + ((k + Math.floor(t)) % 5) * 0.7; // schedule the next blink
      if (t > blinkAt.current) blink = Math.sin(((t - blinkAt.current) / 0.16) * Math.PI); // quick close/open
    }
    setExpression("happy", 0); setExpression("relaxed", 0.12); setExpression("blink", blink); // soft face

    if (anchor) { B.head?.getWorldPosition(anchor); anchor.y += 0.38; } // name tag floats just above the head
  });

  if (!inst) return null; // nothing until loaded
  return (
    <>
      <primitive object={inst.i.root} />
      {/* Floor sitting: a flat reading cushion and an open book in the lap, in the same
          colours as the desk books (only shown around a floor sit). */}
      <group ref={props} visible={false}>
        <mesh position={[0, 0.035, 0.02]}><boxGeometry args={[0.62, 0.07, 0.56]} /><meshLambertMaterial color="#6e4a3a" /></mesh>
        <mesh position={[0, 0.072, 0.02]}><boxGeometry args={[0.56, 0.01, 0.5]} /><meshLambertMaterial color="#7d5543" /></mesh>
        <group position={[0, 0.45, 0.32]} rotation={[-0.55, 0, 0]}>
          <mesh rotation={[0, 0, 0.08]} position={[-0.1, 0, 0]}><boxGeometry args={[0.2, 0.012, 0.26]} /><meshLambertMaterial color="#f3ead6" /></mesh>
          <mesh rotation={[0, 0, -0.08]} position={[0.1, 0, 0]}><boxGeometry args={[0.2, 0.012, 0.26]} /><meshLambertMaterial color="#f6eedc" /></mesh>
          <mesh position={[0, -0.01, 0]}><boxGeometry args={[0.43, 0.008, 0.28]} /><meshLambertMaterial color="#6b2f28" /></mesh>
        </group>
      </group>
    </>
  );
}

// Shared input for my own walking: keys held, the on-screen pad, and the camera's orbit.
export interface WalkInput {
  keys: Set<string>; // KeyboardEvent.code values currently held (movement keys only)
  stick: { x: number; y: number }; // on-screen pad: x right, y forward, each -1..1
  yaw: number; // camera orbit around me (radians; 0 = camera looking toward +z)
  pitch: number; // camera height angle (radians above level)
  dist: number; // camera distance behind me (metres)
  lastLook: number; // performance.now() of the last manual look (pauses auto-follow)
  quick: boolean; // on-screen "Quicker" toggle (Shift does the same while held)
  floor: string | null; // sitting on the floor with this topic (null = on my feet); set by the hall
  getUp?: () => void; // called when I try to walk while sitting on the floor (the hall stands me up)
  obstacles: { x: number; z: number; r: number }[]; // people sitting on the floor right now (walk round them)
}

// Make a fresh input object for a walk that starts facing `ry` (pitch: start a little higher, e.g. to see over the chair I just left).
export function newInput(ry: number, pitch = 0.34): WalkInput {
  return { keys: new Set(), stick: { x: 0, y: 0 }, yaw: ry, pitch, dist: 3.0, lastLook: 0, quick: false, floor: null, obstacles: [] }; // camera starts right behind me
}

// Movement keys (WASD + arrows), the camera turn keys (Q/E), and Shift for a quicker walk.
export const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight"]); // codes we listen to

// Props for my own walker.
interface LocalProps {
  body: Body; // my body (shared with my WalkAvatar)
  input: WalkInput; // keys, pad and camera orbit
  onMove: (w: WalkState) => void; // every frame; the hall throttles what goes over the network
}

// Moves me and steers the follow camera. Runs before the avatars each frame (priority -1).
export function LocalWalker({ body, input, onMove }: LocalProps) {
  const { camera } = useThree(); // active camera
  const vel = useRef(new THREE.Vector2()); // current velocity on the floor (x, z)
  const lookAt = useRef<THREE.Vector3 | null>(null); // smoothed camera target
  const since = useRef(0); // seconds since walking started (first moments: slower camera glide in)
  const rise = useRef(0); // seconds left of getting up from the floor (no stepping until upright)
  const tmp = useMemo(() => ({ want: new THREE.Vector3(), pos: { x: 0, z: 0 } }), []); // scratch
  const fixedCam = useMemo(() => { if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null; const q = new URLSearchParams(window.location.search).get("walkcam"); return q ? q.split(",").map(Number) : null; }, []); // dev-only ?walkcam=x,y,z,lx,ly,lz

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return; // never in production builds
    (window as unknown as { __hhMe?: Body; __hhWalkInput?: WalkInput }).__hhMe = body; // dev-only test hook: my body on foot (position, speed, distance)
    (window as unknown as { __hhWalkInput?: WalkInput }).__hhWalkInput = input; // dev-only test hook: camera orbit for side-view checks
  }, [body, input]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1); // clamp long frames (tab switches) so nobody jumps through a desk
    since.current += dt; // time in walk mode
    const k = input.keys; // held keys
    const ix = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) + input.stick.x; // right/left
    const iy = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + input.stick.y; // forward/back
    const turn = (k.has("KeyE") ? 1 : 0) - (k.has("KeyQ") ? 1 : 0); // Q/E orbit the camera
    const floor = !!input.floor; // sitting on the floor: no walking until I get up
    if (body.floor && !floor) rise.current = 0.75; // just got up: let the body rise before the first step (seconds)
    rise.current = Math.max(0, rise.current - dt); // count down
    body.floor = floor; // the avatar eases down / up
    if (floor && (Math.abs(ix) > 0.2 || Math.abs(iy) > 0.2)) input.getUp?.(); // trying to walk: stand up first (the hall clears the floor sit)
    if (turn) { input.yaw -= turn * 1.3 * dt; input.lastLook = performance.now(); } // slow, steady turn

    // Wanted velocity, relative to where the camera looks (forward = away from the camera).
    const sy = Math.sin(input.yaw), cy = Math.cos(input.yaw); // camera heading
    const still = floor || rise.current > 0; // on the floor, or still getting up
    let dx = still ? 0 : sy * iy - cy * ix, dz = still ? 0 : cy * iy + sy * ix; // forward * iy + right * ix (right = (-cos, sin)); nothing while on the floor or rising
    const len = Math.hypot(dx, dz); // input strength
    if (len > 1) { dx /= len; dz /= len; } // diagonal is not faster
    const pace = input.quick || k.has("ShiftLeft") || k.has("ShiftRight") ? QUICK_SPEED : WALK_SPEED; // Shift / "Quicker": brisk library pace
    const tx = dx * pace, tz = dz * pace; // target velocity
    const speeding = tx * tx + tz * tz > vel.current.lengthSq(); // speeding up or slowing down?
    const a = ease(speeding ? ACCEL : DECEL, dt); // gentle start, slightly firmer stop
    vel.current.x += (tx - vel.current.x) * a; vel.current.y += (tz - vel.current.y) * a; // smooth velocity
    if (len < 0.01 && vel.current.lengthSq() < 1e-4) vel.current.set(0, 0); // fully at rest (no creeping)
    if (floor) vel.current.set(0, 0); // seated on the floor: stay put
    const ax = aisleAssist(body.x, body.z, vel.current.x, vel.current.y) - vel.current.x; // walking between desks: a gentle sideways drift toward the walkway's middle (added to this step only)

    // Step, then slide out of furniture; velocity keeps only what actually happened (glancing, never vibrating).
    const ox = body.x, oz = body.z; // before
    const p = collide(Object.assign(tmp.pos, { x: ox + (vel.current.x + ax) * dt, z: oz + vel.current.y * dt }), floor ? FLOOR_R : undefined, input.obstacles); // proposed, corrected (furniture + people on the floor; a wider footprint while kneeling on the cushion)
    body.x = p.x; body.z = p.z; // apply
    const mx = p.x - ox, mz = p.z - oz, moved = Math.hypot(mx, mz); // real displacement
    if (dt > 0) vel.current.set(mx / dt - ax, mz / dt); // into a wall = that part of the speed is gone; along it = kept (the walkway drift is not kept, so it never builds up)
    body.moved += moved; // legs follow real distance (no moonwalking against a desk)
    body.speed += (moved / Math.max(dt, 1e-4) - body.speed) * ease(10, dt); // smoothed ground speed for the animation blend
    const v = vel.current.length(); // current speed
    if (v > 0.06) body.ry += angleTo(body.ry, Math.atan2(vel.current.x, vel.current.y)) * ease(TURN * Math.min(1, v / 0.4), dt); // turn toward where I walk, gently

    // Camera: drift back behind me while I walk straight ahead and haven't looked around lately.
    if (performance.now() - input.lastLook > 1600 && iy > 0.5 && Math.abs(ix) < 0.3 && v > 0.2) input.yaw += angleTo(input.yaw, body.ry) * ease(0.9, dt); // slow recentre
    const cp = Math.cos(input.pitch), spch = Math.sin(input.pitch); // pitch parts
    const eye = floor ? 0.75 : 1.3; // camera height base: lower while sitting on the floor
    const want = tmp.want.set(body.x - Math.sin(input.yaw) * input.dist * cp, eye + input.dist * spch, body.z - Math.cos(input.yaw) * input.dist * cp); // behind and a little above
    want.x = Math.min(Math.max(want.x, ROOM.minX + 0.3), ROOM.maxX - 0.3); // stay inside the left/right walls
    want.z = Math.min(Math.max(want.z, ROOM.minZ + 0.3), ROOM.maxZ - 0.3); // and the back/front walls
    want.y = Math.min(want.y, ROOM.height - 0.4); // under the ceiling
    const cam = camera as THREE.PerspectiveCamera; // perspective camera
    if (fixedCam) { cam.position.set(fixedCam[0], fixedCam[1], fixedCam[2]); cam.lookAt(fixedCam[3], fixedCam[4], fixedCam[5]); onMove(floor ? { x: body.x, z: body.z, ry: body.ry, pose: "floor", topic: input.floor ?? "" } : { x: body.x, z: body.z, ry: body.ry, pose: body.speed > 0.08 ? "walking" : "idle" }); return; } // dev-only still camera for checking the gait from the side
    const glide = since.current < 2.5 ? 1.6 : 5; // first moments: a slow glide in from the overview or the desk
    cam.position.lerp(want, ease(glide, dt)); // follow without whipping
    if (!lookAt.current) { lookAt.current = new THREE.Vector3(); cam.getWorldDirection(lookAt.current).multiplyScalar(4).add(cam.position); } // start from where the camera already looks
    lookAt.current.lerp(S.d.set(body.x, floor ? 0.55 : 1.2, body.z), ease(glide * 1.4, dt)); // look at my shoulders (lower on the floor)
    cam.lookAt(lookAt.current); // aim
    if (Math.abs(cam.fov - 55) > 0.01) { cam.fov += (55 - cam.fov) * ease(2, dt); cam.updateProjectionMatrix(); } // settle to a natural field of view

    onMove(floor ? { x: body.x, z: body.z, ry: body.ry, pose: "floor", topic: input.floor ?? "" } : { x: body.x, z: body.z, ry: body.ry, pose: body.speed > 0.08 ? "walking" : "idle" }); // report (the hall decides what to send)
  }, -1); // before the avatars draw
  return null; // no visuals of its own
}

// Turns someone else's occasional position updates into smooth walking.
// Updates arrive a few times a second over the live channel, or about once a
// second from the database when the live channel is down. Instead of guessing
// ahead (which overshoots when they stop and then slides back), the figure is
// drawn a short, self-adjusting moment in the past and moves steadily between
// two real positions, so feet stay planted and nobody moonwalks.
type Snap = { x: number; z: number; ry: number; pose: WalkState["pose"]; at: number }; // one received position (at = when it was taken)

export function RemoteWalker({ id, body }: { id: string; body: Body }) {
  const buf = useRef<Snap[]>([]); // recent positions, oldest first
  const seen = useRef<number | null>(null); // the newest sample already taken in (by its time)
  const arrived = useRef(0); // performance.now() when the previous new sample arrived
  const lagE = useRef(0); // smoothed "how old samples are on arrival" (seconds)
  const gapE = useRef(0.4); // smoothed time between arrivals (seconds)
  const delay = useRef(0.5); // how far in the past the figure is drawn (seconds); adapts to the update rate
  const tmp = useMemo(() => ({ x: 0, z: 0 }), []); // scratch target

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1); // clamp long frames
    const s = walkers.get(id); // latest sample
    if (!s) { body.hidden = true; buf.current = []; seen.current = null; return; } // nothing yet (or they stopped walking)
    body.floor = s.pose === "floor"; // sitting on the floor (their avatar eases down / back up)
    const now = performance.now(); // this frame's time
    const b = buf.current; // shortcut
    if (seen.current !== s.at) { // a new sample arrived
      seen.current = s.at; // taken in
      if (arrived.current) gapE.current += (Math.min((now - arrived.current) / 1000, 2) - gapE.current) * 0.3; // learn the update rate
      arrived.current = now; // remember this arrival
      lagE.current += (Math.min(Math.max(now - s.at, 0) / 1000, 2) - lagE.current) * 0.3; // learn how late samples are
      const prev = b[b.length - 1]; // newest kept sample
      if (prev && s.at <= prev.at) b.length = 0; // out of order (e.g. a reload): start fresh
      else if (prev) prev.at = Math.max(prev.at, s.at - 2000); // after a long still spell, don't stretch one step over many seconds
      b.push({ x: s.x, z: s.z, ry: s.ry, pose: s.pose, at: s.at }); // keep it
      if (b.length > 8) b.shift(); // a short history is enough
    }
    delay.current += (Math.min(1.8, Math.max(0.25, lagE.current + gapE.current + 0.1)) - delay.current) * ease(1, dt); // drift gently toward "just behind the newest sample"
    const t = now - delay.current * 1000; // the moment being drawn
    // Where they were at moment t: between the two samples around it, or the
    // newest one (nudged a little ahead for at most 0.3 s if it arrived late).
    let x = b[0].x, z = b[0].z, ry = b[0].ry; // before the first sample: hold it
    const last = b[b.length - 1]; // newest sample
    if (t >= last.at) { // past the newest sample
      x = last.x; z = last.z; ry = last.ry; // hold it
      const pv = b[b.length - 2]; // the one before
      if (pv && last.pose === "walking" && last.at > pv.at) { // still moving: continue briefly at their pace
        const k = Math.min((t - last.at) / (last.at - pv.at), 0.3 / Math.max((last.at - pv.at) / 1000, 0.05)); // at most 0.3 s ahead
        x += (last.x - pv.x) * k; z += (last.z - pv.z) * k; // short, capped continuation
      }
    } else if (t > b[0].at) { // inside the history
      for (let n = 1; n < b.length; n++) {
        if (t <= b[n].at) { // samples n-1 and n bracket t
          const a = b[n - 1], c = b[n], u = (t - a.at) / Math.max(c.at - a.at, 1); // 0..1 between them
          x = a.x + (c.x - a.x) * u; z = a.z + (c.z - a.z) * u; ry = a.ry + angleTo(a.ry, c.ry) * u; // steady blend (shortest turn)
          break; // found
        }
      }
    }
    const tgt = collide(Object.assign(tmp, { x, z })); // never stand inside furniture
    if (body.hidden || Math.hypot(tgt.x - body.x, tgt.z - body.z) > 3) { body.x = tgt.x; body.z = tgt.z; body.ry = ry; body.speed = 0; body.hidden = false; } // first sight or a big jump: place them directly
    const ox = body.x, oz = body.z; // before
    const a = ease(10, dt); // light smoothing on top (rounds the corners between samples)
    body.x += (tgt.x - body.x) * a; body.z += (tgt.z - body.z) * a; // follow the drawn path
    const moved = Math.hypot(body.x - ox, body.z - oz); // real displacement this frame
    body.moved += moved; // legs follow real distance
    body.speed += (moved / Math.max(dt, 1e-4) - body.speed) * ease(8, dt); // smoothed speed for the animation blend
    body.ry += angleTo(body.ry, ry) * ease(8, dt); // turn as they turned
  }, -1); // before the avatars draw
  return null; // no visuals of its own
}
