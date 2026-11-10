"use client"; // three.js runs in the browser only

// All 24 desks, chairs and banker's lamps. Repeated parts use drei <Instances>
// so each part type is one draw call. Occupied desks get a lit lamp and an
// open book; vacant desks get a dimmer lamp and a chair pushed out.

import { useMemo } from "react"; // memo
import { Instances, Instance } from "@react-three/drei"; // instancing helpers
import * as THREE from "three"; // blending constants
import type { ThreeEvent } from "@react-three/fiber"; // pointer event type
import { PLACES } from "./layout"; // seat positions
import { glowTexture, plaqueTexture, shadowTexture } from "./textures"; // procedural textures

// Shared dimensions (metres).
const TOP_Y = 0.76; // desk top height
const DESK_W = 1.7; // desk width
const DESK_D = 0.86; // desk depth

// Props: which desks are taken, which is mine, which is hovered, and handlers.
interface Props {
  occupied: Set<string>; // seats with someone in them
  mine: string | null; // my seat, if any
  hovered: string | null; // desk under the pointer
  firstPerson: boolean; // seated camera mode
  onHover: (seat: string | null) => void; // pointer over / out
  onPick: (seat: string) => void; // click / tap
}

// Small stable hash so each desk gets the same props (laptop vs book) every load.
const h = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7); // string hash

