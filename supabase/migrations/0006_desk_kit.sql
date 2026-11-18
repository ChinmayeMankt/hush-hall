-- Hush Hall: quiet desk kit — study days, unlocked desk items, and where they sit.
-- Run after 0005_desk_batch2.sql. Safe to run more than once.
--
-- Rules (the same numbers live in app/lib/deskKit.ts; keep both in step):
--  * A study day = a sitting of 25+ focused minutes that ends through the recap
--    step (finish_sitting). At most one study day per local calendar day.
--  * Minutes that count toward the kit are capped at 150 (2.5 h) per local day.
--    Private stats keep using sittings.focused_minutes, uncapped.
--  * Items unlock by total study days: plant 1, mug 3, books 7, pencils 14,
--    clock 21, cat 30, notebook 45. Unlocks are never removed. No streaks.
--  * Unlocks and the 5-spot arrangement belong to the person, not to a desk.
--    Others only see the arrangement of someone currently seated.
--  * Users can freely place or remove any unlocked item. An unequipped item stays
--    unlocked forever (removing it only edits desk_layouts, never desk_unlocks) and
--    can be placed again at any time. Only currently placed items appear for others.
--    An empty or sparse desk is a valid choice ('{}' is a normal layout).
-- Clients cannot write any of these tables directly; only the functions below do.

-- ---------------------------------------------------------------------------
-- 1. The item list and thresholds (one place in SQL).
-- ---------------------------------------------------------------------------

-- Fixed catalogue: item id and the study days needed.
create or replace function public.desk_kit_catalog()
returns table (item text, days int)
language sql immutable set search_path = public as $$
  values ('plant', 1), ('mug', 3), ('books', 7), ('pencils', 14), ('clock', 21), ('cat', 30), ('notebook', 45); -- id, study days needed
$$;

-- ---------------------------------------------------------------------------
-- 2. Columns and tables.
-- ---------------------------------------------------------------------------

-- The person's IANA time zone (e.g. "Asia/Kolkata"), last sent with a recap. Not editable directly.
alter table public.profiles add column if not exists time_zone text; -- null = Asia/Kolkata is used

-- When a sitting went through the recap step, and the local date it counted for (if it qualified).
alter table public.sittings add column if not exists recapped_at timestamptz; -- null = ended without the recap (tab closed, stale)
alter table public.sittings add column if not exists study_date date; -- local calendar day it counted toward (null = did not qualify)

-- One row per local calendar day that became a study day.
create table if not exists public.study_days (
  user_id uuid not null references public.profiles (id) on delete cascade, -- owner (account deletion removes these)
  day date not null, -- the person's local calendar date
  counted_minutes int not null default 0 check (counted_minutes between 0 and 150), -- qualifying minutes that day, capped at 2.5 h
  sessions int not null default 0 check (sessions >= 0), -- qualifying sittings that day
  created_at timestamptz not null default now(), -- first qualifying recap that day
  primary key (user_id, day) -- one study day per local date
);

-- Items a person has unlocked. Rows are only ever added (never removed, never withered).
create table if not exists public.desk_unlocks (
  user_id uuid not null references public.profiles (id) on delete cascade, -- owner (account deletion removes these)
  item text not null, -- catalogue id (checked by desk_unlocks_item_ok below)
  unlocked_at timestamptz not null default now(), -- when it unlocked
  primary key (user_id, item) -- once per item
);

-- Item ids must be in the catalogue (named, so a re-run replaces it if the list changes).
alter table public.desk_unlocks drop constraint if exists desk_unlocks_item_check; -- inline check from an earlier draft
alter table public.desk_unlocks drop constraint if exists desk_unlocks_item_ok; -- re-runnable
alter table public.desk_unlocks add constraint desk_unlocks_item_ok
  check (item in ('plant', 'mug', 'books', 'pencils', 'clock', 'cat', 'notebook')); -- same ids as desk_kit_catalog()

-- Where each placed item sits: {"1": "plant", "3": "mug"} (spots 1-5, each item at most once).
create table if not exists public.desk_layouts (
  user_id uuid primary key references public.profiles (id) on delete cascade, -- owner (account deletion removes this)
  spots jsonb not null default '{}'::jsonb check (jsonb_typeof(spots) = 'object'), -- spot -> item
  updated_at timestamptz not null default now() -- last change
);

-- Owner can read their own rows; nobody writes directly.
alter table public.study_days enable row level security; -- deny by default
alter table public.desk_unlocks enable row level security; -- deny by default
alter table public.desk_layouts enable row level security; -- deny by default

drop policy if exists "my study days" on public.study_days; -- re-runnable
create policy "my study days" on public.study_days for select to authenticated using (user_id = auth.uid()); -- read mine
drop policy if exists "my desk unlocks" on public.desk_unlocks; -- re-runnable
create policy "my desk unlocks" on public.desk_unlocks for select to authenticated using (user_id = auth.uid()); -- read mine
drop policy if exists "my desk layout" on public.desk_layouts; -- re-runnable
create policy "my desk layout" on public.desk_layouts for select to authenticated using (user_id = auth.uid()); -- read mine

