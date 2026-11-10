# Hush Hall: product brief (v0.2, 11 Nov 2026)

**One line:** a virtual library where you take a numbered desk in a quiet public hall, write what you're studying on it, and work next to other students. No chat noise, no feeds, no guilt.

**Who it's for:** anyone 18+ studying for something (semester exams, GATE, placements, a thesis, competitive exams) who focuses better when other people are visibly working nearby. Sign-up is **open to anyone**, not tied to one college. Founder: Chinmaye Mankatalia (4th-year B.Tech Biotech, DTU).

**Decisions locked (11 Nov 2026):**
1. Sign-up is open to anyone (no college-email gate).
2. Small study rooms get **audio in v1**.
3. Desks and desk cards show **only nickname, avatar, and current topic**. No college, course, age, photo or real name.

**Evidence status:** this brief has no user research behind it yet. Every "why" below is a design hypothesis based on known behavioural ideas (body doubling, implementation intentions, commitment through a public topic, Pomodoro). Week 4 includes real user tests to check them. Every number here is either a product setting or is labelled as an estimate.

---

## 1. Core screens

| # | Screen | What it does | In the prototype? |
|---|---|---|---|
| 0 | **Sign-up + age gate** | Email/Google sign-in → date of birth (must be 18+) → accept Terms, House Rules and Privacy Notice → pick nickname + avatar | Later (week 1) |
| 1 | **Entrance / lobby** | Library card (nickname, avatar, hide-from-requests), a gentle "this week" summary, doors to the public halls | Yes |
| 2 | **Hall view** | Rows A–D × 6 numbered desks with a centre aisle. Occupied desks show **only nickname, avatar, current topic**, plus a small status lamp (focusing / break / settling in). Vacant desks invite you to sit. Your usual desk gets a dotted outline | Yes |
| 3 | **Sit-down sheet** | Pick a desk → write today's topic → choose a rhythm (25/5, 50/10, 15/3) → "Sit down & start" | Yes |
| 4 | **Focus bar** | Bottom wooden shelf: desk, topic, big calm countdown, progress line, "Take a break", "Stand up". Join requests wait here quietly until your break | Yes |
| 5 | **Break card** | Gentle, skippable. "Stand, stretch, sip water." Your desk stays yours | Yes |
| 6 | **Stand-up recap** | Minutes focused, topic, one line for future you. Saved to local history | Yes |
| 7 | **Desk card** | Tap someone's desk: **nickname, avatar, current topic only**. "Ask to study together" with an optional short note, Block, Report | Yes |
| 8 | **Join request note** | A paper note for the receiver: Accept / Not now. Never shown mid-focus | Yes |
| 9 | **Audio study rooms (small)** | 2–4 people who accepted each other. Shared timer and **voice**: mic consent prompt, everyone joins muted, push-to-talk by default, room owner can remove people, report from inside the room, never recorded | Banner only (mock); v1 week 3 |
| 10 | **Hall hopping** | Move between public halls from the hall header (only while standing, so every sitting ends with a recap) | Yes |
| 11 | **Alarms at set times** | "Remind me to sit at 7:00 AM" / "Wake me at 6:30". One calm reminder, nothing else | Later (week 3 if time) |
| 12 | **Avatars** | Emoji avatars in the MVP. Illustrated avatar kit later | Emoji only |
| 13 | **History / hours** | Hours per day and per week, days you showed up. No "streak lost" language | Simple weekly summary |
| 14 | **Weekly "study wrapped" card** | A shareable image: hours, topics, favourite desk/hall. The user decides whether to share it | Later |
| 15 | **Settings & safety** | Hide from requests, blocked list, report history, mic default (push-to-talk / open mic), chime on/off, delete my data | Partial |

## 2. Core user flows

1. **First visit:** sign in → confirm age (18+) and accept terms/house rules → nickname + avatar → pick a hall → see people already studying.
2. **Session ritual (the core loop):** **sit** (tap a vacant desk) → **topic** (write it, it goes on your desk publicly) → **timer** (focus, then a gentle break, then you choose the next round) → **recap** (stand up, minutes plus one line). The recap goes into history.
3. **Study together (audio room):** while you're on a break or settling in, tap a desk → send a request with a short note (rate-limited) → the receiver sees it at their next break → Accept or Not now (the sender gets a kind "they'd rather study solo" message). On Accept, the requester becomes room owner. Both see a mic-consent screen ("Your voice is heard live by people in this room. It is never recorded.") → join **muted** → hold a key or button to talk (push-to-talk). Either person can leave, block or report at any time, and the owner can remove someone.
4. **Privacy:** toggle "Hide me from requests" in the lobby or hall header. Block or report from any desk card.
5. **Hop halls:** stand up (recap) → choose another hall from the header → sit.
6. **Returning:** your usual desk is outlined in each hall. Sit there again in one tap.

## 3. Retention loop, step by step

The goal is coming back because the hall helps, not because the app nags.

