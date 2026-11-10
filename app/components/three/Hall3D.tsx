"use client"; // three.js runs in the browser only

// The illustrated 3D reading room. Overview = a slow 3/4 view of the hall;
// seated = first-person at eye level from your own chair. Presence, requests
// and the timer stay in HallView; this component only draws and reports clicks.

import { useEffect, useMemo, useRef, useState } from "react"; // React hooks
import { Canvas, useFrame, useThree } from "@react-three/fiber"; // React renderer for three.js
import * as THREE from "three"; // math
import Room from "./Room"; // walls, shelves, windows
import Desks from "./Desks"; // desks, chairs, lamps
import Avatar from "./VrmAvatar"; // seated anime students (VRM), low-poly fallback inside
import { PLACES, PLACE_BY_SEAT } from "./layout"; // seat positions
import type { Member } from "@/lib/presence/types"; // who sits where

const MAX_VRM = 12; // ~35k triangles each (x2 with toon outlines); keeps the hall well under ~1M triangles

// Props from HallView.
interface Props {
  seatMap: Map<string, Member>; // seat -> occupant (includes me)
  myId: string; // my member id
  mySeat: string | null; // my desk, null = standing (overview)
  reduced: boolean; // prefers-reduced-motion: no camera moves, no idle animation
  rain: boolean; // moving rain on the windows
  onPick: (seat: string) => void; // desk clicked
  hoverSeat?: string | null; // externally forced hover (used for screenshots/tests)
}

// Camera presets.
const OVERVIEW = { pos: new THREE.Vector3(5.0, 5.9, 8.4), look: new THREE.Vector3(0.2, 0.8, -1.0), fov: 48 }; // 3/4 view, close enough to read poses

// First-person preset for a seat: eye height, looking across the table.
function seatView(seat: string) {
  const p = PLACE_BY_SEAT.get(seat)!; // place
  return {
    pos: new THREE.Vector3(p.x, 1.42, p.chairZ - p.facing * 0.05), // eye above the chair, sitting up a little
    look: new THREE.Vector3(p.x, 1.0, p.deskZ + p.facing * 3.6), // across the table, slightly down
    fov: 62, // wider, like real eyes
  };
}

// Slowly eases the camera between overview and first-person. Snaps if reduced motion.
function CameraRig({ mySeat, reduced, zoom }: { mySeat: string | null; reduced: boolean; zoom: number }) {
  const { camera } = useThree(); // active camera
  const look = useRef(OVERVIEW.look.clone()); // current look-at point
  const target = useMemo(() => {
    const q = typeof window !== "undefined" && process.env.NODE_ENV !== "production" ? new URLSearchParams(window.location.search).get("cam") : null; // dev-only close-up camera
    if (q && !mySeat) { const n = q.split(",").map(Number); return { pos: new THREE.Vector3(n[0], n[1], n[2]), look: new THREE.Vector3(n[3], n[4], n[5]), fov: 40 }; } // custom preview
    if (mySeat) return seatView(mySeat); // first-person
    const pos = OVERVIEW.look.clone().add(OVERVIEW.pos.clone().sub(OVERVIEW.look).multiplyScalar(zoom)); // dolly toward the hall centre
    return { ...OVERVIEW, pos }; // overview at the chosen zoom
  }, [mySeat, zoom]); // where to go
  useFrame((_, dt) => {
    const cam = camera as THREE.PerspectiveCamera; // perspective camera
    const k = reduced ? 1 : 1 - Math.exp(-dt * 1.1); // slow exponential ease (~3 s), or instant
    cam.position.lerp(target.pos, k); // move
    look.current.lerp(target.look, k); // turn
    cam.fov += (target.fov - cam.fov) * k; // widen / narrow
    cam.lookAt(look.current); // aim
    cam.updateProjectionMatrix(); // apply fov
  });
  return null; // no visuals
}

// One DOM label that follows a point in 3D (positioned by the Projector below).
interface Label { key: string; world: THREE.Vector3; } // label id + anchor point

