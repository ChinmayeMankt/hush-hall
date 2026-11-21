"use client"; // draws the 3D hall in the browser

// The front page's live look into the Main Reading Hall: the real 3D hall in
// its slow overview, with the real people seated right now (desk, avatar and
// look only; nicknames and topics stay inside) plus the labelled companions.
// Whatever card the page passes in floats gently over the scene.

import { useEffect, useMemo, useRef, useState } from "react"; // React hooks
import dynamic from "next/dynamic"; // lazy-load the 3D bundle
import { ambientMembers, ambientTarget } from "@/lib/ambientStudents"; // labelled, scripted company
import { demoMembers, MAIN_HALL } from "@/lib/halls"; // demo students (offline) + the hall shown
import { hallPreview } from "@/lib/guest"; // real people seated now (desk + look only)
import { hasSupabase } from "@/lib/backend/client"; // real backend or offline demo
import { hasWebGL, prefersReducedMotion } from "@/lib/env"; // capability checks
import { prefetchModels } from "./three/models"; // start character downloads before the 3D bundle arrives
import type { Member } from "@/lib/presence/types"; // seated person

// A calm, warm stand-in while the 3D code and characters load (never a blank box).
function Placeholder({ text }: { text: string }) {
  return (
    <div className="hall3d hall-placeholder" aria-label="The reading hall is loading">
      {/* Five soft lamp glows in a row, like desks seen from the door */}
      <div className="ph-lamps" aria-hidden="true"><span /><span /><span /><span /><span /></div>
      {/* One quiet line of text */}
      <div className="ph-text">{text}</div>
    </div>
  );
}

// The 3D hall loads only in the browser, after the page itself is on screen.
const Hall3D = dynamic(() => import("./three/Hall3D"), { ssr: false, loading: () => <Placeholder text="Lighting the lamps…" /> }); // lazy 3D

// How often to re-read who is seated (the front page stays fresh without live presence).
const REFRESH_MS = 30000; // setting: every 30 s

export default function HallPreview({ children, onPickDesk }: { children?: React.ReactNode; onPickDesk?: (seat: string) => void }) {
  const [webgl, setWebgl] = useState<boolean | null>(null); // null until checked in the browser
  const [reduced, setReduced] = useState(false); // prefers-reduced-motion
  const [real, setReal] = useState<Member[]>([]); // real people seated now
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60000)); // minute clock for the companions
  const [drawn, setDrawn] = useState(false); // true once the 3D scene has had a moment to draw its first frames
  const wrapRef = useRef<HTMLElement>(null); // the frame, to notice when the 3D canvas appears

  // Check the device once, then read who is seated now and every 30 s.
  useEffect(() => {
    setWebgl(hasWebGL()); // can this device draw 3D?
    setReduced(prefersReducedMotion()); // OS motion setting
    let live = true; // ignore results after unmount
    const load = () => hallPreview(MAIN_HALL).then((m) => { if (live) setReal(m); }); // read seated people
    load(); // first read
    const t = window.setInterval(() => { load(); setMinute(Math.floor(Date.now() / 60000)); }, REFRESH_MS); // keep it fresh
    return () => { live = false; clearInterval(t); }; // cleanup
  }, []);

  // Everyone drawn at a desk: real people first, then companions fill in (offline demo: demo students).
  const seatMap = useMemo(() => {
    const extra = hasSupabase ? ambientMembers(MAIN_HALL, minute, ambientTarget(MAIN_HALL, real.length)) : demoMembers(MAIN_HALL); // company
    const map = new Map<string, Member>(); // seat -> person
    [...real, ...extra].forEach((m) => { if (m.seat && !map.has(m.seat)) map.set(m.seat, m); }); // first claim wins (real people come first)
    return map; // ready to draw
  }, [real, minute]);

  // Keep the warm stand-in over the scene until the canvas has drawn for a moment (no dark empty frame).
  useEffect(() => {
    if (!webgl) return; // no 3D on this device: the stand-in stays as the picture
    let t = 0; // fade timer
    const poll = window.setInterval(() => { // look for the canvas a few times a second
      if (!wrapRef.current?.querySelector("canvas")) return; // not mounted yet
      clearInterval(poll); // found it
      t = window.setTimeout(() => setDrawn(true), 1500); // setting: ~1.5 s for the first frames, then fade the stand-in out
    }, 200); // setting: check every 0.2 s
    return () => { clearInterval(poll); clearTimeout(t); }; // cleanup
  }, [webgl]);

  // Start downloading the characters as soon as we know who is seated.
  useEffect(() => { prefetchModels(seatMap.values()); }, [seatMap]);

  // The visitor is not in the hall yet: a placeholder record the 3D hall needs but never draws.
  const visitor: Member = useMemo(() => ({ id: "visitor", name: "", avatar: "", color: "#e9d8a6", seat: null, topic: "", phase: "idle", phaseEndsAt: null, hideFromRequests: true, lastSeen: 0 }), []); // never seated, never walking
  const noWalkers = useMemo<Member[]>(() => [], []); // nobody on foot in the preview

  const realCount = real.length; // real people at desks
  const companions = seatMap.size - realCount; // scripted company on screen

  return (
    <section className="hall3d-wrap landing-hall" ref={wrapRef}>
      {/* The scene, or a warm stand-in while it loads / on devices without 3D */}
      {webgl === null ? <Placeholder text="Opening the doors…" />
        : webgl ? <Hall3D seatMap={seatMap} myId={visitor.id} mySeat={null} reduced={reduced} rain={false} onPick={(s) => onPickDesk?.(s)} me={visitor} walk={null} walkers={noWalkers} onMove={() => {}} nowMs={minute * 60000} />
        : <Placeholder text="This device can’t draw the 3D hall, but the desks work the same inside." />}
      {/* The stand-in stays on top while the scene draws its first frames, then fades away */}
      {webgl && <div className={`ph-cover ${drawn ? "gone" : ""}`} aria-hidden="true"><Placeholder text="Lighting the lamps…" /></div>}
      {/* One honest line about who is here */}
      <div className="landing-count small">
        {realCount > 0 ? `${realCount} ${realCount === 1 ? "person" : "people"} studying now` : "Quiet right now"}{companions > 0 ? ` · ${companions} quiet companion${companions === 1 ? "" : "s"}, not real people` : ""}
      </div>
      {/* The page's card floats over the hall */}
      {children && <div className="landing-card">{children}</div>}
    </section>
  );
}
