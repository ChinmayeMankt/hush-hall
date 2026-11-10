"use client"; // browser-only (WebGL + fetch)

// Loads anime VRM characters once, makes them cheap to draw, and hands out
// lightweight clones that share geometry, textures and materials.
//
// Models: CC0 VRoid sample characters by pixiv Inc. (see docs/ASSETS.md),
// shrunk offline by scripts/optimize_vrm.py (512px textures, only the morphs we use).
// Rendering: @pixiv/three-vrm (MIT) with MToon toon shading.

import * as THREE from "three"; // core
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"; // glTF/VRM container
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js"; // skinned-mesh-safe clone
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"; // batch primitives
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName, VRMExpressionMorphTargetBind } from "@pixiv/three-vrm"; // VRM + MToon

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

// Bones we pose. Everything else stays at rest.
const BONES: VRMHumanBoneName[] = [
  "hips", "spine", "chest", "upperChest", "neck", "head",
  "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot",
  "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand", "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
  "leftMiddleProximal", "rightMiddleProximal", // to lay hands flat
];

// One loaded model, ready to clone.
export interface Template {
  scene: THREE.Object3D; // merged, unrotated scene (VRM 0.x faces -Z)
  boneNames: Partial<Record<VRMHumanBoneName, string>>; // humanoid bone -> node name
  hipsY: number; // hips height at rest (metres)
  morphs: Record<"blink" | "happy" | "relaxed", { mesh: string; index: number }[]>; // expression -> mesh/morph pairs
  isVRM0: boolean; // VRM 0.x needs X/Z rotations mirrored
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
    const gltf = await loader.loadAsync(url); // fetch + parse
    const vrm = gltf.userData.vrm as VRM; // the VRM wrapper
    VRMUtils.removeUnnecessaryVertices(gltf.scene); // drop unused verts
    VRMUtils.combineSkeletons(gltf.scene); // one skeleton for all meshes
    gltf.scene.traverse((o) => { // keep toon outlines only on hair + face (where they read as anime); drop them on body/clothes to halve those triangles
      const m = o as THREE.Mesh; // candidate
      if (m.isMesh && Array.isArray(m.material) && /CLOTH|Body/.test(m.material[0].name)) { m.material = m.material[0]; m.geometry.clearGroups(); } // surface only
    });
    mergeByMaterial(gltf.scene); // fewer draw calls
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
    return { scene: vrm.scene, boneNames, hipsY, morphs, isVRM0 };
  })();
  cache.set(url, p); // remember even while loading
  p.catch(() => cache.delete(url)); // allow retry after a failure
  return p;
}

// Make a cheap clone: shared geometry/materials, own bones and morph weights.
// `tint` optionally recolours skin/hair (allowed: the models are CC0).
export function instantiate(t: Template, tint?: { skin?: THREE.Color; hair?: THREE.Color }): Instance {
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
  return {
    root, bones, hipsY: t.hipsY, sign: t.isVRM0 ? -1 : 1,
    setExpression: (name, w) => morphs[name]?.forEach(({ mesh, index }) => { if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = w; }), // set weight
  };
}

// Shared tinted material variants (so ten avatars with the same tint still share one material).
const tintCache = new Map<string, THREE.Material>(); // key -> material
function tintMesh(m: THREE.Mesh, tint: { skin?: THREE.Color; hair?: THREE.Color }) {
  if (!m.isMesh) return; // only meshes
  const swap = (mat: THREE.Material) => {
    const kind = /SKIN/.test(mat.name) ? "skin" : /HAIR/.test(mat.name) ? "hair" : null; // which part
    const c = kind ? tint[kind] : undefined; // colour for it
    if (!c) return mat; // untouched
    const key = `${mat.uuid}:${c.getHexString()}`; // variant id
    if (!tintCache.has(key)) {
      const v = mat.clone() as THREE.Material & { color?: THREE.Color; shadeColorFactor?: THREE.Color }; // MToon copy
      v.color?.multiply(c); // lit colour
      v.shadeColorFactor?.multiply(c); // shadow colour
      tintCache.set(key, v); // share
    }
    return tintCache.get(key)!;
  };
  m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material); // surface (+ outline)
}