1. **Trigger (user-owned):** a time *you* picked ("7 PM study", an alarm) or your own intention. No marketing pushes. Reminders are opt-in, one per day at most.
2. **Low-friction entry:** open → your usual desk in your usual hall is highlighted → one tap → topic is pre-filled from last time (planned).
3. **Body doubling:** you see real people at desks with real topics. Their quiet presence makes starting easier. *(Hypothesis to test.)*
4. **Public commitment:** your topic is visible on your desk. Writing it down is a small promise, and people tend to follow through on a specific stated plan. *(Hypothesis.)*
5. **Protected focus:** nothing interrupts the timer. Requests and notes are held. No badges, no counters, no feed.
6. **Gentle break and small win:** the break card, then a recap line. Finishing feels like closing a book, not like losing points.
7. **Visible progress, without shame:** weekly hours and "days you showed up". Missing a day isn't punished, and nothing "resets".
8. **Belonging:** your returning seat, familiar faces in "your" hall, an optional small study room with people you accepted.
9. **Reflect and share (weekly):** a "study wrapped" card the user *chooses* to share. That's the only growth surface, and it's user-initiated.
10. **Back to 1:** next session at the time you chose.

## 4. Feature → psychology principle

| Feature | Principle it serves |
|---|---|
| Rows of desks, seeing others focus | Body doubling / social facilitation |
| Public topic on the desk | Commitment and implementation intentions ("I will do X now") |
| Sit → topic → timer → recap ritual | Ritual lowers start friction; closure through the recap |
| Pomodoro with gentle breaks | Sustainable attention; breaks are framed as care, not failure |
| Mostly silent halls, no chat | Lower cognitive load, fewer distractions, less social anxiety |
| Personal returning seat | Place attachment, familiarity, and a cheaper decision to start |
| Requests held until a break | Protects deep work; consent-first social contact |
| Accept / Not now (kind wording) | Psychological safety; saying no costs nothing socially |
| Weekly hours, "days you showed up" | Progress you can see, without loss aversion or streak anxiety |
| Study wrapped card | Reflection; voluntary, identity-based sharing ("I'm someone who studies") |
| Calm wood/paper visuals, no red | Low arousal; signals "library", not "game" |

## 5. Safety controls

Open sign-up plus live audio means more strangers and more risk, so these are part of v1, not "later".

**Age gate and terms**
- **Minimum age: 18 (decision).** Sign-up asks for date of birth and blocks anyone under 18, with a plain message ("Hush Hall is for 18+ for now").
- **Why 18:** India's Digital Personal Data Protection Act, 2023 defines a "child" as anyone who hasn't turned 18 (Section 2(f)). Section 9(1) requires "verifiable consent of the parent" before processing a child's personal data. Section 9(3) bans tracking, behavioural monitoring and targeted ads aimed at children. The DPDP Rules, 2025 (Rule 10) require checking that the consenting parent is an identifiable adult, for example through DigiLocker-style tokens. A two-to-three-person student team can't build that verification plus child-safe audio moderation in 4 weeks, so v1 is 18+ only. This could be revisited later with proper parental-consent flows.
  - Official Act text (MeitY): https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf
  - Explanatory note to the DPDP Rules, 2025 (MeitY): https://www.meity.gov.in/static/uploads/2024/02/177897517eb68c21f247bc3247a2f506.pdf
  - Note: a secondary site (dpdpr.in) lists Section 9 as taking effect on 13 May 2027. I couldn't confirm that date on a MeitY page. Either way, design for it now.
- A self-declared date of birth isn't verification. Add a report reason for "this person seems under 18", which suspends room access pending review.
- **Terms, House Rules and Privacy Notice** are accepted at sign-up, with a checkbox that isn't pre-ticked. The house rules are short: be kind, keep halls silent, no harassment, no sharing others' info, no recording.
- Not legal advice. Have the terms and privacy notice reviewed before a public launch.

**Profile minimisation**
- Desks and desk cards show only **nickname, avatar and current topic**. No real name, college, course, age, photo or location.
- Nicknames and topics are length-capped (24 and 60 characters) and go through a word filter.

**Requests and abuse controls**
- **Hide me from requests:** one toggle, enforced server-side.
- **Rate limits (enforced server-side):** at most 3 join requests per sender per 10 minutes, one request to the same person per 10 minutes, and 1 room-creation per few minutes. The prototype already applies the first two client-side. Exact numbers are starting estimates to tune.
- **Requests are held during focus** and use an 80-character capped note. There's no open chat or DMs in halls.
- **Block:** hides their desk, drops their requests, removes them from any shared room. They aren't told.
- **Report queue:** report from a desk card or from inside a room. A reason is required (harassment, spam, sexual content, hate, seems under 18, other), with an optional note. Reports go to a `reports` table with status (open → reviewing → actioned / dismissed) and a simple admin page. Actions: warn, remove topic, suspend from rooms, ban. Repeat reports on one account auto-hide their topic and pause their requests until reviewed (the threshold is an estimate to tune).

