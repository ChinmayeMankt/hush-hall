# Hush Hall: assets and licences (updated 11 Nov 2026)

## Anime characters (VRM)

The seated students are **VRoid sample characters by pixiv Inc. (VRoid Project), all CC0**. They're rendered with @pixiv/three-vrm (MIT) using MToon toon shading.

| File in `app/public/models/` | Character | Official licence page | Licence (official page + VRM meta) |
|---|---|---|---|
| `sendagaya_shibu.vrm` | Sendagaya Shibu (β Ver AvatarSample_1) | https://vroid.pixiv.help/hc/en-us/articles/360012381793 | CC0 |
| `vivi.vrm` | Vivi (β Ver AvatarSample_2, later AvatarSample_E) | https://vroid.pixiv.help/hc/en-us/articles/360014900273 | CC0 |
| `victoria_rubin.vrm` | Victoria Rubin (β Ver AvatarSample_3, later AvatarSample_G) | https://vroid.pixiv.help/hc/en-us/articles/360014900113 | CC0 |
| `vita.vrm` | Vita (β Ver AvatarSample_4, later AvatarSample_F) | https://vroid.pixiv.help/hc/en-us/articles/360014900233 | CC0 |
| `sakurada_fumiriya.vrm` | Sakurada Fumiriya (male) | https://vroid.pixiv.help/hc/en-us/articles/360014788554 | CC0 |
| `sendagaya_shino.vrm` | Sendagaya Shino | https://vroid.pixiv.help/hc/en-us/articles/360013482714 | CC0 |
| `hairsample_male.vrm` | HairSample_Male (male base model) | https://vroid.pixiv.help/hc/en-us/articles/4402614652569 (listed under "CC0 license models") | CC0 |

**What the official pages say (summary).** "The CC license for this model is CC0. This model can be edited and used freely." pixiv Inc. has waived all copyright and related or neighbouring rights, published from Japan. The pages also ask users to "use this model appropriately, within the scope of common sense" and not to harm or disturb other people. CC0 allows app use, redistribution, modification and commercial use, with no credit required. We credit pixiv here anyway.

