# Hush Hall: going live (free tiers)

The code is complete for Supabase (accounts, desks, presence, requests, rooms,
blocks, reports, moderation) and LiveKit (voice in study rooms). Nothing here
costs money on the free plans. Without env vars the app runs in offline demo mode.

## 1. Supabase (required)

1. Create a project on the Free plan (a region near your users, e.g. Mumbai).
2. **SQL Editor** -> paste all of `supabase/migrations/0001_hush_hall.sql` -> **Run**. It should finish without errors.
   Then paste all of `supabase/migrations/0002_hall_walkers.sql` -> **Run** (people walking around are stored and read from the database, so they show even when the live channel is down). Safe to run again.
   Then paste all of `supabase/migrations/0003_floor_and_looks.sql` -> **Run** (sitting on the floor with a topic, and saved wardrobe choices). Run it after 0002 (re-running 0002 later would undo it; run 0003 again if that happens). Safe to run again.
   Then paste all of `supabase/migrations/0004_desk_notes.sql` -> **Run** (private desk notes with titles, sources, links and annotations). Safe to run again.
3. **Authentication -> Sign In / Providers -> Email**: keep it enabled (magic links are used; no passwords).
4. **Authentication -> URL Configuration**:
   - Site URL: your Vercel production URL, e.g. `https://hush-hall.vercel.app`
   - Redirect URLs: add `https://<your-domain>/auth/callback` and, for local testing, `http://localhost:3123/auth/callback`
5. **Realtime -> Settings**: leave "Allow public access" ON (default). Hall presence channels are private and checked by the policies in the SQL file.
6. **Project Settings -> API** (or API Keys): copy the Project URL, the anon / publishable key, and the service_role / secret key.
7. Before a public launch: set up custom SMTP under Authentication -> Emails. Supabase's built-in sender is meant for testing and is rate-limited.
8. Moderators: after Chinmaye and Priya have each signed up once in the app, run in the SQL Editor:
   ```sql
   insert into public.moderators (user_id)
   select id from auth.users where email in ('mankataliachinmaye@gmail.com', '<priya email>');
   ```
   They then see "Report queue" on the lobby card (`/mod`).
9. Optional: words that must not appear in nicknames/topics: `insert into public.blocked_words (word) values ('...');` (lower case).

## 2. LiveKit (voice in study rooms; optional)

1. Create a project on LiveKit Cloud's free "Build" plan.
2. Settings -> Keys: create an API key. Note the key, the secret, and the project URL (`wss://<project>.livekit.cloud`).
3. Do not enable recording/egress. The app never asks for it and tokens are microphone-only.
Without LiveKit keys, rooms still work (members, leave, owner remove) and the voice area says "Voice isn't switched on yet".

## 3. Environment variables

Local: copy `app/.env.example` to `app/.env.local` and fill it in (`.env.local` is gitignored).
Vercel: Project -> Settings -> Environment Variables, the same six names:

| Name | Where it comes from | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon / publishable key | no (RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role / secret key | **yes, server only** |
| `LIVEKIT_URL` | `wss://<project>.livekit.cloud` | no |
| `LIVEKIT_API_KEY` | LiveKit key | yes |
| `LIVEKIT_API_SECRET` | LiveKit secret | **yes** |

## 4. Vercel (Hobby)

Import the GitHub repo, set **Root Directory = `app`** (Next.js is detected), add the env vars above, deploy. Then put the deployed URL into Supabase step 4.
Vercel says Hobby is for personal, non-commercial use; move to Pro before Hush Hall takes money.

## 5. Check it works

1. Sign in with two different emails in two browsers; finish the 18+ card in each.
2. Both walk into Main Reading Hall: each sees the other's desk appear live after they sit.
3. Send a request from one desk card; the other accepts during a break: both see the study room panel. Join voice in both (consent, muted, hold to talk).
4. Report one account from the other; a moderator sees it at `/mod`.

## Local checks without the cloud

- Database rules: `supabase/tests/local_stub.sql` + the migration + `supabase/tests/rules_test.sql` on any scratch Postgres 15+ (prints `ALL_RULES_OK`); then `0002_hall_walkers.sql` + `supabase/tests/walkers_test.sql` (prints `ALL_WALKER_RULES_OK`); then `0003_floor_and_looks.sql` + `supabase/tests/floor_looks_test.sql` (prints `ALL_FLOOR_LOOK_RULES_OK`); then `0004_desk_notes.sql` + `supabase/tests/desk_notes_test.sql` (prints `ALL_DESK_NOTE_RULES_OK`).
- Voice grants were checked against a local `livekit-server --dev`: a second participant received the microphone track and a camera publish was refused.
- Account deletion: `account_delete_test.sql` after migrations 0001–0004 (prints `ALL_DELETE_RULES_OK`): deleting the login leaves no rows about that person, including desk notes.

## Google Play (Android app)

See `docs/PLAY.md`: package `app.hushhall.android`, how to build the AAB, where the upload keystore lives, and what's still needed (US$25 fee, identity verification, 12 testers for 14 days).
