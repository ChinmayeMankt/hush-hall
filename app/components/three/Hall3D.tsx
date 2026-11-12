"use client"; // three.js runs in the browser only

// The illustrated 3D reading room. Overview = a slow 3/4 view of the hall;
// seated = first-person at eye level from your own chair; walking = third-person
// behind your own character as you move through the aisles. Presence, requests
// and the timer stay in HallView; this component only draws and reports clicks.

import { useEffect, useMemo, useRef, useState } from "react"; // React hooks
import { Canvas, useFrame, useThree } from "@react-three/fiber"; // React renderer for three.js
import * as THREE from "three"; // math
import Room from "./Room"; // walls, shelves, windows
import Desks from "./Desks"; // desks, chairs, lamps
import Avatar from "./VrmAvatar"; // seated anime students (VRM), low-poly fallback inside
import { PLACES, PLACE_BY_SEAT } from "./layout"; // seat positions
import type { Member } from "@/lib/presence/types"; // who sits where
import { vrmIdsOf } from "./models"; // MAX_VRM budget, shared with the prefetch
import { WalkAvatar, LocalWalker, RemoteWalker, newInput, MOVE_KEYS, type WalkInput } from "./Walking"; // people on foot
import type { Body } from "./walk"; // shared position object
import type { WalkState } from "@/lib/presence/types"; // what my walk reports
import { PerformanceMonitor } from "@react-three/drei"; // frame-rate watcher for the adaptive resolution


// Props from HallView.
interface Props {
  seatMap: Map<string, Member>; // seat -> occupant (includes me)
  myId: string; // my member id
  mySeat: string | null; // my desk, null = standing (overview)
  reduced: boolean; // prefers-reduced-motion: no camera moves, no idle animation
  rain: boolean; // moving rain on the windows
  onPick: (seat: string) => void; // desk clicked
  hoverSeat?: string | null; // externally forced hover (used for screenshots/tests)
  me: Member; // my own record (picks my character when I walk)
  walk: { x: number; z: number; ry: number; n: number; pitch?: number } | null; // walking: where I started (n changes per new walk; pitch = starting camera height angle); null = not walking
  walkers: Member[]; // other people on foot in this hall (positions come from the walker store)
  onMove: (w: WalkState) => void; // my position while walking, every frame (the hall throttles the network)
  stick?: { x: number; y: number }; // on-screen move pad (touch), x right / y forward
  floor?: string | null; // I'm sitting on the floor with this topic (null = on my feet)
  onGetUp?: () => void; // I tried to walk while sitting on the floor
  quick?: boolean; // on-screen "Quicker" toggle (brisk walk)
}