revoke all on table public.study_days, public.desk_unlocks, public.desk_layouts from public, anon, authenticated; -- no direct writes
grant select on table public.study_days, public.desk_unlocks, public.desk_layouts to authenticated; -- own rows only (RLS)

-- ---------------------------------------------------------------------------
-- 3. Internal helpers (not callable by clients).
-- ---------------------------------------------------------------------------

-- A usable time zone name, or Asia/Kolkata.
create or replace function public.desk_kit_tz(p_tz text) returns text
language sql stable set search_path = public as $$
  select case when p_tz is not null and char_length(p_tz) <= 64
               and exists (select 1 from pg_timezone_names where name = p_tz) then p_tz -- known IANA name
              else 'Asia/Kolkata' end; -- fallback (the launch audience)
$$;

-- Add any items the person has now earned. Returns only the newly added ids, in catalogue order.
create or replace function public.desk_kit_sync(p_user uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare v_days int; v_new text[]; -- study-day total, new items
begin
  select count(*) into v_days from study_days where user_id = p_user; -- total study days (never reset)
  with added as (
    insert into desk_unlocks (user_id, item)
    select p_user, c.item from desk_kit_catalog() c where c.days <= v_days -- everything earned so far
    on conflict do nothing -- already unlocked: keep the original row
    returning item
  )
  select coalesce(array_agg(a.item order by c.days), '{}') into v_new
  from added a join desk_kit_catalog() c on c.item = a.item; -- order by threshold
  return v_new; -- usually empty
end $$;

-- ---------------------------------------------------------------------------
-- 4. Finish a sitting through the recap step.
--    Saves exactly like stand_up(), then (only once per sitting, only for a
--    sitting that ended in the last 15 minutes, only at 25+ minutes) records
--    the study day for the person's local date and returns any new unlocks.
-- ---------------------------------------------------------------------------
drop function if exists public.finish_sitting(uuid, int, text, text); -- re-runnable
create function public.finish_sitting(p_id uuid, p_focused_minutes int, p_recap text, p_tz text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_min int; -- minutes saved by stand_up
  v_s sittings%rowtype; -- the sitting after saving
  v_tz text := desk_kit_tz(p_tz); -- checked time zone
  v_day date; -- local calendar date
  v_new text[] := '{}'; -- newly unlocked items
  v_counted boolean := false; -- did this sitting count?
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if; -- anonymous call
  v_min := stand_up(p_id, p_focused_minutes, p_recap); -- same save as before (minutes capped at real time)
  select * into v_s from sittings where id = p_id and user_id = auth.uid(); -- my sitting only
  if not found then return jsonb_build_object('minutes', 0, 'study_days', 0, 'counted', false, 'new_items', '[]'::jsonb); end if; -- not mine
  if v_s.recapped_at is null and v_s.ended_at is not null and v_s.ended_at > now() - interval '15 minutes' and is_active_user() then -- first recap, and only for a sitting that just ended (no collecting old ones)
    update sittings set recapped_at = now() where id = p_id; -- mark the recap step as done
    if v_s.focused_minutes >= 25 then -- setting: a study day needs 25+ focused minutes
      v_day := (v_s.ended_at at time zone v_tz)::date; -- local calendar date when it ended
      update sittings set study_date = v_day where id = p_id; -- remember which day it counted for
      insert into study_days (user_id, day, counted_minutes, sessions)
      values (auth.uid(), v_day, least(v_s.focused_minutes, 150), 1) -- first qualifying sitting today
      on conflict (user_id, day) do update
        set counted_minutes = least(study_days.counted_minutes + excluded.counted_minutes, 150), -- cap 2.5 h per day
            sessions = study_days.sessions + 1; -- same day: no extra study day
      update profiles set time_zone = v_tz where id = auth.uid(); -- keep the latest zone
      v_new := desk_kit_sync(auth.uid()); -- unlock anything now earned
      v_counted := true; -- it counted
    end if;
  end if;
  return jsonb_build_object(
    'minutes', coalesce(v_min, 0), -- what stand_up saved
    'study_days', (select count(*) from study_days where user_id = auth.uid()), -- running total
    'counted', v_counted, -- this sitting was a study-day sitting
    'new_items', to_jsonb(v_new)); -- show these calmly after the recap
end $$;

-- ---------------------------------------------------------------------------
-- 5. My kit: totals, unlocked items, arrangement.
-- ---------------------------------------------------------------------------
drop function if exists public.my_desk_kit(); -- re-runnable
create function public.my_desk_kit()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform assert_active(); -- signed up, not banned
  perform desk_kit_sync(auth.uid()); -- catch up (e.g. thresholds lowered later)
  return jsonb_build_object(
    'study_days', (select count(*) from study_days where user_id = auth.uid()), -- total, never resets
    'unlocked', coalesce((select jsonb_agg(u.item order by c.days) from desk_unlocks u join desk_kit_catalog() c on c.item = u.item where u.user_id = auth.uid()), '[]'::jsonb), -- in catalogue order
    'spots', coalesce((select spots from desk_layouts where user_id = auth.uid()), '{}'::jsonb)); -- arrangement
end $$;

-- ---------------------------------------------------------------------------
-- 6. Place items. Checked here: spots "1"-"5", only unlocked items, each item once.
--    Empty / null values clear a spot. Returns the saved arrangement.
-- ---------------------------------------------------------------------------
drop function if exists public.set_desk_layout(jsonb); -- re-runnable
create function public.set_desk_layout(p_spots jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_clean jsonb := '{}'::jsonb; r record; -- cleaned arrangement, each pair
begin
  perform assert_active(); -- signed up, not banned
  if p_spots is null or jsonb_typeof(p_spots) <> 'object' then raise exception 'not_allowed'; end if; -- must be an object
  for r in select key, value from jsonb_each(p_spots) loop
    if r.key not in ('1', '2', '3', '4', '5') then raise exception 'not_allowed'; end if; -- unknown spot
    if r.value is null or r.value = 'null'::jsonb or r.value = '""'::jsonb then continue; end if; -- empty spot
    if jsonb_typeof(r.value) <> 'string' then raise exception 'not_allowed'; end if; -- must be an item id
    if not exists (select 1 from desk_unlocks where user_id = auth.uid() and item = r.value #>> '{}') then raise exception 'not_allowed'; end if; -- not unlocked
    if exists (select 1 from jsonb_each(v_clean) e where e.value = r.value) then raise exception 'not_allowed'; end if; -- same item twice
    v_clean := v_clean || jsonb_build_object(r.key, r.value); -- keep it
  end loop;
  insert into desk_layouts (user_id, spots, updated_at) values (auth.uid(), v_clean, now())
  on conflict (user_id) do update set spots = excluded.spots, updated_at = now(); -- one arrangement per person
  return v_clean; -- what was saved
end $$;

-- ---------------------------------------------------------------------------
-- 7. What others see: only the arrangement, only for people seated at a desk
--    right now (fresh heartbeat), never banned, never across a block.
-- ---------------------------------------------------------------------------
drop function if exists public.public_desk_kits(uuid[]); -- re-runnable
create function public.public_desk_kits(ids uuid[])
returns table (user_id uuid, spots jsonb)
language sql stable security definer set search_path = public as $$
  select l.user_id, l.spots -- arrangement only (no study-day count, no dates)
  from desk_layouts l
  join profiles p on p.id = l.user_id -- ban flag
  where l.user_id = any(ids) -- only the people asked about
    and l.spots <> '{}'::jsonb -- nothing placed: no row
    and not p.banned -- never a banned account
    and is_active_user() -- signed-in, signed-up, not banned caller
    and not blocked_between(auth.uid(), l.user_id) -- hide blocked pairs
    and exists (select 1 from sittings s where s.user_id = l.user_id and s.ended_at is null and s.last_seen_at > now() - interval '3 minutes'); -- seated now (same rule as hall_desks)
$$;

-- ---------------------------------------------------------------------------
-- 8. One-time credit for earlier sittings that already had a written recap and
--    25+ minutes (dated in Asia/Kolkata). Only fills days not recorded yet, so
--    running this file again changes nothing.
-- ---------------------------------------------------------------------------
insert into public.study_days (user_id, day, counted_minutes, sessions)
select s.user_id, (coalesce(s.ended_at, s.last_seen_at) at time zone 'Asia/Kolkata')::date, least(sum(s.focused_minutes), 150)::int, count(*)::int -- per local day, capped
from public.sittings s
join public.profiles p on p.id = s.user_id -- real accounts only
where s.recap is not null and s.focused_minutes >= 25 and s.recapped_at is null and s.ended_at is not null -- older sittings that ended with a written recap
group by s.user_id, (coalesce(s.ended_at, s.last_seen_at) at time zone 'Asia/Kolkata')::date
on conflict (user_id, day) do nothing; -- never change a day already recorded

-- Give everyone the items those days earned.
do $$ declare u uuid; begin
  for u in select distinct user_id from public.study_days loop perform public.desk_kit_sync(u); end loop; -- catch up unlocks
end $$;

-- ---------------------------------------------------------------------------
-- 9. Permissions.
-- ---------------------------------------------------------------------------
revoke all on function public.desk_kit_catalog(), public.desk_kit_tz(text), public.desk_kit_sync(uuid) from public, anon, authenticated; -- internal
revoke all on function public.finish_sitting(uuid, int, text, text), public.my_desk_kit(), public.set_desk_layout(jsonb), public.public_desk_kits(uuid[]) from public, anon; -- not for visitors
grant execute on function public.finish_sitting(uuid, int, text, text), public.my_desk_kit(), public.set_desk_layout(jsonb), public.public_desk_kits(uuid[]) to authenticated; -- signed-in users

notify pgrst, 'reload schema'; -- let the API see the new tables and functions right away
