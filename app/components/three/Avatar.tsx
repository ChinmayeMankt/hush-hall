"use client"; // three.js runs in the browser only

// A soft anime / cozy-game style seated student (~3 heads tall, not chibi).
// Face = a painted canvas texture on the head (eyes with highlights, brows,
// nose, mouth, blush). Variety comes from a seed: skin tone, hairstyle,
// clothing (hoodie / kurta / sweater). Poses: "focus" heads-down with slow
// breathing and page turns, "break" arms-up stretch with a happy face,
// "idle" upright. Reduced motion = static poses, no animation.

import { useMemo, useRef } from "react"; // memo + refs
import { useFrame } from "@react-three/fiber"; // animation loop
import * as THREE from "three"; // math + groups
import type { Phase } from "@/lib/presence/types"; // pose source
import { faceTexture, type FaceMood } from "./textures"; // painted faces

// Stable hash for per-student variety.
const hash = (s: string) => [...s].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381); // djb2

// Indian-inclusive skin tones, fair to deep.
const SKIN = ["#f3d4b5", "#e9bf98", "#d9a67c", "#c48c62", "#a8724c", "#8c5a3a", "#6e4429"]; // skin palette
const HAIR = ["#1a120e", "#2a1a12", "#3a2418", "#4a2e1c", "#20140f", "#5a3820"]; // natural dark hair
const EYES = ["#5a3a22", "#4a2e1c", "#6b4a2a", "#3a2a1a"]; // warm brown irises
const STYLES = ["short", "long", "ponytail", "bun", "curly"] as const; // hairstyles
const OUTFITS = ["hoodie", "kurta", "sweater"] as const; // clothing
const KNIT = ["#4f7a5a", "#b9862f", "#3f5a8a", "#8a4a3a", "#7a6aa8", "#c07a4a", "#5a7a8a", "#6b8a3a"]; // hoodie/sweater colours
const KURTA = ["#efe2c4", "#e0a64a", "#5a8a86", "#c9705a", "#8aa070", "#d8c0e0"]; // kurta colours
const PANTS = ["#3a3f4a", "#4a3a30", "#2f3a36", "#45403a"]; // trousers

// Props for one avatar.
interface Props {
  id: string; // member id (variety + timing seed)
  color: string; // lamp colour (mixed into the seed so tabs differ)
  phase: Phase; // pose
  position: [number, number, number]; // chair position
  facing: 1 | -1; // which way they look
  reduced: boolean; // prefers-reduced-motion
}

// Shared geometries (created once, reused by every avatar = less GPU memory).
const G = {
  hairCap: new THREE.SphereGeometry(0.202, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.4), // crown down to the brow line
  hairBack: (t: number) => new THREE.SphereGeometry(0.204, 18, 14, Math.PI, Math.PI, 0, Math.PI * t), // back of the head
  lump: new THREE.SphereGeometry(0.07, 10, 8), // bangs, bun, curls
  torso: new THREE.CapsuleGeometry(0.155, 0.2, 4, 12), // upper body
  arm: new THREE.CapsuleGeometry(0.05, 0.3, 4, 8), // sleeve
  hand: new THREE.SphereGeometry(0.045, 8, 6), // hand
  neck: new THREE.CylinderGeometry(0.05, 0.055, 0.08, 8), // neck
};
// Anime face silhouette: start from the sphere, then taper the lower half into a
// jaw and a small pointed chin. `v` (0..2) varies width/length slightly per student.
const headCache = new Map<number, THREE.BufferGeometry>(); // cached head shapes
function jawHead(v: number) {
  if (headCache.has(v)) return headCache.get(v)!; // reuse
  const g = new THREE.SphereGeometry(0.19, 28, 22); // base head (face UVs preserved)
  const taper = [0.3, 0.36, 0.42][v]; // how narrow the jaw gets at the chin
  const length = [0.04, 0.07, 0.1][v]; // how far the chin drops
  const pos = g.attributes.position as THREE.BufferAttribute; // vertex positions
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); // one vertex
    x *= 0.95; // slightly narrower face overall
    const n = -y / 0.19; // 0 at the equator -> 1 at the bottom
    const s = Math.min(1, Math.max(0, (n - 0.3) / 0.7)); // jaw starts below the cheeks (mouth level)
    const e = s * s * (3 - 2 * s); // smoothstep for a soft jawline
    x *= 1 - taper * e; // tapered jaw
    z *= z > 0 ? 1 - taper * 0.3 * e : 1 - taper * 0.7 * e; // front stays fuller; back tucks toward the neck
    y *= 1 + length * e; // a small, visible chin
    pos.setXYZ(i, x, y, z); // write back
  }
  g.computeVertexNormals(); // smooth shading on the new shape
  headCache.set(v, g); // cache
  return g; // done
}

const backCache = new Map<number, THREE.SphereGeometry>(); // back-hair shells by coverage
const back = (t: number) => { if (!backCache.has(t)) backCache.set(t, G.hairBack(t)); return backCache.get(t)!; }; // cached shell

