"use client"; // three.js runs in the browser only

// An anime VRM student sitting at a desk.
// Pose comes from the student's phase: "focus" = leaning in, hands on the desk,
// head down reading; "break" = arms-up stretch with a happy face; "idle" = upright.
// Arms and legs are placed with a tiny two-bone IK so every model (tall/short)
// sits on the chair with hands on the desk and feet on the floor, without clipping.
// Blinks + slow breathing; reduced motion = one static pose, no blinking.
// If the model fails to load we fall back to the low-poly avatar.

import { useEffect, useMemo, useRef, useState } from "react"; // React hooks
import { useFrame, useThree } from "@react-three/fiber"; // render loop
import * as THREE from "three"; // math
import type { Phase } from "@/lib/presence/types"; // pose source
import LowPolyAvatar from "./Avatar"; // fallback
import { FINGERS, boneOf, loadTemplate, instantiate, type Instance } from "./vrm"; // VRM loading + clones + finger names
import { hash, modelFor } from "./models"; // shared character picker (also used to prefetch)
import { parseLook } from "./looks"; // wardrobe choices

// Indian-inclusive skin tints (multiplied over the VRoid skin texture; null = original).
export const SKIN_TINTS = [null, "#f1d2bd", "#dcae8e", "#c08a68", "#a8775a"]; // fair -> brown
// Natural hair tints (null = model's own colour).
export const HAIR_TINTS = [null, null, "#3a2a22", "#2a1e18", "#5a4030"]; // keep some originals, darken others

const TOP_Y = 0.76; // desk top height (matches Desks.tsx)
const SEAT_Y = 0.52; // chair seat top

// Props match the low-poly avatar so Hall3D can swap them.
interface Props {
  id: string; // member id (seed)
  name?: string; // display name (demo students get a fixed character)
  simple?: boolean; // over the GPU budget: draw the low-poly avatar instead
  color: string; // lamp colour (seed)
  phase: Phase; // pose
  position: [number, number, number]; // chair centre on the floor
  facing: 1 | -1; // +1 looks toward +z
  reduced: boolean; // prefers-reduced-motion
  look?: string; // wardrobe choices (looks.ts string; empty = the character as approved)
}

// Scratch objects (reused every frame, no garbage).
const V = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), e: new THREE.Vector3(), pole: new THREE.Vector3() }; // vectors
const Q = { p: new THREE.Quaternion(), q: new THREE.Quaternion() }; // quaternions
const T = { t: new THREE.Vector3(), p: new THREE.Vector3(), s: new THREE.Vector3() }; // pose targets (separate from the IK scratch)

// Point a bone so its child lies along world direction `dir`.
export function aim(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) { // exported: the walking figure reuses it
  bone.parent!.getWorldQuaternion(Q.p); // parent orientation
  const local = V.e.copy(dir).applyQuaternion(Q.p.invert()).normalize(); // dir in parent space
  const rest = V.d.copy(child.position).normalize(); // rest direction (rest rotations are identity)
  bone.quaternion.setFromUnitVectors(rest, local); // shortest rotation
  bone.updateWorldMatrix(false, true); // refresh this branch
}

// Turn a bone so two of its rest directions land on two world directions:
// `restF` (e.g. wrist -> middle knuckle) goes along `f`, and `restN`
// (e.g. palm normal) goes as close to `n` as possible. Unlike aim(), this also
// fixes the roll, so a palm can be told to face down instead of sideways.
const W = { f: new THREE.Vector3(), n: new THREE.Vector3(), x: new THREE.Vector3(), rf: new THREE.Vector3(), rn: new THREE.Vector3(), rx: new THREE.Vector3(), mw: new THREE.Matrix4(), mr: new THREE.Matrix4(), q: new THREE.Quaternion() }; // own scratch (aim/ik2 use V)
export function orient(bone: THREE.Object3D, restF: THREE.Vector3, restN: THREE.Vector3, f: THREE.Vector3, n: THREE.Vector3) { // exported: hands hang naturally while walking
  bone.parent!.getWorldQuaternion(W.q).invert(); // world -> parent space
  const lf = W.f.copy(f).applyQuaternion(W.q).normalize(); // wanted forward, in parent space
  const ln = W.n.copy(n).applyQuaternion(W.q); // wanted normal, in parent space
  ln.addScaledVector(lf, -ln.dot(lf)).normalize(); // make it exactly perpendicular to forward
  W.mw.makeBasis(lf, ln, W.x.crossVectors(lf, ln)); // wanted frame
  const rf = W.rf.copy(restF).normalize(); // rest forward (rest rotations are identity)
  const rn = W.rn.copy(restN).addScaledVector(rf, -restN.dot(rf)).normalize(); // rest normal, perpendicular
  W.mr.makeBasis(rf, rn, W.rx.crossVectors(rf, rn)); // rest frame
  bone.quaternion.setFromRotationMatrix(W.mw.multiply(W.mr.transpose())); // rotation taking rest frame to wanted frame
  bone.updateWorldMatrix(false, true); // refresh this branch
}

