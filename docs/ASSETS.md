# Hush Hall: assets and licences (3D hall, 11 Nov 2026)

**No third-party art assets are used.** Everything in the 3D hall is generated in code at runtime:

| What | How it's made | Licence |
|---|---|---|
| Room, desks, chairs, banker's lamps, bookshelves, books, windows, plants | Low-poly three.js primitives (boxes, cylinders, spheres, capsules) in `app/components/three/*.tsx` | Our own code |
| Floor planks, rug, brass plaques, lamp glow, contact shadows, night/rain glass | Canvas 2D drawings in `app/components/three/textures.ts` | Our own code |
| Avatars (faces, jawline, hair, hoodie/kurta/sweater) | Sphere head reshaped into a tapered jaw and chin; face painted on a canvas texture (eyes with highlights, brows, nose, mouth, blush) | Our own code |
| Rain ambience | Web Audio filtered brown noise (`app/lib/ambient.ts`), no audio files | Our own code |
| Chime | Web Audio sine tones (`app/lib/chime.ts`) | Our own code |

**Libraries** (npm, licence read from each package's `package.json`):
- three 0.187.0: MIT
- @react-three/fiber 9.8.2: MIT
- @react-three/drei 10.7.9: MIT
- next 16.4.6 and react 19.3.1: MIT

**Fonts:** system fonts only (Georgia / system-ui). Nothing is downloaded at runtime.

**Considered, not used:** ready-made VRM/glTF anime avatars (e.g. CC0 models on VRoid Hub). Each model's licence would need checking one by one, and they're heavy (often several MB and thousands of triangles each). Procedural avatars keep the download tiny and the licence simple. If we switch later, record each model's URL, author and licence here before committing it.
