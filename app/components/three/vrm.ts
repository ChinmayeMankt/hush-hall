"use client"; // browser-only (WebGL + fetch)

// Loads anime VRM characters once, makes them cheap to draw, and hands out
// lightweight clones that share geometry, textures and materials.
//
// Models: CC0 VRoid sample characters by pixiv Inc. (see docs/ASSETS.md),
// shrunk offline by scripts/optimize_vrm.py (only the morphs we use) and
// scripts/strip_vrm_thumbnail.py (drops the unused preview picture).
// Rendering: @pixiv/three-vrm (MIT) with MToon toon shading.

import * as THREE from "three"; // core
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"; // glTF/VRM container
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js"; // skinned-mesh-safe clone
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"; // batch primitives
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName, VRMExpressionMorphTargetBind } from "@pixiv/three-vrm"; // VRM + MToon

// The character roster lives in models.ts (no three.js import), so the page can prefetch files early.
export { MODELS } from "./models"; // re-exported for existing imports
import { fetchModel } from "./models"; // shared, de-duplicated downloads
import { TOP_TINTS, BARE_BODY, type Look } from "./looks"; // wardrobe choices

// Finger joints we pose: 5 fingers x 3 joints x 2 hands.
export const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"] as const; // thumb first
// Joint names, knuckle -> tip. three-vrm uses VRM 1.0 names, where the thumb's
// joints are Metacarpal/Proximal/Distal (VRM 0.x files are mapped onto these).
export const jointsOf = (f: (typeof FINGERS)[number]) => (f === "Thumb" ? ["Metacarpal", "Proximal", "Distal"] : ["Proximal", "Intermediate", "Distal"]) as readonly string[]; // per finger
export const boneOf = (side: "left" | "right", f: (typeof FINGERS)[number], j: number) => `${side}${f}${jointsOf(f)[j]}` as VRMHumanBoneName; // e.g. "leftIndexProximal"
const FINGER_BONES = (["left", "right"] as const).flatMap((s) => FINGERS.flatMap((f) => [0, 1, 2].map((j) => boneOf(s, f, j)))); // all 30 finger bones

// Bones we pose. Everything else stays at rest.
const BONES: VRMHumanBoneName[] = [
  "hips", "spine", "chest", "upperChest", "neck", "head",
  "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot",
  "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand", "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
  "leftEye", "rightEye", // eyes glance down at the book while the head stays a little higher
  ...FINGER_BONES, // all finger joints, so hands can rest relaxed instead of splayed
];

// One loaded model, ready to clone.
export interface Template {
  scene: THREE.Object3D; // merged, unrotated scene (VRM 0.x faces -Z)
  boneNames: Partial<Record<VRMHumanBoneName, string>>; // humanoid bone -> node name
  hipsY: number; // hips height at rest (metres)
  morphs: Record<"blink" | "happy" | "relaxed", { mesh: string; index: number }[]>; // expression -> mesh/morph pairs
  isVRM0: boolean; // VRM 0.x needs X/Z rotations mirrored
  bareBody?: THREE.Texture; // socks-off body map, swapped in when shoes=off
}

// A posable clone handed to an avatar.
export interface Instance {
  root: THREE.Object3D; // add this to the scene
  bones: Partial<Record<VRMHumanBoneName, THREE.Object3D>>; // posable bones
  setExpression: (name: "blink" | "happy" | "relaxed", w: number) => void; // morph weight 0..1
  hipsY: number; // hips rest height
  sign: number; // -1 for VRM 0.x (mirror X/Z rotations), 1 for VRM 1.0
}

const cache = new Map<string, Promise<Template>>(); // url -> template (each file loads once)

