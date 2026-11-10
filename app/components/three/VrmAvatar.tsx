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
import { MODELS, loadTemplate, instantiate, type Instance } from "./vrm"; // VRM loading + clones

// Stable hash for per-student variety (same as the low-poly avatar).
const hash = (s: string) => [...s].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381); // djb2

// Fixed characters for the demo students so names and looks match (index into MODELS).
const DEMO_LOOKS: Record<string, number> = { Aarav: 2, Meera: 1, Kabir: 4, Isha: 6, Rohan: 2, Tara: 0, Zoya: 3 }; // name -> model

// Indian-inclusive skin tints (multiplied over the VRoid skin texture; null = original).
const SKIN_TINTS = [null, "#f1d2bd", "#dcae8e", "#c08a68", "#a8775a"]; // fair -> brown
// Natural hair tints (null = model's own colour).
const HAIR_TINTS = [null, null, "#3a2a22", "#2a1e18", "#5a4030"]; // keep some originals, darken others

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
}

// Scratch objects (reused every frame, no garbage).
const V = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), e: new THREE.Vector3(), pole: new THREE.Vector3() }; // vectors
const Q = { p: new THREE.Quaternion(), q: new THREE.Quaternion() }; // quaternions
const T = { t: new THREE.Vector3(), p: new THREE.Vector3(), s: new THREE.Vector3() }; // pose targets (separate from the IK scratch)

// Point a bone so its child lies along world direction `dir`.
function aim(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) {
  bone.parent!.getWorldQuaternion(Q.p); // parent orientation
  const local = V.e.copy(dir).applyQuaternion(Q.p.invert()).normalize(); // dir in parent space
  const rest = V.d.copy(child.position).normalize(); // rest direction (rest rotations are identity)
  bone.quaternion.setFromUnitVectors(rest, local); // shortest rotation
  bone.updateWorldMatrix(false, true); // refresh this branch
}

// Two-bone IK: root -> mid -> end reaching `target`, elbow/knee bending toward `pole`.
function ik2(root: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3) {
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
  const { id, name, simple, color, phase, position, facing, reduced } = props; // inputs
  const k = useMemo(() => hash(id + color), [id, color]); // seed
  const model = MODELS[name && name in DEMO_LOOKS ? DEMO_LOOKS[name] : k % MODELS.length]; // which character
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
      setInst(instantiate(t, { skin: skin ? new THREE.Color(skin) : undefined, hair: hair ? new THREE.Color(hair) : undefined })); // own bones
      invalidate(); // show it
    }).catch((e) => { console.warn("VRM load failed, using low-poly avatar", e); if (live) setFailed(true); }); // fallback
    return () => { live = false; };
  }, [model.file, k, invalidate, simple]);

  const t0 = useMemo(() => (k % 1000) / 100, [k]); // per-student time offset
  const blinkAt = useRef(2 + (k % 3)); // next blink time

  // Pose every frame (or once when reduced).
  const pose = (t: number) => {
    if (!inst) return;
    const { bones: B, root, sign } = inst; // shortcuts
    const brk = phase === "break", foc = phase === "focus"; // which pose
    const breath = reduced ? 0 : Math.sin((t + t0) * 1.3) * 0.012; // slow breathing
    const lean = (brk ? -0.12 : foc ? 0.3 : 0.12) + breath; // spine lean (radians, + = forward)
    const set = (b: THREE.Object3D | undefined, x: number, y = 0, z = 0) => b?.rotation.set(x * sign, y, z * sign); // body-frame -> raw frame
    set(B.hips, 0); set(B.spine, lean * 0.5); set(B.chest, lean * 0.3); set(B.upperChest, lean * 0.2); // curved back
    const sway = reduced ? 0 : Math.sin((t + t0) * 0.4) * 0.04; // tiny head drift
    set(B.neck, brk ? -0.1 : foc ? 0.12 : 0.05); set(B.head, brk ? -0.15 : foc ? 0.16 : 0.04, sway, 0); // eyes down at the book, face still visible
    root.updateWorldMatrix(true, true); // refresh before IK
    // World helpers: forward/right for this seat.
    const fx = (side: number, fwd: number, y: number) => V.b.set(position[0] + side * facing, y, position[2] + fwd * facing); // side>0 = student's left
    // Legs: thighs on the seat, feet flat on the floor in front of the chair.
    for (const s of [1, -1] as const) {
      const L = s > 0 ? "left" : "right"; // side name
      const up = B[`${L}UpperLeg`], lo = B[`${L}LowerLeg`], ft = B[`${L}Foot`]; // chain
      if (!up || !lo || !ft) continue;
      const tgt = T.t.copy(fx(s * 0.11, 0.5, 0.08)); // ankle target
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
        tgt.copy(fx(s * (0.16 - turn * 0.1), 0.37 + turn * 0.08, TOP_Y + 0.05 + turn * 0.06)); // wrists resting just past the desk edge
        pole.set(s * facing * 0.9, -1, -facing * 0.4).normalize(); // elbows down and slightly out
      }
      ik2(up, lo, hd, tgt, pole); // place arm
      const fin = B[`${L}MiddleProximal`]; // finger root
      if (fin && !brk) aim(hd, fin, V.b.set(-s * facing * 0.25, -0.04, facing).normalize()); // palm flat on the desk, fingers forward and a little inward
      else hd.rotation.set(0, 0, 0); // open hands up high
    }
    // Face: blink every few seconds; smile on break.
    let blink = 0; // 0 open .. 1 closed
    if (!reduced) {
      if (t > blinkAt.current + 0.16) blinkAt.current = t + 2.5 + ((k + Math.floor(t)) % 5) * 0.7; // schedule next
      if (t > blinkAt.current) blink = Math.sin(((t - blinkAt.current) / 0.16) * Math.PI); // quick close/open
    }
    inst.setExpression("happy", brk ? 1 : 0); // ^^ happy stretch
    inst.setExpression("relaxed", brk ? 0 : 0.3); // soft, calm face while studying
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