export default function Avatar({ id, color, phase, position, facing, reduced }: Props) {
  // Pick this student's look from the seed.
  const k = useMemo(() => hash(id + color), [id, color]); // per-student seed
  const look = useMemo(() => ({
    skin: SKIN[k % SKIN.length], // skin
    hair: HAIR[(k >>> 3) % HAIR.length], // hair colour
    eye: EYES[(k >>> 5) % EYES.length], // iris colour
    style: STYLES[(k >>> 7) % STYLES.length], // hairstyle
    outfit: OUTFITS[(k >>> 10) % OUTFITS.length], // clothing
    knit: KNIT[(k >>> 12) % KNIT.length], // hoodie/sweater colour
    kurta: KURTA[(k >>> 14) % KURTA.length], // kurta colour
    pants: PANTS[(k >>> 16) % PANTS.length], // trousers
    jaw: (k >>> 18) % 3, // face shape variant
  }), [k]);
  const top = look.outfit === "kurta" ? look.kurta : look.knit; // clothing colour
  const mood: FaceMood = phase === "break" ? "happy" : phase === "focus" ? "down" : "open"; // face expression
  const face = useMemo(() => faceTexture(look.skin, mood, look.hair, look.eye), [look, mood]); // painted face
  const offset = (k % 1000) / 160; // de-sync animations between students

  // Refs to the moving parts.
  const torso = useRef<THREE.Group>(null); // breathing + lean
  const head = useRef<THREE.Group>(null); // tilt
  const armL = useRef<THREE.Group>(null); // left arm pivot at shoulder
  const armR = useRef<THREE.Group>(null); // right arm pivot at shoulder

  // Target angles per pose (radians). Negative x = arm forward.
  const pose = useMemo(() => {
    if (phase === "break") return { head: -0.12, lean: -0.1, armX: -2.7, armZ: -0.6 }; // stretch: arms up and out in a V
    if (phase === "focus") return { head: 0.38, lean: 0.12, armX: -1.05, armZ: 0.12 }; // heads-down study
    return { head: 0.08, lean: 0.02, armX: -0.55, armZ: 0.1 }; // settling in
  }, [phase]);

  // Ease toward the pose; add tiny breathing / page-turn / stretch sway.
  useFrame(({ clock }, dt) => {
    if (!torso.current || !head.current || !armL.current || !armR.current) return; // not mounted yet
    const t = clock.elapsedTime + offset; // per-student time
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 2.2); // slow ease, or snap when reduced
    const breathe = reduced ? 0 : Math.sin(t * 1.5) * 0.012; // subtle chest rise
    const sway = reduced || phase !== "break" ? 0 : Math.sin(t * 0.9) * 0.12; // slow stretch sway
    const turn = reduced || phase !== "focus" ? 0 : Math.max(0, Math.sin(t * 0.55) - 0.93) * 6; // brief page turn every ~11 s
    torso.current.scale.y = 1 + breathe; // breathing
    torso.current.rotation.x += (pose.lean - torso.current.rotation.x) * ease; // lean
    torso.current.rotation.z = sway * 0.3; // sway with the stretch
    head.current.rotation.x += (pose.head - head.current.rotation.x) * ease; // tilt
    armL.current.rotation.x += (pose.armX - armL.current.rotation.x) * ease; // left arm
    armR.current.rotation.x += (pose.armX + turn * 0.25 - armR.current.rotation.x) * ease; // right arm (+page turn)
    armL.current.rotation.z += (pose.armZ + sway - armL.current.rotation.z) * ease; // left spread
    armR.current.rotation.z += (-pose.armZ + sway - turn * 0.5 - armR.current.rotation.z) * ease; // right spread
  });

  // Hair pieces for the chosen style (all share one material).
  const hairMat = useMemo(() => new THREE.MeshLambertMaterial({ color: look.hair }), [look.hair]); // hair material
  const hair = (
    <group>
      <mesh geometry={G.hairCap} material={hairMat} position={[0, 0.006, -0.004]} />
      <mesh geometry={back(look.style === "long" ? 0.78 : look.style === "short" ? 0.6 : 0.66)} material={hairMat} />
      {/* Bangs: three soft lumps on the forehead, above the brows */}
      {[-0.08, 0, 0.08].map((x, i) => (
        <mesh key={i} geometry={G.lump} material={hairMat} position={[x, 0.135 - Math.abs(x) * 0.25, 0.15]} scale={[1.15, 0.55, 0.6]} />
      ))}
      {look.style === "long" && (
        <>
          <mesh material={hairMat} position={[0, -0.16, -0.1]}><boxGeometry args={[0.36, 0.32, 0.1]} /></mesh>
          <mesh geometry={G.arm} material={hairMat} position={[-0.19, -0.1, 0.02]} scale={[1.1, 0.9, 1]} />
          <mesh geometry={G.arm} material={hairMat} position={[0.19, -0.1, 0.02]} scale={[1.1, 0.9, 1]} />
        </>
      )}
      {look.style === "ponytail" && (
        <>
          <mesh geometry={G.lump} material={hairMat} position={[0, 0.06, -0.21]} scale={0.8} />
          <mesh geometry={G.arm} material={hairMat} position={[0, -0.12, -0.25]} rotation={[0.35, 0, 0]} scale={[1.3, 1, 1.3]} />
        </>
      )}
      {look.style === "bun" && <mesh geometry={G.lump} material={hairMat} position={[0, 0.2, -0.1]} scale={1.45} />}
      {look.style === "curly" && [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const a = (i / 8) * Math.PI * 2; // around the crown
        return <mesh key={i} geometry={G.lump} material={hairMat} position={[Math.cos(a) * 0.15, 0.12 + (i % 2) * 0.04, Math.sin(a) * 0.15 - 0.03]} scale={0.85} />;
      })}
    </group>
  );

  return (
    <group position={position} rotation={[0, facing > 0 ? 0 : Math.PI, 0]} scale={1.12}>
      {/* Legs: thighs on the seat, shins down to the floor (mostly hidden by the desk) */}
      <mesh position={[0, 0.56, 0.16]}><boxGeometry args={[0.32, 0.12, 0.38]} /><meshLambertMaterial color={look.pants} /></mesh>
      <mesh position={[0, 0.28, 0.34]}><boxGeometry args={[0.28, 0.5, 0.1]} /><meshLambertMaterial color={look.pants} /></mesh>
      {/* Upper body pivots at the hips so leaning looks natural */}
      <group ref={torso} position={[0, 0.6, 0]}>
        <mesh geometry={G.torso} position={[0, 0.22, 0]}><meshLambertMaterial color={top} /></mesh>
        {/* Clothing details */}
        {look.outfit === "kurta" && (
          <>
            <mesh position={[0, 0.02, 0.02]}><cylinderGeometry args={[0.17, 0.21, 0.14, 12]} /><meshLambertMaterial color={top} /></mesh>
            <mesh position={[0, 0.3, 0.152]}><boxGeometry args={[0.025, 0.16, 0.01]} /><meshLambertMaterial color="#b08a4a" /></mesh>
            <mesh position={[0, 0.43, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.07, 0.018, 6, 14]} /><meshLambertMaterial color="#b08a4a" /></mesh>
          </>
        )}
        {look.outfit === "hoodie" && (
          <>
            <mesh position={[0, 0.42, -0.06]} rotation={[Math.PI / 2 - 0.3, 0, 0]}><torusGeometry args={[0.1, 0.045, 8, 16]} /><meshLambertMaterial color={top} /></mesh>
            {[-0.04, 0.04].map((x) => <mesh key={x} position={[x, 0.31, 0.15]}><cylinderGeometry args={[0.006, 0.006, 0.12, 4]} /><meshLambertMaterial color="#f3ead6" /></mesh>)}
            <mesh position={[0, 0.12, 0.145]}><boxGeometry args={[0.2, 0.08, 0.02]} /><meshLambertMaterial color={new THREE.Color(top).multiplyScalar(0.85)} /></mesh>
          </>
        )}
        {look.outfit === "sweater" && (
          <mesh position={[0, 0.43, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.075, 0.025, 6, 14]} /><meshLambertMaterial color="#f3ead6" /></mesh>
        )}
        {/* Neck and head (face painted on the sphere) */}
        <mesh geometry={G.neck} position={[0, 0.46, 0]}><meshLambertMaterial color={look.skin} /></mesh>
        <group ref={head} position={[0, 0.66, 0.01]}>
          <mesh geometry={jawHead(look.jaw)}><meshLambertMaterial map={face} /></mesh>
          {/* Small ears help the head read as a face, not a ball */}
          {[-1, 1].map((sx) => <mesh key={sx} geometry={G.lump} position={[sx * 0.172, -0.02, -0.01]} scale={[0.35, 0.6, 0.45]}><meshLambertMaterial color={look.skin} /></mesh>)}
          {hair}
        </group>
        {/* Arms pivot at the shoulders */}
        <group ref={armL} position={[-0.19, 0.36, 0]}>
          <mesh geometry={G.arm} position={[0, -0.2, 0]}><meshLambertMaterial color={top} /></mesh>
          <mesh geometry={G.hand} position={[0, -0.4, 0]}><meshLambertMaterial color={look.skin} /></mesh>
        </group>
        <group ref={armR} position={[0.19, 0.36, 0]}>
          <mesh geometry={G.arm} position={[0, -0.2, 0]}><meshLambertMaterial color={top} /></mesh>
          <mesh geometry={G.hand} position={[0, -0.4, 0]}><meshLambertMaterial color={look.skin} /></mesh>
        </group>
      </group>
    </group>
  );
}