// Merge primitives that share a material into one mesh, so a VRoid model costs
// ~15 draw calls instead of ~100. Morph-target meshes (the face) are left alone.
function mergeByMaterial(root: THREE.Object3D) {
  const groups = new Map<string, THREE.SkinnedMesh[]>(); // material key -> meshes
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh; // candidate
    if (!m.isSkinnedMesh || m.morphTargetInfluences?.length) return; // only plain skinned meshes
    const mats = Array.isArray(m.material) ? m.material : [m.material]; // surface (+ outline)
    const attrs = Object.keys(m.geometry.attributes).sort().join(","); // attribute signature must match
    const key = `${mats.map((x) => x.uuid).join("|")}#${attrs}#${m.skeleton.uuid}#${m.bindMatrix.elements.join(",")}`; // same look + same rig
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m); // collect
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue; // nothing to merge
    const geos = list.map((m) => { const g = m.geometry.clone(); g.clearGroups(); return g; }); // outline groups re-added below
    const merged = mergeGeometries(geos, false); // one buffer
    if (!merged) continue; // incompatible, leave as is
    geos.forEach((g) => g.dispose()); // temp copies
    const first = list[0]; // keeper
    if (Array.isArray(first.material)) { const n = merged.index ? merged.index.count : merged.attributes.position.count; first.material.forEach((_, i) => merged.addGroup(0, n, i)); } // surface + outline passes
    first.geometry.dispose(); first.geometry = merged; // swap in
    list.slice(1).forEach((m) => { m.removeFromParent(); m.geometry.dispose(); }); // drop the rest
  }
}

// Load (once) and prepare a model.
export function loadTemplate(file: string): Promise<Template> {
  const url = `/models/${file}`; // served from public/
  if (cache.has(url)) return cache.get(url)!; // already loading / loaded
  const p = (async () => {
    const loader = new GLTFLoader(); // glTF reader
    loader.register((parser) => new VRMLoaderPlugin(parser)); // adds VRM + MToon
    const gltf = await loader.parseAsync(await fetchModel(file), "/models/"); // parse the shared download (may already be prefetched)
    const vrm = gltf.userData.vrm as VRM; // the VRM wrapper
    VRMUtils.removeUnnecessaryVertices(gltf.scene); // drop unused verts
    VRMUtils.combineSkeletons(gltf.scene); // one skeleton for all meshes
    gltf.scene.traverse((o) => { // keep toon outlines only on hair + face (where they read as anime); drop them on body/clothes to halve those triangles
      const m = o as THREE.Mesh; // candidate
      if (m.isMesh && Array.isArray(m.material) && /CLOTH|Body/.test(m.material[0].name)) { m.material = m.material[0]; m.geometry.clearGroups(); } // surface only
    });
    mergeByMaterial(gltf.scene); // fewer draw calls
    gltf.scene.traverse((o) => faceFill(o as THREE.Mesh)); // soft "desk lamp" fill on faces and hands (shared by every clone)
    const extras: THREE.Object3D[] = []; // spring-bone colliders + the normalized rig (we pose raw bones, no physics)
    gltf.scene.traverse((o) => { if ("colliderMatrix" in o || o === vrm.humanoid.normalizedHumanBonesRoot) extras.push(o); }); // can't be cloned safely
    extras.forEach((o) => o.removeFromParent()); // drop them
    vrm.scene.traverse((o) => { o.frustumCulled = false; (o as THREE.Mesh).raycast = () => {}; }); // skinned bounds are unreliable; clicks go to the desk hitboxes
    const boneNames: Template["boneNames"] = {}; // bone -> node name
    for (const b of BONES) { const n = vrm.humanoid.getRawBoneNode(b); if (n) boneNames[b] = n.name; } // raw rig
    const hips = vrm.humanoid.getRawBoneNode("hips")!; // pelvis
    const hipsY = hips.getWorldPosition(new THREE.Vector3()).y; // rest height
    const morphs: Template["morphs"] = { blink: [], happy: [], relaxed: [] }; // expression binds (VRM0 joy/fun = happy/relaxed)
    for (const name of ["blink", "happy", "relaxed"] as const) {
      const ex = vrm.expressionManager?.getExpression(name); // preset
      ex?.binds.forEach((bd) => {
        if (bd instanceof VRMExpressionMorphTargetBind) bd.primitives.forEach((m) => morphs[name].push({ mesh: m.uuid, index: bd.index })); // by original mesh id
      });
    }
    const isVRM0 = vrm.meta?.metaVersion === "0"; // spec version
    // Bare-leg/foot body texture, loaded once with the template so dressing
    // a clone can swap it in without a later flicker of socks.
    let bareBody: THREE.Texture | undefined; // missing = no variant for this file
    const bareUrl = BARE_BODY[file]; // per-character path under public/looks
    if (bareUrl) {
      bareBody = await new THREE.TextureLoader().loadAsync(bareUrl); // same origin
      bareBody.colorSpace = THREE.SRGBColorSpace; // the PNG is sRGB, like the original body map
      bareBody.flipY = false; // glTF / VRM UVs start at the top-left, not WebGL's bottom-left
      bareBody.needsUpdate = true; // apply the colour space and flip
    }
    return { scene: vrm.scene, boneNames, hipsY, morphs, isVRM0, bareBody };
  })();
  cache.set(url, p); // remember even while loading
  p.catch(() => cache.delete(url)); // allow retry after a failure
  return p;
}

