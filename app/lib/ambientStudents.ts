// Ambient students: a few scripted, clearly labeled "study companions" so a quiet hall
// doesn't feel empty. They are NOT real people:
//   - they live only in the browser (never saved, never sent to other users, no database rows)
//   - they never count toward "desks taken" or live numbers
//   - they can't receive requests, be blocked or reported (the desk card says so)
//   - a real person always wins a desk, and the fewer real people there are, the more ambient students show up
// Everything is computed from the clock, so every visitor sees the same ambient students at the same time.

import type { Member } from "./presence/types"; // member shape
import { ALL_SEATS, LAMP_COLORS } from "./halls"; // desks and lamp colours

// A pool of 100 first names (Indian and Japanese/anime-style). Ambient students draw from it and change names over time,
// so every hall looks lived in. These are made-up companions, so no surnames and no real people.
const NAMES = [
  // Indian
  "Aarav", "Vihaan", "Aditya", "Arjun", "Kabir", "Rohan", "Ishaan", "Reyansh", "Krish", "Dev",
  "Rahul", "Karan", "Nikhil", "Siddharth", "Yash", "Harsh", "Manav", "Tanmay", "Varun", "Parth",
  "Meera", "Ananya", "Diya", "Isha", "Kavya", "Riya", "Saanvi", "Tara", "Zoya", "Aditi",
  "Naina", "Pooja", "Sneha", "Tanvi", "Neha", "Ira", "Myra", "Anika", "Prisha", "Shreya",
  "Aisha", "Charvi", "Mihir", "Rudra", "Vivaan", "Advait", "Anaya", "Navya", "Kiara", "Sara",
  // Japanese / anime-style
  "Haruto", "Yuki", "Sora", "Ren", "Kaito", "Riku", "Hinata", "Sakura", "Akira", "Takumi",
  "Hana", "Mei", "Yui", "Aoi", "Rin", "Haru", "Kenji", "Daichi", "Shinji", "Naoki",
  "Mio", "Sana", "Nana", "Emi", "Ayumi", "Kana", "Rei", "Asuka", "Misaki", "Chihiro",
  "Itsuki", "Ryo", "Hikari", "Satoshi", "Taro", "Yuto", "Kazuki", "Minato", "Tsubasa", "Shun",
  "Noa", "Kohaku", "Suzu", "Mizuki", "Hotaru", "Akari", "Natsu", "Fuyu", "Kai", "Leo",
]; // 100 names

// Soft emoji avatars and varied study topics (kept general; nothing about real courses or colleges).
const AVATARS = ["🦉", "🌿", "🐢", "📚", "☕", "🌙", "🪴", "🦊", "🐼", "🍵", "🌸", "🐱", "🦋", "🍃", "⭐", "🐧"];
const TOPICS = [
  "Organic chem: SN1 vs SN2", "GATE BT: enzyme kinetics", "DSA: graphs", "Thesis lit review", "Linear algebra ch. 4",
  "UPSC: polity notes", "Bioprocess eng. problem set", "JEE: rotational motion", "NEET: human physiology", "CAT: quant practice",
  "Python: pandas basics", "SQL joins practice", "Machine learning: regression", "Statistics: hypothesis tests", "Japanese N5 vocab",
  "Spanish verbs", "Essay outline", "Case study prep", "Accounting basics", "Economics: demand curves",
  "Calculus: integrals", "Genetics problem set", "Mock test review", "Research paper reading", "Resume and cover letters",
  "Maths: probability", "History: revision notes", "Cell biology flashcards",
];

const MAX_AMBIENT = 8; // never more than this many on screen
const SLOT_MIN = 30; // one pomodoro: 25 min focus + 5 min break

// Small stable hash so the schedule is the same for everyone.
function hash(s: string) {
  let h = 5381; // djb2
  for (const ch of s) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0; // mix in each character
  return h; // unsigned 32-bit
}

// How many ambient students to show for this many real people (me included) sitting at desks.
export function ambientTarget(hallId: string, realSeated: number) {
  const wanted = 7 + (hash(hallId) % 3); // every hall looks about 7-9 desks busy
  return Math.max(0, Math.min(MAX_AMBIENT, wanted - realSeated)); // real people replace ambient ones
}

// The ambient students for a hall at a given minute (epoch minutes).
export function ambientMembers(hallId: string, epochMinute: number, count: number): Member[] {
  if (count <= 0) return []; // enough real people
  const out: Member[] = []; // result
  const used = new Set<string>(); // desks already given out this minute
  const names = new Set<string>(); // names already used this minute
  const slot = Math.floor(epochMinute / SLOT_MIN); // 30-minute slot number
  for (let i = 0; i < MAX_AMBIENT + 6 && out.length < count; i++) { // extra candidates cover students who are away, so the hall stays busy
    // Away for a while now and then (about 1 slot in 5), so the hall changes through the day.
    if (hash(`${hallId}|away|${i}|${slot}`) % 5 === 0) continue; // this student is on a longer break
    const block = Math.floor(slot / 4); // each "sitting" lasts about 2 hours, then a new student takes the desk
    let ni = hash(`${hallId}|name|${i}|${block}`) % NAMES.length; // name from the 100-name carousel
    for (let tries = 0; tries < NAMES.length && names.has(NAMES[ni]); tries++) ni = (ni + 1) % NAMES.length; // no two students share a name
    names.add(NAMES[ni]); // reserve it
    let idx = hash(`${hallId}|seat|${i}|${block}`) % ALL_SEATS.length; // preferred desk
    for (let tries = 0; tries < ALL_SEATS.length && used.has(ALL_SEATS[idx]); tries++) idx = (idx + 1) % ALL_SEATS.length; // next free desk
    used.add(ALL_SEATS[idx]); // reserve it
    const offset = (hash(`${hallId}|off|${i}`) % SLOT_MIN); // each student's pomodoro starts at a different minute
    const pos = (epochMinute + offset) % SLOT_MIN; // minute inside this student's cycle
    const focusing = pos < 25; // first 25 min focus, last 5 min break
    const minsLeft = focusing ? 25 - pos : SLOT_MIN - pos; // minutes until the phase changes
    out.push({
      id: `ambient-${hallId}-${i}-${block}`, // stable per sitting; a new sitting looks like a new student; never a real user id
      name: NAMES[ni], // fictional first name that changes with each sitting
      avatar: AVATARS[hash(`${hallId}|av|${i}|${block}`) % AVATARS.length], // emoji avatar
      color: LAMP_COLORS[hash(`${hallId}|c|${i}|${block}`) % LAMP_COLORS.length], // lamp colour (also picks the 3D look)
      seat: ALL_SEATS[idx], // desk
      topic: TOPICS[hash(`${hallId}|topic|${i}|${block}`) % TOPICS.length], // what they "study"
      phase: focusing ? "focus" : "break", // pomodoro phase
      phaseEndsAt: (epochMinute + minsLeft) * 60000, // when it changes (epoch ms)
      hideFromRequests: true, // can't take requests
      isAmbient: true, // labeled as ambient everywhere
      lastSeen: epochMinute * 60000, // fresh
    });
  }
  return out; // the ambient students for now
}
