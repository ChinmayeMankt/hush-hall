-- Behaviour tests for guest entry (0007_guest_entry.sql) on top of 0001-0006.
-- Run after the other tests:  psql -v ON_ERROR_STOP=1 -f guest_entry_test.sql
-- A guest is an account with no email (Supabase Anonymous Sign-Ins). The
-- checks below show every earlier rule still applies to guests, and that the
-- front-page preview shares no nickname or topic. Last line: ALL_GUEST_RULES_OK.

-- Accounts: guest G (no email), email user E, banned person X, moderator M.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000071', null), -- guest: no email at all
  ('00000000-0000-0000-0000-000000000072', 'e@example.test'), -- email account
  ('00000000-0000-0000-0000-000000000073', 'x@example.test'), -- will be banned
  ('00000000-0000-0000-0000-000000000074', 'm@guest.test'); -- moderator
insert into profiles (id, nickname, avatar, adult_confirmed_at, terms_version, terms_accepted_at) values
  ('00000000-0000-0000-0000-000000000072', 'Email Owl', '🦉', now(), 'test', now()), -- onboarded
  ('00000000-0000-0000-0000-000000000073', 'Banned Fox', '🦊', now(), 'test', now()), -- onboarded
  ('00000000-0000-0000-0000-000000000074', 'Mod Heron', '🐦', now(), 'test', now()); -- onboarded
insert into moderators (user_id) values ('00000000-0000-0000-0000-000000000074'); -- reviews reports

