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
- Skin and hair colours tinted at runtime for Indian-inclusive looks.
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
