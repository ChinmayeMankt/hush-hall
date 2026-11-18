-- Behaviour tests for the desk kit (0006_desk_kit.sql). Run on a scratch
-- database after local_stub.sql + migrations 0001-0006:
--   psql -v ON_ERROR_STOP=1 -f desk_kit_test.sql
-- Each check raises an error if a rule doesn't hold; the last line prints ALL_DESK_KIT_RULES_OK.

-- Three accounts: Asha (studies), Bilal (looks at her desk), Chen (blocks her).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a6', 'asha6@example.test'),
  ('00000000-0000-0000-0000-0000000000b6', 'bilal6@example.test'),
  ('00000000-0000-0000-0000-0000000000c6', 'chen6@example.test') on conflict do nothing; -- test accounts
insert into profiles (id, nickname, avatar, adult_confirmed_at, terms_version, terms_accepted_at)
select id, initcap(split_part(email, '@', 1)), '🦉', now(), 'test', now() from auth.users
where id::text like '00000000-0000-0000-0000-0000000000_6' on conflict do nothing; -- onboarded

update sittings set ended_at = now() where ended_at is null; -- scratch database: free every desk left by earlier test files

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false); $$; -- pretend to be this person
-- Test helper (runs as the test owner): sit Asha down and backdate the start so N minutes really passed.
create function pg_temp.sit_for(seat text, mins int) returns uuid language plpgsql as $$
declare v uuid; begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a6', false); -- as Asha
  v := sit_down('main-reading', seat, 'Enzyme kinetics'); -- real sit_down
  update sittings set started_at = now() - make_interval(mins => mins + 1), last_seen_at = now() where id = v; -- minutes really elapsed
  return v; end $$;
grant execute on function pg_temp.sit_for(text, int) to authenticated; -- callable after set role (runs as caller, so we reset role around it)

-- 1. A short sitting (20 min) with a recap does not make a study day.
select pg_temp.sit_for('A1', 20) as s1 \gset
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
do $$ declare r jsonb; begin
  r := finish_sitting((select id from sittings where ended_at is null and user_id = auth.uid()), 20, 'warm-up', 'Asia/Kolkata');
  if (r->>'counted')::boolean or (r->>'study_days')::int <> 0 or jsonb_array_length(r->'new_items') <> 0 then raise exception 'FAIL short sitting counted: %', r; end if;
end $$;
reset role;

-- 2. A 30-minute sitting with a recap is study day 1 and unlocks the plant (first reward after the first study day).
select pg_temp.sit_for('A1', 30) as s2 \gset
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
do $$ declare r jsonb; begin
  r := finish_sitting((select id from sittings where ended_at is null and user_id = auth.uid()), 30, '', 'Asia/Kolkata');
  if not (r->>'counted')::boolean or (r->>'study_days')::int <> 1 or r->'new_items' <> '["plant"]'::jsonb then raise exception 'FAIL first study day: %', r; end if;
  if (r->>'minutes')::int <> 30 then raise exception 'FAIL minutes not saved like stand_up: %', r; end if;
end $$;
-- Calling it again for the same sitting changes nothing.
do $$ declare r jsonb; begin
  r := finish_sitting((select id from sittings where user_id = auth.uid() order by started_at desc limit 1), 30, 'again', 'Asia/Kolkata');
  if (r->>'counted')::boolean or (select sessions from study_days where user_id = auth.uid()) <> 1 then raise exception 'FAIL same sitting counted twice: %', r; end if;
end $$;
reset role;

-- 3. More sittings on the same local day: still one study day; counted minutes cap at 150 (2.5 h).
select pg_temp.sit_for('A2', 100) as s3 \gset
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
select finish_sitting((select id from sittings where ended_at is null and user_id = auth.uid()), 100, 'long one', 'Asia/Kolkata') is not null;
reset role;
select pg_temp.sit_for('A2', 60) as s4 \gset
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
do $$ declare r jsonb; begin
  r := finish_sitting((select id from sittings where ended_at is null and user_id = auth.uid()), 60, 'evening', 'Asia/Kolkata');
  if (r->>'study_days')::int <> 1 then raise exception 'FAIL same day counted twice: %', r; end if;
  if (select counted_minutes from study_days where user_id = auth.uid()) <> 150 then raise exception 'FAIL daily 2.5 h cap not applied'; end if;
  if (select sessions from study_days where user_id = auth.uid()) <> 3 then raise exception 'FAIL qualifying sittings not tallied'; end if;
end $$;
-- Private stats still see every minute (uncapped).
do $$ begin if (select sum(focused_minutes) from sittings where user_id = auth.uid()) < 200 then raise exception 'FAIL private minutes were capped'; end if; end $$;
reset role;

