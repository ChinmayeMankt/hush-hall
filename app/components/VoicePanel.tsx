"use client"; // microphone + WebRTC live in the browser

// Voice for a small study room, over LiveKit.
// - Consent first: "Your voice is heard live ... never recorded." Only after
//   that does the browser's microphone prompt appear (on first talk).
// - Everyone joins muted. Push-to-talk is the default (hold the button or the
//   space bar); open mic is opt-in for this session and asks again.
// - No recording anywhere: we never start LiveKit egress and tokens can't.
// - If the server has no LiveKit keys yet, we say so plainly; nothing pretends to work.

import { useEffect, useRef, useState } from "react"; // React hooks
import type { Room as LkRoom } from "livekit-client"; // type only (the library loads on demand)
import { callApi } from "@/lib/backend/client"; // our token route

type Stage = "off" | "consent" | "connecting" | "live" | "unavailable" | "error"; // panel states
type Person = { id: string; isMe: boolean; micOn: boolean }; // one person on the call

// Small mic icons (drawn inline so no image files are needed).
function MicIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

// Three little bars that move while someone speaks (still bars if the OS asks for less motion).
function SpeakingBars() {
  return <span className="voice-bars" aria-hidden="true"><i /><i /><i /></span>;
}

export default function VoicePanel({ roomId, names }: { roomId: string; names: Record<string, string> }) {
  const [stage, setStage] = useState<Stage>("off"); // where we are
  const [talking, setTalking] = useState(false); // my mic is open right now
  const [openMic, setOpenMic] = useState(false); // open-mic mode (opt-in)
  const [speakers, setSpeakers] = useState<string[]>([]); // identities speaking now
  const [people, setPeople] = useState<Person[]>([]); // everyone on the call (me first) with mic on/off
  const lk = useRef<LkRoom | null>(null); // the LiveKit room
  const audioEls = useRef<HTMLMediaElement[]>([]); // attached remote audio elements

  // Ask the server for a token, then connect muted.
  const connect = async () => {
    setStage("connecting"); // spinner text
    const r = await callApi<{ ok?: boolean; reason?: string; url?: string; token?: string }>("/api/livekit/token", { roomId }); // only room members get one
    if (!r.ok || !r.data.token || !r.data.url) { setStage(r.data.reason === "voice_not_configured" ? "unavailable" : "error"); return; } // honest failure
    const { Room, RoomEvent } = await import("livekit-client"); // load the WebRTC library only now
    const room = new Room({ adaptiveStream: true, dynacast: true }); // efficient defaults
    const refresh = () => setPeople([room.localParticipant, ...room.remoteParticipants.values()].map((p) => ({ id: p.identity, isMe: p === room.localParticipant, micOn: p.isMicrophoneEnabled }))); // who's on the call and whose mic is open
    room.on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === "audio") { const el = track.attach(); el.style.display = "none"; document.body.appendChild(el); audioEls.current.push(el); } }); // play others' voices
    room.on(RoomEvent.TrackUnsubscribed, (track) => { track.detach().forEach((el) => { el.remove(); audioEls.current = audioEls.current.filter((x) => x !== el); }); }); // stop playing
    room.on(RoomEvent.ParticipantConnected, refresh).on(RoomEvent.ParticipantDisconnected, refresh); // list changes
    [RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished].forEach((ev) => room.on(ev, refresh)); // mic on/off changes
    room.on(RoomEvent.ActiveSpeakersChanged, (ps) => setSpeakers(ps.map((p) => p.identity))); // soft "speaking" marks
    room.on(RoomEvent.Disconnected, () => { cleanup(); setStage("off"); }); // removed or connection lost
    try {
      await room.connect(r.data.url, r.data.token, { autoSubscribe: true }); // join (mic stays off)
      await room.startAudio(); // allowed: we're inside the user's click
      lk.current = room; refresh(); setStage("live"); // connected, muted
    } catch { setStage("error"); } // network / token problem
  };

  // Turn my mic on or off (first "on" triggers the browser's permission prompt).
  const setMic = async (on: boolean) => {
    const room = lk.current; if (!room) return; // not connected
    try { await room.localParticipant.setMicrophoneEnabled(on); setTalking(on); } catch { setTalking(false); } // permission denied = stay muted
    setPeople((ps) => ps.map((p) => (p.isMe ? { ...p, micOn: room.localParticipant.isMicrophoneEnabled } : p))); // update my icon at once
  };

  // Leave voice: release the mic and stop all audio.
  const cleanup = () => {
    audioEls.current.forEach((el) => el.remove()); audioEls.current = []; // stop playback
    setTalking(false); setOpenMic(false); setSpeakers([]); setPeople([]); // reset UI
  };
  const leave = async () => { await lk.current?.disconnect(); lk.current = null; cleanup(); setStage("off"); }; // one tap

  // Push-to-talk on the space bar (ignored while typing in a field).
  useEffect(() => {
    if (stage !== "live" || openMic) return; // only in push-to-talk mode
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement; // in a form field
    const down = (e: KeyboardEvent) => { if (e.code === "Space" && !e.repeat && !typing(e)) { e.preventDefault(); setMic(true); } }; // hold = talk
    const up = (e: KeyboardEvent) => { if (e.code === "Space" && !typing(e)) { e.preventDefault(); setMic(false); } }; // release = mute
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); // listen
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); }; // cleanup
  }, [stage, openMic]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the room (or the page) always ends the call.
  useEffect(() => () => { lk.current?.disconnect(); lk.current = null; audioEls.current.forEach((el) => el.remove()); }, [roomId]); // unmount

  if (stage === "unavailable") return <p className="small muted">Voice isn’t switched on for Hush Hall yet. The room still works: you can see each other here and study together at your desks.</p>; // honest
  if (stage === "off" || stage === "error") return (
    <div className="row" style={{ gap: 8, marginTop: 6 }}>
      <button className="sage small" onClick={() => setStage("consent")}>Join voice</button>
      {stage === "error" && <span className="small muted">Couldn’t connect to voice. Try again in a moment.</span>}
    </div>
  );
  if (stage === "consent") return (
    <div className="voice-consent">
      <p><b>Before you join voice:</b> your voice is heard live by the people in this room. It is never recorded.</p>
      <p className="small muted">You join muted. Hold the Talk button (or the space bar) to speak. Your browser will ask for the microphone the first time you talk.</p>
      <div className="row" style={{ gap: 8 }}>
        <button className="ghost small" onClick={() => setStage("off")}>Not now</button>
        <button className="sage small" onClick={connect}>I understand, join muted</button>
      </div>
    </div>
  );
  if (stage === "connecting") return <p className="small muted">Connecting to voice…</p>; // brief
  return (
    <div className="voice-live">
      <div className="small muted">{people.length <= 1 ? "On voice: just you so far" : `On voice: ${people.length} people`}</div>
      <div className="voice-people" role="list">
        {people.map((p) => {
          const speaking = speakers.includes(p.id) && p.micOn; // talking right now
          const who = p.isMe ? "You" : (names[p.id] ?? "Someone"); // label
          return (
            <span key={p.id} role="listitem" className={`voice-person ${speaking ? "is-speaking" : ""} ${p.micOn ? "" : "is-muted"}`} aria-label={`${who}, ${speaking ? "speaking" : p.micOn ? "mic on" : "muted"}`}>
              <span className="voice-mic"><MicIcon off={!p.micOn} /></span>
              <span>{who}</span>
              {speaking && <SpeakingBars />}
            </span>
          );
        })}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        {!openMic ? (
          <button className={`small ${talking ? "sage" : "ghost"}`} onPointerDown={() => setMic(true)} onPointerUp={() => setMic(false)} onPointerLeave={() => talking && setMic(false)} aria-pressed={talking}><MicIcon off={!talking} /> {talking ? "Talking…" : "Hold to talk"}</button>
        ) : (
          <button className="ghost small" onClick={() => { setOpenMic(false); setMic(false); }}><MicIcon off /> Mute (back to push-to-talk)</button>
        )}
        {!openMic && <button className="ghost small" onClick={() => { if (window.confirm("Open mic: everyone in this room hears you until you mute. Never recorded. Turn it on?")) { setOpenMic(true); setMic(true); } }}>Open mic</button>}
        <button className="ghost small" onClick={leave}>Leave voice</button>
      </div>
    </div>
  );
}
