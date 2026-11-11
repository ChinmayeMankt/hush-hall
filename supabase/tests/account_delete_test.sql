-- Account deletion check (Google Play: deleting an account must really delete
-- its data). Run on a scratch database after local_stub.sql + both migrations:
--   psql -v ON_ERROR_STOP=1 -f account_delete_test.sql
-- The app's /api/account/delete removes the auth.users row (server side, with
-- the service key); every table below must then hold nothing about that person.
-- Each check raises an error if a rule doesn't hold; the last line prints ALL_DELETE_RULES_OK.

-- Two accounts: Dev (will delete) and Esha (stays).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'dev@example.test'), ('00000000-0000-0000-0000-0000000000e1', 'esha@example.test'); -- test accounts
insert into profiles (id, nickname, avatar, adult_confirmed_at, terms_version, terms_accepted_at)
select id, initcap(split_part(email, '@', 1)), '🦉', now(), 'test', now() from auth.users where id::text in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1'); -- onboarded

-- Give Dev a row in every table that can hold something about a person.
insert into sittings (user_id, hall_id, seat, topic, recap) values ('00000000-0000-0000-0000-0000000000d1', 'science-wing', 'A1', 'Organic chemistry', 'two chapters'); -- a sitting with a recap
insert into usual_seats (user_id, hall_id, seat) values ('00000000-0000-0000-0000-0000000000d1', 'science-wing', 'A1'); -- usual desk
insert into walkers (user_id, hall_id, x, z, ry) values ('00000000-0000-0000-0000-0000000000d1', 'main-reading', 0, 0, 0); -- on foot
insert into blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1'); -- both directions
insert into rooms (id, owner_id, name) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000d1', 'Owl & Fern'); -- a room Dev owns
insert into room_members (room_id, user_id) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000e1'); -- both in it
insert into join_requests (from_id, to_id, hall_id, note) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'science-wing', 'hi'), ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'science-wing', ''); -- sent and received
insert into reports (reporter_id, reported_id, reason, urgent, reported_nickname) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'spam', false, 'Esha'), ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'spam', false, 'Dev'); -- filed and received
insert into account_notices (user_id, body) values ('00000000-0000-0000-0000-0000000000d1', 'A note'); -- a notice
insert into moderators (user_id) values ('00000000-0000-0000-0000-0000000000d1'); -- even a moderator can leave

-- What the server does: delete the login.
delete from auth.users where id = '00000000-0000-0000-0000-0000000000d1'; -- cascades

-- Nothing about Dev is left anywhere.
do $$ declare d uuid := '00000000-0000-0000-0000-0000000000d1'; n int; begin
  select (select count(*) from profiles where id = d) + (select count(*) from sittings where user_id = d) + (select count(*) from usual_seats where user_id = d)
       + (select count(*) from walkers where user_id = d) + (select count(*) from blocks where blocker_id = d or blocked_id = d)
       + (select count(*) from room_members where user_id = d) + (select count(*) from join_requests where from_id = d or to_id = d)
       + (select count(*) from reports where reporter_id = d or reported_id = d or reviewed_by = d) + (select count(*) from account_notices where user_id = d)
       + (select count(*) from moderators where user_id = d) + (select count(*) from rooms where owner_id = d) into n; -- every place a person can appear
  if n <> 0 then raise exception 'FAIL % rows about the deleted account remain', n; end if;
end $$;
do $$ begin if exists (select 1 from reports where reported_nickname = 'Dev') then raise exception 'FAIL report snapshot kept the deleted nickname'; end if; end $$;

-- Esha is untouched (her profile and her room membership stay).
do $$ begin if not exists (select 1 from profiles where id = '00000000-0000-0000-0000-0000000000e1') then raise exception 'FAIL other account removed'; end if; end $$;
do $$ begin if not exists (select 1 from room_members where user_id = '00000000-0000-0000-0000-0000000000e1') then raise exception 'FAIL other member removed from room'; end if; end $$;

select 'ALL_DELETE_RULES_OK' as result; -- every check passed
