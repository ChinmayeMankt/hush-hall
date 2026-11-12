"use client"; // dialogs hold local form state

// Small paper dialogs used in the hall: sit down, desk card, recap, break.

import { useEffect, useState } from "react"; // local form and load state
import type { Member } from "@/lib/presence/types"; // member shape
import { REPORT_REASONS, type ReportReason } from "@/lib/account"; // report reasons (same list as the database)
import { TOP_LABELS, type Look } from "./three/looks"; // wardrobe choices (no three.js import)
import { deleteNote, listNotes, saveNote, NOTE_SOURCES, type DeskNote } from "@/lib/notes"; // private desk notes

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
export function BreakCard(props: { clock: string; compact?: boolean; onSkip: () => void; onHide: () => void }) {
  // Compact variant: a small paper card that leaves the 3D room visible.
  if (props.compact) {
    return (
      <div className="break-mini" role="status">
        <b>Short break · {props.clock}</b>
        <div className="small muted">Stand, stretch, sip water, look out the window. Your desk stays yours.</div>
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <button type="button" className="ghost small" onClick={props.onHide}>Hide</button>
          <button type="button" className="sage small" onClick={props.onSkip}>Back to focus</button>
        </div>
      </div>
    );
  }
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

// ---- Report: a reason is required, a note is optional. Private to moderators. ----
export function ReportDialog(props: { member: Member; onCancel: () => void; onSend: (reason: ReportReason, note: string) => void }) {
  const [reason, setReason] = useState<ReportReason | "">(""); // nothing pre-selected
  const [note, setNote] = useState(""); // optional details
  return (
    <div className="veil" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={(e) => { e.preventDefault(); if (reason) props.onSend(reason, note.trim()); }}>
        <h2>Report {props.member.name}</h2>
        <p className="muted small">Only the Hush Hall moderators see this. {props.member.name} won’t be told who reported them. Harassment and safety reports are looked at within 24 hours.</p>
        <label htmlFor="reason">What happened?</label>
        <select id="reason" value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
          <option value="" disabled>Choose a reason</option>
          {REPORT_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <label htmlFor="rnote">Anything that helps us understand (optional)</label>
        <textarea id="rnote" maxLength={500} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What they wrote or did, roughly when" />
        <p className="small muted">You can also block them from their desk card so you no longer see each other.</p>
        <div className="actions">
          <button type="button" className="ghost" onClick={props.onCancel}>Cancel</button>
          <button type="submit" className="sage" disabled={!reason}>Send report</button>
        </div>
      </form>
    </div>
  );
}

// ---- Sit on the floor: one line for the topic, then sit where you stand ----
export function FloorDialog(props: {
  defaultTopic: string; // last topic, offered again
  onCancel: () => void; // stay on my feet
  onSit: (topic: string) => void; // sit down cross-legged here
}) {
  const [topic, setTopic] = useState(props.defaultTopic); // what they will study
  return (
    <div className="veil" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={(e) => { e.preventDefault(); if (topic.trim()) props.onSit(topic.trim()); }}>
        <h2>Sit on the floor</h2>
        <p className="muted small">You’ll kneel on a reading cushion right where you stand. Your topic shows above you for everyone in the hall. Walk again any time to get up, or tap a free desk.</p>
        <label htmlFor="floor-topic">Today’s topic</label>
        <input id="floor-topic" type="text" autoFocus maxLength={60} placeholder="e.g. Organic chemistry: SN1 vs SN2" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <div className="actions">
          <button type="button" className="ghost" onClick={props.onCancel}>Not now</button>
          <button type="submit" className="sage" disabled={!topic.trim()}>Sit here</button>
        </div>
      </form>
    </div>
  );
}

// ---- Wardrobe: a small first set of choices, all from the character's own clothes ----
export function WardrobeDialog(props: {
  look: Look; // current choices
  hasNeck: boolean; // my character wears a neck ribbon / tie
  onCancel: () => void; // close without changes
  onSave: (look: Look) => void; // keep these
}) {
  const [look, setLook] = useState<Look>(props.look); // working copy
  const pick = (patch: Partial<Look>) => setLook((l) => ({ ...l, ...patch })); // change one choice
  return (
    <div className="veil" role="dialog" aria-modal="true">
      <form className="dialog" onSubmit={(e) => { e.preventDefault(); props.onSave(look); }}>
        <h2>Wardrobe</h2>
        <p className="muted small">Small changes to your character’s own clothes. Everyone in the hall sees them.</p>
        <label htmlFor="look-top">Outfit colour</label>
        <select id="look-top" value={look.top} onChange={(e) => pick({ top: e.target.value as Look["top"] })}>
          {(Object.keys(TOP_LABELS) as Look["top"][]).map((k) => <option key={k} value={k}>{TOP_LABELS[k]}</option>)}
        </select>
        {props.hasNeck && (
          <label className="toggle" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={look.neck === "on"} onChange={(e) => pick({ neck: e.target.checked ? "on" : "off" })} />
            Neck ribbon / tie
          </label>
        )}
        <label className="toggle" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={look.shoes === "off"} onChange={(e) => pick({ shoes: e.target.checked ? "off" : "on" })} />
          Shoes and socks off
        </label>
        <div className="actions">
          <button type="button" className="ghost" onClick={props.onCancel}>Cancel</button>
          <button type="submit" className="sage">Save</button>
        </div>
      </form>
    </div>
  );
}

// ---- Private desk notes: title, optional source, optional link, annotation. Only the owner sees these. ----
export function NotesDialog(props: { onClose: () => void }) {
  const blank = { title: "", source: "", url: "", note: "" }; // empty form
  const [notes, setNotes] = useState<DeskNote[]>([]); // my notes, newest first
  const [loading, setLoading] = useState(true); // first fetch
  const [filter, setFilter] = useState<string>(""); // source filter ("" = all)
  const [editing, setEditing] = useState<string | "new" | null>(null); // which form is open
  const [form, setForm] = useState(blank); // add/edit fields
  const [error, setError] = useState(""); // calm reason if save fails
  const [pending, setPending] = useState(false); // disable double submits
  const [confirmId, setConfirmId] = useState<string | null>(null); // note waiting to be removed

  const refresh = async () => { // reload the list
    const rows = await listNotes(); // own notes only
    setNotes(rows); // newest first
    setLoading(false); // first paint done
  };
  useEffect(() => { void refresh(); }, []); // load once when opened

  const shown = filter ? notes.filter((n) => n.source === filter) : notes; // optional source filter
  const labelFor = (s: DeskNote["source"]) => NOTE_SOURCES.find((x) => x.id === s)?.label ?? ""; // display name
  const openNew = () => { setEditing("new"); setForm(blank); setError(""); setConfirmId(null); }; // add form
  const openEdit = (n: DeskNote) => { setEditing(n.id); setForm({ title: n.title, source: n.source ?? "", url: n.url ?? "", note: n.note }); setError(""); setConfirmId(null); }; // edit form
  const cancelForm = () => { setEditing(null); setForm(blank); setError(""); }; // back to the list

  const submit = async (e: { preventDefault: () => void }) => { // save add or edit
    e.preventDefault(); // stay in the dialog
    setPending(true); // one save at a time
    const res = await saveNote(form, editing === "new" || !editing ? undefined : editing); // no id when adding
    setPending(false);
    if (!res.ok) { setError(res.reason); return; } // show why
    cancelForm(); // close the form
    await refresh(); // show the new list
  };

  const remove = async (id: string) => { // delete after confirm
    setPending(true);
    const ok = await deleteNote(id); // own row only
    setPending(false);
    setConfirmId(null);
    if (!ok) { setError("Couldn’t remove that note. Try again?"); return; }
    await refresh();
  };

  return (
    <div className="veil" role="dialog" aria-modal="true" onClick={props.onClose}>
      <div className="dialog notes" onClick={(e) => e.stopPropagation()}>
        <h2>Desk notes</h2>
        <p className="muted small">Private to you. Use this to keep titles, links and short notes from ChatGPT, Google, YouTube, books and anywhere else you study. Other people at the desk still only see your nickname, avatar and topic.</p>
        {editing ? (
          <form onSubmit={submit}>
            <label htmlFor="note-title">Title</label>
            <input id="note-title" type="text" autoFocus maxLength={80} placeholder="e.g. PCR annealing temperatures" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <label htmlFor="note-source">Source (optional)</label>
            <select id="note-source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              <option value="">No source</option>
              {NOTE_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <label htmlFor="note-url">Link (optional)</label>
            <input id="note-url" type="text" maxLength={500} placeholder="https://" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <label htmlFor="note-body">Annotation (optional)</label>
            <textarea id="note-body" maxLength={2000} rows={4} placeholder="What to come back to, or how you used this" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            {error && <p className="small muted" role="alert">{error}</p>}
            <div className="actions">
              <button type="button" className="ghost" onClick={cancelForm} disabled={pending}>Back</button>
              <button type="submit" className="sage" disabled={pending || !form.title.trim()}>{editing === "new" ? "Add note" : "Save"}</button>
            </div>
          </form>
        ) : (
          <>
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <label htmlFor="note-filter" className="small muted" style={{ margin: 0 }}>Show</label>
              <select id="note-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">All sources</option>
                {NOTE_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <button type="button" className="sage small" onClick={openNew} style={{ marginLeft: "auto" }}>Add note</button>
            </div>
            {error && <p className="small muted" role="alert">{error}</p>}
            {loading ? <p className="muted small">Loading your notes…</p> : shown.length === 0 ? (
              <p className="muted small" style={{ marginTop: 12 }}>{notes.length === 0 ? "No notes yet. Add one to keep a link or a short reminder on your desk." : "No notes from that source."}</p>
            ) : (
              <ul className="note-list">
                {shown.map((n) => (
                  <li className="note-item" key={n.id}>
                    <div className="note-item-title">{n.title}</div>
                    <div className="small muted">{n.source ? labelFor(n.source) : "No source"}{n.url ? " · " : ""}{n.url && <a href={n.url} target="_blank" rel="noopener noreferrer">Open link</a>}</div>
                    {n.note && <div className="small" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{n.note}</div>}
                    <div className="row" style={{ gap: 6, marginTop: 8 }}>
                      <button type="button" className="ghost small" onClick={() => openEdit(n)}>Edit</button>
                      {confirmId === n.id ? (
                        <>
                          <button type="button" className="ghost small" onClick={() => remove(n.id)} disabled={pending}>Remove for good</button>
                          <button type="button" className="ghost small" onClick={() => setConfirmId(null)}>Keep</button>
                        </>
                      ) : (
                        <button type="button" className="ghost small" onClick={() => setConfirmId(n.id)}>Remove</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="actions">
              <button type="button" className="ghost" onClick={props.onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
