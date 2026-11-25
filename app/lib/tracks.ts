// Background music tracks, listed in the order "All tracks" plays them.
// To add a track: put the mp3 in public/ and append one object to TRACKS.

// One playable piece: a stable id, the name shown in the Background menu, and the public file path.
export type Track = {
  id: string; // used as the dropdown value when looping this track alone
  title: string; // calm label in the Background menu
  file: string; // URL path under public/, for example /night-piano.mp3
};

// Play order for "All tracks". Append a new entry at the bottom to add a track.
export const TRACKS: Track[] = [
  { id: "warm-focus", title: "Warm Focus", file: "/warm-focus.mp3" }, // existing default piece
  { id: "night-piano", title: "Night Piano", file: "/night-piano.mp3" }, // short piano piece, after Warm Focus
];