// Make a cheap clone: shared geometry/materials, own bones and morph weights.
// `tint` optionally recolours skin/hair (allowed: the models are CC0).
// `look` applies the wardrobe: outfit tint, neck accessory, and shoes/socks (see looks.ts).
export function instantiate(t: Template, tint?: { skin?: THREE.Color; hair?: THREE.Color }, look?: Look): Instance {
  const root = skeletonClone(t.scene); // new bones, shared buffers
  // Map original objects -> clones (same traversal order) to find morph meshes.
  const orig: THREE.Object3D[] = []; t.scene.traverse((o) => orig.push(o)); // source order
  const copy: THREE.Object3D[] = []; root.traverse((o) => copy.push(o)); // clone order
  const byUuid = new Map(orig.map((o, i) => [o.uuid, copy[i]])); // original uuid -> clone
  const bones: Instance["bones"] = {}; // posable bones
  for (const [b, n] of Object.entries(t.boneNames)) { const o = root.getObjectByName(n!); if (o) bones[b as VRMHumanBoneName] = o; } // lookup by name
  const morphs = Object.fromEntries(Object.entries(t.morphs).map(([k, list]) => [k, list.map((x) => ({ mesh: byUuid.get(x.mesh) as THREE.Mesh, index: x.index })).filter((x) => x.mesh)])) as Record<string, { mesh: THREE.Mesh; index: number }[]>; // per-clone targets
  root.traverse((o) => { o.frustumCulled = false; (o as THREE.Mesh).raycast = () => {}; }); // clones don't copy these: no culling glitches, no click stealing
  if (tint) root.traverse((o) => tintMesh(o as THREE.Mesh, tint)); // recolour
  if (look) root.traverse((o) => dress(o as THREE.Mesh, look, t.bareBody)); // wardrobe choices
  return {
    root, bones, hipsY: t.hipsY, sign: t.isVRM0 ? -1 : 1,
    setExpression: (name, w) => morphs[name]?.forEach(({ mesh, index }) => { if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = w; }), // set weight
  };
}

// Face fill: the hall is lit from high above, so a head tilted toward a book
// falls into shadow and the eyes, nose and mouth disappear. Instead of adding a
// real light per student (every extra light costs every pixel in the hall), we
// give face and hand materials a faint warm glow from their own texture, as if
// the desk lamp were bouncing light up off the open book, and lift their shadow
// colour so the shaded side of the face still shows its features.
const FILL = new THREE.Color("#ffd9b0"); // warm lamp-bounce colour
type Toon = THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null; emissive?: THREE.Color; emissiveMap?: THREE.Texture | null; shadeColorFactor?: THREE.Color; shadeMultiplyTexture?: THREE.Texture | null }; // MToon fields we touch
function faceFill(m: THREE.Mesh) {
  if (!m.isMesh) return; // only meshes
  const mats = (Array.isArray(m.material) ? m.material : [m.material]) as Toon[]; // surface (+ outline)
  for (const mat of mats) {
    const face = /_Face_|_EYE|_FACE/.test(mat.name); // face skin, eyes, brows, lashes, mouth
    const skin = /Body_00_SKIN/.test(mat.name); // body skin (shows on hands)
    if ((!face && !skin) || !mat.color || !mat.emissive || mat.userData.filled) continue; // only skin/face MToon, once
    const glow = face ? 0.22 : 0.12; // faces get more fill than hands
    if (mat.map) { mat.emissiveMap = mat.map; mat.emissive.copy(FILL).multiplyScalar(glow); } // glow follows the painted texture, so eyes stay dark and skin stays skin-coloured
    else mat.emissive.copy(mat.color).multiply(FILL).multiplyScalar(glow); // untextured fallback: glow in the base colour
    mat.shadeColorFactor?.lerp(mat.color, face ? 0.45 : 0.25); // shaded side moves part-way toward the lit colour (softer shadow, same mood)
    mat.userData.filled = true; // don't apply twice (outline pass can share the material)
    mat.needsUpdate = true; // recompile with the emissive map
  }
}

