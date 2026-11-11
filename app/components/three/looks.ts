// Wardrobe: a deliberately small first set of options that only use what the
// approved VRoid characters already contain, so faces, hair and the overall
// look stay exactly as they are. No new meshes, no downloaded assets.
//  - Outfit colour: the character's own top, or a soft blue / sage
//    tint multiplied over the original cloth texture (folds and details stay).
//  - Neck accessory (ribbon / tie) on or off, on characters that have one.
//  - Shoes on or off. Every character has modelled feet under the shoes.
// Socks: on these characters socks, tights and leg warmers are painted into the
// body texture (not separate meshes), so removing them would mean repainting each
// character's skin texture. Not done (it would risk a patchy look); "shoes off"
// shows whatever the character wears under the shoes (socks, tights or bare feet).
// No three.js import: the profile page and presence code can use this too.

// One person's choices.
export interface Look {
  top: "orig" | "blue" | "sage"; // outfit colour
  neck: "on" | "off"; // neck accessory (ribbon / tie) where the character has one
  shoes: "on" | "off"; // shoes on, or barefoot
}

// What everyone wears unless they choose otherwise (the characters as approved).
export const DEFAULT_LOOK: Look = { top: "orig", neck: "on", shoes: "on" }; // originals

// Outfit tints, multiplied over the cloth texture (null = untouched).
export const TOP_TINTS: Record<Look["top"], string | null> = { orig: null, blue: "#a3b0d6", sage: "#aec4ad" }; // gentle, library-appropriate

// Labels for the settings (calm wording).
export const TOP_LABELS: Record<Look["top"], string> = { orig: "Original", blue: "Soft blue", sage: "Sage" }; // shown in the wardrobe

// Characters that wear a neck accessory (from the model files' material list).
export const HAS_NECK = new Set(["sendagaya_shibu.vrm", "sendagaya_shino.vrm", "sakurada_fumiriya.vrm"]); // ribbon / tie

// Read a stored look string ("top=blue;neck=off;shoes=off"); anything unknown falls back to the default.
export function parseLook(s?: string | null): Look {
  const out: Look = { ...DEFAULT_LOOK }; // start from the originals
  for (const part of (s ?? "").split(";")) { // each key=value
    const [k, v] = part.split("="); // split
    if (k === "top" && (v === "orig" || v === "blue" || v === "sage")) out.top = v; // known colour
    if (k === "neck" && (v === "on" || v === "off")) out.neck = v; // known toggle
    if (k === "shoes" && (v === "on" || v === "off")) out.shoes = v; // known toggle
  }
  return out; // safe value
}

// Write a look as a short string (what gets stored and shared). Empty = all defaults.
export function lookString(l: Look): string {
  const parts: string[] = []; // only what differs
  if (l.top !== "orig") parts.push(`top=${l.top}`); // colour
  if (l.neck !== "on") parts.push(`neck=${l.neck}`); // accessory
  if (l.shoes !== "on") parts.push(`shoes=${l.shoes}`); // shoes
  return parts.join(";"); // e.g. "top=blue;shoes=off"
}
