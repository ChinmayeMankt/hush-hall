-- 0007: guest entry (no email needed) and a public look into the hall.
--
-- Guests sign in with Supabase Anonymous Sign-Ins. A guest is a normal
-- signed-in user (role "authenticated", is_anonymous = true in the token),
-- so every rule from 0001-0006 applies to them unchanged: they need a profile
-- (made by the server after the 18+ box) before they can sit, walk, write
-- notes, block, report or be reported, and bans act on their user id.
--
-- This file adds one thing: hall_preview(), so the front page can draw the
-- real people seated in a hall before the visitor has entered. It returns
-- only what the 3D hall needs to draw someone at a desk (desk number, avatar
-- emoji, lamp colour, wardrobe) plus the id that picks their character.
-- No nickname, no topic, no times, no hours, no notes.
--
-- Safe to run more than once.

-- Seated people in one hall, for the front page (anyone may call it).
create or replace function public.hall_preview(p_hall text)
returns table (user_id uuid, seat text, avatar text, color text, look text)
language sql stable security definer set search_path = public as $$
  select s.user_id, s.seat, p.avatar, p.color, p.look -- only what a seated figure needs
  from sittings s
  join profiles p on p.id = s.user_id -- avatar, colour, wardrobe, ban flag
  where s.hall_id = p_hall -- this hall only
    and s.ended_at is null -- still seated
    and s.last_seen_at > now() - interval '3 minutes' -- same freshness rule as hall_desks()
    and not p.banned -- never a banned account
    and (auth.uid() is null or not blocked_between(auth.uid(), s.user_id)) -- a signed-in caller never sees someone they blocked (or who blocked them)
  order by s.seat -- stable order
  limit 60; -- a hall has fewer desks than this
$$;

-- Visitors and signed-in users may both call it; nothing else changes.
revoke all on function public.hall_preview(text) from public; -- start closed
grant execute on function public.hall_preview(text) to anon, authenticated; -- front page (signed out) and lobby (signed in)
