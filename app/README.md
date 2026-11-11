# Hush Hall

Two modes:
- **Real app** (Supabase + optional LiveKit): set the env vars in `.env.local` (see `.env.example` and `../docs/SETUP.md`). Email magic-link sign-in, 18+ sign-up, live desks, requests, study rooms with voice, block/report, moderator queue at `/mod`, study log at `/me`.
- **Demo mode** (no env vars): runs fully locally, no accounts, no network services (BroadcastChannel presence, localStorage history, demo students).

```bash
npm install
npm run dev        # http://localhost:3123
npm run build      # production build check
node scripts/screenshots.mjs   # with dev server running; saves PNGs to ../screenshots
```

- Open **2–3 tabs**: each tab is a different student (per-tab identity in sessionStorage). Presence goes over `BroadcastChannel`.
- Halls contain a few **demo students** (generated locally, labelled "demo student" on their desk card). Requests to them auto-accept after about 2.5 s.
- `?speed=60` on a hall URL makes the timer 60× faster for demos.
- Backends: `lib/presence/index.ts` picks `SupabasePresence` when Supabase is configured, else the BroadcastChannel demo. Database schema and rules: `../supabase/migrations/0001_hush_hall.sql`, plus `0002_hall_walkers.sql` (walkers stored in the database) and `0003_floor_and_looks.sql` (floor sitting with a topic, saved wardrobe).
- Speed: `node scripts/perf3d.mjs` against `next start -p 3124` measures model download and frame numbers.

## 3D hall

- The default hall view is an illustrated 3D reading room (react-three-fiber + drei). Students are anime VRM characters (CC0 VRoid samples by pixiv, rendered with @pixiv/three-vrm + MToon; see `../docs/ASSETS.md`). Models lazy-load from `public/models/`, are cloned with SkeletonUtils (shared geometry/textures), and fall back to low-poly avatars if loading fails or past 12 on screen. Poses: focus (lean in, hands on desk, eyes down, blinking, breathing), break (arms-up stretch, happy face), empty chair pushed out. "Simple view" switches back to the 2D desk cards. The 2D view is also the fallback when WebGL isn't available. `?view=2d` / `?view=3d` force a view.
- Overview: 3/4 camera, + / − (or mouse wheel) to zoom. Hover a desk for a preview (nickname, avatar, topic); click for the desk card. Click a vacant desk to sit.
- Sitting: the camera glides (about 3 s) to first-person eye level at your desk, with a minimal timer note top-right. Standing up glides back.
- Walking (optional): "Walk around" (top-left of the scene, or in the timer note while seated, which stands you up with the usual recap and frees the desk) puts you on foot with a third-person camera behind your own VRM character. WASD / arrow keys walk at a calm pace, drag to look, Q/E turn the view, mouse wheel sets the camera distance; touch screens get a small move pad. Keys are ignored while typing or when a dialog is open. Desks, chairs, plants and walls are solid (you glide along them). Tap a free desk to sit as usual. The VRoid samples have no animation clips, so the walk is procedural (IK legs with planted feet driven by distance walked, hip bob/sway, counter-twist, arm swing, relaxed hands; idle weight shift); faces and materials are untouched. Others in the hall see walkers through the same presence channel (position, facing, walking/idle, about 2.5 updates a second while moving), smoothed on their side.
- Quicker walk: hold Shift (touch: the quiet "Quicker" button) for a slightly brisker library pace (1.45 m/s instead of 1.0, longer stride, slight forward lean). No running, no crouch.
- Aisles: desks are 2.5 m apart along each row, leaving a 0.8 m walkway between neighbours; walking along a walkway is gently centred so you don't snag on desk corners.
- Floor sitting: while walking, press G (or "Sit on the floor"), type what you're studying, and you kneel (seiza) on a reading cushion with an open book; others see the topic on your name tag (the server filters it like desk topics, and "hide topic" applies). Any walking key or "Get up" stands you up. Desk sitting is unchanged. Others walk round you.
- Wardrobe ("Wardrobe" button): a deliberately small set that only uses the approved characters' own meshes: top colour (Original / Soft blue / Sage, a tint over the original texture), neck ribbon or tie on/off (characters that have one), shoes off. Socks/tights are painted into the body textures, so there is no socks-off option. Saved to your profile (`profiles.look`); others see changes after their next profile refresh.
- Bigger view: in the 3D view the scene fills the window width. "Full screen" (or the F key) puts the hall, its notes and dialogs in browser full screen; Esc or the same button leaves it.
- `prefers-reduced-motion`: camera cuts instead of glides, avatars hold still, tags don't float, and rendering is on demand.
- Soft rain (moving window rain + Web Audio ambience) is off by default.
- Re-optimise a VRoid VRM: `python3 scripts/optimize_vrm.py in.vrm public/models/out.vrm 512`.
- Screenshots: `node scripts/screenshots3d.mjs` (headless Chrome with SwiftShader WebGL).

Layout: `app/` (routes), `components/` (HallView, Desk, Dialogs), `lib/presence/` (interface + BroadcastChannel mock), `lib/halls.ts`, `lib/profile.ts`, `lib/chime.ts`, `lib/ambient.ts`, `lib/env.ts`, `components/three/` (Hall3D, Room, Desks, Avatar, VrmAvatar, Walking, walk, layout, textures), `lib/presence/walkers.ts` (live positions of people on foot).
