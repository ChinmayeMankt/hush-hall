"use client"; // loads my sittings and the hours-visibility toggle

// My study hours: today and this week (Monday–Sunday, IST), plus a simple
// 7-day bar list. Totals only add up; missed days are just empty bars.

import { useEffect, useState } from "react"; // local load state
import { loadHistory } from "@/lib/account"; // my sittings
import { formatStudyHours, studyStats } from "@/lib/studyStats"; // IST totals
import { loadShowWeeklyHours, saveShowWeeklyHours } from "@/lib/weekHoursPref"; // desk visibility toggle

export function StatsDialog(props: { liveMinutes?: number; onClose: () => void }) {
  const [today, setToday] = useState(0); // focused minutes today (IST)
  const [week, setWeek] = useState(0); // focused minutes this Mon–Sun (IST)
  const [days, setDays] = useState<{ label: string; minutes: number }[]>([]); // last 7 IST days
  const [show, setShow] = useState(true); // others may see this week's total
  const [msg, setMsg] = useState(""); // toggle result
  const [ready, setReady] = useState(false); // first load

  useEffect(() => {
    Promise.all([loadHistory(), loadShowWeeklyHours()]).then(([history, visible]) => { // sittings + toggle
      const s = studyStats(history, props.liveMinutes ?? 0); // include the sitting in progress
      setToday(s.today); setWeek(s.week); setDays(s.days); setShow(visible); setReady(true); // paint
    });
  }, [props.liveMinutes]); // update if the live sitting grows

  const toggle = async (on: boolean) => { // show or hide the public weekly total
    setShow(on); // optimistic
    const ok = await saveShowWeeklyHours(on); // own setting
    setMsg(ok ? (on ? "Others can see this week’s hours on your desk." : "This week’s hours are hidden from others.") : "Couldn’t save that just now. Try again?"); // calm
  };

  const max = Math.max(1, ...days.map((d) => d.minutes)); // bar scale (avoid divide-by-zero)

  return (
    <div className="veil" role="dialog" aria-modal="true" onClick={props.onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Study hours</h2>
        {!ready ? <p className="muted small">Adding up your hours…</p> : (
          <>
            <p>Today: <b>{formatStudyHours(today)}</b></p>
            <p>This week (Mon–Sun): <b>{formatStudyHours(week)}</b></p>
            <p className="muted small">Hours you’ve logged at a desk. Nothing here resets, and a quiet day is just a quiet day.</p>
            <div className="hour-bars" aria-label="Last seven days">
              {days.map((d) => (
                <div className="hour-bar-col" key={d.label + d.minutes}>
                  <div className="hour-bar" style={{ height: `${Math.max(d.minutes > 0 ? 8 : 2, Math.round((d.minutes / max) * 80))}px` }} title={`${d.label}: ${formatStudyHours(d.minutes)}`} />
                  <div className="small muted">{d.label}</div>
                </div>
              ))}
            </div>
            <span className="toggle" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={show} onChange={(e) => { void toggle(e.target.checked); }} />
              Show this week’s hours on my desk
            </span>
            {msg && <p className="small muted">{msg}</p>}
          </>
        )}
        <div className="actions">
          <button type="button" className="ghost" onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
