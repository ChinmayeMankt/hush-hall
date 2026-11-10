"use client"; // dialogs hold local form state

// Small paper dialogs used in the hall: sit down, desk card, recap, break.

import { useState } from "react"; // local form state
import type { Member } from "@/lib/presence/types"; // member shape

// ---- Sit-down dialog: step 2 of the ritual (sit -> topic -> timer -> recap) ----
export function SitDialog(props: {
  seat: string; // chosen desk
  defaultFocus: number; // last-used focus minutes
  defaultBreak: number; // last-used break minutes
  onCancel: () => void; // back to standing
  onSit: (topic: string, focusMin: number, breakMin: number, remember: boolean) => void; // confirm
}) {
  const [topic, setTopic] = useState(""); // what they will study
  const [plan, setPlan] = useState(`${props.defaultFocus}/${props.defaultBreak}`); // Pomodoro plan
  const [remember, setRemember] = useState(true); // save as usual seat
  const [f, b] = plan.split("/").map(Number); // parse "25/5"
  return (
    <div className="veil" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={(e) => { e.preventDefault(); if (topic.trim()) props.onSit(topic.trim(), f, b, remember); }}>
        <h2>Desk {props.seat}</h2>
        <p className="muted small">Write what you are working on. It shows on your desk for everyone in the hall.</p>
        <label htmlFor="topic">Today’s topic</label>
        <input id="topic" type="text" autoFocus maxLength={60} placeholder="e.g. Molecular biology: PCR" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <label htmlFor="plan">Rhythm</label>
        <select id="plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option value="25/5">25 min focus · 5 min break</option>
          <option value="50/10">50 min focus · 10 min break</option>
          <option value="15/3">15 min focus · 3 min break (warm-up)</option>
        </select>
        <span className="toggle" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Make this my usual desk in this hall
        </span>
        <div className="actions">
          <button type="button" className="ghost" onClick={props.onCancel}>Not yet</button>
          <button type="submit" className="sage" disabled={!topic.trim()}>Sit down &amp; start</button>
        </div>
      </form>
    </div>
  );
}

// ---- Desk card: what you see when you tap someone else's desk ----
export function DeskCard(props: {
  member: Member; // who sits there
  canRequest: boolean; // false if I am in focus or they hide from requests
  reason: string; // why requesting is unavailable, in plain words
  onRequest: (note: string) => void; // send a join request
  onBlock: () => void; // block this person
  onReport: () => void; // report this person
  onClose: () => void; // close the card
}) {
  const [note, setNote] = useState(""); // optional short note
  const m = props.member; // shorthand
  return (
    <div className="veil" role="dialog" aria-modal="true" onClick={props.onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <span style={{ fontSize: "2rem", background: m.color, borderRadius: "50%", width: 52, height: 52, display: "grid", placeItems: "center" }}>{m.avatar}</span>
          <div>
            {/* Desk card shows only nickname, avatar and current topic: no seat history, college or course */}
            <h2 style={{ margin: 0 }}>{m.name}</h2>
            <div className="muted small">Studying: {m.topic}</div>
          </div>
        </div>
        {/* Join request: quiet, one short note, receiver decides */}
        {props.canRequest ? (
          <>
            <label htmlFor="note">Ask to study together in a small room (optional note)</label>
            <input id="note" type="text" maxLength={80} placeholder="e.g. Also doing enzyme kinetics, want to sync breaks?" value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        ) : (
          <p className="muted small" style={{ marginTop: 12 }}>{props.reason}</p>
        )}
        <div className="actions">
          <button type="button" className="ghost small" onClick={props.onReport}>Report</button>
          <button type="button" className="ghost small" onClick={props.onBlock}>Block</button>
          <button type="button" className="ghost" onClick={props.onClose}>Close</button>
          {props.canRequest && <button type="button" className="sage" onClick={() => props.onRequest(note)}>Send request</button>}
        </div>
      </div>
    </div>
  );
}

// ---- Recap: last step of the ritual, shown when standing up ----
export function RecapDialog(props: {
  topic: string; // what they studied
  minutes: number; // focused minutes this sitting
  onSave: (note: string) => void; // save recap and stand up
  onBack: () => void; // keep sitting
}) {
  const [note, setNote] = useState(""); // one-line recap
  return (
    <div className="veil" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={(e) => { e.preventDefault(); props.onSave(note.trim()); }}>
        <h2>Standing up</h2>
        <p>{props.minutes} min of focus on <b>{props.topic}</b>.{props.minutes > 0 ? " That counts." : " Showing up counts too."}</p>
        <label htmlFor="recap">One line for future you: what got done? (optional)</label>
        <input id="recap" type="text" autoFocus maxLength={100} placeholder="e.g. Finished 12 Michaelis-Menten problems" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="actions">
          <button type="button" className="ghost" onClick={props.onBack}>Keep studying</button>
          <button type="submit" className="sage">Save &amp; stand up</button>
        </div>
      </form>
    </div>
  );
}

// ---- Break card: gentle, skippable, no guilt ----
export function BreakCard(props: { clock: string; onSkip: () => void; onHide: () => void }) {
  return (
    <div className="veil" role="dialog" aria-modal="true">
      <div className="dialog break-card">
        <h2>Short break</h2>
        <div className="big">{props.clock}</div>
        <p className="muted">Stand, stretch, sip some water, look at something far away. Your desk stays yours.</p>
        <div className="actions" style={{ justifyContent: "center" }}>
          <button type="button" className="ghost" onClick={props.onHide}>Hide this</button>
          <button type="button" className="sage" onClick={props.onSkip}>Back to focus</button>
        </div>
      </div>
    </div>
  );
}