-- 4. A sitting that ended long ago (no recap at the time) cannot be collected later.
select pg_temp.sit_for('A3', 40) as s5 \gset
update sittings set ended_at = now() - interval '20 minutes', last_seen_at = now() - interval '20 minutes' where id = :'s5'; -- tab closed 20 min ago
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
do $$ declare r jsonb; begin
  r := finish_sitting((select id from sittings where user_id = auth.uid() and seat = 'A3'), 40, 'late', 'Asia/Kolkata');
  if (r->>'counted')::boolean then raise exception 'FAIL old sitting collected: %', r; end if;
end $$;
reset role;

-- 5. Thresholds: with two earlier study days on record, today's qualifying sitting (day 3) unlocks the mug.
delete from study_days where user_id = '00000000-0000-0000-0000-0000000000a6'; -- start this check clean (unlocks stay)
insert into study_days (user_id, day, counted_minutes, sessions) values
  ('00000000-0000-0000-0000-0000000000a6', current_date - 5, 40, 1),
  ('00000000-0000-0000-0000-0000000000a6', current_date - 3, 40, 1); -- two earlier days
select pg_temp.sit_for('A4', 26) as s6 \gset
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
do $$ declare r jsonb; begin
  r := finish_sitting((select id from sittings where ended_at is null and user_id = auth.uid()), 26, 'ok', 'Pacific/Kiritimati');
  if (r->>'study_days')::int <> 3 or r->'new_items' <> '["mug"]'::jsonb then raise exception 'FAIL day-3 mug unlock: %', r; end if;
  if (select study_date from sittings where user_id = auth.uid() and seat = 'A4') <> (now() at time zone 'Pacific/Kiritimati')::date then raise exception 'FAIL local date not used'; end if;
  if (select time_zone from profiles where id = auth.uid()) <> 'Pacific/Kiritimati' then raise exception 'FAIL time zone not stored'; end if;
end $$;
reset role;
-- A bad time zone name falls back to Asia/Kolkata (no error). (Helper is internal, so checked as the owner.)
do $$ begin if public.desk_kit_tz('Mars/Olympus') <> 'Asia/Kolkata' then raise exception 'FAIL bad zone accepted'; end if; end $$;

-- 6. Unlocks are never removed, even if study-day rows vanished (e.g. a manual fix).
delete from study_days where user_id = '00000000-0000-0000-0000-0000000000a6'; -- simulate
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
do $$ declare k jsonb; begin
  k := my_desk_kit();
  if k->'unlocked' <> '["plant", "mug"]'::jsonb then raise exception 'FAIL unlocks withered: %', k; end if;
end $$;

-- 7. Placing items: spots 1-5, unlocked items only, each once; empty clears.
do $$ declare r jsonb; begin
  r := set_desk_layout('{"1": "plant", "4": "mug", "2": null, "3": ""}');
  if r <> '{"1": "plant", "4": "mug"}'::jsonb then raise exception 'FAIL layout not saved cleanly: %', r; end if;
end $$;
do $$ begin perform set_desk_layout('{"1": "pencils"}'); raise exception 'FAIL locked item placed'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
do $$ begin perform set_desk_layout('{"1": "plant", "2": "plant"}'); raise exception 'FAIL item placed twice'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
do $$ begin perform set_desk_layout('{"6": "plant"}'); raise exception 'FAIL unknown spot'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
do $$ begin perform set_desk_layout('{"1": 5}'); raise exception 'FAIL non-text item'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
do $$ begin perform set_desk_layout('[]'); raise exception 'FAIL non-object layout'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
do $$ begin if (select spots from desk_layouts where user_id = auth.uid()) <> '{"1": "plant", "4": "mug"}'::jsonb then raise exception 'FAIL failed call changed the layout'; end if; end $$;

-- 7b. Removing is free: an empty desk is valid, removed items stay unlocked and can go back any time.
do $$ declare r jsonb; k jsonb; begin
  r := set_desk_layout('{}'); -- clear everything
  if r <> '{}'::jsonb then raise exception 'FAIL empty desk not allowed: %', r; end if;
  k := my_desk_kit();
  if k->'unlocked' <> '["plant", "mug"]'::jsonb then raise exception 'FAIL removing withered an unlock: %', k; end if;
  if k->'spots' <> '{}'::jsonb then raise exception 'FAIL empty layout not kept: %', k; end if;
  r := set_desk_layout('{"4": "mug"}'); -- a sparse desk: one item
  if r <> '{"4": "mug"}'::jsonb then raise exception 'FAIL sparse desk not saved: %', r; end if;
  r := set_desk_layout('{"1": "plant", "4": "mug"}'); -- put the plant back
  if r <> '{"1": "plant", "4": "mug"}'::jsonb then raise exception 'FAIL re-placing a removed item: %', r; end if;