// Each frame, list the people sitting on the floor (not me), so my walk goes round them.
function FloorObstacles({ bodies, myId, input }: { bodies: Map<string, Body>; myId: string; input: WalkInput }) {
  useFrame(() => {
    input.obstacles.length = 0; // fresh list (same array, no garbage)
    for (const [id, b] of bodies) if (id !== myId && b.floor && !b.hidden) input.obstacles.push({ x: b.x, z: b.z, r: 0.42 }); // someone cross-legged here
  }, -2); // before my walker moves
  return null; // no visuals
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
function CameraRig({ mySeat, reduced, zoom, walking }: { mySeat: string | null; reduced: boolean; zoom: number; walking: boolean }) { // walking: the follow camera drives instead
  const { camera } = useThree(); // active camera
  const look = useRef(OVERVIEW.look.clone()); // current look-at point
  const target = useMemo(() => {
    const q = typeof window !== "undefined" && process.env.NODE_ENV !== "production" ? new URLSearchParams(window.location.search).get("cam") : null; // dev-only close-up camera
    if (q && !mySeat) { const n = q.split(",").map(Number); return { pos: new THREE.Vector3(n[0], n[1], n[2]), look: new THREE.Vector3(n[3], n[4], n[5]), fov: 40 }; } // custom preview
    if (mySeat) return seatView(mySeat); // first-person
    const pos = OVERVIEW.look.clone().add(OVERVIEW.pos.clone().sub(OVERVIEW.look).multiplyScalar(zoom)); // dolly toward the hall centre
    return { ...OVERVIEW, pos }; // overview at the chosen zoom
  }, [mySeat, zoom]); // where to go
  // Once the camera has arrived (and been aimed at least once), skip the
  // per-frame matrix work; a new target (sit, stand, zoom) wakes it up again.
  const settled = useRef(false); // true = camera already at rest on the target
  useEffect(() => { settled.current = false; }, [target]); // new destination: move again
  useFrame((_, dt) => {
    if (walking) { settled.current = false; camera.getWorldDirection(look.current).multiplyScalar(4).add(camera.position); return; } // walking: track where the camera looks, so the ease back to a desk or the overview starts from there
    if (settled.current) return; // at rest: nothing would change this frame
    const cam = camera as THREE.PerspectiveCamera; // perspective camera
    const k = reduced ? 1 : 1 - Math.exp(-dt * 1.1); // slow exponential ease (~3 s), or instant
    cam.position.lerp(target.pos, k); // move
    look.current.lerp(target.look, k); // turn
    cam.fov += (target.fov - cam.fov) * k; // widen / narrow
    cam.lookAt(look.current); // aim
    cam.updateProjectionMatrix(); // apply fov
    if (cam.position.distanceToSquared(target.pos) < 1e-8 && look.current.distanceToSquared(target.look) < 1e-8 && Math.abs(cam.fov - target.fov) < 1e-4) settled.current = true; // arrived (already aimed this frame)
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
  // Remember what each label was last given, so a still camera causes no DOM
  // writes (no style recalc/layout every frame); the look is identical.
  const last = useRef(new Map<string, { el: HTMLElement; css: string; vis: string }>()); // key -> element + last written values
  useFrame(() => {
    for (const l of labels) {
      let rec = last.current.get(l.key); // cached element
      if (!rec || !rec.el.isConnected) { const el = document.getElementById(`lbl-${l.key}`); if (!el) continue; rec = { el, css: "", vis: "" }; last.current.set(l.key, rec); } // (re)find it once
      v.copy(l.world).project(camera); // to clip space
      const behind = v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2; // off-screen or behind camera
      const vis = behind ? "hidden" : "visible"; // wanted visibility
      if (vis !== rec.vis) { rec.el.style.visibility = vis; rec.vis = vis; } // write only on change
      const x = ((v.x + 1) / 2) * size.width; // pixel x
      const y = ((1 - v.y) / 2) * size.height; // pixel y
      const css = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`; // anchor bottom-centre
      if (css !== rec.css) { rec.el.style.transform = css; rec.css = css; } // write only on change
    }
  });
  return null; // no visuals
}

// Everything inside the canvas.
function Scene({ seatMap, myId, mySeat, reduced, rain, onPick, hot, setHovered, labels, zoom, me, walk, walkers, onMove, input, bodies, anchors }: Props & { hot: string | null; setHovered: (s: string | null) => void; labels: Label[]; zoom: number; input: WalkInput; bodies: Map<string, Body>; anchors: Map<string, THREE.Vector3> }) {
  const occupied = useMemo(() => new Set(seatMap.keys()), [seatMap]); // taken seats
  // GPU budget: only the first MAX_VRM students (stable order) get full anime models; the rest use the light low-poly avatar.
  const walking = !!walk && !mySeat; // I'm on foot
  const vrmIds = useMemo(() => vrmIdsOf([...seatMap.values(), ...walkers, ...(walking ? [me] : [])], walking ? me.id : undefined), [seatMap, walkers, walking, me]); // ids with VRM (MAX_VRM = 12, unchanged; my walking figure first)
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

      <Room rain={rain} reduced={reduced} closed={firstPerson || walking} />
      <Desks occupied={occupied} mine={mySeat} hovered={hot} firstPerson={firstPerson} onHover={setHovered} onPick={onPick} />

      {/* Seated students (hide myself in first-person so the camera isn't inside my head) */}
      {[...seatMap.entries()].map(([seat, m]) => {
        const p = PLACE_BY_SEAT.get(seat); // place
        if (!p || (firstPerson && m.id === myId)) return null; // skip unknown seats / me in first-person
        return <Avatar key={m.id} id={m.id} name={m.name} simple={!vrmIds.has(m.id)} color={m.color} phase={m.phase} position={[p.x, 0, p.chairZ]} facing={p.facing} reduced={reduced} look={m.look} />;
      })}

      {/* Me on foot: keys move my body, the camera follows behind */}
      {walking && bodies.get(me.id) && (
        <>
          <FloorObstacles bodies={bodies} myId={me.id} input={input} />
          <LocalWalker key={walk!.n} body={bodies.get(me.id)!} input={input} onMove={onMove} />
          <WalkAvatar key={`me-${walk!.n}`} id={me.id} name={me.name} color={me.color} body={bodies.get(me.id)!} reduced={reduced} look={me.look} />
        </>
      )}

      {/* Other people on foot (within the same VRM budget as everyone else) */}
      {walkers.filter((m) => vrmIds.has(m.id) && bodies.get(m.id)).map((m) => (
        <group key={m.id}>
          <RemoteWalker id={m.id} body={bodies.get(m.id)!} />
          <WalkAvatar id={m.id} name={m.name} color={m.color} body={bodies.get(m.id)!} reduced={reduced} anchor={anchors.get(m.id)} look={m.look} />
        </group>
      ))}

      <Projector labels={labels} />
      <CameraRig mySeat={mySeat} reduced={reduced} zoom={zoom} walking={walking} />
    </>
  );
}

// Canvas wrapper with low-GPU settings: adaptive pixel ratio (1x-2x by frame rate), no shadows, low-power GPU hint.
// Topic tags and the hover preview are plain DOM on top of the canvas.
export default function Hall3D(props: Props) {
  const { seatMap, myId, mySeat, hoverSeat, walk, walkers, me } = props; // inputs
  const walking = !!walk && !mySeat; // I'm on foot
  const [hovered, setHovered] = useState<string | null>(null); // desk under the pointer
  const hot = hoverSeat ?? hovered; // forced hover wins (for previews)
  const firstPerson = !!mySeat; // seated camera
  const [zoom, setZoom] = useState(1); // overview zoom: 1 = whole hall, 0.45 = close to the desks
  // Adaptive sharpness: draw at the screen's real pixel density (up to 2x, so
  // faces, hair and outlines stay crisp on phones and retina laptops), and step
  // down in 0.25 steps toward 1x if the frame rate drops, back up when it recovers.
  // A device that keeps flip-flopping settles at 1x.
  const maxDpr = typeof window !== "undefined" ? Math.min(2, Math.max(1, window.devicePixelRatio || 1)) : 1; // screen density, capped
  const [dpr, setDpr] = useState(maxDpr); // current render resolution
  const nudge = (d: number) => setZoom((z) => Math.min(1.1, Math.max(0.45, +(z + d).toFixed(2)))); // clamp zoom steps

  // Walking: one input object and one body per walk (a new walk starts fresh at its spot).
  const input = useMemo(() => newInput(walk?.ry ?? 0, walk?.pitch), [walk?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const myBody = useMemo<Body>(() => ({ x: walk?.x ?? 0, z: walk?.z ?? 0, ry: walk?.ry ?? 0, speed: 0, moved: 0 }), [walk?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  if (props.stick) input.stick = props.stick; // on-screen pad shares the same input
  input.floor = walking ? props.floor ?? null : null; // sitting on the floor (topic), set by the hall
  input.getUp = props.onGetUp; // walking keys while on the floor ask the hall to stand me up
  input.quick = !!props.quick; // touch "Quicker" toggle
  // Bodies and tag anchors for remote walkers, kept per id so they survive re-renders.
  const store = useRef({ bodies: new Map<string, Body>(), anchors: new Map<string, THREE.Vector3>() }); // per-person objects
  const bodies = useMemo(() => { // id -> body, updated when people start/stop walking
    const b = store.current.bodies; // reuse
    for (const id of [...b.keys()]) if (id !== me.id && !walkers.some((m) => m.id === id)) { b.delete(id); store.current.anchors.delete(id); } // forget people who stopped walking
    for (const m of walkers) if (!b.has(m.id)) { b.set(m.id, { x: 0, z: 0, ry: 0, speed: 0, moved: 0, hidden: true }); store.current.anchors.set(m.id, new THREE.Vector3(0, -50, 0)); } // new walkers start hidden until positioned
    b.set(me.id, myBody); // my own body
    return b; // id -> body
  }, [walkers, me.id, myBody]);

  // Keyboard while walking: WASD / arrows move, Q/E turn the view. Ignored while typing or when a dialog is open.
  useEffect(() => {
    if (!walking) return; // only on foot
    const busy = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable) || !!document.querySelector(".veil"); }; // typing, or a dialog is up
    const down = (e: KeyboardEvent) => { // key pressed
      if (!MOVE_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || busy(e)) return; // not ours
      input.keys.add(e.code); // hold
      if (e.code.startsWith("Arrow")) e.preventDefault(); // arrows walk instead of scrolling the page
    };
    const up = (e: KeyboardEvent) => { input.keys.delete(e.code); }; // release (always, so no key ever sticks)
    const clear = () => input.keys.clear(); // window lost focus: stop walking
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", clear); // listen
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", clear); clear(); }; // cleanup
  }, [walking, input]);

  // Drag on the scene to look around while walking (mouse or one finger).
  const drag = useRef<{ x: number; y: number } | null>(null); // last pointer spot during a drag
  const onDown = (e: React.PointerEvent) => { if (walking) drag.current = { x: e.clientX, y: e.clientY }; }; // start
  const onDrag = (e: React.PointerEvent) => { // pointer moved over the scene
    if (!walking || !drag.current || !e.buttons) { drag.current = null; return; } // not dragging
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y; // movement
    drag.current = { x: e.clientX, y: e.clientY }; // next
    input.yaw -= dx * 0.006; input.pitch = Math.min(0.75, Math.max(0.08, input.pitch + dy * 0.004)); input.lastLook = performance.now(); // orbit, kept between level and high
  };

  // Who gets a tag: everyone seated, except me while I'm in first-person.
  const tagged = useMemo(() => [...seatMap.entries()].filter(([seat, m]) => PLACE_BY_SEAT.has(seat) && !(firstPerson && m.id === myId)), [seatMap, firstPerson, myId]); // [seat, member][]
  const walkTags = useMemo(() => walkers.filter((m) => bodies.has(m.id)), [walkers, bodies]); // small name-only tags over people on foot

  // Anchor points: tags above heads, hover card a little higher.
  const labels = useMemo(() => {
    const out: Label[] = tagged.map(([seat]) => { const p = PLACE_BY_SEAT.get(seat)!; return { key: `tag-${seat}`, world: new THREE.Vector3(p.x, 2.05, p.chairZ) }; }); // tags
    walkTags.forEach((m) => out.push({ key: `walk-${m.id}`, world: store.current.anchors.get(m.id)! })); // follows the head (moved by the avatar each frame)
    if (hot) { const p = PLACE_BY_SEAT.get(hot)!; out.push({ key: "hover", world: new THREE.Vector3(p.x, seatMap.has(hot) ? 2.75 : 1.5, seatMap.has(hot) ? p.chairZ : p.deskZ) }); } // hover card
    return out; // all labels
  }, [tagged, hot, seatMap, walkTags]);

  const hm = hot ? seatMap.get(hot) : undefined; // hovered occupant
  return (
    <div className={`hall3d ${walking ? "walking" : ""}`} onWheel={(e) => { if (walking) input.dist = Math.min(4.6, Math.max(1.8, input.dist + (e.deltaY > 0 ? 0.25 : -0.25))); else if (!firstPerson) nudge(e.deltaY > 0 ? 0.08 : -0.08); }} onPointerDown={onDown} onPointerMove={onDrag} onPointerUp={() => { drag.current = null; }}>
      <Canvas
        dpr={dpr} // adaptive (see above): sharp when the device keeps up, lighter when it doesn't
        gl={{ antialias: true, powerPreference: "low-power" }} // MSAA edges (also smooths cut-out hair via alpha-to-coverage); prefer battery over peak speed
        camera={{ position: OVERVIEW.pos.toArray(), fov: OVERVIEW.fov, near: 0.05, far: 80 }} // start in overview
        frameloop={props.reduced && !walking && walkers.length === 0 ? "demand" : "always"} // nothing animates under reduced motion, so render on demand (walking always needs frames)
      >
        <PerformanceMonitor flipflops={3} onDecline={() => setDpr((d) => Math.max(1, +(d - 0.25).toFixed(2)))} onIncline={() => setDpr((d) => Math.min(maxDpr, +(d + 0.25).toFixed(2)))} onFallback={() => setDpr(1)} /> {/* resolution follows the frame rate */}
        <Scene {...props} hot={hot} setHovered={setHovered} labels={labels} zoom={zoom} input={input} bodies={bodies} anchors={store.current.anchors} />
      </Canvas>

      {/* Gentle zoom buttons (touch-friendly; mouse wheel also works) */}
      {!firstPerson && !walking && (
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
        {walkTags.map((m) => (
          <div key={m.id} id={`lbl-walk-${m.id}`} className="lbl">
            <div className="tag3d walk-tag"><div className="tag3d-who">{m.avatar} {m.name}</div>{m.floor && m.topic && <div className="tag3d-topic">{m.topic}</div>}</div>
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
