// Static hall catalogue and desk layout for the prototype.
// Halls are public and mostly silent; each has the same 4 x 6 desk grid.

import type { Member } from "./presence/types"; // member shape for demo students

// A public hall anyone can walk into.
export interface Hall {
  id: string; // url slug
  name: string; // shown on the lobby door
  mood: string; // one-line description
  rule: string; // the hall's single house rule
}

// The halls on the lobby board.
export const HALLS: Hall[] = [
  { id: "main-reading", name: "Main Reading Hall", mood: "Big, quiet, long tables", rule: "Silent. Nods only." },
  { id: "science-wing", name: "Science Wing", mood: "Labs, papers, problem sets", rule: "Silent. Diagrams welcome." },
  { id: "exam-season", name: "Exam Season Hall", mood: "Deadlines and steady pages", rule: "Silent. One topic per desk." },
  { id: "night-owls", name: "Night Owls", mood: "Late-night lamps", rule: "Silent. Be kind to tired eyes." },
];

// Look up a hall by id.
export const hallById = (id: string) => HALLS.find((h) => h.id === id); // undefined if unknown

// Desk grid: rows A-D, desks 1-6 per row (split by a centre aisle in the UI).
export const ROWS = ["A", "B", "C", "D"]; // row letters, front to back
export const DESKS_PER_ROW = 6; // desks per row
export const ALL_SEATS = ROWS.flatMap((r) =>
  Array.from({ length: DESKS_PER_ROW }, (_, i) => `${r}${i + 1}`), // e.g. "A1".."D6"
);

// Demo students so a hall never feels empty in the prototype.
// They are generated the same way in every tab, so all tabs agree on them.
const DEMO_PEOPLE = [
  { name: "Aarav", avatar: "🦉", topic: "Organic chem: SN1 vs SN2" },
  { name: "Meera", avatar: "🌿", topic: "GATE BT: enzyme kinetics" },
  { name: "Kabir", avatar: "🐢", topic: "DSA: graphs" },
  { name: "Isha", avatar: "📚", topic: "Thesis lit review" },
  { name: "Rohan", avatar: "☕", topic: "Linear algebra ch. 4" },
  { name: "Tara", avatar: "🌙", topic: "UPSC: polity notes" },
  { name: "Zoya", avatar: "🪴", topic: "Bioprocess eng. problem set" },
];

// Soft desk-lamp colours (warm, low saturation; deliberately no red).
export const LAMP_COLORS = ["#e9d8a6", "#d4a373", "#ccd5ae", "#b7c4cf", "#e6ccb2", "#c9ada7"];

// Tiny deterministic hash so demo seating is stable per hall.
function hash(s: string) {
  let h = 0; // running hash
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; // classic 31-multiplier string hash
  return h; // unsigned 32-bit
}

// Build the demo students for a hall (4-6 people on stable seats).
export function demoMembers(hallId: string): Member[] {
  const h = hash(hallId); // seed from hall id
  const count = 4 + (h % 3); // 4, 5 or 6 demo students
  const used = new Set<string>(); // avoid double-booking a desk
  const out: Member[] = []; // result list
  for (let i = 0; i < count; i++) {
    const p = DEMO_PEOPLE[(h + i * 3) % DEMO_PEOPLE.length]; // pick a person
    let seatIdx = (h + i * 7) % ALL_SEATS.length; // pick a desk
    while (used.has(ALL_SEATS[seatIdx])) seatIdx = (seatIdx + 1) % ALL_SEATS.length; // next free desk
    used.add(ALL_SEATS[seatIdx]); // reserve it
    out.push({
      id: `demo-${hallId}-${i}`, // stable id
      name: p.name, // display name
      avatar: p.avatar, // emoji avatar
      color: LAMP_COLORS[(h + i) % LAMP_COLORS.length], // lamp colour
      seat: ALL_SEATS[seatIdx], // desk
      topic: p.topic, // public topic
      phase: i % 4 === 3 ? "break" : "focus", // most are focusing, one may be on a break
      phaseEndsAt: null, // demo students have no visible countdown
      hideFromRequests: i === 1, // one demo student shows the "not taking requests" state
      isDemo: true, // marked as simulated
      lastSeen: Date.now(), // always fresh
    });
  }
  return out; // the hall's demo occupants
}