// Projects 3D anchor points to screen pixels every frame and moves the DOM labels.
// One plain DOM layer is cheaper than a React root per label.
function Projector({ labels }: { labels: Label[] }) {
  const { camera, size } = useThree(); // camera + canvas size
  const v = useMemo(() => new THREE.Vector3(), []); // scratch vector
  useFrame(() => {
    for (const l of labels) {
      const el = document.getElementById(`lbl-${l.key}`); // DOM label
      if (!el) continue; // not rendered yet
      v.copy(l.world).project(camera); // to clip space
      const behind = v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2; // off-screen or behind camera
      el.style.visibility = behind ? "hidden" : "visible"; // hide if not in view
      const x = ((v.x + 1) / 2) * size.width; // pixel x
      const y = ((1 - v.y) / 2) * size.height; // pixel y
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`; // anchor bottom-centre
    }
  });
  return null; // no visuals
}

// Everything inside the canvas.
function Scene({ seatMap, myId, mySeat, reduced, rain, onPick, hot, setHovered, labels, zoom }: Props & { hot: string | null; setHovered: (s: string | null) => void; labels: Label[]; zoom: number }) {
  const occupied = useMemo(() => new Set(seatMap.keys()), [seatMap]); // taken seats
  // GPU budget: only the first MAX_VRM students (stable order) get full anime models; the rest use the light low-poly avatar.
  const vrmIds = useMemo(() => new Set([...seatMap.values()].map((m) => m.id).sort().slice(0, MAX_VRM)), [seatMap]); // ids with VRM
  const firstPerson = !!mySeat; // seated camera
  const gl = useThree((s) => s.gl); // renderer (for cursor)
  useEffect(() => { gl.domElement.style.cursor = hot ? "pointer" : "default"; }, [hot, gl]); // pointer cursor on desks

  // Dev-only test hook: who sits where (seat, name, model seed inputs) for close-up test cameras.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return; // never in production builds
    (window as unknown as { __hhSeats?: () => unknown }).__hhSeats = () => [...seatMap.entries()].map(([seat, m]) => ({ seat, name: m.name, phase: m.phase, ...PLACE_BY_SEAT.get(seat) })); // list
  }, [seatMap]);

  // Dev-only test hook: screen position of a desk, so headless tests can hover/click real desks.
  const { camera, size } = useThree(); // camera + canvas size
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return; // never in production builds
    const w = window as unknown as { __hhProject?: (seat: string) => { x: number; y: number } | null; __hhInfo?: () => unknown }; // typed handle
    w.__hhInfo = () => ({ ...gl.info.render, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, dpr: gl.getPixelRatio() }); // draw-call stats for perf notes
    w.__hhProject = (seat) => {
      const p = PLACE_BY_SEAT.get(seat); // place
      if (!p) return null; // unknown seat
      const v = new THREE.Vector3(p.x + 0.2, 0.8, p.deskZ).project(camera); // desk-top point, to clip space
      const r = gl.domElement.getBoundingClientRect(); // canvas on the page
      return { x: r.left + ((v.x + 1) / 2) * size.width, y: r.top + ((1 - v.y) / 2) * size.height }; // to page pixels
    };
  }, [camera, size, gl]);

  return (
    <>
      {/* Warm, cheap lighting: hemisphere + one key light + two sconce point lights */}
      <color attach="background" args={["#2a1b12"]} />
      <fog attach="fog" args={["#2a1b12", 22, 42]} />
      <hemisphereLight args={["#ffe2b0", "#4a2e1c", 1.3]} />
      <directionalLight position={[6, 12, 8]} intensity={1.4} color="#ffd59a" />
      <directionalLight position={[-4, 6, -10]} intensity={0.35} color="#8fa6d6" />
      <pointLight position={[-6.5, 4.2, -6.6]} intensity={9} distance={9} decay={1.6} color="#ffbf70" />
      <pointLight position={[6.5, 4.2, -6.6]} intensity={9} distance={9} decay={1.6} color="#ffbf70" />
      {/* Your own lamp gets one real light when seated, for a cosy pool on your desk */}
      {mySeat && (() => { const p = PLACE_BY_SEAT.get(mySeat)!; return <pointLight position={[p.x - 0.5, 1.15, p.deskZ]} intensity={2.2} distance={3} decay={1.5} color="#ffd08a" />; })()}

      <Room rain={rain} reduced={reduced} closed={firstPerson} />
      <Desks occupied={occupied} mine={mySeat} hovered={hot} firstPerson={firstPerson} onHover={setHovered} onPick={onPick} />

      {/* Seated students (hide myself in first-person so the camera isn't inside my head) */}
      {[...seatMap.entries()].map(([seat, m]) => {
        const p = PLACE_BY_SEAT.get(seat); // place
        if (!p || (firstPerson && m.id === myId)) return null; // skip unknown seats / me in first-person
        return <Avatar key={m.id} id={m.id} name={m.name} simple={!vrmIds.has(m.id)} color={m.color} phase={m.phase} position={[p.x, 0, p.chairZ]} facing={p.facing} reduced={reduced} />;
      })}

      <Projector labels={labels} />
      <CameraRig mySeat={mySeat} reduced={reduced} zoom={zoom} />
    </>
  );
}

// Canvas wrapper with low-GPU settings: capped pixel ratio, no shadows, low-power GPU hint.
// Topic tags and the hover preview are plain DOM on top of the canvas.
export default function Hall3D(props: Props) {
  const { seatMap, myId, mySeat, hoverSeat } = props; // inputs
  const [hovered, setHovered] = useState<string | null>(null); // desk under the pointer
  const hot = hoverSeat ?? hovered; // forced hover wins (for previews)
  const firstPerson = !!mySeat; // seated camera
  const [zoom, setZoom] = useState(1); // overview zoom: 1 = whole hall, 0.45 = close to the desks
  const nudge = (d: number) => setZoom((z) => Math.min(1.1, Math.max(0.45, +(z + d).toFixed(2)))); // clamp zoom steps

  // Who gets a tag: everyone seated, except me while I'm in first-person.
  const tagged = useMemo(() => [...seatMap.entries()].filter(([seat, m]) => PLACE_BY_SEAT.has(seat) && !(firstPerson && m.id === myId)), [seatMap, firstPerson, myId]); // [seat, member][]

  // Anchor points: tags above heads, hover card a little higher.
  const labels = useMemo(() => {
    const out: Label[] = tagged.map(([seat]) => { const p = PLACE_BY_SEAT.get(seat)!; return { key: `tag-${seat}`, world: new THREE.Vector3(p.x, 2.05, p.chairZ) }; }); // tags
    if (hot) { const p = PLACE_BY_SEAT.get(hot)!; out.push({ key: "hover", world: new THREE.Vector3(p.x, seatMap.has(hot) ? 2.75 : 1.5, seatMap.has(hot) ? p.chairZ : p.deskZ) }); } // hover card
    return out; // all labels
  }, [tagged, hot, seatMap]);

  const hm = hot ? seatMap.get(hot) : undefined; // hovered occupant
  return (
    <div className="hall3d" onWheel={(e) => { if (!firstPerson) nudge(e.deltaY > 0 ? 0.08 : -0.08); }}>
      <Canvas
        dpr={[1, 1.5]} // cap resolution so phones stay cool
        gl={{ antialias: true, powerPreference: "low-power" }} // prefer battery over peak speed
        camera={{ position: OVERVIEW.pos.toArray(), fov: OVERVIEW.fov, near: 0.05, far: 80 }} // start in overview
        frameloop={props.reduced ? "demand" : "always"} // nothing animates under reduced motion, so render on demand
      >
        <Scene {...props} hot={hot} setHovered={setHovered} labels={labels} zoom={zoom} />
      </Canvas>

      {/* Gentle zoom buttons (touch-friendly; mouse wheel also works) */}
      {!firstPerson && (
        <div className="zoom3d">
          <button className="ghost small" aria-label="Zoom in" onClick={() => nudge(-0.15)}>+</button>
          <button className="ghost small" aria-label="Zoom out" onClick={() => nudge(0.15)}>−</button>
        </div>
      )}

      {/* DOM label layer (pointer-events off so clicks reach the desks) */}
      <div className="label-layer">
        {tagged.map(([seat, m]) => (
          <div key={seat} id={`lbl-tag-${seat}`} className="lbl">
            <div className={`tag3d ${hot && hot !== seat ? "dim" : ""}`}>
              <div className="tag3d-who">{m.avatar} {m.name}</div>
              <div className="tag3d-topic">{m.topic}</div>
            </div>
          </div>
        ))}
        {hot && !(firstPerson && hot === mySeat) && (
          <div id="lbl-hover" className="lbl">
            {hm && hm.id !== myId ? (
              <div className="hover3d card-preview">
                <div className="row" style={{ gap: 8 }}><span className="ava-sm" style={{ background: hm.color }}>{hm.avatar}</span><b>{hm.name}</b></div>
                <div className="small">Studying: {hm.topic}</div>
                <div className="small muted">Tap for desk card</div>
              </div>
            ) : (
              <div className="hover3d">{hm ? "Your desk" : `Desk ${hot} · vacant · tap to sit`}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Re-export for convenience.
export { PLACES };
