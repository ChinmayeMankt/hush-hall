-- Behaviour tests for private desk notes (0004_desk_notes.sql). Run on a scratch
-- database after local_stub.sql + migrations 0001–0004:
--   psql -v ON_ERROR_STOP=1 -f desk_notes_test.sql
-- Each check raises an error if a rule doesn't hold; the last line prints ALL_DESK_NOTE_RULES_OK.

-- Two accounts: Asha (writes notes) and Bilal (must not see them).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'asha@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'bilal@example.test') on conflict do nothing; -- test accounts
insert into profiles (id, nickname, avatar, adult_confirmed_at, terms_version, terms_accepted_at)
select id, initcap(split_part(email, '@', 1)), '🦉', now(), 'test', now() from auth.users
where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1') on conflict do nothing; -- onboarded

-- Act as a given user (what Supabase does with the JWT).
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false); $$;
set role authenticated; -- browser privileges from here on

-- Anonymous callers can't write notes.
select pg_temp.as_user('');
do $$ begin
  insert into desk_notes (title, note) values ('Hidden page', 'should fail');
  raise exception 'FAIL anonymous wrote a note';
exception when others then if sqlerrm like 'FAIL%' then raise; end if;
end $$;

-- Asha can add a note with a source and an https link.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into desk_notes (title, source, url, note)
values ('PCR steps', 'chatgpt', 'https://chatgpt.com/c/example', 'Ask about annealing temperatures.'); -- valid row

-- A javascript: URL is refused.
do $$ begin
  insert into desk_notes (title, url) values ('Bad link', 'javascript:alert(1)');
  raise exception 'FAIL javascript url allowed';
exception when others then if sqlerrm like 'FAIL%' then raise; end if;
end $$;

-- A blank title is refused.
do $$ begin
  insert into desk_notes (title, note) values ('   ', 'no title');
  raise exception 'FAIL blank title allowed';
exception when others then if sqlerrm like 'FAIL%' then raise; end if;
end $$;

-- An unknown source is refused.
do $$ begin
  insert into desk_notes (title, source) values ('Mystery', 'tiktok');
  raise exception 'FAIL unknown source allowed';
exception when others then if sqlerrm like 'FAIL%' then raise; end if;
end $$;

-- Asha sees only her own notes, newest first once a second one exists.
insert into desk_notes (title, source, note) values ('YouTube walkthrough', 'youtube', 'Skip to 4:10 for the derivation.'); -- second note
do $$ begin
  if (select count(*) from desk_notes) <> 2 then raise exception 'FAIL Asha should see her two notes'; end if;
  if (select title from desk_notes order by created_at desc limit 1) <> 'YouTube walkthrough' then raise exception 'FAIL not newest first'; end if;
end $$;

-- Bilal cannot see or change Asha's notes.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
do $$ begin
  if (select count(*) from desk_notes) <> 0 then raise exception 'FAIL Bilal saw Asha notes'; end if;
end $$;
do $$ begin
  update desk_notes set title = 'hijack' where title = 'PCR steps';
  if found then raise exception 'FAIL Bilal updated Asha note'; end if;
end $$;
do $$ begin
  delete from desk_notes where title = 'PCR steps';
  if found then raise exception 'FAIL Bilal deleted Asha note'; end if;
end $$;

-- Asha can edit and delete her own notes.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
update desk_notes set note = 'Updated annotation', updated_at = now() where title = 'PCR steps'; -- own edit
do $$ begin
  if (select note from desk_notes where title = 'PCR steps') <> 'Updated annotation' then raise exception 'FAIL own update failed'; end if;
end $$;
delete from desk_notes where title = 'YouTube walkthrough'; -- own delete
do $$ begin
  if (select count(*) from desk_notes) <> 1 then raise exception 'FAIL own delete failed'; end if;
end $$;

-- Deleting Asha's login removes her remaining notes (same cascade as account deletion).
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1'; -- cascades through profiles
do $$ begin
  if exists (select 1 from desk_notes) then raise exception 'FAIL notes left after account delete'; end if;
end $$;
do $$ begin
  if not exists (select 1 from profiles where id = '00000000-0000-0000-0000-0000000000b1') then raise exception 'FAIL other account removed'; end if;
end $$;

select 'ALL_DESK_NOTE_RULES_OK' as result; -- every check passed
