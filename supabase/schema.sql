-- QuickPull database. Paste all of this into Supabase → SQL Editor → Run.
-- Safe to run more than once; re-running never deletes data.

------------------------------------------------------------------
-- Cars you checked in
------------------------------------------------------------------
create table if not exists pm_vehicles (
  id          bigint generated always as identity primary key,
  vin         text not null,
  year        text,
  make        text,
  model       text,
  trim        text,
  engine      text,
  body        text,
  platform    text not null default '',   -- make|model|year, shared by every car of that kind
  est_value   numeric,                    -- sum of clean prices of parts over the cutoff
  decision    text,                       -- your override: 'pull' or 'shred'
  scanned_at  timestamptz not null default now(),
  scanned_by  uuid default auth.uid()
);
alter table pm_vehicles add column if not exists stock_no    text;
alter table pm_vehicles add column if not exists status      text not null default 'queued';  -- queued | ready | error
alter table pm_vehicles add column if not exists status_note text;
alter table pm_vehicles add column if not exists destination text not null default 'waiting'; -- waiting | pull | shred
alter table pm_vehicles add column if not exists pull_count  int;
create index if not exists pm_vehicles_scanned  on pm_vehicles (scanned_at desc);
create index if not exists pm_vehicles_platform on pm_vehicles (platform);
create index if not exists pm_vehicles_status   on pm_vehicles (status);
create index if not exists pm_vehicles_vin      on pm_vehicles (vin);

------------------------------------------------------------------
-- One row per year/make/model: when its data was last gathered
------------------------------------------------------------------
create table if not exists pm_platforms (
  platform       text primary key,
  year           text,
  make           text,
  model          text,
  targeted_at    timestamptz,   -- tracked parts searched
  sweep_at       timestamptz,   -- discovery sweep done
  researched_at  timestamptz,   -- you pasted sold data
  locked_until   timestamptz,   -- stops two gatherers working on the same model
  last_error     text
);

------------------------------------------------------------------
-- What each part sells for, per year/make/model
-- ask_* = used listings live now   (low = rough, median = typical, high = clean)
-- sold_* = sold in the last 90 days (from your Terapeak/eBay pastes, or eBay Insights if approved)
------------------------------------------------------------------
create table if not exists pm_part_stats (
  platform      text not null,
  part_key      text not null,
  active_count  int,
  ask_median    numeric,
  ask_low       numeric,
  ask_high      numeric,
  ask_sample    int,
  ask_query     text,
  ask_mode      text,
  ask_updated   timestamptz,
  sold_count    numeric,
  sold_median   numeric,
  sold_source   text,
  sold_updated  timestamptz,
  primary key (platform, part_key)
);
alter table pm_part_stats alter column sold_count type numeric;
alter table pm_part_stats add column if not exists sold_low      numeric;
alter table pm_part_stats add column if not exists sold_high     numeric;
alter table pm_part_stats add column if not exists part_name     text;     -- for parts found by the sweep or a paste
alter table pm_part_stats add column if not exists group_name    text;
alter table pm_part_stats add column if not exists discovered    boolean not null default false;
alter table pm_part_stats add column if not exists sample_titles jsonb;

------------------------------------------------------------------
-- Parts you pulled: shelf through sold
------------------------------------------------------------------
create table if not exists pm_items (
  id          bigint generated always as identity primary key,
  vehicle_id  bigint references pm_vehicles(id) on delete set null,
  vin         text,
  platform    text,
  part_key    text,
  part_name   text,
  shelf       text,
  status      text not null default 'pulled',
  list_price  numeric,
  sold_price  numeric,
  created_at  timestamptz not null default now(),
  listed_at   timestamptz,
  sold_at     timestamptz
);
alter table pm_items add column if not exists grade    text;
alter table pm_items add column if not exists stock_no text;
alter table pm_items add column if not exists sku      text;
-- Give every existing shelf item a SKU (stock number - part - grade - id)
update pm_items set sku = coalesce(stock_no, 'NA') || '-' || upper(replace(coalesce(part_key, 'PART'), '_', '-')) || '-' || coalesce(grade, 'X') || '-' || id where sku is null;
create unique index if not exists pm_items_sku on pm_items (sku);
create index if not exists pm_items_status   on pm_items (status, created_at desc);
create index if not exists pm_items_platform on pm_items (platform, part_key);

------------------------------------------------------------------
-- Every sold listing you paste in Research, small AND large parts, kept for good.
-- Small parts feed the pull sheets; large parts are saved for when you sell them too.
------------------------------------------------------------------
create table if not exists pm_sales (
  id          bigint generated always as identity primary key,
  model_key   text not null,           -- make|model
  make        text,
  model       text,
  year_from   int,                     -- the years you said this paste covers
  year_to     int,
  title       text not null,
  price       numeric not null,
  qty         numeric not null default 1,
  period_days int,                     -- Terapeak rows: totals over this many days
  sold_on     date,
  ship        numeric,
  part_key    text,
  part_name   text,
  size        text,                    -- small | big
  source      text,                    -- ebay-sold | terapeak
  dedupe_key  text not null unique,    -- the same sale pasted twice is saved once
  pasted_at   timestamptz not null default now(),
  pasted_by   uuid default auth.uid()
);
create index if not exists pm_sales_model on pm_sales (model_key, size, year_from, year_to);
create index if not exists pm_sales_part  on pm_sales (part_key);

