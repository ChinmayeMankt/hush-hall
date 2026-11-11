-- Behaviour tests for people on foot (0002_hall_walkers.sql). Run on a scratch
-- database after local_stub.sql + both migrations:  psql -v ON_ERROR_STOP=1 -f walkers_test.sql
-- Each check raises an error if a rule doesn't hold; the last line prints ALL_WALKER_RULES_OK.

-- Three accounts: Asha, Bilal, Chitra (created as the server would).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'asha@example.test'), ('00000000-0000-0000-0000-0000000000b1', 'bilal@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'chitra@example.test') on conflict do nothing; -- test accounts
insert into profiles (id, nickname, avatar, adult_confirmed_at, terms_version, terms_accepted_at)
select id, initcap(split_part(email, '@', 1)), '🦉', now(), 'test', now() from auth.users where id::text like '%-0000000000_1' on conflict do nothing; -- onboarded (only these three)

-- Act as a given user (what Supabase does with the JWT).
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false); $$;
set role authenticated; -- browser privileges from here on

-- Anonymous callers can't walk.
select pg_temp.as_user('');
do $$ begin perform walk_update('science-wing', 0, 0, 0, 'walking'); raise exception 'FAIL anonymous walked'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;

-- The table itself is not readable or writable directly.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin perform 1 from walkers; raise exception 'FAIL table readable'; exception when insufficient_privilege then null; end $$;

-- Asha walks; Bilal sees her (position clamped into the hall), Asha doesn't see herself.
do $$ begin if not walk_update('science-wing', 50, 1.5, 0.5, 'walking') then raise exception 'FAIL walk not stored'; end if; end $$;
do $$ begin if (select count(*) from hall_walkers('science-wing')) <> 0 then raise exception 'FAIL I see myself'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
do $$ begin if (select x from hall_walkers('science-wing') where pose = 'walking') <> 11 then raise exception 'FAIL walker not visible or not clamped'; end if; end $$;
do $$ begin if (select count(*) from hall_walkers('main-reading')) <> 0 then raise exception 'FAIL walker leaked into another hall'; end if; end $$;

-- Unknown halls are refused.
do $$ begin perform walk_update('nowhere', 0, 0, 0, 'idle'); raise exception 'FAIL unknown hall'; exception when others then if sqlerrm <> 'unknown_hall' then raise; end if; end $$;

-- Stale rows (no heartbeat for 20 s) are not shown.
reset role; update walkers set updated_at = now() - interval '30 seconds'; set role authenticated;
do $$ begin if (select count(*) from hall_walkers('science-wing')) <> 0 then raise exception 'FAIL stale walker shown'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select walk_update('science-wing', 1, 1, 0, 'idle'); -- heartbeat brings her back

-- Blocks hide walkers in both directions.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select block_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin if (select count(*) from hall_walkers('science-wing')) <> 0 then raise exception 'FAIL blocked walker shown'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select walk_update('science-wing', 1, 1, 0, 'idle');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select walk_update('science-wing', 2, 2, 0, 'walking');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin if exists (select 1 from hall_walkers('science-wing') where user_id = '00000000-0000-0000-0000-0000000000c1') then raise exception 'FAIL blocker shown to blocked'; end if; end $$;

-- Sitting down ends walking; a seated person can't be stored on foot.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select sit_down('science-wing', 'A1', 'reading');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
do $$ begin if exists (select 1 from hall_walkers('science-wing') where user_id = '00000000-0000-0000-0000-0000000000a1') then raise exception 'FAIL seated person drawn walking'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin if walk_update('science-wing', 0, 0, 0, 'walking') then raise exception 'FAIL seated person stored walking'; end if; end $$;

-- Clearing removes my row only.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select walk_update('science-wing', 3, 3, 1, 'walking');
select walk_clear();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin if exists (select 1 from hall_walkers('science-wing') where user_id = '00000000-0000-0000-0000-0000000000b1') then raise exception 'FAIL clear did not remove'; end if; end $$;

reset role;
select 'ALL_WALKER_RULES_OK' as result;