end $$;

-- 8. No direct writes: counters, unlocks, layouts and the recap marker are function-only.
do $$ begin insert into study_days (user_id, day) values (auth.uid(), current_date + 1); raise exception 'FAIL wrote a study day directly'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
do $$ begin insert into desk_unlocks (user_id, item) values (auth.uid(), 'cat'); raise exception 'FAIL unlocked directly'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
do $$ begin update desk_layouts set spots = '{"1": "cat"}'; raise exception 'FAIL layout written directly'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
update sittings set recapped_at = null, focused_minutes = 1440; -- RLS has no update policy: silently changes nothing
do $$ begin if not exists (select 1 from sittings where user_id = auth.uid() and recapped_at is not null) or exists (select 1 from sittings where focused_minutes = 1440) then raise exception 'FAIL sitting edited directly'; end if; end $$;
do $$ begin perform desk_kit_sync(auth.uid()); raise exception 'FAIL internal unlock helper callable'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
do $$ begin delete from desk_unlocks; raise exception 'FAIL unlock deleted directly'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;

-- 9. Others see only the arrangement, only while she's seated, never across a block.
select sit_down('main-reading', 'B2', 'Enzyme kinetics') is not null as asha_sat; -- Asha sits again
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b6');
do $$ declare n int; s jsonb; begin
  select count(*), max(spots::text)::jsonb into n, s from public_desk_kits(array['00000000-0000-0000-0000-0000000000a6']::uuid[]);
  if n <> 1 or s <> '{"1": "plant", "4": "mug"}'::jsonb then raise exception 'FAIL seated arrangement not visible (% %)', n, s; end if;
end $$;
do $$ begin perform 1 from study_days where user_id = '00000000-0000-0000-0000-0000000000a6'; if found then raise exception 'FAIL saw her study days'; end if; end $$;
do $$ begin perform 1 from desk_layouts where user_id = '00000000-0000-0000-0000-0000000000a6'; if found then raise exception 'FAIL read her layout table'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
select stand_up((select id from sittings where ended_at is null and user_id = auth.uid()), 1, '') >= 0 as asha_stood; -- she leaves
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b6');
do $$ begin if exists (select 1 from public_desk_kits(array['00000000-0000-0000-0000-0000000000a6']::uuid[])) then raise exception 'FAIL arrangement shown while not seated'; end if; end $$;
-- Blocked pair: Chen blocks Asha, then Asha sits; Chen sees nothing.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c6');
select block_user('00000000-0000-0000-0000-0000000000a6');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
select sit_down('main-reading', 'B3', 'Enzyme kinetics') is not null as asha_sat_again;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c6');
do $$ begin if exists (select 1 from public_desk_kits(array['00000000-0000-0000-0000-0000000000a6']::uuid[])) then raise exception 'FAIL blocked person saw arrangement'; end if; end $$;
reset role;
set role anon; select pg_temp.as_user('');
do $$ begin perform public_desk_kits(array['00000000-0000-0000-0000-0000000000a6']::uuid[]); raise exception 'FAIL visitors can read desk kits'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
do $$ begin perform finish_sitting(gen_random_uuid(), 30, '', 'UTC'); raise exception 'FAIL visitors can finish sittings'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;
reset role;

-- 10. Arrangement follows the person, not the desk: same spots at her new desk B3.
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b6');
do $$ begin if (select spots from public_desk_kits(array['00000000-0000-0000-0000-0000000000a6']::uuid[])) <> '{"1": "plant", "4": "mug"}'::jsonb then raise exception 'FAIL arrangement did not move with her'; end if; end $$;
reset role;

-- 11. Account deletion removes every desk-kit row.
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a6'; -- what /api/account/delete does
do $$ declare d uuid := '00000000-0000-0000-0000-0000000000a6'; begin
  if (select count(*) from study_days where user_id = d) + (select count(*) from desk_unlocks where user_id = d) + (select count(*) from desk_layouts where user_id = d) <> 0 then raise exception 'FAIL desk-kit rows outlived the account'; end if;
end $$;

-- 12. The SQL catalogue matches app/lib/deskKit.ts (update both together).
do $$ begin
  if (select string_agg(item || ':' || days, ',' order by days) from desk_kit_catalog()) <> 'plant:1,mug:3,books:7,pencils:14,clock:21,cat:30,notebook:45' then raise exception 'FAIL catalogue changed without updating the test and app'; end if;
end $$;

select 'ALL_DESK_KIT_RULES_OK' as result; -- every check passed