-- Act as a given user. Guests carry is_anonymous = true in their token; nothing in the SQL reads it.
create function pg_temp.as_user(u text, anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claims', json_build_object('sub', u, 'is_anonymous', anon)::text, false); $$;
grant execute on function pg_temp.as_user(text, boolean) to anon, authenticated; -- callable after set role

-- 1. A guest who has not ticked the 18+ box yet (no profile) can do nothing.
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-000000000071', true);
do $$ begin perform sit_down('science-wing', 'A1', 'x'); raise exception 'FAIL guest without profile sat'; exception when others then if sqlerrm <> 'not_allowed' then raise; end if; end $$;
do $$ begin insert into desk_notes (title) values ('nope'); raise exception 'FAIL guest without profile wrote a note'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
do $$ begin perform file_report('00000000-0000-0000-0000-000000000072', 'spam', '', null, null, ''); raise exception 'FAIL guest without profile reported'; exception when others then if sqlerrm <> 'not_allowed' then raise; end if; end $$;
reset role;

-- 2. The server makes the profile after the 18+ box (same insert as for email accounts).
insert into profiles (id, nickname, avatar, adult_confirmed_at, terms_version, terms_accepted_at)
values ('00000000-0000-0000-0000-000000000071', 'Quiet Otter', '🦦', now(), 'test', now()); -- no email anywhere

-- 3. Now the guest can sit, keep the desk, write a note, place desk items and finish a study day.
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-000000000071', true);
select sit_down('science-wing', 'A1', 'Guest topic') is not null as guest_sat;
do $$ begin if not heartbeat_sitting((select id from sittings where ended_at is null and user_id = auth.uid()), 1) then raise exception 'FAIL guest heartbeat'; end if; end $$;
insert into desk_notes (title, note) values ('Guest note', 'works'); -- own row
do $$ begin if (select count(*) from desk_notes) <> 1 then raise exception 'FAIL guest sees wrong notes'; end if; end $$;
reset role;
update sittings set started_at = now() - interval '31 minutes' where user_id = '00000000-0000-0000-0000-000000000071' and ended_at is null; -- 30 real minutes passed
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-000000000071', true);
do $$ declare r jsonb; begin
  r := finish_sitting((select id from sittings where ended_at is null and user_id = auth.uid()), 30, 'done', 'Asia/Kolkata');
  if not (r->>'counted')::boolean or r->'new_items' <> '["plant"]'::jsonb then raise exception 'FAIL guest study day: %', r; end if;
end $$;
select set_desk_layout('{"1":"plant"}'::jsonb) is not null as guest_placed; -- desk kit works for guests
select sit_down('science-wing', 'A1', 'Guest topic again') is not null as guest_sat_again; -- seated for the preview checks
reset role;

-- E and X sit too; then X is banned.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000072'); select sit_down('science-wing', 'A2', 'Email topic') is not null as e_sat;
select pg_temp.as_user('00000000-0000-0000-0000-000000000073'); select sit_down('science-wing', 'A3', 'Banned topic') is not null as x_sat;
reset role;
update profiles set banned = true where id = '00000000-0000-0000-0000-000000000073'; -- moderator ban (service side)

-- 4. Front-page preview: a visitor (anon role) sees G and E seated, never X, and no nickname or topic.
set role anon; select pg_temp.as_user('');
do $$ begin
  if (select count(*) from hall_preview('science-wing') where user_id in ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072')) <> 2 then raise exception 'FAIL preview misses seated people'; end if;
  if exists (select 1 from hall_preview('science-wing') where user_id = '00000000-0000-0000-0000-000000000073') then raise exception 'FAIL preview shows a banned person'; end if;
  if (select seat from hall_preview('science-wing') where user_id = '00000000-0000-0000-0000-000000000071') <> 'A1' then raise exception 'FAIL preview desk number'; end if;
  if exists (select 1 from hall_preview('main-reading-nope')) then raise exception 'FAIL unknown hall returned rows'; end if;
end $$;
do $$ begin if pg_get_function_result('public.hall_preview(text)'::regprocedure) ~* '(nickname|topic|started|minutes|note)' then raise exception 'FAIL preview shares more than desk + look'; end if; end $$;
-- Visitors still can't use anything else.
do $$ begin perform hall_desks('science-wing'); raise exception 'FAIL visitor read hall_desks'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public_profiles(array['00000000-0000-0000-0000-000000000071']::uuid[]); raise exception 'FAIL visitor read profiles'; exception when insufficient_privilege then null; end $$;
do $$ begin perform sit_down('science-wing', 'B1', 'x'); raise exception 'FAIL visitor sat'; exception when insufficient_privilege then null; end $$;
do $$ begin perform hall_counts(); raise exception 'FAIL visitor read counts'; exception when insufficient_privilege then null; end $$;
reset role;

-- 5. Block and report work with guests on both sides.
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-000000000072');
select file_report('00000000-0000-0000-0000-000000000071', 'harassment', 'guest was rude', 'science-wing', null, 'Guest topic again') is not null as e_reported_guest;
select block_user('00000000-0000-0000-0000-000000000071'); -- E blocks the guest
do $$ begin
  if exists (select 1 from hall_preview('science-wing') where user_id = '00000000-0000-0000-0000-000000000071') then raise exception 'FAIL blocked guest still in my preview'; end if;
  if exists (select 1 from hall_desks('science-wing') where user_id = '00000000-0000-0000-0000-000000000071') then raise exception 'FAIL blocked guest still at a desk for me'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000071', true);
do $$ begin if exists (select 1 from hall_preview('science-wing') where user_id = '00000000-0000-0000-0000-000000000072') then raise exception 'FAIL block not two-way in preview'; end if; end $$;
select file_report('00000000-0000-0000-0000-000000000072', 'spam', '', 'science-wing', null, '') is not null as guest_reported_e; -- guests can report too
select pg_temp.as_user('00000000-0000-0000-0000-000000000074');
do $$ begin if not exists (select 1 from mod_queue('open') where reported_id = '00000000-0000-0000-0000-000000000071' and reported_nickname = 'Quiet Otter' and urgent) then raise exception 'FAIL report on guest not in the moderator queue'; end if; end $$;
reset role;

-- 6. A ban on the guest's id stops them, and the preview drops them.
update profiles set banned = true where id = '00000000-0000-0000-0000-000000000071'; -- moderator ban
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-000000000071', true);
do $$ begin perform sit_down('science-wing', 'B2', 'x'); raise exception 'FAIL banned guest sat'; exception when others then if sqlerrm <> 'not_allowed' then raise; end if; end $$;
reset role; set role anon; select pg_temp.as_user('');
do $$ begin if exists (select 1 from hall_preview('science-wing') where user_id = '00000000-0000-0000-0000-000000000071') then raise exception 'FAIL banned guest in preview'; end if; end $$;
reset role;

-- 7. Deleting the guest's login removes everything tied to it (same cascade as email accounts).
delete from auth.users where id = '00000000-0000-0000-0000-000000000071';
do $$ begin
  if exists (select 1 from profiles where id = '00000000-0000-0000-0000-000000000071') then raise exception 'FAIL guest profile left'; end if;
  if exists (select 1 from sittings where user_id = '00000000-0000-0000-0000-000000000071') then raise exception 'FAIL guest sittings left'; end if;
  if exists (select 1 from desk_notes where user_id = '00000000-0000-0000-0000-000000000071') then raise exception 'FAIL guest notes left'; end if;
  if exists (select 1 from desk_unlocks where user_id = '00000000-0000-0000-0000-000000000071') then raise exception 'FAIL guest desk items left'; end if;
end $$;

select 'ALL_GUEST_RULES_OK';
