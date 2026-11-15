"use client"; // interactive button

// One numbered desk. Vacant desks invite you to sit; occupied desks show
// the person's avatar, name, public topic and a tiny status lamp.

import type { Member } from "@/lib/presence/types"; // who sits here
import { formatStudyHours } from "@/lib/studyStats"; // this-week hours on the desk

// Props for a single desk.
interface Props {
  seat: string; // desk label, e.g. "B4"
  occupant: Member | null; // who sits here, if anyone
  isMine: boolean; // true if this is where I sit
  isUsual: boolean; // true if this is my usual (returning) seat
  onClick: () => void; // tap handler (sit, or open desk card)
}

// Plain-language status for the lamp.
const STATUS: Record<Member["phase"], string> = {
  focus: "focusing", // timer running
  break: "on a short break", // Pomodoro break
  idle: "settling in", // seated, timer not started
};

export default function Desk({ seat, occupant, isMine, isUsual, onClick }: Props) {
  // Vacant desk: dashed outline, number plate, gentle hint.
  if (!occupant) {
    return (
      <button type="button" className={`desk vacant ${isUsual ? "usual" : ""}`} onClick={onClick} aria-label={`Desk ${seat}, vacant`}>
        <span className="num">{seat}</span>
        <span className="hint">{isUsual ? "Your usual desk" : "Vacant · take this seat"}</span>
      </button>
    );
  }
  // Occupied desk: avatar, name, status lamp, topic card.
  return (
    <button type="button" className={`desk ${isMine ? "mine" : ""}`} onClick={onClick} aria-label={`Desk ${seat}, ${occupant.name} studying ${occupant.topic}`}>
      <span className="num">{seat}</span>
      <span className="who">
        <span className="ava" style={{ background: occupant.color }}>{occupant.avatar}</span>
        {isMine ? "You" : occupant.name}
      </span>
      <span className="state"><span className={`lamp ${occupant.phase}`} />{STATUS[occupant.phase]}</span>
      <span className="topic" title={occupant.topic}>{occupant.topic || "…"}</span>
      {typeof occupant.weekMinutes === "number" && occupant.weekMinutes > 0 && <span className="small muted">{formatStudyHours(occupant.weekMinutes)} this week</span>}
    </button>
  );
}
