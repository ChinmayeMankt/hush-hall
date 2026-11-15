-- Hush Hall: private desk notes (title, source, link, annotation).
-- Run after 0003_floor_and_looks.sql. Safe to run more than once.
-- Notes are only for the owner. Desks still show only nickname, avatar and topic.

-- One table: each signed-in person can keep their own study notes and links.
create table if not exists public.desk_notes (
  id uuid primary key default gen_random_uuid(), -- note id
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade, -- owner (deleting the account removes these)
  title text not null check (char_length(btrim(title)) between 1 and 80), -- short label on the desk list
  source text check (source is null or source in ('chatgpt', 'google', 'youtube', 'book', 'other')), -- optional where it came from
  url text check (url is null or (char_length(url) between 8 and 500 and url ~* '^https?://')), -- optional http(s) link only
  note text not null default '' check (char_length(note) <= 2000), -- free-text annotation (may be empty)
  created_at timestamptz not null default now(), -- when first saved
  updated_at timestamptz not null default now() -- when last edited
);

-- Newest-first lists for one person.
create index if not exists desk_notes_user_created on public.desk_notes (user_id, created_at desc);

-- Nobody else can read or write these rows.
alter table public.desk_notes enable row level security;

-- Re-runnable policy (drop first so a second run does not fail).
drop policy if exists "my desk notes" on public.desk_notes;
create policy "my desk notes" on public.desk_notes
  for all to authenticated
  using (user_id = auth.uid()) -- only my rows
  with check (user_id = auth.uid() and public.is_active_user()); -- signed up, not banned; cannot write as someone else

-- Signed-in users may use the table; anonymous visitors may not.
revoke all on table public.desk_notes from public, anon; -- not for visitors
grant select, insert, update, delete on table public.desk_notes to authenticated; -- own rows only (RLS)

notify pgrst, 'reload schema'; -- let the API see the new table right away
