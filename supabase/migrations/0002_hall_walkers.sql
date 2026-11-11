-- Hush Hall: people walking around a hall, stored in the database.
-- Desks already come from the database (hall_desks), so seated people show up
-- even when the live Realtime channel is down. This does the same for people
-- on foot: each walker keeps one small row (where they stand, which way they
-- face, walking or standing still) with a short heartbeat, and everyone else
-- in the hall reads those rows a few times a second through hall_walkers().
-- Safe to run more than once.
drop function if exists public.hall_walkers(text); -- re-runnable even if its columns change

-- One row per person on foot (at most one hall at a time).
create table if not exists public.walkers (
  user_id uuid primary key references public.profiles (id) on delete cascade, -- who (one row per person)
  hall_id text not null references public.halls (id) on delete cascade, -- which hall they walk in
  x real not null, -- position across the hall (metres)
  z real not null, -- position along the hall (metres)
  ry real not null, -- which way they face (radians)
  pose text not null default 'idle' check (pose in ('walking', 'idle')), -- moving or standing still
  updated_at timestamptz not null default now() -- heartbeat: rows older than 20 s are ignored
);
create index if not exists walkers_hall_time on public.walkers (hall_id, updated_at desc); -- "who walks in this hall now"
alter table public.walkers enable row level security; -- no direct access (no policies): reads and writes go through the functions below

-- Report where I stand while walking (called a few times a second while moving,
-- and every few seconds as a heartbeat while standing still).
-- Returns false (and stores nothing) if I hold a desk: walkers never occupy a desk.
create or replace function public.walk_update(p_hall text, p_x real, p_z real, p_ry real, p_pose text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform assert_active(); -- signed up, not banned
  if not exists (select 1 from halls where id = p_hall) then raise exception 'unknown_hall'; end if; -- real halls only
  if p_x is null or p_z is null or p_ry is null or p_x = 'NaN' or p_z = 'NaN' or p_ry = 'NaN' then raise exception 'bad_position'; end if; -- finite numbers only
  if exists (select 1 from sittings where user_id = auth.uid() and ended_at is null and last_seen_at > now() - interval '3 minutes') then -- I'm seated
    delete from walkers where user_id = auth.uid(); -- never drawn on foot while at a desk
    return false; -- nothing stored
  end if;
  insert into walkers (user_id, hall_id, x, z, ry, pose, updated_at)
  values (auth.uid(), p_hall, greatest(-11, least(11, p_x)), greatest(-8, least(8, p_z)), greatest(-100, least(100, p_ry)), case when p_pose = 'walking' then 'walking' else 'idle' end, now()) -- kept inside the hall, known pose
  on conflict (user_id) do update set hall_id = excluded.hall_id, x = excluded.x, z = excluded.z, ry = excluded.ry, pose = excluded.pose, updated_at = now(); -- one row per person, latest wins
  return true; -- stored
end $$;

-- Stop walking (sat down, pressed "Stop walking", or left the hall).
create or replace function public.walk_clear()
returns void language sql security definer set search_path = public as $$
  delete from walkers where user_id = auth.uid(); -- my row only
$$;

-- Everyone else walking in a hall right now: fresh heartbeat, not seated,
-- not banned, and never someone in a block with me (either direction).
-- age_ms = how old the position is by the database clock (no clock-skew issues);
-- stamp = when it was written (ms since 1970, database clock), so a reader can tell a new step from the same one read twice.
create or replace function public.hall_walkers(p_hall text)
returns table (user_id uuid, x real, z real, ry real, pose text, age_ms int, stamp bigint)
language sql stable security definer set search_path = public as $$
  select w.user_id, w.x, w.z, w.ry, w.pose, (extract(epoch from now() - w.updated_at) * 1000)::int, (extract(epoch from w.updated_at) * 1000)::bigint -- position, its age, and when it was written
  from walkers w join profiles p on p.id = w.user_id
  where w.hall_id = p_hall and w.updated_at > now() - interval '20 seconds' -- setting: a closed tab stops showing after 20 s
    and w.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) -- not me
    and not p.banned and is_active_user() and not blocked_between(auth.uid(), w.user_id) -- same rules as desks
    and not exists (select 1 from sittings s where s.user_id = w.user_id and s.ended_at is null and s.last_seen_at > now() - interval '3 minutes'); -- seated people are drawn at their desk, not on foot
$$;

-- Sitting down ends walking right away (so nobody is drawn twice).
create or replace function public.walkers_clear_on_sit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from walkers where user_id = new.user_id; -- off their feet
  return new; -- keep the sitting
end $$;
drop trigger if exists walkers_clear_on_sit on public.sittings; -- re-runnable
create trigger walkers_clear_on_sit after insert on public.sittings for each row execute function public.walkers_clear_on_sit(); -- every sit_down

-- Privileges: signed-in users only (the functions check the rest).
revoke all on table public.walkers from public, anon, authenticated; -- no direct table access
revoke all on function public.walk_update(text, real, real, real, text), public.walk_clear(), public.hall_walkers(text), public.walkers_clear_on_sit() from public, anon; -- not for anonymous visitors
grant execute on function public.walk_update(text, real, real, real, text), public.walk_clear(), public.hall_walkers(text) to authenticated; -- signed-in users
notify pgrst, 'reload schema'; -- let the API see the new functions right away
