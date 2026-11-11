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
- Backends: `lib/presence/index.ts` picks `SupabasePresence` when Supabase is configured, else the BroadcastChannel demo. Database schema and rules: `../supabase/migrations/0001_hush_hall.sql`.
- Speed: `node scripts/perf3d.mjs` against `next start -p 3124` measures model download and frame numbers.

## 3D hall

- The default hall view is an illustrated 3D reading room (react-three-fiber + drei). Students are anime VRM characters (CC0 VRoid samples by pixiv, rendered with @pixiv/three-vrm + MToon; see `../docs/ASSETS.md`). Models lazy-load from `public/models/`, are cloned with SkeletonUtils (shared geometry/textures), and fall back to low-poly avatars if loading fails or past 12 on screen. Poses: focus (lean in, hands on desk, eyes down, blinking, breathing), break (arms-up stretch, happy face), empty chair pushed out. "Simple view" switches back to the 2D desk cards. The 2D view is also the fallback when WebGL isn't available. `?view=2d` / `?view=3d` force a view.
- Overview: 3/4 camera, + / − (or mouse wheel) to zoom. Hover a desk for a preview (nickname, avatar, topic); click for the desk card. Click a vacant desk to sit.
- Sitting: the camera glides (about 3 s) to first-person eye level at your desk, with a minimal timer note top-right. Standing up glides back.
- `prefers-reduced-motion`: camera cuts instead of glides, avatars hold still, tags don't float, and rendering is on demand.
- Soft rain (moving window rain + Web Audio ambience) is off by default.
- Re-optimise a VRoid VRM: `python3 scripts/optimize_vrm.py in.vrm public/models/out.vrm 512`.
- Screenshots: `node scripts/screenshots3d.mjs` (headless Chrome with SwiftShader WebGL).

Layout: `app/` (routes), `components/` (HallView, Desk, Dialogs), `lib/presence/` (interface + BroadcastChannel mock), `lib/halls.ts`, `lib/profile.ts`, `lib/chime.ts`, `lib/ambient.ts`, `lib/env.ts`, `components/three/` (Hall3D, Room, Desks, Avatar, layout, textures).
