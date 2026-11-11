-- Hush Hall database (Supabase Postgres). Run once in the Supabase SQL editor
-- (or `supabase db push`). Everything users can change goes through row-level
-- security or the small SECURITY DEFINER functions below, so the browser can
-- never skip a rule (hide-from-requests, blocks, rate limits, room size, bans).
--
-- Tunable settings are plain constants inside the functions and are marked
-- "setting"; they are starting values, not measured numbers.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Halls: the public rooms on the lobby board (same ids as app/lib/halls.ts).
-- ---------------------------------------------------------------------------
create table public.halls (
  id text primary key, -- url slug
  name text not null -- shown on the lobby door
);
insert into public.halls (id, name) values
  ('main-reading', 'Main Reading Hall'), -- big, quiet, long tables
  ('science-wing', 'Science Wing'), -- labs, papers, problem sets
  ('exam-season', 'Exam Season Hall'), -- deadlines and steady pages
  ('night-owls', 'Night Owls'); -- late-night lamps

-- ---------------------------------------------------------------------------
-- Profiles: one per account. Created only by the server onboarding route
-- (after the 18+ check), never directly by the browser. Date of birth is NOT
-- stored: we keep only the fact and time that the person confirmed 18+.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade, -- the auth account
  nickname text not null check (char_length(btrim(nickname)) between 1 and 24), -- shown on the desk
  avatar text not null check (char_length(avatar) between 1 and 8), -- emoji avatar
  color text not null default '#e9d8a6' check (color ~ '^#[0-9a-fA-F]{6}$'), -- lamp colour
  hide_from_requests boolean not null default false, -- nobody can send me requests
  focus_min int not null default 25 check (focus_min between 5 and 120), -- last Pomodoro focus length
  break_min int not null default 5 check (break_min between 1 and 60), -- last break length
  chime boolean not null default false, -- soft chime at phase change
  adult_confirmed_at timestamptz not null, -- when the 18+ date-of-birth check passed
  terms_version text not null, -- which house rules / terms text they accepted
  terms_accepted_at timestamptz not null, -- when they ticked the box
  topic_hidden boolean not null default false, -- moderation: their topic is not shown to others
  requests_paused boolean not null default false, -- moderation: they cannot send requests
  rooms_suspended boolean not null default false, -- moderation: no study rooms / voice
  banned boolean not null default false, -- moderation: account can't use the app
  created_at timestamptz not null default now() -- sign-up time
);
alter table public.profiles enable row level security; -- deny by default

-- People who review the report queue (Chinmaye and Priya). Added by hand in SQL.
create table public.moderators (
  user_id uuid primary key references public.profiles (id) on delete cascade, -- moderator account
  added_at timestamptz not null default now() -- when
);
alter table public.moderators enable row level security; -- nobody reads this directly

-- Words moderators don't want in nicknames or topics. Starts empty on purpose.
create table public.blocked_words (
  word text primary key check (word = lower(word) and char_length(word) between 2 and 40) -- lower-case fragment
);
alter table public.blocked_words enable row level security; -- managed in SQL by moderators

-- Calm, private notices to a user (e.g. after a moderator warning). No reporter details ever.
create table public.account_notices (
  id uuid primary key default gen_random_uuid(), -- notice id
  user_id uuid not null references public.profiles (id) on delete cascade, -- who it is for
  body text not null, -- the message
  created_at timestamptz not null default now(), -- when
  read_at timestamptz -- when they dismissed it
);
alter table public.account_notices enable row level security; -- own rows only (policies below)

-- ---------------------------------------------------------------------------
-- Helpers used by policies and functions.
-- ---------------------------------------------------------------------------

-- True if the caller has a profile and is not banned.
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and not banned); -- signed up and allowed in
$$;

-- True if the caller is a moderator.
create or replace function public.is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from moderators m join profiles p on p.id = m.user_id where m.user_id = auth.uid() and not p.banned); -- listed and active
$$;

