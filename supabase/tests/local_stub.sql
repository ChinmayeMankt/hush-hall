-- Minimal stand-ins for the parts of Supabase the migration expects, so the
-- schema and its rules can be tested on a plain local Postgres (no Docker).
-- Never run this on a real Supabase project: it already has all of these.
create role anon nologin; -- visitors
create role authenticated nologin; -- signed-in users
create role service_role nologin bypassrls; -- server key
create schema auth; -- Supabase Auth lives here
create table auth.users (id uuid primary key, email text); -- accounts
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; -- caller id from the JWT
grant usage on schema auth to anon, authenticated; -- like Supabase
grant execute on function auth.uid() to anon, authenticated; -- like Supabase
create publication supabase_realtime; -- Realtime's publication
create schema realtime; -- Realtime's schema
create table realtime.messages (id bigserial primary key, topic text, extension text); -- just the columns the policies use
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$; -- channel being joined
alter table realtime.messages enable row level security; -- already on in Supabase
grant usage on schema public, realtime to anon, authenticated; -- like Supabase
alter default privileges in schema public grant all on tables to anon, authenticated, service_role; -- Supabase's defaults (RLS does the real work)
alter default privileges in schema public grant all on functions to anon, authenticated, service_role; -- Supabase's defaults
grant select, insert on realtime.messages to authenticated; -- so the policies can be exercised
