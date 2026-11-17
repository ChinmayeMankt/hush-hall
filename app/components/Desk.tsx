"use client"; // interactive button

// One numbered desk. Vacant desks invite you to sit; occupied desks show
// the person's avatar, name, public topic and a tiny status lamp.

import type { Member } from "@/lib/presence/types"; // who sits here
import { formatStudyHours } from "@/lib/studyStats"; // this-week hours on the desk
import { isRealStudent, satAgoLabel } from "@/lib/livePresence"; // real people vs scripted companions

// Props for a single desk.
interface Props {
  seat: string; // desk label, e.g. "B4"
  occupant: Member | null; // who sits here, if anyone
  isMine: boolean; // true if this is where I sit
  isUsual: boolean; // true if this is my usual (returning) seat
  nowMs: number; // a slowly ticking "now" (for "sat down X min ago")
  onClick: () => void; // tap handler (sit, or open desk card)
}

// Plain-language status for the lamp.
const STATUS: Record<Member["phase"], string> = {
  focus: "focusing", // timer running
  break: "on a short break", // Pomodoro break
  idle: "settling in", // seated, timer not started
};

export default function Desk({ seat, occupant, isMine, isUsual, nowMs, onClick }: Props) {
  // Vacant desk: dashed outline, number plate, gentle hint.
  if (!occupant) {
    return (
      <button type="button" className={`desk vacant ${isUsual ? "usual" : ""}`} onClick={onClick} aria-label={`Desk ${seat}, vacant`}>
        <span className="num">{seat}</span>
        <span className="hint">{isUsual ? "Your usual desk" : "Vacant · take this seat"}</span>
      </button>
    );
  }
  const real = isRealStudent(occupant); // a live person, never a scripted companion
  const ago = real ? satAgoLabel(occupant.satDownAt, nowMs) : null; // "sat down X min ago"
  // Occupied desk: avatar, name, live marker (real people only), status lamp, topic card.
  return (
    <button type="button" className={`desk ${isMine ? "mine" : ""} ${real ? "real" : "companion"}`} onClick={onClick} aria-label={`Desk ${seat}, ${occupant.name} studying ${occupant.topic}`}>
      <span className="num">{seat}</span>
      <span className="who">
        <span className="ava" style={{ background: occupant.color }}>{occupant.avatar}</span>
        {isMine ? "You" : occupant.name}
        {real ? <span className="live-dot" title="Real student, here now" aria-label="live" /> : <span className="companion-tag">companion</span>}
      </span>
      <span className="state"><span className={`lamp ${occupant.phase}`} />{STATUS[occupant.phase]}</span>
      <span className="topic" title={occupant.topic}>{occupant.topic || "…"}</span>
      {ago && <span className="sat-ago">{ago}</span>}
      {typeof occupant.weekMinutes === "number" && occupant.weekMinutes > 0 && <span className="small muted">{formatStudyHours(occupant.weekMinutes)} this week</span>}
    </button>
  );
}