-- Stop the current call unless the caller is an active user.
create or replace function public.assert_active() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if; -- anonymous call
  if not is_active_user() then raise exception 'not_allowed'; end if; -- no profile yet, or banned
end $$;

-- True if a nickname/topic passes the (moderator-managed) word list.
create or replace function public.text_ok(t text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from blocked_words w where position(w.word in lower(coalesce(t, ''))) > 0); -- no listed fragment inside
$$;


-- ---------------------------------------------------------------------------
-- Blocks: hide someone's desk and requests from me; they are not told.
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade, -- me
  blocked_id uuid not null references public.profiles (id) on delete cascade, -- them
  created_at timestamptz not null default now(), -- when
  primary key (blocker_id, blocked_id), -- once per pair
  check (blocker_id <> blocked_id) -- can't block yourself
);
alter table public.blocks enable row level security; -- own rows only
create policy "see my blocks" on public.blocks for select to authenticated using (blocker_id = auth.uid()); -- read my list
create policy "unblock" on public.blocks for delete to authenticated using (blocker_id = auth.uid()); -- remove my own block
-- Adding a block goes through block_user() so shared rooms and requests are cleaned up too.

-- True if either person has blocked the other.
create or replace function public.blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)); -- either direction
$$;

-- ---------------------------------------------------------------------------
-- Sittings: one row per "sit down -> stand up". One active sitting per desk
-- and per person is enforced by partial unique indexes.
-- ---------------------------------------------------------------------------
create table public.sittings (
  id uuid primary key default gen_random_uuid(), -- sitting id
  user_id uuid not null references public.profiles (id) on delete cascade, -- who
  hall_id text not null references public.halls (id), -- where
  seat text not null check (seat ~ '^[A-D][1-6]$'), -- which desk (rows A-D, desks 1-6)
  topic text not null check (char_length(btrim(topic)) between 1 and 60), -- public topic (the small promise)
  started_at timestamptz not null default now(), -- sat down
  last_seen_at timestamptz not null default now(), -- heartbeat while seated
  ended_at timestamptz, -- stood up (null = still seated)
  focused_minutes int not null default 0 check (focused_minutes between 0 and 1440), -- focus time this sitting
  recap text check (recap is null or char_length(recap) <= 100) -- one line for future you
);
create unique index sittings_one_per_desk on public.sittings (hall_id, seat) where ended_at is null; -- a desk holds one person
create unique index sittings_one_per_user on public.sittings (user_id) where ended_at is null; -- a person holds one desk
create index sittings_user_time on public.sittings (user_id, started_at desc); -- history lookups
alter table public.sittings enable row level security; -- own rows only
create policy "see my sittings" on public.sittings for select to authenticated using (user_id = auth.uid()); -- my history
-- Writes go through sit_down / heartbeat_sitting / stand_up.

-- Usual (returning) desk per hall.
create table public.usual_seats (
  user_id uuid not null references public.profiles (id) on delete cascade, -- who
  hall_id text not null references public.halls (id), -- which hall
  seat text not null check (seat ~ '^[A-D][1-6]$'), -- their desk
  primary key (user_id, hall_id) -- one per hall
);
alter table public.usual_seats enable row level security; -- own rows only
create policy "my usual seats" on public.usual_seats for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_active_user()); -- read/write mine

-- ---------------------------------------------------------------------------
-- Study rooms (2-4 people who accepted each other) and join requests.
-- ---------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(), -- room id (LiveKit room is "hh-<id>")
  owner_id uuid references public.profiles (id) on delete set null, -- person whose request was accepted
  name text not null check (char_length(name) <= 60), -- e.g. "Owl & Fern"
  created_at timestamptz not null default now(), -- opened
  closed_at timestamptz -- everyone left
);
create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade, -- room
  user_id uuid not null references public.profiles (id) on delete cascade, -- member
  joined_at timestamptz not null default now(), -- joined
  left_at timestamptz, -- left (null = still in)
  removed boolean not null default false, -- owner removed them: they can't rejoin this room
  primary key (room_id, user_id) -- once per room
);
alter table public.rooms enable row level security; -- members only
alter table public.room_members enable row level security; -- members only

