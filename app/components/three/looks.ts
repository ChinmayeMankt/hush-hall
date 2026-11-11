// Wardrobe: a deliberately small first set of options that only use what the
// approved VRoid characters already contain, so faces, hair and the overall
// look stay exactly as they are. No new meshes, no downloaded assets.
//  - Outfit colour: the character's own top, or a soft blue / sage
//    tint multiplied over the original cloth texture (folds and details stay).
//  - Neck accessory (ribbon / tie) on or off, on characters that have one.
//  - Shoes and socks off as one choice (look.shoes = "off"): hide the shoe
//    meshes and, on characters whose socks, tights or leg warmers are painted
//    into the body texture, swap in a bare-leg/foot variant of that texture
//    (see BARE_BODY and public/looks/). Faces, hair and anything above the
//    legs are untouched. Characters already barefoot under the shoes just
//    hide the shoes.
// No three.js import: the profile page and presence code can use this too.

// One person's choices.
export interface Look {
  top: "orig" | "blue" | "sage"; // outfit colour
  neck: "on" | "off"; // neck accessory (ribbon / tie) where the character has one
  shoes: "on" | "off"; // shoes on, or shoes and socks off (barefoot)
}

// What everyone wears unless they choose otherwise (the characters as approved).
export const DEFAULT_LOOK: Look = { top: "orig", neck: "on", shoes: "on" }; // originals

// Outfit tints, multiplied over the cloth texture (null = untouched).
export const TOP_TINTS: Record<Look["top"], string | null> = { orig: null, blue: "#a3b0d6", sage: "#aec4ad" }; // gentle, library-appropriate

// Labels for the settings (calm wording).
export const TOP_LABELS: Record<Look["top"], string> = { orig: "Original", blue: "Soft blue", sage: "Sage" }; // shown in the wardrobe

// Characters that wear a neck accessory (from the model files' material list).
export const HAS_NECK = new Set(["sendagaya_shibu.vrm", "sendagaya_shino.vrm", "sakurada_fumiriya.vrm"]); // ribbon / tie

// Bare-leg/foot variants of each character's own Body_00 texture (512x512 PNG,
// same resolution as the source). Swap these onto the body material when
// shoes=off (vrm.ts). Every character in the current roster has a variant.
export const BARE_BODY: Record<string, string> = {
  "sendagaya_shibu.vrm": "/looks/sendagaya_shibu.body-bare.png", // knee-high socks painted out
  "sendagaya_shino.vrm": "/looks/sendagaya_shino.body-bare.png", // same body texture as Shibu
  "vivi.vrm": "/looks/vivi.body-bare.png", // mid-calf leg warmers painted out (feet were already bare)
  "victoria_rubin.vrm": "/looks/victoria_rubin.body-bare.png", // thigh-high tights painted out
  "vita.vrm": "/looks/vita.body-bare.png", // gradient leggings and navy soles painted out
  "sakurada_fumiriya.vrm": "/looks/sakurada_fumiriya.body-bare.png", // ankle socks under the trouser cuffs
  "hairsample_male.vrm": "/looks/hairsample_male.body-bare.png", // ankle socks under the trouser cuffs
};

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