export default function Desks({ occupied, mine, hovered, firstPerson, onHover, onPick }: Props) {
  const glow = useMemo(() => glowTexture(), []); // lamp light pool
  const shadow = useMemo(() => shadowTexture(), []); // contact shadow
  const plaques = useMemo(() => new Map(PLACES.map((p) => [p.seat, plaqueTexture(p.seat)])), []); // one small texture per desk

  return (
    <group>
      {/* Desk tops (one draw call) */}
      <Instances limit={PLACES.length}>
        <boxGeometry args={[DESK_W, 0.07, DESK_D]} />
        <meshLambertMaterial color="#8a5a34" />
        {PLACES.map((p) => <Instance key={p.seat} position={[p.x, TOP_Y, p.deskZ]} />)}
      </Instances>

      {/* Side panels: two per desk */}
      <Instances limit={PLACES.length * 2}>
        <boxGeometry args={[0.07, TOP_Y, DESK_D - 0.06]} />
        <meshLambertMaterial color="#6e4426" />
        {PLACES.flatMap((p) => [-1, 1].map((s) => <Instance key={`${p.seat}${s}`} position={[p.x + s * (DESK_W / 2 - 0.06), TOP_Y / 2, p.deskZ]} />))}
      </Instances>

      {/* Raised book ledge between back-to-back desks (like a carrel divider) */}
      <Instances limit={PLACES.length}>
        <boxGeometry args={[DESK_W, 0.26, 0.05]} />
        <meshLambertMaterial color="#5e3a20" />
        {PLACES.map((p) => <Instance key={p.seat} position={[p.x, TOP_Y + 0.13, p.deskZ + p.facing * (DESK_D / 2 - 0.02)]} />)}
      </Instances>

      {/* Chair seats (green leather) */}
      <Instances limit={PLACES.length}>
        <boxGeometry args={[0.5, 0.08, 0.48]} />
        <meshLambertMaterial color="#3f5f45" />
        {PLACES.map((p) => {
          const empty = !occupied.has(p.seat); // vacant desks get a pushed-out chair
          const z = p.chairZ - p.facing * (empty ? 0.25 : 0); // pull in or push out
          const rot = empty ? ((h(p.seat) % 5) - 2) * 0.08 : 0; // slight random angle when empty
          return <Instance key={p.seat} position={[p.x + (empty ? 0.1 : 0), 0.48, z]} rotation={[0, rot, 0]} />;
        })}
      </Instances>

      {/* Chair backs and legs (wood) */}
      <Instances limit={PLACES.length * 3}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color="#5a3720" />
        {PLACES.flatMap((p) => {
          const empty = !occupied.has(p.seat); // same offsets as the seat
          const z = p.chairZ - p.facing * (empty ? 0.25 : 0); // chair z
          const x = p.x + (empty ? 0.1 : 0); // chair x
          return [
            <Instance key={`${p.seat}b`} position={[x, 0.82, z - p.facing * 0.24]} scale={[0.5, 0.6, 0.05]} />, // backrest
            <Instance key={`${p.seat}l`} position={[x - 0.22, 0.23, z]} scale={[0.05, 0.46, 0.44]} />, // left leg frame
            <Instance key={`${p.seat}r`} position={[x + 0.22, 0.23, z]} scale={[0.05, 0.46, 0.44]} />, // right leg frame
          ];
        })}
      </Instances>

      {/* Banker's lamp brass bases and stems */}
      <Instances limit={PLACES.length * 2}>
        <cylinderGeometry args={[1, 1, 1, 10]} />
        <meshLambertMaterial color="#c49a4a" emissive="#3a2508" />
        {PLACES.flatMap((p) => {
          const lx = p.x - 0.55; // lamp on the left of the desk
          const lz = p.deskZ + p.facing * 0.22; // toward the far edge
          return [
            <Instance key={`${p.seat}base`} position={[lx, TOP_Y + 0.05, lz]} scale={[0.1, 0.03, 0.1]} />, // base disc
            <Instance key={`${p.seat}stem`} position={[lx, TOP_Y + 0.2, lz]} scale={[0.015, 0.3, 0.015]} />, // stem
          ];
        })}
      </Instances>

      {/* Green glass shades: brighter when someone sits there */}
      {PLACES.map((p) => {
        const lit = occupied.has(p.seat); // lamp on?
        return (
          <mesh key={p.seat} position={[p.x - 0.55, TOP_Y + 0.37, p.deskZ + p.facing * 0.18]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.7]}>
            <cylinderGeometry args={[0.09, 0.09, 0.38, 10, 1, false, 0, Math.PI]} />
            <meshLambertMaterial color={lit ? "#3a9a60" : "#2c4a36"} emissive={lit ? "#1f6e40" : "#0d1f14"} side={THREE.DoubleSide} />
          </mesh>
        );
      })}

      {/* Glowing bulbs under lit shades */}
      {PLACES.filter((p) => occupied.has(p.seat)).map((p) => (
        <mesh key={p.seat} position={[p.x - 0.55, TOP_Y + 0.33, p.deskZ + p.facing * 0.18]}>
          <sphereGeometry args={[0.045, 8, 6]} />
          <meshBasicMaterial color="#ffe2a0" toneMapped={false} />
        </mesh>
      ))}

      {/* Warm light pools under lit lamps (fake lights: no per-desk light cost) */}
      {PLACES.filter((p) => occupied.has(p.seat)).map((p) => (
        <mesh key={p.seat} position={[p.x - 0.25, TOP_Y + 0.042, p.deskZ]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.6, 1.1]} />
          <meshBasicMaterial map={glow} transparent opacity={0.75} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}

      {/* Book stacks on every desk */}
      <Instances limit={PLACES.length * 2}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial />
        {PLACES.flatMap((p) => {
          const k = h(p.seat); // stable per desk
          const bx = p.x + 0.55; // right side
          const bz = p.deskZ + p.facing * 0.2; // far edge
          const colors = ["#7a2e2a", "#3b4a6b", "#8a6a3a", "#2f4a3a"]; // cloth bindings
          return [
            <Instance key={`${p.seat}1`} position={[bx, TOP_Y + 0.07, bz]} scale={[0.32, 0.06, 0.24]} rotation={[0, (k % 7) * 0.05, 0]} color={colors[k % 4]} />, // bottom book
            <Instance key={`${p.seat}2`} position={[bx + 0.01, TOP_Y + 0.13, bz]} scale={[0.28, 0.05, 0.22]} rotation={[0, -(k % 5) * 0.06, 0]} color={colors[(k + 1) % 4]} />, // top book
          ];
        })}
      </Instances>

      {/* Open book or laptop on occupied desks (and always on mine) */}
      {PLACES.filter((p) => occupied.has(p.seat) || p.seat === mine).map((p) => {
        const z = p.deskZ - p.facing * 0.08; // near the student
        const laptop = h(p.seat) % 3 === 0; // a third of students use a laptop
        return laptop ? (
          <group key={p.seat} position={[p.x + 0.05, TOP_Y + 0.04, z]} rotation={[0, p.facing > 0 ? 0 : Math.PI, 0]}>
            <mesh><boxGeometry args={[0.42, 0.02, 0.3]} /><meshLambertMaterial color="#5c5f66" /></mesh>
            <mesh position={[0, 0.14, 0.15]} rotation={[-0.25, 0, 0]}><boxGeometry args={[0.42, 0.28, 0.015]} /><meshLambertMaterial color="#4a4d54" /></mesh>
            <mesh position={[0, 0.14, 0.14]} rotation={[-0.25, Math.PI, 0]}><planeGeometry args={[0.38, 0.24]} /><meshBasicMaterial color="#cfe0f0" toneMapped={false} /></mesh>
          </group>
        ) : (
          <group key={p.seat} position={[p.x + 0.05, TOP_Y + 0.045, z]} rotation={[0, p.facing > 0 ? 0 : Math.PI, 0]}>
            <mesh rotation={[0, 0, 0.08]} position={[-0.13, 0, 0]}><boxGeometry args={[0.26, 0.015, 0.34]} /><meshLambertMaterial color="#f3ead6" /></mesh>
            <mesh rotation={[0, 0, -0.08]} position={[0.13, 0, 0]}><boxGeometry args={[0.26, 0.015, 0.34]} /><meshLambertMaterial color="#f6eedc" /></mesh>
            <mesh position={[0, -0.012, 0]}><boxGeometry args={[0.56, 0.01, 0.37]} /><meshLambertMaterial color="#6b2f28" /></mesh>
          </group>
        );
      })}

      {/* Brass number plaques, standing on the desk corner, readable from both sides */}
      {PLACES.map((p) => {
        const tex = plaques.get(p.seat)!; // texture for this label
        const hot = hovered === p.seat; // highlighted when hovered
        return (
          <group key={p.seat} position={[p.x + 0.66, TOP_Y + 0.1, p.deskZ + p.facing * 0.33]}>
            <mesh><planeGeometry args={[0.24, 0.12]} /><meshBasicMaterial map={tex} toneMapped={false} color={hot ? "#ffffff" : "#e8dcc0"} /></mesh>
            <mesh rotation={[0, Math.PI, 0]}><planeGeometry args={[0.24, 0.12]} /><meshBasicMaterial map={tex} toneMapped={false} color={hot ? "#ffffff" : "#e8dcc0"} /></mesh>
          </group>
        );
      })}

      {/* Soft contact shadows under each desk + chair (one draw call) */}
      <Instances limit={PLACES.length}>
        <planeGeometry args={[2.3, 2.0]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
        {PLACES.map((p) => <Instance key={p.seat} position={[p.x, 0.01, (p.deskZ + p.chairZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} />)}
      </Instances>

      {/* Gentle warm floor glow under the hovered desk */}
      {hovered && !firstPerson && (() => {
        const p = PLACES.find((q) => q.seat === hovered)!; // hovered place
        return (
          <mesh position={[p.x, 0.02, (p.deskZ + p.chairZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[2.8, 2.4]} />
            <meshBasicMaterial map={glow} transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        );
      })()}

      {/* Invisible hit areas per desk: a low slab over the desk and a column over the chair.
          Keeping them tight stops nearer desks from stealing clicks meant for desks behind. */}
      {PLACES.flatMap((p) => {
        const handlers = {
          onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(p.seat); }, // hover in
          onPointerOut: () => onHover(null), // hover out
          onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onPick(p.seat); }, // pick
        };
        return [
          <mesh key={`${p.seat}-desk`} position={[p.x, 0.48, p.deskZ]} visible={false} {...handlers}>
            <boxGeometry args={[DESK_W, 0.96, DESK_D]} />
          </mesh>, // desk slab (not drawn, still raycast)
          <mesh key={`${p.seat}-chair`} position={[p.x, 0.85, p.chairZ - p.facing * 0.05]} visible={false} {...handlers}>
            <boxGeometry args={[0.8, 1.7, 0.6]} />
          </mesh>, // chair / student column (not drawn, still raycast)
        ];
      })}
    </group>
  );
}