-- True if the caller is currently in the room.
create or replace function public.in_room(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from room_members where room_id = r and user_id = auth.uid() and left_at is null); -- active member
$$;
create policy "rooms I am in" on public.rooms for select to authenticated using (public.in_room(id)); -- see my room
create policy "members of my room" on public.room_members for select to authenticated using (user_id = auth.uid() or public.in_room(room_id)); -- see who is with me (and my own past rows)

create table public.join_requests (
  id uuid primary key default gen_random_uuid(), -- request id
  from_id uuid not null references public.profiles (id) on delete cascade, -- who asks
  to_id uuid not null references public.profiles (id) on delete cascade, -- who is asked
  hall_id text not null references public.halls (id), -- where both sit
  note text not null default '' check (char_length(note) <= 80), -- short optional note
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')), -- lifecycle
  room_id uuid references public.rooms (id) on delete set null, -- room they ended up in
  created_at timestamptz not null default now(), -- sent
  responded_at timestamptz, -- answered
  check (from_id <> to_id) -- not to yourself
);
create index join_requests_from_time on public.join_requests (from_id, created_at desc); -- rate limit lookups
create index join_requests_to_pending on public.join_requests (to_id) where status = 'pending'; -- inbox
alter table public.join_requests enable row level security; -- sender and receiver only
create policy "my requests" on public.join_requests for select to authenticated
  using ((from_id = auth.uid() or to_id = auth.uid()) and not public.blocked_between(from_id, to_id)); -- blocked pairs vanish for both

-- ---------------------------------------------------------------------------
-- Reports: private queue for moderators. The reported person never sees who
-- reported them (they can't read this table at all).
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(), -- report id
  reporter_id uuid not null references public.profiles (id) on delete cascade, -- who reported (private)
  reported_id uuid not null references public.profiles (id) on delete cascade, -- who was reported
  reason text not null check (reason in ('harassment', 'spam', 'sexual', 'hate', 'under18', 'other')), -- required reason
  note text not null default '' check (char_length(note) <= 500), -- optional details
  hall_id text references public.halls (id), -- where it happened (if in a hall)
  room_id uuid references public.rooms (id) on delete set null, -- where it happened (if in a room)
  reported_nickname text, -- nickname at report time (they may change it)
  reported_topic text, -- topic at report time
  urgent boolean not null, -- harassment/safety reasons: act within 24 hours
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')), -- review state
  action text check (action in ('none', 'warn', 'remove_topic', 'suspend_rooms', 'ban', 'restore')), -- what the moderator did
  mod_note text check (mod_note is null or char_length(mod_note) <= 500), -- private moderator note
  reviewed_by uuid references public.profiles (id) on delete set null, -- which moderator
  reviewed_at timestamptz, -- when
  created_at timestamptz not null default now(), -- when filed
  check (reporter_id <> reported_id) -- not yourself
);
create index reports_queue on public.reports (status, urgent desc, created_at); -- queue order
alter table public.reports enable row level security; -- deny by default
create policy "moderators read reports" on public.reports for select to authenticated using (public.is_moderator()); -- queue
create policy "reporters see their own reports" on public.reports for select to authenticated using (reporter_id = auth.uid()); -- "thanks, we got it"

create policy "my notices" on public.account_notices for select to authenticated using (user_id = auth.uid()); -- read mine
create policy "dismiss my notices" on public.account_notices for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid()); -- mark read

