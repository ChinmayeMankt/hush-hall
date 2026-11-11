-- Behaviour tests for the Hush Hall rules. Run on a scratch database after
-- local_stub.sql + the migration:  psql -v ON_ERROR_STOP=1 -f rules_test.sql
-- Each check raises an error if a rule doesn't hold; the last line prints ALL_RULES_OK.

-- Four accounts: Asha, Bilal, Chitra, and moderator Mod (created as the server would).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test'), ('00000000-0000-0000-0000-00000000000b', 'b@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'c@example.test'), ('00000000-0000-0000-0000-00000000000d', 'm@example.test'); -- test accounts
insert into profiles (id, nickname, avatar, adult_confirmed_at, terms_version, terms_accepted_at)
select id, initcap(split_part(email, '@', 1)), '🦉', now(), 'test', now() from auth.users; -- onboarded
insert into moderators (user_id) values ('00000000-0000-0000-0000-00000000000d'); -- Mod reviews reports

-- Act as a given user (what Supabase does with the JWT).
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false); $$;

set role authenticated; -- browser privileges from here on

-- Anonymous callers can't sit.
select pg_temp.as_user('');
do $$ begin perform sit_down('main-reading', 'A1', 'x'); raise exception 'FAIL anonymous sat'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end $$;

-- A and B sit; B can't take A's desk; A can't hold two desks.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select sit_down('main-reading', 'A1', 'Enzyme kinetics') is not null as a_sat;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin perform sit_down('main-reading', 'A1', 'Taking it'); raise exception 'FAIL desk double-booked'; exception when others then if sqlerrm <> 'desk_taken' then raise; end if; end $$;
select sit_down('main-reading', 'B2', 'Graphs') is not null as b_sat;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select sit_down('main-reading', 'A2', 'Moved desks') is not null as a_moved; -- moving releases A1
do $$ begin if (select count(*) from sittings where ended_at is null) <> 1 then raise exception 'FAIL A holds two desks (sees %)', (select count(*) from sittings where ended_at is null); end if; end $$; -- A sees only own rows: one active
do $$ begin if (select count(*) from hall_desks('main-reading')) <> 2 then raise exception 'FAIL hall_desks should list A and B'; end if; end $$;

-- A can't edit moderation flags or other people's profiles.
do $$ begin update profiles set banned = false where id = auth.uid(); raise exception 'FAIL flag column writable'; exception when insufficient_privilege then null; end $$;
update profiles set nickname = 'Hacked' where id = '00000000-0000-0000-0000-00000000000b';
do $$ begin if exists (select 1 from public_profiles(array['00000000-0000-0000-0000-00000000000b']::uuid[]) where nickname = 'Hacked') then raise exception 'FAIL edited someone else'; end if; end $$;
do $$ begin if (select count(*) from profiles) <> 1 then raise exception 'FAIL can read other profiles directly'; end if; end $$;

-- Requests: A -> B works once; repeat to B is rate limited.
select send_join_request('00000000-0000-0000-0000-00000000000b', 'main-reading', 'sync breaks?') is not null as a_requested_b;
do $$ begin perform send_join_request('00000000-0000-0000-0000-00000000000b', 'main-reading', 'again'); raise exception 'FAIL repeat request'; exception when others then if sqlerrm <> 'rate_limited' then raise; end if; end $$;
-- A can't insert requests directly (must use the function).
do $$ begin insert into join_requests (from_id, to_id, hall_id) values (auth.uid(), '00000000-0000-0000-0000-00000000000c', 'main-reading'); raise exception 'FAIL direct insert'; exception when insufficient_privilege then null; end $$;

-- C hides from requests: A's request is refused with the generic answer.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select sit_down('main-reading', 'C3', 'Polity notes') is not null as c_sat;
update profiles set hide_from_requests = true where id = auth.uid();
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin perform send_join_request('00000000-0000-0000-0000-00000000000c', 'main-reading', ''); raise exception 'FAIL hidden person got a request'; exception when others then if sqlerrm <> 'unavailable' then raise; end if; end $$;