------------------------------------------------------------------
-- Settings, eBay usage, and who is who
------------------------------------------------------------------
create table if not exists pm_settings (
  id               int primary key default 1 check (id = 1),
  part_min         numeric not null default 60,   -- parts worth less than this (clean price) are hidden, not deleted
  last_process_at  timestamptz
);
insert into pm_settings (id) values (1) on conflict (id) do nothing;
alter table pm_settings add column if not exists never_pull     text[] not null default '{injectors}';  -- part types you never pull (data is kept)
alter table pm_settings add column if not exists last_backup_at timestamptz;

-- Your "Merge these" / "Not a duplicate" choices, remembered per make|model
create table if not exists pm_merges (
  model_key  text not null,
  from_key   text not null,
  to_key     text not null,
  kind       text not null default 'merge' check (kind in ('merge','distinct')),
  created_at timestamptz not null default now(),
  primary key (model_key, from_key, to_key)
);

create table if not exists pm_usage (
  day    date primary key,
  calls  int not null default 0
);

create table if not exists pm_people (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  email    text,
  role     text not null default 'checkin' check (role in ('owner','checkin'))
);

-- The first person to sign in becomes the owner. Everyone after that starts as check-in until the owner changes it.
create or replace function pm_my_role() returns text
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if auth.uid() is null then return null; end if;
  select role into r from pm_people where user_id = auth.uid();
  if r is not null then return r; end if;
  if not exists (select 1 from pm_people where role = 'owner') then r := 'owner'; else r := 'checkin'; end if;
  insert into pm_people (user_id, email, role)
    values (auth.uid(), (select email from auth.users where id = auth.uid()), r)
    on conflict (user_id) do nothing;
  return r;
end $$;

create or replace function pm_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pm_people where user_id = auth.uid() and role = 'owner')
$$;

-- Owner only: change someone's role by email. They must already exist in Authentication → Users.
create or replace function pm_set_role(target_email text, new_role text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not pm_is_owner() then raise exception 'Only the owner can change roles'; end if;
  if new_role not in ('owner','checkin') then raise exception 'Role must be owner or checkin'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(target_email));
  if uid is null then raise exception 'No user with that email. Add them in Authentication → Users first.'; end if;
  if new_role = 'checkin' and uid = auth.uid() and (select count(*) from pm_people where role = 'owner') <= 1 then
    raise exception 'You are the only owner. Make someone else owner first.';
  end if;
  insert into pm_people (user_id, email, role) values (uid, lower(trim(target_email)), new_role)
    on conflict (user_id) do update set role = excluded.role, email = excluded.email;
  return new_role;
end $$;

-- Adds to today's eBay lookup count (used by the gathering function)
create or replace function pm_add_calls(n int) returns int
language sql security definer set search_path = public as $$
  insert into pm_usage (day, calls) values ((now() at time zone 'America/Chicago')::date, n)
  on conflict (day) do update set calls = pm_usage.calls + excluded.calls
  returning calls
$$;

------------------------------------------------------------------
-- Security: the owner sees and changes everything.
-- Check-in logins can only see the car list; adding cars goes through the function.
------------------------------------------------------------------
alter table pm_vehicles   enable row level security;
alter table pm_platforms  enable row level security;
alter table pm_part_stats enable row level security;
alter table pm_items      enable row level security;
alter table pm_sales      enable row level security;
alter table pm_merges     enable row level security;
alter table pm_settings   enable row level security;
alter table pm_usage      enable row level security;
alter table pm_people     enable row level security;

drop policy if exists "signed in" on pm_vehicles;
drop policy if exists "signed in" on pm_part_stats;
drop policy if exists "signed in" on pm_items;
drop policy if exists "everyone reads" on pm_vehicles;
drop policy if exists "owner" on pm_vehicles;
drop policy if exists "owner" on pm_platforms;
drop policy if exists "owner" on pm_part_stats;
drop policy if exists "owner" on pm_items;
drop policy if exists "owner" on pm_sales;
drop policy if exists "owner" on pm_merges;
drop policy if exists "owner" on pm_settings;
drop policy if exists "owner" on pm_usage;
drop policy if exists "owner" on pm_people;

create policy "everyone reads" on pm_vehicles for select to authenticated using (true);
create policy "owner" on pm_vehicles   for all to authenticated using (pm_is_owner()) with check (pm_is_owner());
create policy "owner" on pm_platforms  for all to authenticated using (pm_is_owner()) with check (pm_is_owner());
create policy "owner" on pm_part_stats for all to authenticated using (pm_is_owner()) with check (pm_is_owner());
create policy "owner" on pm_items      for all to authenticated using (pm_is_owner()) with check (pm_is_owner());
create policy "owner" on pm_sales      for all to authenticated using (pm_is_owner()) with check (pm_is_owner());
create policy "owner" on pm_merges     for all to authenticated using (pm_is_owner()) with check (pm_is_owner());
create policy "owner" on pm_settings   for all to authenticated using (pm_is_owner()) with check (pm_is_owner());
create policy "owner" on pm_usage      for select to authenticated using (pm_is_owner());
create policy "owner" on pm_people     for select to authenticated using (pm_is_owner());

grant execute on function pm_my_role() to authenticated;
grant execute on function pm_set_role(text, text) to authenticated;
revoke execute on function pm_add_calls(int) from public, anon, authenticated;
