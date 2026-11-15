-- Hush Hall: desk batch 2 — easier notes, share links, weekly hours, timetable.
-- Run after 0004_desk_notes.sql. Safe to run more than once.
-- Notes stay private unless the owner creates a share link. Weekly hours shown
-- to others are only a single total for this week (Monday–Sunday, Asia/Kolkata).
-- The timetable is private. Spotify URLs are kept in the browser, not here.

-- ---------------------------------------------------------------------------
-- 1. Notes: title may be empty (the app can fill it from the first line).
--    Annotations may be longer. Optional unguessable share token.
-- ---------------------------------------------------------------------------

-- Drop the old "title must not be blank" rule (name used by 0004).
alter table public.desk_notes drop constraint if exists desk_notes_title_check; -- old 1–80 non-blank rule
alter table public.desk_notes alter column title set default ''; -- empty is fine until a title is derived
alter table public.desk_notes alter column title set not null; -- still a string, may be ''
alter table public.desk_notes add constraint desk_notes_title_check check (char_length(title) <= 80); -- keep the length cap

-- Raise the annotation length cap (2000 -> 10000).
alter table public.desk_notes drop constraint if exists desk_notes_note_check; -- old 2000 cap
alter table public.desk_notes add constraint desk_notes_note_check check (char_length(note) <= 10000); -- longer writing area

-- One optional public-link token per note (null = not shared).
alter table public.desk_notes add column if not exists share_token text; -- unguessable token, or null
alter table public.desk_notes drop constraint if exists desk_notes_share_token_ok; -- re-runnable
alter table public.desk_notes add constraint desk_notes_share_token_ok
  check (share_token is null or share_token ~ '^[A-Za-z0-9_-]{20,64}$'); -- url-safe, long enough to be unguessable
create unique index if not exists desk_notes_share_token on public.desk_notes (share_token) where share_token is not null; -- one note per token

-- Public read of one shared note by token. No user id, no other notes, no RLS opening.
-- Callable by anyone who has the link (including signed-out visitors).
drop function if exists public.get_shared_note(text); -- re-runnable
create function public.get_shared_note(p_token text)
returns table (title text, source text, url text, note text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select n.title, n.source, n.url, n.note, n.updated_at -- only the public fields of that one note
  from desk_notes n
  where n.share_token is not null -- must be shared
    and p_token is not null and char_length(p_token) between 20 and 64 -- reject empty / odd tokens
    and n.share_token = p_token; -- exact match only
$$;

revoke all on function public.get_shared_note(text) from public; -- start tight
grant execute on function public.get_shared_note(text) to anon, authenticated; -- anyone with the link

-- ---------------------------------------------------------------------------
-- 2. Optional "show my weekly hours on my desk" (on by default).
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists show_weekly_hours boolean not null default true; -- others may see this week's total
grant update (show_weekly_hours) on public.profiles to authenticated; -- own row only (existing RLS)

-- This week's focused minutes (Monday 00:00 to next Monday, Asia/Kolkata / IST).
-- Returns only user_id + minutes, and only for people who left the toggle on.
drop function if exists public.public_weekly_hours(uuid[]); -- re-runnable
create function public.public_weekly_hours(ids uuid[])
returns table (user_id uuid, minutes int)
language sql stable security definer set search_path = public as $$
  with week as ( -- Monday 00:00 IST of the current week, as a timestamptz
    select date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as start_at
  )
  select s.user_id, least(coalesce(sum(s.focused_minutes), 0), 10080)::int -- cap at 7×24h
  from sittings s
  join profiles p on p.id = s.user_id -- need the toggle and ban flag
  cross join week w
  where s.user_id = any(ids) -- only the people asked about
    and p.show_weekly_hours -- they chose to show it
    and not p.banned -- never list a banned account
    and is_active_user() -- signed-in, signed-up, not banned caller
    and not blocked_between(auth.uid(), s.user_id) -- hide blocked pairs, same as desks
    and s.started_at >= w.start_at -- this IST week (includes a sitting still in progress)
  group by s.user_id
  having sum(s.focused_minutes) > 0; -- no line for zero hours (never-shaming)
$$;

revoke all on function public.public_weekly_hours(uuid[]) from public, anon; -- not for visitors
grant execute on function public.public_weekly_hours(uuid[]) to authenticated; -- signed-in users

-- ---------------------------------------------------------------------------
-- 3. Private weekly timetable (day, start, end, subject). Owner only.
-- ---------------------------------------------------------------------------

create table if not exists public.timetable_slots (
  id uuid primary key default gen_random_uuid(), -- row id
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade, -- owner (account deletion removes these)
  day smallint not null check (day between 0 and 6), -- 0 = Monday … 6 = Sunday
  start_min int not null check (start_min between 0 and 1439), -- minutes from midnight (inclusive)
  end_min int not null check (end_min between 1 and 1440 and end_min > start_min), -- minutes from midnight (exclusive), after start
  subject text not null check (char_length(btrim(subject)) between 1 and 80), -- what they plan to study
  created_at timestamptz not null default now() -- when added
);

create index if not exists timetable_slots_user_day on public.timetable_slots (user_id, day, start_min); -- weekly grid order

alter table public.timetable_slots enable row level security; -- deny by default

drop policy if exists "my timetable" on public.timetable_slots; -- re-runnable
create policy "my timetable" on public.timetable_slots
  for all to authenticated
  using (user_id = auth.uid()) -- only my rows
  with check (user_id = auth.uid() and public.is_active_user()); -- signed up, not banned; cannot write as someone else

revoke all on table public.timetable_slots from public, anon; -- not for visitors
grant select, insert, update, delete on table public.timetable_slots to authenticated; -- own rows only (RLS)

notify pgrst, 'reload schema'; -- let the API see the new table and functions right away
