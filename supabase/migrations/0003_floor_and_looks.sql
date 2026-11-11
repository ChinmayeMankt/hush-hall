-- Hush Hall: sitting on the floor to study, and a small wardrobe.
-- Run after 0002_hall_walkers.sql. Safe to run more than once.
--  - Floor sitting reuses the walker row (position + pose 'floor') and adds the
--    study topic, filtered by the same word list and "hide my topic" rule as desks.
--  - The wardrobe is one short text on the profile ("top=blue;shoes=off"), shown
--    to others through public_profiles() like nickname and avatar.

-- Wardrobe choice on the profile (only letters, '=' and ';'; the app ignores anything it doesn't know).
alter table public.profiles add column if not exists look text not null default ''; -- empty = the character as approved
alter table public.profiles drop constraint if exists profiles_look_ok; -- re-runnable
alter table public.profiles add constraint profiles_look_ok check (look ~ '^[a-z=;]{0,60}$'); -- short and plain
grant update (look) on public.profiles to authenticated; -- people may change their own look (row policy: own row only)

-- public_profiles() now also returns the look.
drop function if exists public.public_profiles(uuid[]); -- return columns change
create function public.public_profiles(ids uuid[])
returns table (id uuid, nickname text, avatar text, color text, takes_requests boolean, show_topic boolean, look text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nickname, p.avatar, p.color,
         not (p.hide_from_requests or p.requests_paused or p.rooms_suspended) and not blocked_between(auth.uid(), p.id), -- can I send a request?
         not p.topic_hidden, -- show their topic?
         p.look -- wardrobe
  from profiles p
  where p.id = any(ids) and not p.banned and is_active_user(); -- only for signed-up callers, never banned people
$$;

-- Walkers: a third pose (sitting on the floor) and its study topic.
alter table public.walkers drop constraint if exists walkers_pose_check; -- the old two-pose rule
alter table public.walkers add constraint walkers_pose_check check (pose in ('walking', 'idle', 'floor')); -- walking, standing, or sitting on the floor
alter table public.walkers add column if not exists topic text not null default ''; -- what a floor sitter studies ('' otherwise)

-- Save my position (and, when sitting on the floor, my topic).
drop function if exists public.walk_update(text, real, real, real, text); -- replaced by the version with a topic
drop function if exists public.walk_update(text, real, real, real, text, text); -- re-runnable
create function public.walk_update(p_hall text, p_x real, p_z real, p_ry real, p_pose text, p_topic text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pose text := case when p_pose in ('walking', 'floor') then p_pose else 'idle' end; -- known poses only
declare v_topic text := ''; -- shown topic
begin
  perform assert_active(); -- signed up, not banned
  if not exists (select 1 from halls where id = p_hall) then raise exception 'unknown_hall'; end if; -- real halls only
  if p_x is null or p_z is null or p_ry is null or p_x = 'NaN' or p_z = 'NaN' or p_ry = 'NaN' then raise exception 'bad_position'; end if; -- finite numbers only
  if exists (select 1 from sittings where user_id = auth.uid() and ended_at is null and last_seen_at > now() - interval '3 minutes') then -- I'm seated at a desk
    delete from walkers where user_id = auth.uid(); -- never drawn on foot (or on the floor) while at a desk
    return false; -- nothing stored
  end if;
  if v_pose = 'floor' and text_ok(p_topic) then v_topic := left(btrim(coalesce(p_topic, '')), 80); end if; -- same word list as desk topics; a refused topic just shows blank
  insert into walkers (user_id, hall_id, x, z, ry, pose, topic, updated_at)
  values (auth.uid(), p_hall, greatest(-11, least(11, p_x)), greatest(-8, least(8, p_z)), greatest(-100, least(100, p_ry)), v_pose, v_topic, now()) -- kept inside the hall
  on conflict (user_id) do update set hall_id = excluded.hall_id, x = excluded.x, z = excluded.z, ry = excluded.ry, pose = excluded.pose, topic = excluded.topic, updated_at = now(); -- one row per person, latest wins
  return true; -- stored
end $$;

-- Everyone else on foot or on the floor in a hall (topic hidden if they chose to hide topics).
drop function if exists public.hall_walkers(text); -- return columns change
create function public.hall_walkers(p_hall text)
returns table (user_id uuid, x real, z real, ry real, pose text, age_ms int, stamp bigint, topic text)
language sql stable security definer set search_path = public as $$
  select w.user_id, w.x, w.z, w.ry, w.pose, (extract(epoch from now() - w.updated_at) * 1000)::int, (extract(epoch from w.updated_at) * 1000)::bigint, -- position, its age, and when it was written
         case when p.topic_hidden or w.pose <> 'floor' then '' else w.topic end -- floor topic, unless hidden
  from walkers w join profiles p on p.id = w.user_id
  where w.hall_id = p_hall and w.updated_at > now() - interval '20 seconds' -- a closed tab stops showing after 20 s
    and w.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) -- not me
    and not p.banned and is_active_user() and not blocked_between(auth.uid(), w.user_id) -- same rules as desks
    and not exists (select 1 from sittings s where s.user_id = w.user_id and s.ended_at is null and s.last_seen_at > now() - interval '3 minutes'); -- seated people are drawn at their desk
$$;

-- Privileges: signed-in users only.
revoke all on function public.walk_update(text, real, real, real, text, text), public.hall_walkers(text), public.public_profiles(uuid[]) from public, anon; -- not for anonymous visitors
grant execute on function public.walk_update(text, real, real, real, text, text), public.hall_walkers(text), public.public_profiles(uuid[]) to authenticated; -- signed-in users
notify pgrst, 'reload schema'; -- let the API see the changes right away
