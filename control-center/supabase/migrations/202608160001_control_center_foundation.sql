-- AmirOS Control Center: operational data only.
-- This schema must never hold conversations, personal memory, contact data,
-- API keys, WhatsApp material, or any other local AmirOS content.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'control_access_status') then
    create type public.control_access_status as enum ('active', 'paused', 'revoked');
  end if;
  if not exists (select 1 from pg_type where typname = 'control_release_channel') then
    create type public.control_release_channel as enum ('internal', 'beta', 'stable');
  end if;
  if not exists (select 1 from pg_type where typname = 'control_ticket_type') then
    create type public.control_ticket_type as enum ('Bug', 'Feedback', 'Feature request', 'Setup help');
  end if;
  if not exists (select 1 from pg_type where typname = 'control_ticket_state') then
    create type public.control_ticket_state as enum ('New', 'Investigating', 'Resolved');
  end if;
end $$;

create table if not exists public.control_accounts (
  netlify_user_id uuid primary key,
  email text not null unique,
  display_name text,
  access_status public.control_access_status not null default 'active',
  release_channel public.control_release_channel not null default 'beta',
  access_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.control_feature_definitions (
  feature_key text primary key,
  name text not null,
  description text not null,
  default_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  constraint control_feature_definitions_key_format check (feature_key ~ '^[a-z0-9-]+$')
);

create table if not exists public.control_feature_assignments (
  account_id uuid not null references public.control_accounts(netlify_user_id) on delete cascade,
  feature_key text not null references public.control_feature_definitions(feature_key) on delete restrict,
  enabled boolean not null,
  updated_by uuid references public.control_accounts(netlify_user_id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (account_id, feature_key)
);

create table if not exists public.control_devices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.control_accounts(netlify_user_id) on delete cascade,
  device_key text not null unique,
  label text not null,
  platform text not null,
  app_version text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint control_devices_device_key_length check (char_length(device_key) between 16 and 128)
);

create table if not exists public.control_releases (
  id bigint generated always as identity primary key,
  version text not null unique,
  channel public.control_release_channel not null,
  download_url text not null,
  sha256 text not null,
  published_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint control_releases_version_length check (char_length(version) between 1 and 80),
  constraint control_releases_sha256_format check (sha256 ~ '^[a-f0-9]{64}$')
);

create table if not exists public.control_support_tickets (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.control_accounts(netlify_user_id) on delete cascade,
  type public.control_ticket_type not null,
  subject text not null,
  details text not null,
  state public.control_ticket_state not null default 'New',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint control_support_tickets_subject_length check (char_length(subject) between 1 and 140),
  constraint control_support_tickets_details_length check (char_length(details) between 1 and 1500)
);

create table if not exists public.control_audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.control_accounts(netlify_user_id) on delete set null,
  target_user_id uuid references public.control_accounts(netlify_user_id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now(),
  constraint control_audit_events_action_length check (char_length(action) between 1 and 100),
  constraint control_audit_events_entity_type_length check (char_length(entity_type) between 1 and 60),
  constraint control_audit_events_entity_id_length check (char_length(entity_id) between 1 and 160)
);

create index if not exists control_accounts_access_status_idx
  on public.control_accounts (access_status);
create index if not exists control_feature_assignments_account_idx
  on public.control_feature_assignments (account_id);
create index if not exists control_devices_account_last_seen_idx
  on public.control_devices (account_id, last_seen_at desc);
create index if not exists control_support_tickets_account_created_idx
  on public.control_support_tickets (account_id, created_at desc);
create index if not exists control_support_tickets_open_created_idx
  on public.control_support_tickets (created_at desc) where state <> 'Resolved';
create index if not exists control_audit_events_target_created_idx
  on public.control_audit_events (target_user_id, created_at desc);
create index if not exists control_audit_events_entity_created_idx
  on public.control_audit_events (entity_type, entity_id, created_at desc);

create or replace function public.control_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists control_accounts_set_updated_at on public.control_accounts;
create trigger control_accounts_set_updated_at
before update on public.control_accounts
for each row execute function public.control_set_updated_at();

drop trigger if exists control_feature_assignments_set_updated_at on public.control_feature_assignments;
create trigger control_feature_assignments_set_updated_at
before update on public.control_feature_assignments
for each row execute function public.control_set_updated_at();

drop trigger if exists control_support_tickets_set_updated_at on public.control_support_tickets;
create trigger control_support_tickets_set_updated_at
before update on public.control_support_tickets
for each row execute function public.control_set_updated_at();

insert into public.control_feature_definitions (feature_key, name, description, default_enabled)
values
  ('memory-control', 'Memory control', 'Correct, historicize, and forget relationship facts.', true),
  ('calendar-views', 'Calendar views', 'Day, week, and month planning views.', true),
  ('auto-mode', 'Auto Mode', 'Owner-style replies after the configured delay.', false),
  ('early-release', 'Early releases', 'Receive internal builds before beta rollout.', false)
on conflict (feature_key) do update
set name = excluded.name,
    description = excluded.description,
    default_enabled = excluded.default_enabled;

-- The browser never talks directly to this database. Netlify Functions verify
-- the Netlify Identity session and role before using a server-only Supabase key.
-- RLS remains enabled as a second containment layer should that boundary change.
alter table public.control_accounts enable row level security;
alter table public.control_feature_definitions enable row level security;
alter table public.control_feature_assignments enable row level security;
alter table public.control_devices enable row level security;
alter table public.control_releases enable row level security;
alter table public.control_support_tickets enable row level security;
alter table public.control_audit_events enable row level security;

revoke all on schema public from anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Netlify Functions are the only application component permitted to query the
-- Data API. The server-only Supabase secret authenticates as service_role;
-- browser-facing roles receive neither current nor future table privileges.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;

commit;
