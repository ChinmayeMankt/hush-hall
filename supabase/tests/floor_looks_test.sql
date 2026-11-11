-- Behaviour tests for floor sitting and the wardrobe (0003_floor_and_looks.sql).
-- Run on a scratch database after local_stub.sql + migrations 0001-0003:
--   psql -v ON_ERROR_STOP=1 -f floor_looks_test.sql
-- Each check raises an error if a rule doesn't hold; the last line prints ALL_FLOOR_LOOK_RULES_OK.

-- Two accounts: Esha and Farid (created as the server would).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e2', 'esha@example.test'), ('00000000-0000-0000-0000-0000000000f2', 'farid@example.test') on conflict do nothing; -- test accounts
insert into profiles (id, nickname, avatar, adult_confirmed_at, terms_version, terms_accepted_at)
select id, initcap(split_part(email, '@', 1)), '🦉', now(), 'test', now() from auth.users where id::text like '%-0000000000_2' on conflict do nothing; -- onboarded (only these two)
insert into blocked_words (word) values ('rudeword') on conflict do nothing; -- a word the list refuses

-- Act as a given user (what Supabase does with the JWT).
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false); $$;
set role authenticated; -- browser privileges from here on

-- Esha sits on the floor with a topic; Farid sees the pose and the topic.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select walk_update('science-wing', 1, 0.5, 0, 'floor', '  Organic chemistry  ');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
do $$ begin if (select topic from hall_walkers('science-wing') where user_id = '00000000-0000-0000-0000-0000000000e2' and pose = 'floor') is distinct from 'Organic chemistry' then raise exception 'FAIL floor topic not shown'; end if; end $$;

-- A topic the word list refuses shows blank (the position still saves).
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
do $$ begin if not walk_update('science-wing', 1, 0.5, 0, 'floor', 'a rudeword here') then raise exception 'FAIL position not saved'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
do $$ begin if (select topic from hall_walkers('science-wing') where user_id = '00000000-0000-0000-0000-0000000000e2') <> '' then raise exception 'FAIL refused topic shown'; end if; end $$;

-- Walking carries no topic; unknown poses count as standing.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select walk_update('science-wing', 1, 0.5, 0, 'walking', 'should not show');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
do $$ begin if (select topic from hall_walkers('science-wing') where user_id = '00000000-0000-0000-0000-0000000000e2') <> '' then raise exception 'FAIL walking topic shown'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select walk_update('science-wing', 1, 0.5, 0, 'flying');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
do $$ begin if (select pose from hall_walkers('science-wing') where user_id = '00000000-0000-0000-0000-0000000000e2') <> 'idle' then raise exception 'FAIL unknown pose kept'; end if; end $$;

-- "Hide my topic" also hides a floor topic.
reset role; update profiles set topic_hidden = true where id = '00000000-0000-0000-0000-0000000000e2'; set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select walk_update('science-wing', 1, 0.5, 0, 'floor', 'Physics');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
do $$ begin if (select topic from hall_walkers('science-wing') where user_id = '00000000-0000-0000-0000-0000000000e2') <> '' then raise exception 'FAIL hidden topic shown'; end if; end $$;

-- Sitting at a desk ends floor sitting.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select sit_down('science-wing', 'C3', 'Physics');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
do $$ begin if exists (select 1 from hall_walkers('science-wing') where user_id = '00000000-0000-0000-0000-0000000000e2') then raise exception 'FAIL desk sitter still on the floor'; end if; end $$;

-- Wardrobe: I can set my own look; others read it; junk is refused; I can't set someone else's.
update profiles set look = 'top=blue;shoes=off' where id = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
do $$ begin if (select look from public_profiles(array['00000000-0000-0000-0000-0000000000f2'::uuid])) <> 'top=blue;shoes=off' then raise exception 'FAIL look not shared'; end if; end $$;
do $$ begin update profiles set look = '<script>' where id = '00000000-0000-0000-0000-0000000000e2'; raise exception 'FAIL junk look stored'; exception when check_violation then null; end $$;
update profiles set look = 'shoes=off' where id = '00000000-0000-0000-0000-0000000000f2'; -- not my row: RLS makes this a no-op
reset role;
do $$ begin if (select look from profiles where id = '00000000-0000-0000-0000-0000000000f2') <> 'top=blue;shoes=off' then raise exception 'FAIL changed someone else''s look'; end if; end $$;
select 'ALL_FLOOR_LOOK_RULES_OK' as result;