-- ---------------------------------------------------------------------------
-- Profiles: read my own row; others are read through public_profiles().
-- I can change only my settings columns (not moderation flags).
-- ---------------------------------------------------------------------------
create policy "read my profile" on public.profiles for select to authenticated using (id = auth.uid()); -- my row
create policy "update my profile" on public.profiles for update to authenticated using (id = auth.uid() and not banned) with check (id = auth.uid() and public.text_ok(nickname)); -- my row, filtered nickname
revoke update on public.profiles from authenticated, anon; -- no column by default
grant update (nickname, avatar, color, hide_from_requests, focus_min, break_min, chime) on public.profiles to authenticated; -- settings only

-- What other people may see about a list of members: nickname, avatar, lamp
-- colour, and whether they take requests. Moderation flags are never exposed
-- ("can't receive requests" looks the same as "hid from requests").
create or replace function public.public_profiles(ids uuid[])
returns table (id uuid, nickname text, avatar text, color text, takes_requests boolean, show_topic boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.nickname, p.avatar, p.color,
         not (p.hide_from_requests or p.requests_paused or p.rooms_suspended) and not blocked_between(auth.uid(), p.id), -- can I send a request?
         not p.topic_hidden -- show their topic?
  from profiles p
  where p.id = any(ids) and not p.banned and is_active_user(); -- only for signed-up callers, never banned people
$$;

-- Active desks in a hall (people seated with a heartbeat in the last 3 minutes).
create or replace function public.hall_desks(p_hall text)
returns table (user_id uuid, seat text, topic text, started_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.user_id, s.seat, case when p.topic_hidden then '' else s.topic end, s.started_at -- hidden topics come back empty
  from sittings s join profiles p on p.id = s.user_id
  where s.hall_id = p_hall and s.ended_at is null and s.last_seen_at > now() - interval '3 minutes' -- setting: stale after 3 min
    and not p.banned and is_active_user() and not blocked_between(auth.uid(), s.user_id); -- hide blocked pairs
$$;

-- How many desks are in use per hall, for the lobby doors.
create or replace function public.hall_counts()
returns table (hall_id text, seated int)
language sql stable security definer set search_path = public as $$
  select h.id, count(s.id)::int -- zero for empty halls
  from halls h left join sittings s on s.hall_id = h.id and s.ended_at is null and s.last_seen_at > now() - interval '3 minutes'
  group by h.id;
$$;

-- ---------------------------------------------------------------------------
-- The ritual: sit down (topic), heartbeat, stand up (recap).
-- ---------------------------------------------------------------------------
create or replace function public.sit_down(p_hall text, p_seat text, p_topic text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; -- new sitting
begin
  perform assert_active(); -- signed up, not banned
  if not text_ok(p_topic) then raise exception 'topic_not_allowed'; end if; -- word list
  update sittings set ended_at = last_seen_at where user_id = auth.uid() and ended_at is null; -- leave any desk I still hold (other tab, crash)
  update sittings set ended_at = last_seen_at where hall_id = p_hall and seat = p_seat and ended_at is null and last_seen_at < now() - interval '3 minutes'; -- free a desk whose owner vanished
  begin
    insert into sittings (user_id, hall_id, seat, topic) values (auth.uid(), p_hall, p_seat, btrim(p_topic)) returning id into v_id; -- claim it
  exception when unique_violation then
    raise exception 'desk_taken'; -- someone sat a moment earlier
  end;
  return v_id; -- the client keeps this for heartbeat / stand up
end $$;

-- Keep my desk alive and bank focus minutes so far (so a closed tab still counts).
create or replace function public.heartbeat_sitting(p_id uuid, p_focused_minutes int)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update sittings set last_seen_at = now(),
    focused_minutes = greatest(focused_minutes, least(coalesce(p_focused_minutes, 0), ceil(extract(epoch from now() - started_at) / 60)::int, 1440)) -- never more than real elapsed time
  where id = p_id and user_id = auth.uid() and ended_at is null; -- my active sitting only
  return found; -- false = the desk is no longer mine (e.g. stale and taken)
end $$;

-- Stand up with a short recap.
create or replace function public.stand_up(p_id uuid, p_focused_minutes int, p_recap text)
returns int language plpgsql security definer set search_path = public as $$
declare v_min int; -- saved minutes
begin
  update sittings set ended_at = now(), last_seen_at = now(),
    focused_minutes = greatest(focused_minutes, least(coalesce(p_focused_minutes, 0), ceil(extract(epoch from now() - started_at) / 60)::int, 1440)), -- capped at real time
    recap = nullif(left(btrim(coalesce(p_recap, '')), 100), '') -- optional line
  where id = p_id and user_id = auth.uid() and ended_at is null
  returning focused_minutes into v_min; -- what was saved
  if not found then -- desk already released (stale): still save the recap on that sitting
    update sittings set recap = nullif(left(btrim(coalesce(p_recap, '')), 100), ''),
      focused_minutes = greatest(focused_minutes, least(coalesce(p_focused_minutes, 0), ceil(extract(epoch from coalesce(ended_at, now()) - started_at) / 60)::int, 1440))
    where id = p_id and user_id = auth.uid() returning focused_minutes into v_min; -- my sitting only
  end if;
  return coalesce(v_min, 0); -- minutes saved
end $$;

-- ---------------------------------------------------------------------------
-- Requests and rooms.
-- ---------------------------------------------------------------------------

-- Leave every room I'm in (one room at a time).
create or replace function public.leave_all_rooms() returns void
language plpgsql security definer set search_path = public as $$
declare r record; -- each room
begin
  for r in select room_id from room_members where user_id = auth.uid() and left_at is null loop
    perform leave_room(r.room_id); -- same path as the Leave button
  end loop;
end $$;

-- Send a "study together?" request. Every rule is checked here, not in the browser.
create or replace function public.send_join_request(p_to uuid, p_hall text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me profiles; -- sender
  v_to profiles; -- receiver
  v_id uuid; -- new request
begin
  perform assert_active(); -- signed up, not banned
  select * into v_me from profiles where id = auth.uid(); -- sender row
  if v_me.requests_paused or v_me.rooms_suspended then raise exception 'unavailable'; end if; -- paused pending review (not explained in detail)
  select * into v_to from profiles where id = p_to; -- receiver row
  if v_to.id is null or v_to.id = v_me.id or v_to.banned or v_to.hide_from_requests or v_to.rooms_suspended
     or blocked_between(v_me.id, p_to) then raise exception 'unavailable'; end if; -- hidden, blocked, or can't use rooms: same answer for all
  if not exists (select 1 from sittings where user_id = p_to and hall_id = p_hall and ended_at is null) then raise exception 'unavailable'; end if; -- they must be at a desk in this hall
  if (select count(*) from join_requests where from_id = v_me.id and created_at > now() - interval '10 minutes') >= 3 then raise exception 'rate_limited'; end if; -- setting: 3 per 10 minutes
  if exists (select 1 from join_requests where from_id = v_me.id and to_id = p_to and created_at > now() - interval '10 minutes') then raise exception 'rate_limited'; end if; -- setting: once per person per 10 minutes
  insert into join_requests (from_id, to_id, hall_id, note) values (v_me.id, p_to, p_hall, left(btrim(coalesce(p_note, '')), 80)) returning id into v_id; -- store it (Realtime delivers it)
  return v_id; -- for the sender's "sent" state
end $$;

-- Answer a request. Accept puts both people in a small room (max 4).
create or replace function public.respond_join_request(p_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_req join_requests; -- the request
  v_room uuid; -- room both end up in
  v_from profiles; -- sender
  v_me profiles; -- receiver (caller)
begin
  perform assert_active(); -- signed up, not banned
  select * into v_req from join_requests where id = p_id and to_id = auth.uid() and status = 'pending' for update; -- mine and still open
  if v_req.id is null then raise exception 'not_found'; end if; -- answered already or not mine
  if not p_accept then
    update join_requests set status = 'declined', responded_at = now() where id = p_id; -- "Not now"
    return null; -- no room
  end if;
  select * into v_from from profiles where id = v_req.from_id; -- sender row
  select * into v_me from profiles where id = auth.uid(); -- my row
  if v_from.banned or v_from.rooms_suspended or v_me.rooms_suspended or blocked_between(v_req.from_id, auth.uid()) then
    update join_requests set status = 'cancelled', responded_at = now() where id = p_id; -- can't happen any more
    raise exception 'unavailable'; -- same answer for every reason
  end if;
  -- Join the sender's open room if they own one with space; otherwise open a new one.
  select r.id into v_room from rooms r
  where r.owner_id = v_req.from_id and r.closed_at is null and in_room_of(r.id, v_req.from_id)
    and (select count(*) from room_members m where m.room_id = r.id and m.left_at is null) < 4 -- setting: rooms hold 2-4 people
    and not exists (select 1 from room_members m where m.room_id = r.id and m.user_id = auth.uid() and m.removed) -- removed people can't rejoin that room
  order by r.created_at desc limit 1;
  perform leave_all_rooms(); -- I can only be in one room
  if v_room is null then
    -- The sender also leaves any other room before the new one opens.
    update room_members set left_at = now() where user_id = v_req.from_id and left_at is null; -- sender's old room
    update rooms r set closed_at = now() where r.closed_at is null and not exists (select 1 from room_members m where m.room_id = r.id and m.left_at is null); -- close empty rooms
    insert into rooms (owner_id, name) values (v_req.from_id, left(v_from.nickname || ' & ' || v_me.nickname, 60)) returning id into v_room; -- new room
    insert into room_members (room_id, user_id) values (v_room, v_req.from_id); -- sender in
  end if;
  insert into room_members (room_id, user_id) values (v_room, auth.uid())
    on conflict (room_id, user_id) do update set left_at = null, joined_at = now(); -- me in (rejoin after leaving is fine; removed was checked)
  update join_requests set status = 'accepted', responded_at = now(), room_id = v_room where id = p_id; -- done
  return v_room; -- both clients open this room
end $$;

-- True if a given user is currently in a room (used above).
create or replace function public.in_room_of(r uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from room_members where room_id = r and user_id = u and left_at is null); -- active member
$$;

-- Leave a room; it closes when the last person leaves.
create or replace function public.leave_room(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update room_members set left_at = now() where room_id = p_room and user_id = auth.uid() and left_at is null; -- me out
  update rooms set closed_at = now() where id = p_room and closed_at is null
    and not exists (select 1 from room_members where room_id = p_room and left_at is null); -- empty: close
end $$;

-- Room owner removes someone. They can't rejoin this room.
create or replace function public.remove_from_room(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_active(); -- signed up, not banned
  if not exists (select 1 from rooms where id = p_room and owner_id = auth.uid() and closed_at is null) then raise exception 'not_owner'; end if; -- owner only
  if p_user = auth.uid() then raise exception 'use_leave'; end if; -- owners leave with leave_room
  update room_members set left_at = now(), removed = true where room_id = p_room and user_id = p_user and left_at is null; -- out, for good
end $$;

-- Block someone: hides them both ways, cancels requests, separates shared rooms.
create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; -- each shared room
begin
  perform assert_active(); -- signed up, not banned
  if p_user = auth.uid() then return; end if; -- nothing to do
  insert into blocks (blocker_id, blocked_id) values (auth.uid(), p_user) on conflict do nothing; -- remember
  update join_requests set status = 'cancelled', responded_at = now()
    where status = 'pending' and ((from_id = auth.uid() and to_id = p_user) or (from_id = p_user and to_id = auth.uid())); -- drop open requests
  for r in select a.room_id, ro.owner_id from room_members a join room_members b on a.room_id = b.room_id join rooms ro on ro.id = a.room_id
           where a.user_id = auth.uid() and b.user_id = p_user and a.left_at is null and b.left_at is null loop
    if r.owner_id = auth.uid() then
      update room_members set left_at = now(), removed = true where room_id = r.room_id and user_id = p_user; -- my room: they go
    else
      perform leave_room(r.room_id); -- their room: I go (they are not told why)
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reports and moderation.
-- ---------------------------------------------------------------------------
create or replace function public.file_report(p_reported uuid, p_reason text, p_note text, p_hall text, p_room uuid, p_topic text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; -- new report
begin
  perform assert_active(); -- signed up, not banned
  if (select count(*) from reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then raise exception 'rate_limited'; end if; -- setting: 20 reports a day stops spam, not real use
  insert into reports (reporter_id, reported_id, reason, note, hall_id, room_id, reported_nickname, reported_topic, urgent)
  values (auth.uid(), p_reported, p_reason, left(coalesce(p_note, ''), 500), p_hall, p_room,
          (select nickname from profiles where id = p_reported), left(coalesce(p_topic, ''), 60),
          p_reason in ('harassment', 'sexual', 'hate', 'under18')) -- harassment and safety reasons: review within 24 hours
  returning id into v_id; -- stored
  return v_id; -- reporter sees "thanks"
end $$;

-- Automatic holds while a report waits for a human:
--  * "seems under 18" suspends rooms (voice) for that account until reviewed;
--  * reports from 3+ different people hide their topic and pause their requests.
create or replace function public.after_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reason = 'under18' then
    update profiles set rooms_suspended = true where id = new.reported_id; -- hold voice/rooms
    update room_members set left_at = now() where user_id = new.reported_id and left_at is null; -- out of any room now
  end if;
  if (select count(distinct reporter_id) from reports where reported_id = new.reported_id and status in ('open', 'reviewing')) >= 3 then -- setting: 3 distinct reporters
    update profiles set topic_hidden = true, requests_paused = true where id = new.reported_id; -- quiet hold, reviewed by a moderator
  end if;
  return new; -- keep the row
end $$;
create trigger reports_after_insert after insert on public.reports for each row execute function public.after_report(); -- run per report

-- Moderator queue with the context needed to decide (moderators only).
create or replace function public.mod_queue(p_status text default 'open')
returns table (id uuid, created_at timestamptz, urgent boolean, due_at timestamptz, reason text, note text, status text, action text, mod_note text,
               hall_id text, room_id uuid, reported_id uuid, reported_nickname text, reported_topic text, reporter_nickname text,
               reports_on_account int, account_flags text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_moderator() then raise exception 'not_allowed'; end if; -- moderators only
  return query
  select r.id, r.created_at, r.urgent, case when r.urgent then r.created_at + interval '24 hours' end, -- urgent: act within 24 hours
         r.reason, r.note, r.status, r.action, r.mod_note, r.hall_id, r.room_id, r.reported_id,
         coalesce(p.nickname, r.reported_nickname), r.reported_topic, rp.nickname, -- current nickname (snapshot if changed)
         (select count(*)::int from reports x where x.reported_id = r.reported_id), -- history on this account
         concat_ws(', ', case when p.banned then 'banned' end, case when p.rooms_suspended then 'rooms suspended' end,
                         case when p.requests_paused then 'requests paused' end, case when p.topic_hidden then 'topic hidden' end) -- current holds
  from reports r left join profiles p on p.id = r.reported_id left join profiles rp on rp.id = r.reporter_id
  where p_status = 'all' or r.status = p_status or (p_status = 'open' and r.status = 'reviewing') -- "open" view includes in-review
  order by r.urgent desc, r.created_at asc; -- urgent first, oldest first
end $$;

-- A moderator decides on a report and the account change happens in the same step.
create or replace function public.moderate_report(p_id uuid, p_status text, p_action text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; -- reported account
begin
  if not is_moderator() then raise exception 'not_allowed'; end if; -- moderators only
  update reports set status = p_status, action = p_action, mod_note = nullif(left(coalesce(p_note, ''), 500), ''), reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id returning reported_id into v_user; -- record the decision
  if v_user is null then raise exception 'not_found'; end if; -- unknown report
  if p_action = 'warn' then
    insert into account_notices (user_id, body) values (v_user, 'A moderator reviewed a report about your account. Please read the house rules again; repeated problems can lead to a suspension.'); -- private, no reporter details
  elsif p_action = 'remove_topic' then
    update profiles set topic_hidden = true where id = v_user; -- topic no longer shown
    update sittings set topic = '(topic removed)' where user_id = v_user and ended_at is null; -- current desk
  elsif p_action = 'suspend_rooms' then
    update profiles set rooms_suspended = true, requests_paused = true where id = v_user; -- no rooms, no requests
    update room_members set left_at = now() where user_id = v_user and left_at is null; -- out of rooms now
  elsif p_action = 'ban' then
    update profiles set banned = true where id = v_user; -- can't use the app
    update sittings set ended_at = now() where user_id = v_user and ended_at is null; -- off their desk
    update room_members set left_at = now() where user_id = v_user and left_at is null; -- out of rooms
  elsif p_action = 'restore' then
    update profiles set topic_hidden = false, requests_paused = false, rooms_suspended = false, banned = false where id = v_user; -- lift every hold
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: the browser (role "authenticated") can call these functions;
-- anonymous visitors can call none of them.
-- ---------------------------------------------------------------------------
revoke all on function public.sit_down(text, text, text), public.heartbeat_sitting(uuid, int), public.stand_up(uuid, int, text),
  public.send_join_request(uuid, text, text), public.respond_join_request(uuid, boolean), public.leave_room(uuid), public.leave_all_rooms(),
  public.remove_from_room(uuid, uuid), public.block_user(uuid), public.file_report(uuid, text, text, text, uuid, text),
  public.mod_queue(text), public.moderate_report(uuid, text, text, text), public.public_profiles(uuid[]), public.hall_desks(text),
  public.hall_counts(), public.in_room_of(uuid, uuid), public.after_report() from public, anon; -- not for anonymous visitors
grant execute on function public.sit_down(text, text, text), public.heartbeat_sitting(uuid, int), public.stand_up(uuid, int, text),
  public.send_join_request(uuid, text, text), public.respond_join_request(uuid, boolean), public.leave_room(uuid), public.leave_all_rooms(),
  public.remove_from_room(uuid, uuid), public.block_user(uuid), public.file_report(uuid, text, text, text, uuid, text),
  public.mod_queue(text), public.moderate_report(uuid, text, text, text), public.public_profiles(uuid[]), public.hall_desks(text),
  public.hall_counts() to authenticated; -- signed-in users (functions check the rest)

-- ---------------------------------------------------------------------------
-- Realtime: requests and room membership changes are pushed to the two
-- people involved (Postgres Changes respects the RLS policies above).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.join_requests, public.room_members; -- live notes and room lists

-- Private presence channels "hall:<id>": only signed-up, non-banned users can
-- see or announce who sits where. The app always opens hall channels with
-- private: true. Keep Realtime's "Allow public access" setting ON (default):
-- the per-user inbox channels carry only Postgres Changes, which RLS filters.
create policy "hall presence read" on realtime.messages for select to authenticated
  using (realtime.topic() like 'hall:%' and realtime.messages.extension in ('presence') and public.is_active_user()); -- watch desks
create policy "hall presence write" on realtime.messages for insert to authenticated
  with check (realtime.topic() like 'hall:%' and realtime.messages.extension in ('presence') and public.is_active_user()); -- announce my desk
