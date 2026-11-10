"use client"; // three.js runs in the browser only

// The library room: plank floor, green rugs, panelled walls, tall bookshelves,
// arched night windows with optional moving rain, brass wall sconces and plants.
// Everything is low-poly boxes/cylinders; books are a single instanced mesh.

import { useMemo, useRef } from "react"; // memo + refs
import { useFrame } from "@react-three/fiber"; // per-frame updates
import { Instances, Instance } from "@react-three/drei"; // instancing helpers
import * as THREE from "three"; // geometry helpers
import { ROOM } from "./layout"; // room bounds
import { plankTexture, rainGlassTexture, rugTexture } from "./textures"; // procedural textures

// Shared colours for the room.
const WALL = "#4a3020"; // dark walnut panelling
const WOOD = "#6b4428"; // shelf wood
const TRIM = "#3a2416"; // darker trim

// One bookshelf: frame plus a block of instanced books in seeded colours.
function Bookshelf({ position, rotationY = 0, width = 3.2, height = 4.2 }: { position: [number, number, number]; rotationY?: number; width?: number; height?: number }) {
  const shelves = 6; // shelf levels
  const books = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number]; c: THREE.Color }[] = []; // book list
    let seed = Math.abs(Math.round(position[0] * 13 + position[2] * 7)) + 1; // stable per shelf
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); // Park-Miller random
    const palette = ["#7a2e2a", "#2f4a3a", "#8a6a3a", "#3b4a6b", "#5a3a2a", "#a37b4a", "#4d5e3a", "#6b3b4a"]; // muted cloth bindings
    for (let s = 0; s < shelves; s++) {
      let x = -width / 2 + 0.12; // start at the left of the shelf
      while (x < width / 2 - 0.2) {
        const w = 0.07 + rnd() * 0.07; // spine thickness
        const h = 0.38 + rnd() * 0.2; // book height
        if (rnd() > 0.06) out.push({ p: [x + w / 2, 0.08 + s * (height / shelves) + h / 2, 0], s: [w, h, 0.28], c: new THREE.Color(palette[Math.floor(rnd() * palette.length)]) }); // most slots have a book
        x += w + 0.008; // next spine
      }
    }
    return out; // all books on this shelf
  }, [position, width, height]);

  // Write book transforms and colours into one instanced mesh.
  const ref = useRef<THREE.InstancedMesh>(null); // instanced books
  const ready = useRef(false); // fill once
  useFrame(() => {
    if (ready.current || !ref.current) return; // already filled
    const m = new THREE.Matrix4(); // scratch matrix
    books.forEach((b, i) => {
      m.compose(new THREE.Vector3(...b.p), new THREE.Quaternion(), new THREE.Vector3(...b.s)); // place + size
      ref.current!.setMatrixAt(i, m); // write matrix
      ref.current!.setColorAt(i, b.c); // write colour
    });
    ref.current.instanceMatrix.needsUpdate = true; // upload matrices
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true; // upload colours
    ready.current = true; // done
  });

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Back board and sides */}
      <mesh position={[0, height / 2, -0.17]}><boxGeometry args={[width, height, 0.04]} /><meshLambertMaterial color={TRIM} /></mesh>
      <mesh position={[-width / 2, height / 2, 0]}><boxGeometry args={[0.08, height, 0.38]} /><meshLambertMaterial color={WOOD} /></mesh>
      <mesh position={[width / 2, height / 2, 0]}><boxGeometry args={[0.08, height, 0.38]} /><meshLambertMaterial color={WOOD} /></mesh>
      {/* Shelf boards (one draw call per bookshelf) */}
      <Instances limit={shelves + 1}>
        <boxGeometry args={[width, 0.05, 0.38]} />
        <meshLambertMaterial color={WOOD} />
        {Array.from({ length: shelves + 1 }, (_, s) => <Instance key={s} position={[0, 0.04 + s * (height / shelves), 0]} />)}
      </Instances>
      {/* Books (one draw call) */}
      <instancedMesh ref={ref} args={[undefined, undefined, books.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial />
      </instancedMesh>
    </group>
  );
}