// Wardrobe on one clone's mesh: hide shoes or the neck accessory (each is its
// own mesh after merging, so nothing else changes), tint the top, and when
// shoes are off, swap the body skin map for the bare-leg/foot variant so
// painted socks, tights and leg warmers come off with the shoes.
function dress(m: THREE.Mesh, look: Look, bareBody?: THREE.Texture) {
  if (!m.isMesh) return; // only meshes
  const mats = (Array.isArray(m.material) ? m.material : [m.material]) as Toon[]; // surface (+ outline)
  const name = mats[0]?.name ?? ""; // material name tells the part
  if (/_Shoes_/.test(name)) m.visible = look.shoes !== "off"; // hide the shoe mesh
  if (/_AccessoryNeck_/.test(name)) m.visible = look.neck !== "off"; // ribbon / tie
  const tint = /_Tops_/.test(name) ? TOP_TINTS[look.top] : null; // outfit colour
  if (tint) tintMesh(m, { cloth: new THREE.Color(tint) }); // multiplied over the cloth texture
  // Body skin is shared across clones, so we clone the material (like
  // tintCache) rather than mutating the original map. The MToon shade
  // slot also uses Body_00; if we only swapped map, socks would still
  // show in the shaded areas.
  if (bareBody && look.shoes === "off" && /Body_00_SKIN/.test(name)) {
    m.material = Array.isArray(m.material) ? mats.map((mat) => bareSkin(mat, bareBody)) : bareSkin(mats[0], bareBody); // both passes
  }
}

// Shared bare-skin material variants (ten avatars with shoes off still share one).
const bareCache = new Map<string, THREE.Material>(); // original uuid -> bare clone
function bareSkin(mat: Toon, tex: THREE.Texture): THREE.Material {
  const key = `${mat.uuid}:bare`; // one clone per source material
  if (!bareCache.has(key)) {
    const v = mat.clone() as Toon; // leave the shared original untouched
    v.map = tex; // lit colour
    if ("shadeMultiplyTexture" in v) v.shadeMultiplyTexture = tex; // MToon shade (same Body_00 on these characters)
    if (v.emissiveMap) v.emissiveMap = tex; // faceFill glow follows the painted skin, including bare legs
    v.needsUpdate = true; // pick up the new maps
    bareCache.set(key, v); // share
  }
  return bareCache.get(key)!; // reused
}

// Shared tinted material variants (so ten avatars with the same tint still share one material).
const tintCache = new Map<string, THREE.Material>(); // key -> material
function tintMesh(m: THREE.Mesh, tint: { skin?: THREE.Color; hair?: THREE.Color; cloth?: THREE.Color }) {
  if (!m.isMesh) return; // only meshes
  const swap = (mat: THREE.Material) => {
    const kind = /SKIN/.test(mat.name) ? "skin" : /HAIR/.test(mat.name) ? "hair" : /CLOTH/.test(mat.name) ? "cloth" : null; // which part
    const c = kind ? tint[kind] : undefined; // colour for it
    if (!c) return mat; // untouched
    const key = `${mat.uuid}:${c.getHexString()}`; // variant id
    if (!tintCache.has(key)) {
      const v = mat.clone() as THREE.Material & { color?: THREE.Color; shadeColorFactor?: THREE.Color }; // MToon copy
      v.color?.multiply(c); // lit colour
      v.shadeColorFactor?.multiply(c); // shadow colour
      (v as Toon).emissive?.multiply(c); // face fill glow follows the skin tint too
      tintCache.set(key, v); // share
    }
    return tintCache.get(key)!;
  };
  m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material); // surface (+ outline)
}
