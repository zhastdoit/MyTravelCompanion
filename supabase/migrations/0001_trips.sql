-- SyncTrip COLD store: saved trips, one row per "Save Trip" snapshot.
--
-- Apply locally:
--   supabase db push
-- Or directly in the dashboard SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.trips (
  id            uuid          primary key default gen_random_uuid(),
  user_auth_id  uuid          not null,
  session_id    text          not null,
  name          text          not null default '',
  snapshot      jsonb         not null,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now()
);

comment on table  public.trips                is 'Saved TripState snapshots, one row per Save Trip click.';
comment on column public.trips.user_auth_id   is 'Supabase auth.users.id of the trip owner; matched against auth.uid() in RLS.';
comment on column public.trips.session_id     is 'HOT-store session id; loading rehydrates `/trip/<session_id>`.';
comment on column public.trips.snapshot       is 'Full TripState JSON at the moment of save.';

create index if not exists trips_user_updated_idx
  on public.trips (user_auth_id, updated_at desc);

-- Touch updated_at on every UPDATE.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trips_set_updated_at on public.trips;
create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.touch_updated_at();

-- Row-level security: a user may only see / mutate their own trips.
alter table public.trips enable row level security;

drop policy if exists "Users read own trips"   on public.trips;
drop policy if exists "Users insert own trips" on public.trips;
drop policy if exists "Users update own trips" on public.trips;
drop policy if exists "Users delete own trips" on public.trips;

create policy "Users read own trips"
  on public.trips for select
  using (auth.uid() = user_auth_id);

create policy "Users insert own trips"
  on public.trips for insert
  with check (auth.uid() = user_auth_id);

create policy "Users update own trips"
  on public.trips for update
  using (auth.uid() = user_auth_id)
  with check (auth.uid() = user_auth_id);

create policy "Users delete own trips"
  on public.trips for delete
  using (auth.uid() = user_auth_id);
