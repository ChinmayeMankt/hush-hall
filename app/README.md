# Hush Hall prototype

Runs fully locally: no accounts, no network services.

```bash
npm install
npm run dev        # http://localhost:3123
npm run build      # production build check
node scripts/screenshots.mjs   # with dev server running; saves PNGs to ../screenshots
```

- Open **2–3 tabs**: each tab is a different student (per-tab identity in sessionStorage). Presence goes over `BroadcastChannel`.
- Halls contain a few **demo students** (generated locally, labelled "demo student" on their desk card). Requests to them auto-accept after about 2.5 s.
- `?speed=60` on a hall URL makes the timer 60× faster for demos.
- Swap the backend in `lib/presence/index.ts` (see `../docs/STACK.md`).

Layout: `app/` (routes), `components/` (HallView, Desk, Dialogs), `lib/presence/` (interface + BroadcastChannel mock), `lib/halls.ts`, `lib/profile.ts`, `lib/chime.ts`.
