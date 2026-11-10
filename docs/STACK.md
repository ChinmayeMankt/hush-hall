# Hush Hall: recommended stack (checked 11 Nov 2026, v0.2)

## Recommendation (short)

- **Web app:** Next.js (App Router, TypeScript), hosted on **Vercel Hobby** (free).
- **Backend, realtime, auth, database:** **Supabase** (Postgres + Auth + Realtime Presence/Broadcast) on the Free plan.
- **Audio (v1, small study rooms only, lands in week 3):** **LiveKit Cloud** free "Build" plan, with tokens minted by a Vercel serverless route. Self-hosted LiveKit is the fallback.
- **Mobile (later):** wrap the same web app with **Capacitor**. Choose **Expo** (React Native) only if you later need a fully native UI.

The prototype already hides presence behind `PresenceProvider` (`app/lib/presence/types.ts`), so moving from the local mock to Supabase means writing one class, `SupabasePresence`, and changing one line in `app/lib/presence/index.ts`.

## Why Supabase over Firebase

| | Supabase (Free) | Firebase (Spark, no-cost) |
|---|---|---|
| Data model | Postgres (SQL, relations, unique constraints, row-level security) | NoSQL (Firestore / Realtime Database) |
| Presence | Built-in **Realtime Presence** (sync/join/leave per channel) plus **Broadcast** for messages | No presence primitive. The usual approach is Realtime Database `onDisconnect` |
| Realtime free limits | 200 concurrent peak connections, 2 million messages/month, 256 KB max message | Realtime Database: 100 simultaneous connections, 1 GB stored, 10 GB/month downloaded |
| DB/storage free | 500 MB database, 5 GB egress, 1 GB file storage, 50,000 MAU auth | Firestore: 1 GiB stored, 50K reads/day, 20K writes/day, 10 GiB/month egress |
| Catch | **Free projects pause after 1 week of inactivity**; max 2 active free projects | Spark needs no card. Several products need the Blaze (pay-as-you-go) plan |
| Fit for Hush Hall | Seats, sittings, blocks and reports are relational. "One active sitting per desk" is a single SQL unique constraint. Presence maps directly to desks | Works, but you'd hand-roll presence, and the daily read/write quotas are easier to hit with heartbeats |

**Plain reasoning:** Hush Hall is mostly "who is at which desk right now" plus a few relational tables. Supabase gives presence as a feature and SQL for the rest. Firebase is a fine alternative, but it would need custom presence code. Its Realtime Database free tier caps at 100 simultaneous connections, versus Supabase's 200 concurrent Realtime connections. For a soft launch, either is probably enough (estimate). If usage grows past that, Supabase Pro starts at $25/month.

**Watch-outs:**
- A free Supabase project pauses after a week with no activity. During a quiet exam break the app would go down until someone resumes it in the dashboard.
- Open sign-up means more users. The free plan has 200 concurrent Realtime connections and 50,000 monthly active users for auth. A sign-up cap during the soft launch keeps us inside that.
- Server-side rate limits for join requests: a Postgres function (or Supabase Edge Function, 500,000 invocations/month free) that checks a `requests` table before inserting. Don't rely on the client.

## LiveKit for v1 audio rooms (week 3)

Decision: study rooms have audio in v1. Public halls stay silent with no audio at all.

**Free-tier facts (LiveKit "Build" plan, $0/month, no credit card):** 5,000 WebRTC participant minutes/month, 100 concurrent connections, 50 GB downstream data transfer. Paid "Ship" starts at $50/month (150,000 minutes, 1,000 concurrent). Source: https://livekit.io/pricing

**What that means (estimates, not measurements):**
- 5,000 participant-minutes ≈ 83 person-hours of audio per month. For example, about 40 two-person rooms of 1 hour each, or about 20 four-person 1-hour rooms.
- That's enough for week-4 testing and a small soft launch. A real launch would need Ship, or self-hosting on a small VM (cost not checked).
- 100 concurrent connections ≈ 25 four-person rooms at the same moment.
- Mitigations: cap room size at 4, auto-leave the room after a long idle period with no one talking (the limit is a setting to choose), and show "Rooms are full right now" instead of failing.

**How the safety rules map to LiveKit features** (participant docs: https://docs.livekit.io/home/server/managing-participants/):
- **Only accepted pairs can join:** a Vercel route checks Supabase that the requester holds an accepted request, then mints a short-lived token for that room only. API keys stay in Vercel env vars, never in the client.
- **Mute by default / push-to-talk:** the client connects with the mic track unpublished or muted and only unmutes while the talk key is held. Remote unmute by admins is off by default in LiveKit, which suits us.
- **Owner can remove:** the server calls `RemoveParticipant`. On LiveKit Cloud this also revokes their token, so they can't rejoin with it.
- **Moderator mute:** the server can call `MutePublishedTrack` (needs the `roomAdmin` grant, server-side only).
- **No recording:** recording in LiveKit is a separate Egress service that has to be explicitly started via API. We never call it and never give clients the grants for it.
- **Mic consent:** that's app UI (our consent screen before `getUserMedia`), not a LiveKit feature.

**Not verified:** whether LiveKit's free Build plan has restrictions on commercial use (I didn't see any on the pricing page); exact audio bandwidth per participant.

## Hosting: Vercel Hobby

- **$0/month.** Includes 100 GB/month fast data transfer, 1M edge requests/month, 1M function invocations/month, and 4 hours of Fluid active CPU/month.
- **Important:** Vercel says Hobby is for **personal, non-commercial use**. Once Hush Hall takes money (or is run as a business), it needs Pro ($20/month per developer seat) or another host.
- Hobby can't buy extra usage. Hitting a limit pauses things rather than charging you, which is safe for a student budget.

## Mobile wrapper (later)

- **Capacitor (Ionic):** open-source native runtime that wraps an existing web app for iOS/Android/PWA, with plugins like Local Notifications (useful for set-time alarms). Best fit: you keep one Next.js codebase. Note: Next.js needs a static export (or a hosted URL) for Capacitor.
- **Expo:** Expo and its SDK are free and open source (MIT). The cloud services have a free tier: 15 Android + 15 iOS builds/month, updates to 1,000 MAU. But it means rewriting the UI in React Native. Worth it only if native feel becomes a priority.
- Either way, app-store accounts cost money (not checked here), so this is a later decision.

## Sources (opened 11 Nov 2026)

- Supabase pricing: https://supabase.com/pricing
- Supabase Realtime Presence docs: https://supabase.com/docs/guides/realtime/presence
- Firebase pricing: https://firebase.google.com/pricing
- LiveKit pricing: https://livekit.io/pricing
- LiveKit participant management docs: https://docs.livekit.io/home/server/managing-participants/
- Vercel pricing: https://vercel.com/pricing
- Capacitor: https://capacitorjs.com/
- Expo pricing: https://expo.dev/pricing

**Not verified:** Apple/Google developer account fees; Capacitor's exact licence (the homepage only says "open source"); Indian GST on these plans (all listed prices are USD and exclude tax per the vendor pages). Free tiers change, so recheck before launch.
