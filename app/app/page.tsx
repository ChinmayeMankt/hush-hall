// Front page: the Main Reading Hall itself, with all its normal controls.
// Visitors can look around straight away; the nickname + 18+ step appears
// only when they do something that needs a name (like taking a desk).
// The lobby (library card, this week, halls) lives at /lobby.

import HallView from "@/components/HallView"; // the interactive hall
import { MAIN_HALL } from "@/lib/halls"; // which hall the front page shows

export default function Home() {
  return <HallView hallId={MAIN_HALL} home />; // the hall, in "front page" mode (visitors welcome)
}
