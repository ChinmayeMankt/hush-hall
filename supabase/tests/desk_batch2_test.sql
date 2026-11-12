-- Behaviour tests for desk batch 2 (0005_desk_batch2.sql). Run on a scratch
-- database after local_stub.sql + migrations 0001-0005:
--   psql -v ON_ERROR_STOP=1 -f desk_batch2_test.sql
-- Each check raises an error if a rule doesn't hold; the last line prints ALL_DESK_BATCH2_RULES_OK.

-- Two accounts: Asha (owner) and Bilal (must not see her private data).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'asha2@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'bilal2@example.test') on conflict do nothing; -- test accounts
insert into profiles (id, nickname, avatar, adult_confirmed_at, terms_version, terms_accepted_at)
select id, initcap(split_part(email, '@', 1)), '🦉', now(), 'test', now() from auth.users
where id in ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2') on conflict do nothing; -- onboarded

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false); $$;
set role authenticated;

-- A blank title is allowed; a too-long title is not; a long annotation (up to 10000) is.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
insert into desk_notes (title, note) values ('', 'just writing'); -- empty title ok
do $$ begin
  insert into desk_notes (title, note) values (repeat('x', 81), 'too long');
  raise exception 'FAIL title longer than 80 allowed';
exception when others then if sqlerrm like 'FAIL%' then raise; end if;
end $$;
insert into desk_notes (title, note) values ('Long write', repeat('a', 10000)); -- at the cap
do $$ begin
  insert into desk_notes (title, note) values ('Too long', repeat('a', 10001));
  raise exception 'FAIL note longer than 10000 allowed';
exception when others then if sqlerrm like 'FAIL%' then raise; end if;
end $$;

-- Share token: Asha can set one; Bilal cannot read the row; anon can read only via the RPC.
update desk_notes set share_token = 'abcdefghijklmnopqrstuvwxyz12' where title = '' and note = 'just writing'; -- valid token
do $$ begin
  if (select count(*) from get_shared_note('abcdefghijklmnopqrstuvwxyz12')) <> 1 then raise exception 'FAIL shared note not returned'; end if;
  if (select note from get_shared_note('abcdefghijklmnopqrstuvwxyz12')) <> 'just writing' then raise exception 'FAIL wrong shared body'; end if;
end $$;
do $$ begin
  if (select count(*) from get_shared_note('zzzzzzzzzzzzzzzzzzzzzzzzzzzz')) <> 0 then raise exception 'FAIL unknown token returned a note'; end if;
end $$;

-- A signed-in other person still cannot see Asha's notes through the table.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
do $$ begin
  if (select count(*) from desk_notes) <> 0 then raise exception 'FAIL Bilal saw Asha notes'; end if;
end $$;
-- They can read the shared note through the RPC only (not her other notes).
do $$ begin
  if (select count(*) from get_shared_note('abcdefghijklmnopqrstuvwxyz12')) <> 1 then raise exception 'FAIL share RPC hidden from another user'; end if;
end $$;

-- Anonymous visitors can use the share RPC, not the table.
reset role;
set role anon;
select pg_temp.as_user('');
do $$ begin
  if (select count(*) from get_shared_note('abcdefghijklmnopqrstuvwxyz12')) <> 1 then raise exception 'FAIL anon could not read a shared note'; end if;
end $$;
do $$ begin
  perform * from desk_notes;
  raise exception 'FAIL anon selected desk_notes';
exception when others then if sqlerrm like 'FAIL%' then raise; end if;
end $$;

-- Weekly hours: only the total, only when the toggle is on, only this IST week.
-- Sittings are written only through sit_down in the app, so the test inserts them as the owner role.
reset role;
insert into sittings (user_id, hall_id, seat, topic, focused_minutes, started_at, last_seen_at, ended_at)
values ('00000000-0000-0000-0000-0000000000a2', 'science-wing', 'A1', 'PCR', 90, now(), now(), now()); -- this week
-- A sitting from two weeks ago must not count.
insert into sittings (user_id, hall_id, seat, topic, focused_minutes, started_at, last_seen_at, ended_at)
values ('00000000-0000-0000-0000-0000000000a2', 'science-wing', 'A2', 'Old', 400, now() - interval '14 days', now() - interval '14 days', now() - interval '14 days'); -- last fortnight
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
do $$ begin
  if (select minutes from public_weekly_hours(array['00000000-0000-0000-0000-0000000000a2'::uuid])) <> 90 then raise exception 'FAIL weekly hours should be 90, not older sittings'; end if;
end $$;
-- Hiding the total removes the row (nothing else is returned).
update profiles set show_weekly_hours = false where id = '00000000-0000-0000-0000-0000000000a2';
do $$ begin
  if (select count(*) from public_weekly_hours(array['00000000-0000-0000-0000-0000000000a2'::uuid])) <> 0 then raise exception 'FAIL hidden weekly hours were returned'; end if;
end $$;
update profiles set show_weekly_hours = true where id = '00000000-0000-0000-0000-0000000000a2'; -- restore

-- Bilal cannot read Asha's timetable, and Asha can write her own.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
insert into timetable_slots (day, start_min, end_min, subject) values (0, 9 * 60, 11 * 60, 'Molecular biology'); -- Monday 09:00-11:00
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
do $$ begin
  if (select count(*) from timetable_slots) <> 0 then raise exception 'FAIL Bilal saw Asha timetable'; end if;
end $$;
do $$ begin
  delete from timetable_slots where subject = 'Molecular biology';
  if found then raise exception 'FAIL Bilal deleted Asha timetable'; end if;
end $$;

-- Deleting Asha's login removes her notes, share token, timetable and sittings.
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a2'; -- cascades
do $$ begin
  if exists (select 1 from desk_notes where user_id = '00000000-0000-0000-0000-0000000000a2') then raise exception 'FAIL notes left after account delete'; end if;
  if exists (select 1 from timetable_slots where user_id = '00000000-0000-0000-0000-0000000000a2') then raise exception 'FAIL timetable left after account delete'; end if;
  if (select count(*) from get_shared_note('abcdefghijklmnopqrstuvwxyz12')) <> 0 then raise exception 'FAIL share link survived account delete'; end if;
end $$;
do $$ begin
  if not exists (select 1 from profiles where id = '00000000-0000-0000-0000-0000000000b2') then raise exception 'FAIL other account removed'; end if;
end $$;

select 'ALL_DESK_BATCH2_RULES_OK' as result; -- every check passed