**Audio-specific (study rooms)**
- **Explicit mic consent** before the first join and whenever the mic is turned on: "Your voice is heard live by people in this room. It is never recorded." The browser mic permission prompt only appears after this.
- **Mute by default:** everyone joins muted. **Push-to-talk is the default mode**; open mic is an opt-in per room session.
- **Room owner controls:** the person who sent the accepted request owns the room and can remove a participant. Removal revokes their room token, and they can't rejoin that room.
- **Small rooms:** 2–4 people in v1, invite-by-accepted-request only, never in public halls.
- **No recording, ever:** LiveKit recording/egress isn't enabled or called, no transcripts, no "record" UI. The privacy notice says so.
- **Leave instantly:** one button leaves the room and releases the mic.
- **Admin mute/remove** via server API for moderators handling a live report.

**Data**
- A "delete my data" control (account, sittings, reports authored).
- No tracking SDKs, no ad networks, no selling data.

## 6. Monetization guardrails

- **Core stays free:** halls, desks, timer, history, requests.
- **Possible paid extras later (ideas, not decided):** more avatar and desk themes, private study rooms for a group, longer history and exports, the "wrapped" card in more styles.
- **Hard rules:**
  - No ₹1 trials that roll into autopay. No hidden recurring mandates. Any subscription shows the full price and renewal date before payment, and cancelling takes one screen.
  - No dark patterns: no fake scarcity, no confirm-shaming ("No, I don't want to pass my exams"), no pre-ticked upsells.
  - No ads inside halls or during focus. No selling or sharing study data.
  - No paywall on safety features (block, report, hide).
  - No engagement-bait notifications (like "Riya is studying, don't fall behind!").

## 7. MVP vs later

**MVP (4 weeks):** open sign-up with an 18+ age gate and terms, nickname/avatar-only profiles, 3–4 public halls, numbered desks with live presence, the sit/topic/timer/recap ritual, Pomodoro breaks, returning seat, hide-from-requests, rate-limited join requests with accept/reject, **small audio study rooms** (mic consent, muted by default, push-to-talk, owner remove, no recording), block, report queue with a basic admin page.

**Later:** set-time alarms and reminders, weekly study wrapped card, hours-history charts (v1 keeps a simple weekly total), topic pre-fill, illustrated avatars, mobile apps (Capacitor), friend lists, college or topic halls, video, parental-consent flow for under-18s, paid themes.

## 8. Four-week MVP plan (2–3 student developers, part-time)

*Estimate: roughly 10–15 hours per person per week. That's a planning assumption, not a measurement. Audio in week 3 is the biggest risk. If it slips, ship halls first and turn rooms on a week later rather than weakening safety.*

**Week 1: Accounts, age gate, live hall**
- Supabase auth (email magic link + Google), sign-up with DOB (18+), terms/house rules acceptance, nickname + avatar profile.
- `SupabasePresence` behind the existing `PresenceProvider` (Realtime Presence for desks).
- One active sitting per desk enforced by a Postgres unique constraint.
- Done when: two people on two laptops see each other sit down live.

**Week 2: Ritual, requests, safety backbone**
- Timer phase synced in presence, recap saved to Postgres, returning seat, simple weekly hours total.
- Join requests over Realtime Broadcast, validated by a server function that applies hide/block and rate limits.
- Block list, reports table + reasons, basic admin page (list, change status, suspend).
- Done when: a request can be sent, held during focus, and accepted or declined, and a report shows up in the admin page.

**Week 3: Audio study rooms (LiveKit)**
- Vercel serverless route mints LiveKit tokens only for people in an accepted request (room size cap 4).
- Mic consent screen, join muted, push-to-talk (default) / open-mic toggle, leave button.
- Owner "remove" (LiveKit RemoveParticipant), report from inside the room, recording never enabled.
- Done when: two people on different networks can talk with push-to-talk, and the owner can remove one.

**Week 4: Hardening, test, soft launch**
- Abuse testing (spam requests, rejoin after removal, under-18 report path), accessibility and mobile web pass.
- 5–10 testers for a week, from any college or none, to check the hypotheses.
- Privacy notice + terms reviewed, then an **open soft launch** with a sign-up cap (for example the first few hundred accounts, an estimate tied to free-tier limits) and an invite link shared in a few student communities.

**Cut to "later" to make room for audio:** set-time alarms, topic pre-fill, hours-history charts, the study wrapped card, illustrated avatars, mobile wrapper, payments.

## 9. Decisions

**Made (11 Nov 2026):** open sign-up; audio in v1 study rooms; desks show only nickname, avatar, current topic; minimum age 18 (proposed in this brief, confirm).

**Still open for Chinmaye:**
1. **Confirm 18+**, or plan a later parental-consent path for 16–17-year-old exam students (needs DPDP-compliant verifiable consent).
2. **Who moderates the report queue** in week 4 and after launch (founder only, or 1–2 trusted volunteers), and the target response time.
3. **Soft-launch size:** a hard cap on accounts in the first weeks to stay inside free tiers and keep moderation manageable.