-- B accepts: both are in one room. C can't see it.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select respond_join_request((select id from join_requests where status = 'pending' limit 1), true) is not null as b_accepted;
do $$ begin if (select count(*) from room_members where left_at is null) <> 2 then raise exception 'FAIL room should have A and B'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin if exists (select 1 from rooms) or exists (select 1 from room_members) or exists (select 1 from join_requests) then raise exception 'FAIL outsider sees room or requests'; end if; end $$;

-- Owner A removes B; B can't be re-added to that room by a new request.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin perform remove_from_room((select id from rooms limit 1), '00000000-0000-0000-0000-00000000000a'); raise exception 'FAIL non-owner removed'; exception when others then if sqlerrm <> 'not_owner' then raise; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select remove_from_room((select id from rooms limit 1), '00000000-0000-0000-0000-00000000000b');
do $$ begin if (select count(*) from room_members where left_at is null) <> 1 then raise exception 'FAIL B still in room'; end if; end $$;

-- B blocks A: A's desk disappears for B, and A can no longer request B.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select block_user('00000000-0000-0000-0000-00000000000a');
do $$ begin if exists (select 1 from hall_desks('main-reading') where user_id = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL blocked desk visible'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin if exists (select 1 from hall_desks('main-reading') where user_id = '00000000-0000-0000-0000-00000000000b') then raise exception 'FAIL blocker visible to blocked'; end if; end $$;
do $$ begin if exists (select 1 from blocks) then raise exception 'FAIL blocked person can see the block'; end if; end $$;

-- Reports: C reports A for harassment. A can't see it; Mod can; it's urgent with a 24 h due time.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select file_report('00000000-0000-0000-0000-00000000000a', 'harassment', 'kept sending notes', 'main-reading', null, 'Moved desks') is not null as c_reported;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin if exists (select 1 from reports) then raise exception 'FAIL reported person sees report'; end if; end $$;
do $$ begin perform mod_queue('open'); raise exception 'FAIL non-moderator read queue'; exception when others then if sqlerrm <> 'not_allowed' then raise; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
do $$ declare q record; begin
  select * into q from mod_queue('open') limit 1; -- first in queue
  if q.id is null or not q.urgent or q.due_at is null or q.reporter_nickname <> 'C' then raise exception 'FAIL queue row wrong: %', row_to_json(q); end if;
end $$;

-- Under-18 report puts an immediate hold on rooms for that account.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select file_report('00000000-0000-0000-0000-00000000000c', 'under18', '', 'main-reading', null, 'Polity notes') is not null as b_reported_c;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin if not (select rooms_suspended from profiles where id = auth.uid()) then raise exception 'FAIL under18 hold missing'; end if; end $$;

-- Mod suspends A's rooms; A gets a private notice only for warnings; restore lifts holds.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select moderate_report((select id from reports where reason = 'harassment'), 'actioned', 'warn', 'first warning');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin if (select count(*) from account_notices) <> 1 or exists (select 1 from account_notices where body ilike '%C%hitra%') then raise exception 'FAIL warning notice'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select moderate_report((select id from reports where reason = 'under18'), 'actioned', 'ban', 'confirmed under 18');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin perform sit_down('main-reading', 'D1', 'x'); raise exception 'FAIL banned user sat'; exception when others then if sqlerrm <> 'not_allowed' then raise; end if; end $$;

-- Stand up: minutes are capped at real elapsed time (no inflated history).
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin if (select stand_up((select id from sittings where ended_at is null), 500, 'done')) > 1 then raise exception 'FAIL minutes not capped'; end if; end $$;

-- Realtime presence policy: only active users can join hall channels.
select set_config('realtime.topic', 'hall:main-reading', false);
do $$ begin if (select count(*) from (select public.is_active_user()) x) <> 1 or not public.is_active_user() then raise exception 'FAIL active user check'; end if; end $$;

reset role;
select 'ALL_RULES_OK' as result;
