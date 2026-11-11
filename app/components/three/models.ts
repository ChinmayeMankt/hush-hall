// Lightweight model roster + picker, with no three.js import, so the hall page
// can decide which character files it needs and start downloading them while
// the big 3D bundle is still loading. vrm.ts parses the same downloads, so each
// file is fetched exactly once.

// The character roster. Each file is a CC0 VRoid sample (license read from the VRM meta + pixiv's page).
export const MODELS = [
  { file: "sendagaya_shibu.vrm", name: "Sendagaya Shibu" }, // β Ver AvatarSample_1
  { file: "vivi.vrm", name: "Vivi" }, // β Ver AvatarSample_2
  { file: "sakurada_fumiriya.vrm", name: "Sakurada Fumiriya" }, // male sample
  { file: "victoria_rubin.vrm", name: "Victoria Rubin" }, // β sample
  { file: "hairsample_male.vrm", name: "HairSample_Male" }, // male base sample
  { file: "vita.vrm", name: "Vita" }, // β sample
  { file: "sendagaya_shino.vrm", name: "Sendagaya Shino" }, // β-era sample
] as const;

export const MAX_VRM = 12; // ~35k triangles each (x2 with toon outlines); keeps the hall well under ~1M triangles

// Stable hash for per-student variety (same as the low-poly avatar).
export const hash = (s: string) => [...s].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381); // djb2

// Fixed characters for the demo students so names and looks match (index into MODELS).
const DEMO_LOOKS: Record<string, number> = { Aarav: 2, Meera: 1, Kabir: 4, Isha: 6, Rohan: 2, Tara: 0, Zoya: 3 }; // name -> model

// Which character a student gets (same rule the avatar has always used).
export function modelFor(id: string, color: string, name?: string) {
  const k = hash(id + color); // seed
  return MODELS[name && name in DEMO_LOOKS ? DEMO_LOOKS[name] : k % MODELS.length]; // demo look or seeded pick
}

// Which members get a full VRM model: the first MAX_VRM by id (stable order).
export function vrmIdsOf(members: Iterable<{ id: string }>) {
  return new Set([...members].map((m) => m.id).sort().slice(0, MAX_VRM)); // ids with VRM
}

// One download per file, shared by the prefetch below and the VRM parser.
const downloads = new Map<string, Promise<ArrayBuffer>>(); // file -> bytes
export function fetchModel(file: string): Promise<ArrayBuffer> {
  if (!downloads.has(file)) {
    const p = fetch(`/models/${file}`, { priority: "low" } as RequestInit).then((r) => { if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`); return r.arrayBuffer(); }); // from public/; low priority so the 3D bundle still arrives first
    p.catch(() => downloads.delete(file)); // allow a retry after a failure
    downloads.set(file, p); // remember even while in flight
  }
  return downloads.get(file)!; // shared promise
}

// Start downloading the unique files the seated students need (no parsing yet).
export function prefetchModels(members: Iterable<{ id: string; color: string; name?: string }>) {
  const list = [...members]; // reusable
  const vrm = vrmIdsOf(list); // only students that will get a full model
  for (const m of list) if (vrm.has(m.id)) fetchModel(modelFor(m.id, m.color, m.name).file).catch(() => {}); // errors resurface when the avatar loads
}