// Relaxed finger curl per joint (radians), knuckle -> tip. A resting human hand
// is never flat: fingers bend gently, the little finger a bit more than the index.
const CURL = { Thumb: [0.15, 0.2, 0.15], Index: [0.3, 0.35, 0.2], Middle: [0.35, 0.4, 0.25], Ring: [0.4, 0.45, 0.25], Little: [0.45, 0.5, 0.3] } as const; // per finger, per joint
export const PALM_DOWN = new THREE.Vector3(0, -1, 0); // VRoid T-pose: palms face the floor at rest
const AX = new THREE.Vector3(); // scratch curl axis

// Bend every finger of one hand toward the palm by `amount` x CURL.
export function curlFingers(B: Instance["bones"], L: "left" | "right", amount: number) { // exported: relaxed hands while walking too
  for (const f of FINGERS) {
    for (let j = 0; j < 3; j++) {
      const bone = B[boneOf(L, f, j)]; // this joint
      if (!bone) continue; // model without that joint
      const next = B[boneOf(L, f, Math.min(j + 1, 2))]; // the joint after it (tip uses its own)
      const dir = (next && next !== bone ? next.position : bone.position); // which way this finger segment points at rest
      AX.crossVectors(dir, PALM_DOWN).normalize(); // turning about this axis moves the segment toward the palm
      bone.quaternion.setFromAxisAngle(AX, CURL[f][j] * amount); // bend
    }
  }
  // Thumb: at rest it sticks out sideways (T-pose). Swing it part-way toward the
  // index finger, the way a relaxed thumb lies alongside the hand.
  const th = B[`${L}ThumbMetacarpal`], ti = B[`${L}ThumbProximal`], mid = B[`${L}MiddleProximal`]; // thumb root, its next joint, hand direction
  if (th && ti && mid) {
    const tuck = TQ.setFromUnitVectors(TV.a.copy(ti.position).normalize(), TV.b.copy(mid.position).normalize()); // full swing: thumb pointing where the fingers point
    th.quaternion.premultiply(TQ2.identity().slerp(tuck, 0.45 * amount)); // apply part of it, after the small curl
  }
}
const TQ = new THREE.Quaternion(), TQ2 = new THREE.Quaternion(); // thumb scratch rotations
const TV = { a: new THREE.Vector3(), b: new THREE.Vector3() }; // thumb scratch vectors

// Two-bone IK: root -> mid -> end reaching `target`, elbow/knee bending toward `pole`.
export function ik2(root: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3) { // exported: legs and arms of the walking figure
  root.updateWorldMatrix(true, false); // fresh parents
  const s = root.getWorldPosition(V.a); // shoulder / hip
  const a = mid.position.length() * root.getWorldScale(V.b).x; // upper length
  const b = end.position.length() * root.getWorldScale(V.b).x; // lower length
  const to = V.b.copy(target).sub(s); // shoulder -> target
  const d = Math.min(Math.max(to.length(), Math.abs(a - b) + 1e-3), a + b - 1e-3); // reachable distance
  const u = to.normalize(); // unit direction
  const cosA = (a * a + d * d - b * b) / (2 * a * d); // law of cosines
  const n = V.c.copy(pole).sub(V.d.copy(u).multiplyScalar(pole.dot(u))).normalize(); // bend direction ⟂ u
  const elbow = V.pole.copy(s).addScaledVector(u, a * cosA).addScaledVector(n, a * Math.sqrt(Math.max(0, 1 - cosA * cosA))); // joint
  aim(root, mid, V.d.copy(elbow).sub(s)); // upper bone
  const reach = V.c.copy(s).addScaledVector(u, d); // clamped target
  aim(mid, end, reach.sub(mid.getWorldPosition(V.a))); // lower bone
}