**VRM meta inside each file** (read with `scripts/optimize_vrm.py`'s parser, before and after optimisation):
- `licenseName: "CC0"`
- `allowedUserName: "Everyone"`
- `commercialUssageName: "Allow"`
- `violentUssageName: "Allow"`
- `sexualUssageName: "Allow"`

**Where the files came from.**
- VRoid Hub serves these files only to logged-in users, and we didn't create an account.
- The exact pixiv exports were taken from the public GitHub mirror https://github.com/madjin/vrm-samples (`vroid/beta/*.vrm`).
- Each file's embedded VRM meta was checked against pixiv's official CC0 pages above.
- OpenGameArt hosts the same CC0 set: https://opengameart.org/content/vroid-studio-cc0-models

**Not used:**
- AvatarSample_A/B/C. They're under pixiv's own terms, not CC0 (https://vroid.pixiv.help/hc/en-us/articles/4402394424089). The terms are permissive, but they forbid re-licensing derived VRMs as CC0 and add other conditions.
- The three-vrm example `VRM1_Constraint_Twist_Sample.vrm` (meta: everyone, corporate commercial use OK, redistribution and modification allowed). It's licensed fine, but its rest pose isn't neutral, so it doesn't fit our pose code.
- Seed-san (VirtualCast). Credit is required; not needed.

**Our modifications** (allowed under CC0):
- Textures first downscaled to 512 px (optimize_vrm.py). Colour and cut-out textures were later restored from pixiv's originals at up to 1024 px as WebP (scripts/restore_vrm_textures.py, 12 Nov 2026): face/eye art lossless, the rest high-quality lossy; normal/specular/matcap maps unchanged; transparent texels colour-filled so filtering leaves no dark fringes.
- Vita's outfit layer is flattened onto a near-black fabric colour so she keeps the dark long-sleeved dress the hall has always shown (her original texture is a see-through bodysuit).
- Morph targets trimmed to blink, happy, relaxed and "a".
- Toon outlines kept only on hair and face.
- Skin and hair colours tinted at runtime for Indian-inclusive looks (skin tints re-balanced 16 Nov 2026 to remove an orange cast under the amber room light; same range of depth).
- Runtime material polish (`polish()` in `components/three/vrm.ts`, 16 Nov 2026): hair highlight band boosted, brighter irises, slightly stronger and softer face fill. These are shader settings on the existing materials, with no new textures, lights or draw calls.
- Edge-halo fix (16 Nov 2026, `sharpen()` in `components/three/vrm.ts`): the painted highlight layer (matcap) is faded out toward each surface's silhouette, which removes the bright halo along hair and collar outlines; cut-out edge pixels are darkened slightly to hide the pale fill colour under transparent texels; face and eye textures now use mipmaps (no grain at normal distance); and when the canvas has no antialiasing (`setMsaa()`, reported by `Hall3D`), cut-outs use a clean hard cut-off instead of alpha-to-coverage.
- **Edge colour fix (16 Nov 2026), the root cause of the speckled hair:** the back-hair layer (`*_HairBack_00`, the outer silhouette and side strands) is an alpha-blended material, and its soft edge texels were exported nearly white (luma 0.96 against 0.55 for the solid hair; 98.9% of edge texels clearly lighter than the hair beside them). Blended onto the scene, every strand got a pale fringe, which shows as white specks and a "bouncing light" outline at any resolution. Eye highlights, eyelines, lashes and brows had the same problem with grey or dark rims. `scripts/fix_edge_colours.py` (and `clean_edges()` in `restore_vrm_textures.py`) repaints every non-solid texel of those images with the colour of the nearest solid texel; alpha, shape, size and all other textures are unchanged. After the fix, edge luma equals core luma (0.55 vs 0.55) and 0% of edge texels are lighter. Run `python3 scripts/fix_edge_colours.py public/models` after any texture re-export.
- **Edge smoothing (17 Nov 2026):** with Sharper on, `Hall3D` draws through a small post-process chain (`Smooth`: one multisampled buffer, up to 8x where the GPU supports it, then FXAA; the final pass doesn't swap buffers so only one multisampled buffer exists) so stair-steps that hardware MSAA leaves on cut-out hair, thin lines and shader edges are smoothed. The buffer is flagged as an XR-style sRGB target so three applies each material's own tone mapping and sRGB encoding while drawing; colours (including `toneMapped={false}` lamps, screens and the background) match the direct path to within 0.5/255 in a test scene. Turning Sharper off unmounts the chain and goes back to direct drawing. While Sharper is on, the adaptive resolution never drops below 1.5x (or the screen's own density if higher).
- **Toon outlines removed (17 Nov 2026):** the dark outline round faces and hair is now off for every character (`OUTLINES = false` in `components/three/vrm.ts`; `dropOutlines()` strips only the outline passes and keeps every surface of a multi-part mesh such as the face). It read as a harsh black line at hall distance, and dropping it also removes a second draw of every hair and face triangle. Set `OUTLINES = true` to bring it back (hair and face only); the fix below then keeps it unbroken.
- **Outline dashes fix (17 Nov 2026), the cause of the broken chin and hair outlines:** MToon draws the dark outline as a second copy of the mesh pushed out by a fixed world-space width (about a millimetre), which a few metres from the camera is far less than one screen pixel. It then only covers the pixels it happens to hit, so the line breaks into dashes at any resolution or antialiasing setting. `patchOutline()` in `components/three/vrm.ts` gives the outline a minimum width of 1.5 device pixels (more at higher pixel ratios); `OutlineSync` in `Hall3D.tsx` keeps the canvas height up to date. Close up, the authored width is wider and unchanged. Tinted material clones are tracked with `trackOutline()`.
- Sparkle fix (16 Nov 2026): the matcap highlight is also faded where the surface normal changes sharply between neighbouring pixels (specular anti-aliasing, `fwidth(normal)`), and `HAIR_SHEEN` was lowered from 1.7 to 1.3. This removes white speckle in hair seen on a real Intel UHD GPU at 1.25x pixel ratio. `Hall3D` also no longer lets the adaptive resolution fall below the screen's own density when that is fractional (1.25x or 1.5x), because a 1x image stretched by the browser softens and shimmers the whole scene.
- The script is `app/scripts/optimize_vrm.py`. Originals are about 15–19 MB each; optimised files are about 2.6–3.7 MB (about 1.4–2 MB gzipped).

## Everything else (procedural)

| What | How it's made | Licence |
|---|---|---|
| Room, desks, chairs, banker's lamps, shelves, books, windows, plants | Low-poly three.js primitives in `app/components/three/*.tsx` | Our own code |
| Floor, rug, plaques, glow, shadows, rain glass | Canvas 2D drawings in `app/components/three/textures.ts` | Our own code |
| Low-poly fallback avatars (used when a VRM can't load, or past the 12-model GPU budget) | `app/components/three/Avatar.tsx` | Our own code |
| Rain ambience, chime | Web Audio synthesis (`app/lib/ambient.ts`, `app/lib/chime.ts`), no audio files | Our own code |

## Libraries (npm; licence read from each package.json)
- @pixiv/three-vrm 3.5.5: MIT
- three 0.187.0: MIT
- @react-three/fiber 9.8.2: MIT
- @react-three/drei 10.7.9: MIT
- next 16.4.6 and react 19.3.1: MIT

Fonts: system fonts only.