// Arched window: frame, mullions and night glass; rain scrolls only if enabled.
function ArchedWindow({ position, rain, reduced, glass, rotationY = 0 }: { position: [number, number, number]; rain: boolean; reduced: boolean; glass: THREE.Texture; rotationY?: number }) {
  const tex = useMemo(() => { const t = glass.clone(); t.needsUpdate = true; return t; }, [glass]); // own copy so offsets differ
  useFrame((_, dt) => {
    if (rain && !reduced) tex.offset.y += dt * 0.12; // slow drifting rain
  });
  const w = 1.8; // window width
  const h = 2.6; // straight part height
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Glass: rectangle plus half-disc arch */}
      <mesh position={[0, h / 2, 0]}><planeGeometry args={[w, h]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
      <mesh position={[0, h, 0]}><circleGeometry args={[w / 2, 24, 0, Math.PI]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
      {/* Frame and mullions */}
      <mesh position={[0, -0.05, 0.03]}><boxGeometry args={[w + 0.2, 0.12, 0.12]} /><meshLambertMaterial color={TRIM} /></mesh>
      <mesh position={[-w / 2 - 0.05, h / 2, 0.03]}><boxGeometry args={[0.1, h, 0.1]} /><meshLambertMaterial color={TRIM} /></mesh>
      <mesh position={[w / 2 + 0.05, h / 2, 0.03]}><boxGeometry args={[0.1, h, 0.1]} /><meshLambertMaterial color={TRIM} /></mesh>
      <mesh position={[0, h / 2 + 0.4, 0.03]}><boxGeometry args={[0.05, h + 0.8, 0.05]} /><meshLambertMaterial color={TRIM} /></mesh>
      {[0.6, 1.3, 2.0].map((y) => (
        <mesh key={y} position={[0, y, 0.03]}><boxGeometry args={[w, 0.04, 0.05]} /><meshLambertMaterial color={TRIM} /></mesh>
      ))}
      <mesh position={[0, h, 0.03]}><torusGeometry args={[w / 2 + 0.03, 0.05, 6, 24, Math.PI]} /><meshLambertMaterial color={TRIM} /></mesh>
    </group>
  );
}

// Brass wall sconce with a warm emissive bulb (light itself is added in Hall3D).
function Sconce({ position, rotationY = 0 }: { position: [number, number, number]; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh><boxGeometry args={[0.12, 0.3, 0.04]} /><meshLambertMaterial color="#a9803c" /></mesh>
      <mesh position={[0, 0.12, 0.14]}><sphereGeometry args={[0.09, 10, 8]} /><meshBasicMaterial color="#ffd28a" toneMapped={false} /></mesh>
      <mesh position={[0, 0.2, 0.14]}><cylinderGeometry args={[0.06, 0.12, 0.14, 10, 1, true]} /><meshLambertMaterial color="#e8c88a" side={THREE.DoubleSide} emissive="#a06a20" /></mesh>
    </group>
  );
}

// Potted plant: terracotta pot with a few leafy low-poly blobs.
function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.28, 0.2, 0.5, 10]} /><meshLambertMaterial color="#8a5236" /></mesh>
      {[[0, 0.75, 0, 0.32], [0.18, 0.95, 0.05, 0.24], [-0.16, 0.9, -0.06, 0.26], [0.02, 1.15, 0, 0.2]].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]}><icosahedronGeometry args={[r, 0]} /><meshLambertMaterial color={i % 2 ? "#4f7a43" : "#3e6638"} flatShading /></mesh>
      ))}
    </group>
  );
}

