-- Core beta access lifecycle. This database remains an operational control
-- plane: it never stores conversations, AmirOS memory, API keys, WhatsApp
-- material, device secrets, or any OpenAI credential.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'control_setup_state') then
    create type public.control_setup_state as enum ('setup_required', 'device_pending', 'active');
  end if;
  if not exists (select 1 from pg_type where typname = 'control_beta_application_state') then
    create type public.control_beta_application_state as enum ('requested', 'reviewing', 'approved', 'invited', 'device_pending', 'active', 'declined');
  end if;
  if not exists (select 1 from pg_type where typname = 'control_support_source') then
    create type public.control_support_source as enum ('account_portal', 'paired_device');
  end if;
end $$;

alter table public.control_accounts
  add column if not exists setup_state public.control_setup_state not null default 'setup_required';

-- Existing connected installations remain connected. Existing signed-in
-- accounts without a paired Mac become setup-pending, rather than silently
-- receiving normal account controls.
update public.control_accounts account
set setup_state = case
  when exists (
    select 1
    from public.control_devices device
    where device.account_id = account.netlify_user_id
      and device.revoked_at is null
      and device.access_status = 'active'
  ) then 'active'::public.control_setup_state
  else 'device_pending'::public.control_setup_state
end
where account.setup_state = 'setup_required';

alter table public.control_support_tickets
  add column if not exists source public.control_support_source not null default 'account_portal';

create table if not exists public.control_beta_applications (
  id uuid primary key default gen_random_uuid(),
  submission_id text not null unique,
  email text not null,
  email_normalized text not null unique,
  full_name text not null,
  interest text,
  state public.control_beta_application_state not null default 'requested',
  account_user_id uuid references public.control_accounts(netlify_user_id) on delete set null,
  approved_by uuid references public.control_accounts(netlify_user_id) on delete set null,
  approved_at timestamptz,
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint control_beta_applications_submission_length check (char_length(submission_id) between 1 and 160),
  constraint control_beta_applications_email_normalized check (email_normalized = lower(btrim(email_normalized))),
  constraint control_beta_applications_email_length check (char_length(email) between 3 and 320),
  constraint control_beta_applications_full_name_length check (char_length(full_name) between 2 and 160),
  constraint control_beta_applications_interest_length check (interest is null or char_length(interest) <= 2000)
);

create index if not exists control_beta_applications_state_created_idx
  on public.control_beta_applications (state, created_at desc);
create index if not exists control_beta_applications_account_idx
  on public.control_beta_applications (account_user_id)
  where account_user_id is not null;

drop trigger if exists control_beta_applications_set_updated_at on public.control_beta_applications;
create trigger control_beta_applications_set_updated_at
before update on public.control_beta_applications
for each row execute function public.control_set_updated_at();

alter table public.control_beta_applications enable row level security;
revoke all on public.control_beta_applications from anon, authenticated;
grant select, insert, update, delete on public.control_beta_applications to service_role;