export default function VrmAvatar(props: Props) {
  const { id, name, simple, color, phase, position, facing, reduced, look } = props; // inputs
  const k = useMemo(() => hash(id + color), [id, color]); // seed
  const model = modelFor(id, color, name); // which character (same rule the page prefetches with)
  const [inst, setInst] = useState<Instance | null>(null); // loaded clone
  const [failed, setFailed] = useState(false); // load error -> fallback
  const invalidate = useThree((s) => s.invalidate); // redraw on demand (reduced motion)

  // Load (shared) and clone with this student's tint.
  useEffect(() => {
    if (simple) return; // no download needed
    let live = true; // ignore late results after unmount
    loadTemplate(model.file).then((t) => {
      if (!live) return;
      const skin = SKIN_TINTS[(k >>> 4) % SKIN_TINTS.length]; // skin tint
      const hair = HAIR_TINTS[(k >>> 8) % HAIR_TINTS.length]; // hair tint
      setInst(instantiate(t, { skin: skin ? new THREE.Color(skin) : undefined, hair: hair ? new THREE.Color(hair) : undefined }, parseLook(look))); // own bones, dressed as they chose
      invalidate(); // show it
    }).catch((e) => { console.warn("VRM load failed, using low-poly avatar", e); if (live) setFailed(true); }); // fallback
    return () => { live = false; };
  }, [model.file, k, invalidate, simple, look]); // a wardrobe change re-dresses the clone

  const t0 = useMemo(() => (k % 1000) / 100, [k]); // per-student time offset
  const blinkAt = useRef(2 + (k % 3)); // next blink time

  // Pose every frame (or once when reduced).
  const pose = (t: number) => {
    if (!inst) return;
    const { bones: B, root, sign } = inst; // shortcuts
    const brk = phase === "break", foc = phase === "focus"; // which pose
    const breath = reduced ? 0 : Math.sin((t + t0) * 1.3) * 0.012; // slow breathing
    const lean = (brk ? -0.12 : foc ? 0.22 : 0.1) + breath; // spine lean (radians, + = forward); a little more upright than before so the face isn't hidden
    const set = (b: THREE.Object3D | undefined, x: number, y = 0, z = 0) => b?.rotation.set(x * sign, y, z * sign); // body-frame -> raw frame
    set(B.hips, 0); set(B.spine, lean * 0.5); set(B.chest, lean * 0.3); set(B.upperChest, lean * 0.2); // curved back
    const sway = reduced ? 0 : Math.sin((t + t0) * 0.4) * 0.04; // tiny head drift
    set(B.neck, brk ? -0.1 : foc ? 0.06 : 0.03); set(B.head, brk ? -0.15 : foc ? 0.08 : 0.02, sway, 0); // head only slightly bowed, so the face (and eyes) stay visible from across the hall
    const gaze = brk ? 0 : foc ? 0.12 : 0.05; // eyes glance down at the book instead of the whole head dropping (small, so the eyes stay open-looking)
    // Tiny reading saccades: every couple of seconds the eyes hop a little along the
    // line (and now and then back to its start), like someone actually reading,
    // so a close-up never looks frozen. Small enough to stay calm.
    const beat = Math.floor((t + t0) / 2.2); // which "word group" we're on
    const hop = reduced || brk ? 0 : ((((k + beat * 7919) >>> 0) % 5) - 2) * 0.025; // -0.05..0.05 rad, stepped
    set(B.leftEye, gaze, hop); set(B.rightEye, gaze, hop); // both eyes look down together
    root.updateWorldMatrix(true, true); // refresh before IK
    // World helpers: forward/right for this seat.
    const fx = (side: number, fwd: number, y: number) => V.b.set(position[0] + side * facing, y, position[2] + fwd * facing); // side>0 = student's left
    // Legs: thighs on the seat, feet flat on the floor in front of the chair.
    for (const s of [1, -1] as const) {
      const L = s > 0 ? "left" : "right"; // side name
      const up = B[`${L}UpperLeg`], lo = B[`${L}LowerLeg`], ft = B[`${L}Foot`]; // chain
      if (!up || !lo || !ft) continue;
      const tgt = T.t.copy(fx(s * 0.11, 0.5, inst.barefoot ? inst.ankleY : 0.08)); // ankle target (barefoot: at the character's own ankle height, so bare soles rest on the floor)
      ik2(up, lo, ft, tgt, T.p.set(0, 0.2, facing).normalize()); // knee goes forward/up
      ft.rotation.set(0, 0, 0); // flat-ish foot
    }
    // Arms: on the desk (focus/idle) or stretched up (break).
    const page = foc && !reduced ? Math.max(0, Math.sin((t + t0) * 0.35)) ** 12 : 0; // occasional page turn
    for (const s of [1, -1] as const) {
      const L = s > 0 ? "left" : "right"; // side name
      const up = B[`${L}UpperArm`], lo = B[`${L}LowerArm`], hd = B[`${L}Hand`]; // chain
      if (!up || !lo || !hd) continue;
      const tgt = T.t, pole = T.p; // hand target + elbow hint (reused vectors)
      if (brk) {
        const shY = up.getWorldPosition(T.s).y; // shoulder height
        tgt.copy(fx(s * 0.17, -0.04, shY + 0.75)); // hands reaching up above the head (arms nearly straight)
        pole.set(s * facing, 0, -facing * 0.3).normalize(); // elbows out
      } else {
        const turn = s < 0 ? page : 0; // right hand turns pages
        tgt.copy(fx(s * (0.16 - turn * 0.1), 0.37 + turn * 0.08, TOP_Y + 0.045 + turn * 0.06)); // wrists resting just past the desk edge, just above the wood
        pole.set(s * facing * 0.9, -1, -facing * 0.4).normalize(); // elbows down and slightly out
      }
      ik2(up, lo, hd, tgt, pole); // place arm
      const fin = B[`${L}MiddleProximal`]; // finger root (wrist -> middle knuckle = "hand forward")
      if (fin && !brk) {
        const fwd = V.b.set(-s * facing * 0.3, 0.02, facing); // fingers point forward and a little inward; level, so the curled fingertips meet the desk instead of sinking into it
        const palm = V.c.set(-s * facing * 0.35, -1, 0); // palm faces the desk, rolled a little toward the body's centre (pinky edge lower, like a resting hand)
        orient(hd, fin.position, PALM_DOWN, fwd, palm); // set wrist direction and roll together (fixes the sideways "claw" palms)
      } else hd.rotation.set(0, 0, 0); // open hands up high
      curlFingers(B, L, brk ? 0.4 : 1); // relaxed, gently bent fingers (looser while stretching)
    }
    // Face: blink every few seconds; smile on break.
    let blink = 0; // 0 open .. 1 closed
    if (!reduced) {
      if (t > blinkAt.current + 0.16) blinkAt.current = t + 2.5 + ((k + Math.floor(t)) % 5) * 0.7; // schedule next
      if (t > blinkAt.current) blink = Math.sin(((t - blinkAt.current) / 0.16) * Math.PI); // quick close/open
    }
    inst.setExpression("happy", brk ? 1 : 0); // ^^ happy stretch
    inst.setExpression("relaxed", brk ? 0 : 0.15); // soft, calm face while studying (lighter, so the eyes don't look half-shut)
    inst.setExpression("blink", brk ? 0 : blink); // blink
  };

  // Place the clone on the chair, facing the desk.
  useEffect(() => {
    if (!inst) return;
    const { root, sign, hipsY } = inst; // shortcuts
    root.position.set(position[0], SEAT_Y + 0.09 - hipsY, position[2] + facing * 0.05); // hips just above the seat, sitting toward the front edge
    root.rotation.set(0, (sign < 0 ? Math.PI : 0) + (facing > 0 ? 0 : Math.PI), 0); // VRM0 faces -z
    pose(0); invalidate(); // initial pose
  }, [inst, position[0], position[2], facing, phase, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock }) => { if (!reduced) pose(clock.elapsedTime); }); // animate (skipped when reduced)

  if (failed || simple) return <LowPolyAvatar {...props} />; // graceful fallback / over budget
  return inst ? <primitive object={inst.root} /> : null; // nothing until loaded
}