// The whole room. `closed` adds the near walls, only needed in first-person view.
export default function Room({ rain, reduced, closed }: { rain: boolean; reduced: boolean; closed: boolean }) {
  const planks = useMemo(() => plankTexture(), []); // floor texture
  const rug = useMemo(() => rugTexture(), []); // rug texture
  const glass = useMemo(() => rainGlassTexture(), []); // window texture
  const W = ROOM.maxX - ROOM.minX; // room width
  const D = ROOM.maxZ - ROOM.minZ; // room depth
  const cx = (ROOM.maxX + ROOM.minX) / 2; // centre x
  const cz = (ROOM.maxZ + ROOM.minZ) / 2; // centre z
  return (
    <group>
      {/* Floor and two rugs under the table pairs */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]}><planeGeometry args={[W, D]} /><meshLambertMaterial map={planks} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, -4]}><planeGeometry args={[16.5, 4.6]} /><meshLambertMaterial map={rug} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 2]}><planeGeometry args={[16.5, 4.6]} /><meshLambertMaterial map={rug} /></mesh>

      {/* Back wall: panelling, three arched windows between bookshelves */}
      <mesh position={[cx, ROOM.height / 2, ROOM.minZ]}><boxGeometry args={[W, ROOM.height, 0.2]} /><meshLambertMaterial color={WALL} /></mesh>
      <mesh position={[cx, 1.0, ROOM.minZ + 0.12]}><boxGeometry args={[W, 0.08, 0.06]} /><meshLambertMaterial color={TRIM} /></mesh>
      {[-4.6, 0, 4.6].map((x) => <ArchedWindow key={x} position={[x, 1.3, ROOM.minZ + 0.11]} rain={rain} reduced={reduced} glass={glass} />)}
      {[-8.4, -2.3, 2.3, 8.4].map((x) => <Bookshelf key={x} position={[x, 0, ROOM.minZ + 0.32]} width={x === -2.3 || x === 2.3 ? 2.2 : 3.4} />)}

      {/* Left wall: long run of bookshelves with sconces above */}
      <mesh position={[ROOM.minX, ROOM.height / 2, cz]}><boxGeometry args={[0.2, ROOM.height, D]} /><meshLambertMaterial color={WALL} /></mesh>
      {[-5.2, -1.6, 2.0, 5.6].map((z) => <Bookshelf key={z} position={[ROOM.minX + 0.32, 0, z]} rotationY={Math.PI / 2} width={3.4} />)}
      {[-3.4, 3.8].map((z) => <Sconce key={z} position={[ROOM.minX + 0.14, 4.6, z]} rotationY={Math.PI / 2} />)}
      {[-6.5, 6.5].map((x) => <Sconce key={x} position={[x, 4.6, ROOM.minZ + 0.14]} />)}

      {/* Plants in the corners and by the windows */}
      <Plant position={[ROOM.minX + 0.7, 0, ROOM.minZ + 0.9]} scale={1.3} />
      <Plant position={[-6.6, 0, ROOM.minZ + 0.7]} />
      <Plant position={[6.6, 0, ROOM.minZ + 0.7]} />
      <Plant position={[ROOM.maxX - 0.8, 0, ROOM.minZ + 0.9]} scale={1.2} />

      {/* Near walls only when seated (they would block the overview camera) */}
      {closed && (
        <group>
          <mesh position={[ROOM.maxX, ROOM.height / 2, cz]}><boxGeometry args={[0.2, ROOM.height, D]} /><meshLambertMaterial color={WALL} /></mesh>
          {[-4.6, 0, 4.6].map((z) => <ArchedWindow key={z} position={[ROOM.maxX - 0.11, 1.3, z]} rotationY={-Math.PI / 2} rain={rain} reduced={reduced} glass={glass} />)}
          <mesh position={[cx, ROOM.height / 2, ROOM.maxZ]}><boxGeometry args={[W, ROOM.height, 0.2]} /><meshLambertMaterial color={WALL} /></mesh>
          {[-7.5, -3.8, 3.8, 7.5].map((x) => <Bookshelf key={x} position={[x, 0, ROOM.maxZ - 0.32]} rotationY={Math.PI} width={3.4} />)}
          <mesh position={[cx, ROOM.height, cz]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[W, D]} /><meshLambertMaterial color="#3a2618" /></mesh>
        </group>
      )}
    </group>
  );
}