-- A signed-in Identity user may claim an approved invitation exactly by their
-- email. The caller's role is read from the server-verified Identity token;
-- the browser never chooses an account state or an account ID.
create or replace function public.control_claim_beta_application(
  p_user_id uuid,
  p_email text,
  p_display_name text default null,
  p_is_admin boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_email text := lower(btrim(p_email));
  resolved_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  account public.control_accounts%rowtype;
  application public.control_beta_applications%rowtype;
begin
  select * into account
  from public.control_accounts
  where netlify_user_id = p_user_id
  for update;

  if found then
    update public.control_accounts
    set email = p_email,
        display_name = coalesce(resolved_name, display_name),
        setup_state = case when p_is_admin then 'active'::public.control_setup_state else setup_state end
    where netlify_user_id = p_user_id
    returning * into account;
    return to_jsonb(account);
  end if;

  select * into application
  from public.control_beta_applications
  where email_normalized = resolved_email
    and state in ('invited', 'device_pending', 'active')
  for update;

  if found then
    insert into public.control_accounts (
      netlify_user_id,
      email,
      display_name,
      access_status,
      release_channel,
      setup_state
    ) values (
      p_user_id,
      p_email,
      coalesce(resolved_name, application.full_name),
      'active',
      'beta',
      case when application.state = 'active' then 'active'::public.control_setup_state else 'device_pending'::public.control_setup_state end
    ) returning * into account;

    update public.control_beta_applications
    set account_user_id = p_user_id,
        state = case when state = 'active' then 'active'::public.control_beta_application_state else 'device_pending'::public.control_beta_application_state end
    where id = application.id;

    insert into public.control_audit_events (
      actor_user_id,
      target_user_id,
      action,
      entity_type,
      entity_id,
      after_state
    ) values (
      p_user_id,
      p_user_id,
      'beta_application.account_claimed',
      'beta_application',
      application.id::text,
      jsonb_build_object('setup_state', account.setup_state)
    );
    return to_jsonb(account);
  end if;

  -- Operators can enter their own Control Center without connecting a Mac.
  -- All other unrecognized Identity sessions are paused and restricted to
  -- setup/support until a real beta invitation is recorded.
  insert into public.control_accounts (
    netlify_user_id,
    email,
    display_name,
    access_status,
    release_channel,
    setup_state
  ) values (
    p_user_id,
    p_email,
    resolved_name,
    case when p_is_admin then 'active'::public.control_access_status else 'paused'::public.control_access_status end,
    'beta',
    case when p_is_admin then 'active'::public.control_setup_state else 'setup_required'::public.control_setup_state end
  ) returning * into account;
  return to_jsonb(account);
end;
$$;

revoke all on function public.control_claim_beta_application(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.control_claim_beta_application(uuid, text, text, boolean) to service_role;

-- Administrator-only lifecycle changes are serialized and audited here. The
-- standard Netlify Identity invitation is sent separately by Netlify; marking
-- an application invited never creates or exposes a credential or token.
create or replace function public.control_update_beta_application(
  p_actor_user_id uuid,
  p_application_id uuid,
  p_next_state public.control_beta_application_state
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application public.control_beta_applications%rowtype;
  before_state jsonb;
  after_state jsonb;
  valid_transition boolean := false;
begin
  if not exists (select 1 from public.control_accounts where netlify_user_id = p_actor_user_id) then
    raise exception 'operator account not found';
  end if;

  select * into application
  from public.control_beta_applications
  where id = p_application_id
  for update;
  if not found then
    raise exception 'beta application not found';
  end if;

  valid_transition :=
    (application.state = 'requested' and p_next_state in ('reviewing', 'approved', 'declined'))
    or (application.state = 'reviewing' and p_next_state in ('requested', 'approved', 'declined'))
    or (application.state = 'approved' and p_next_state in ('invited', 'declined'))
    or (application.state = 'declined' and p_next_state in ('requested', 'reviewing'));
  if not valid_transition then
    raise exception 'invalid beta application lifecycle transition';
  end if;

  before_state := jsonb_build_object('state', application.state);
  update public.control_beta_applications
  set state = p_next_state,
      approved_by = case when p_next_state = 'approved' then p_actor_user_id else approved_by end,
      approved_at = case when p_next_state = 'approved' then now() else approved_at end,
      invited_at = case when p_next_state = 'invited' then now() else invited_at end
  where id = application.id
  returning jsonb_build_object(
    'state', state,
    'approved_at', approved_at,
    'invited_at', invited_at
  ) into after_state;

  insert into public.control_audit_events (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state
  ) values (
    p_actor_user_id,
    'beta_application.state.changed',
    'beta_application',
    application.id::text,
    before_state,
    after_state
  );

  return after_state;
end;
$$;

revoke all on function public.control_update_beta_application(uuid, uuid, public.control_beta_application_state) from public, anon, authenticated;
grant execute on function public.control_update_beta_application(uuid, uuid, public.control_beta_application_state) to service_role;

-- Pairing is the only transition from a setup-pending tester to an active
-- tester. This extends the original transactional device approval function.
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
  if account.setup_state = 'setup_required' then
    raise exception 'account is not approved to connect a Mac';
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
    insert into public.control_devices (account_id, device_key, label, platform, app_version)
    values (p_actor_user_id, activation.device_key, activation.label, activation.platform, activation.app_version)
    returning id into resolved_device_id;
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

  update public.control_accounts
  set setup_state = 'active'
  where netlify_user_id = p_actor_user_id;

  update public.control_beta_applications
  set state = 'active'
  where account_user_id = p_actor_user_id
    and state = 'device_pending';

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
      'label', activation.label,
      'platform', activation.platform,
      'app_version', activation.app_version,
      'setup_state', 'active'
    )
  );

  return jsonb_build_object('device_id', resolved_device_id, 'status', 'approved');
end;
$$;

revoke all on function public.control_approve_device_activation(uuid, text) from public, anon, authenticated;
grant execute on function public.control_approve_device_activation(uuid, text) to service_role;

commit;
