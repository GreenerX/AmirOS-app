-- AmirOS device pairing. This holds only random device credentials and basic
-- operational metadata. It must never hold chat content, saved memory,
-- contacts, API keys, QR codes, or WhatsApp authentication material.

begin;

create table if not exists public.control_device_activations (
  activation_code_hash text primary key,
  device_key text not null unique,
  device_secret_hash text not null,
  label text not null,
  platform text not null,
  app_version text not null,
  expires_at timestamptz not null,
  approved_account_id uuid references public.control_accounts(netlify_user_id) on delete set null,
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint control_device_activations_code_hash check (activation_code_hash ~ '^[a-f0-9]{64}$'),
  constraint control_device_activations_device_key check (char_length(device_key) between 32 and 128),
  constraint control_device_activations_secret_hash check (device_secret_hash ~ '^[a-f0-9]{64}$'),
  constraint control_device_activations_label_length check (char_length(label) between 1 and 120),
  constraint control_device_activations_platform_length check (char_length(platform) between 1 and 80),
  constraint control_device_activations_version_length check (char_length(app_version) between 1 and 80)
);

create table if not exists public.control_device_credentials (
  device_id uuid primary key references public.control_devices(id) on delete cascade,
  device_secret_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint control_device_credentials_secret_hash check (device_secret_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists control_device_activations_pending_expiry_idx
  on public.control_device_activations (expires_at)
  where approved_at is null;

drop trigger if exists control_device_credentials_set_updated_at on public.control_device_credentials;
create trigger control_device_credentials_set_updated_at
before update on public.control_device_credentials
for each row execute function public.control_set_updated_at();

alter table public.control_device_activations enable row level security;
alter table public.control_device_credentials enable row level security;
revoke all on public.control_device_activations, public.control_device_credentials from anon, authenticated;
grant select, insert, update, delete on public.control_device_activations, public.control_device_credentials to service_role;

-- This transaction prevents a device from being silently moved between
-- accounts, records the approval, and stores only a one-way secret hash.
create or replace function public.control_approve_device_activation(
  p_actor_user_id uuid,
  p_activation_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  activation public.control_device_activations%rowtype;
  account public.control_accounts%rowtype;
  existing_device public.control_devices%rowtype;
  resolved_device_id uuid;
begin
  select * into activation
  from public.control_device_activations
  where activation_code_hash = p_activation_code_hash
  for update;
  if not found then
    raise exception 'device approval request not found';
  end if;
  if activation.expires_at <= now() then
    raise exception 'device approval request expired';
  end if;

  select * into account
  from public.control_accounts
  where netlify_user_id = p_actor_user_id
  for update;
  if not found then
    raise exception 'account not found';
  end if;
  if account.access_status <> 'active' then
    raise exception 'account access is not active';
  end if;

  select * into existing_device
  from public.control_devices
  where device_key = activation.device_key
  for update;
  if found and existing_device.account_id <> p_actor_user_id then
    raise exception 'this device belongs to another account';
  end if;
  if found and existing_device.revoked_at is not null then
    raise exception 'this device has been revoked; start a new activation from AmirOS';
  end if;

  if found then
    update public.control_devices
    set label = activation.label,
        platform = activation.platform,
        app_version = activation.app_version,
        last_seen_at = now()
    where id = existing_device.id
    returning id into resolved_device_id;
  else
    insert into public.control_devices (
      account_id,
      device_key,
      label,
      platform,
      app_version
    ) values (
      p_actor_user_id,
      activation.device_key,
      activation.label,
      activation.platform,
      activation.app_version
    ) returning id into resolved_device_id;
  end if;

  insert into public.control_device_credentials (device_id, device_secret_hash)
  values (resolved_device_id, activation.device_secret_hash)
  on conflict (device_id) do update
  set device_secret_hash = excluded.device_secret_hash;

  update public.control_device_activations
  set approved_account_id = p_actor_user_id,
      approved_at = now(),
      completed_at = now()
  where activation_code_hash = p_activation_code_hash;

  insert into public.control_audit_events (
    actor_user_id,
    target_user_id,
    action,
    entity_type,
    entity_id,
    after_state
  ) values (
    p_actor_user_id,
    p_actor_user_id,
    'device.authorized',
    'device',
    resolved_device_id::text,
    jsonb_build_object(
      'device_key', activation.device_key,
      'label', activation.label,
      'platform', activation.platform,
      'app_version', activation.app_version
    )
  );

  return jsonb_build_object('device_id', resolved_device_id, 'status', 'approved');
end;
$$;

revoke all on function public.control_approve_device_activation(uuid, text) from public, anon, authenticated;
grant execute on function public.control_approve_device_activation(uuid, text) to service_role;

commit;
