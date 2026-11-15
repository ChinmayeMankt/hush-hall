"use client"; // the weekly plan holds local form state

// A simple private weekly timetable: day, start, end, subject. Only you see it.

import { useEffect, useState } from "react"; // local state
import { addSlot, deleteSlot, listSlots, minToTime, timeToMin, TIMETABLE_DAYS, type TimetableSlot } from "@/lib/timetable"; // private plan

export function TimetableDialog(props: { onClose: () => void }) {
  const [slots, setSlots] = useState<TimetableSlot[]>([]); // my plan, Monday first
  const [day, setDay] = useState(0); // 0 = Monday
  const [start, setStart] = useState("09:00"); // default start
  const [end, setEnd] = useState("11:00"); // default end
  const [subject, setSubject] = useState(""); // what they plan to study
  const [error, setError] = useState(""); // calm reason
  const [pending, setPending] = useState(false); // one write at a time
  const [ready, setReady] = useState(false); // first load

  const refresh = async () => { // reload
    setSlots(await listSlots()); // own rows only
    setReady(true); // first paint done
  };
  useEffect(() => { void refresh(); }, []); // load once

  const add = async () => { // save a slot
    const a = timeToMin(start), b = timeToMin(end); // parse times
    if (a == null || b == null) { setError("Use a start and end time."); return; } // bad time
    setPending(true);
    const res = await addSlot(day, a, b, subject); // validate and store
    setPending(false);
    if (!res.ok) { setError(res.reason); return; } // show why
    setSubject(""); setError(""); // keep the times for the next slot
    await refresh();
  };
  const remove = async (id: string) => { // drop one slot
    setPending(true);
    const ok = await deleteSlot(id); // own row only
    setPending(false);
    if (!ok) { setError("Couldn’t remove that slot. Try again?"); return; }
    await refresh();
  };

  return (
    <div className="veil" role="dialog" aria-modal="true" onClick={props.onClose}>
      <div className="dialog notes" onClick={(e) => e.stopPropagation()}>
        <h2>Timetable</h2>
        <p className="muted small">Private to you. A simple weekly plan for your desk.</p>
        <div className="grid2" style={{ gap: 8 }}>
          <div>
            <label htmlFor="tt-day">Day</label>
            <select id="tt-day" value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {TIMETABLE_DAYS.map((label, i) => <option key={label} value={i}>{label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tt-subject">Subject</label>
            <input id="tt-subject" type="text" maxLength={80} placeholder="e.g. Molecular biology" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label htmlFor="tt-start">Start</label>
            <input id="tt-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label htmlFor="tt-end">End</label>
            <input id="tt-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        {error && <p className="small muted" role="alert">{error}</p>}
        <div className="actions" style={{ marginTop: 8 }}>
          <button type="button" className="sage small" onClick={() => { void add(); }} disabled={pending || !subject.trim()}>Add to plan</button>
        </div>
        {!ready ? <p className="muted small">Opening your plan…</p> : slots.length === 0 ? (
          <p className="muted small" style={{ marginTop: 12 }}>No slots yet. Add a day, a time and a subject.</p>
        ) : (
          <ul className="note-list">
            {TIMETABLE_DAYS.map((label, i) => {
              const daySlots = slots.filter((s) => s.day === i); // this day
              if (daySlots.length === 0) return null; // skip empty days
              return (
                <li key={label} className="note-item">
                  <div className="note-item-title">{label}</div>
                  {daySlots.map((s) => (
                    <div className="row" key={s.id} style={{ gap: 8, marginTop: 6, justifyContent: "space-between" }}>
                      <span className="small">{minToTime(s.startMin)}–{minToTime(s.endMin)} · {s.subject}</span>
                      <button type="button" className="ghost small" onClick={() => { void remove(s.id); }} disabled={pending}>Remove</button>
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
        <div className="actions">
          <button type="button" className="ghost" onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
