-- Device-level controls let an administrator pause or revoke one Mac without
-- changing the rest of a user's account. This remains operational metadata
-- only: no conversation, memory, contact, API-key, or credential value is
-- ever stored in the audit trail.

begin;

alter table public.control_devices
  add column if not exists access_status public.control_access_status not null default 'active',
  add column if not exists paused_at timestamptz;

-- Preserve the existing revocation meaning for devices created before this
-- column existed.
update public.control_devices
set access_status = 'revoked'
where revoked_at is not null and access_status <> 'revoked';

create index if not exists control_devices_account_access_last_seen_idx
  on public.control_devices (account_id, access_status, last_seen_at desc);

create or replace function public.control_update_device_access(
  p_actor_user_id uuid,
  p_device_id uuid,
  p_access_status public.control_access_status
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  device public.control_devices%rowtype;
  before_state jsonb;
  after_state jsonb;
begin
  if not exists (select 1 from public.control_accounts where netlify_user_id = p_actor_user_id) then
    raise exception 'operator account not found';
  end if;

  select * into device
  from public.control_devices
  where id = p_device_id
  for update;
  if not found then
    raise exception 'device not found';
  end if;

  if device.revoked_at is not null and p_access_status <> 'revoked' then
    raise exception 'a revoked device cannot be restored; reconnect it from AmirOS instead';
  end if;

  before_state := jsonb_build_object(
    'label', device.label,
    'platform', device.platform,
    'app_version', device.app_version,
    'access_status', device.access_status,
    'paused_at', device.paused_at,
    'revoked_at', device.revoked_at
  );

  if p_access_status = 'active' then
    update public.control_devices
    set access_status = 'active',
        paused_at = null
    where id = device.id
    returning jsonb_build_object(
      'label', label,
      'platform', platform,
      'app_version', app_version,
      'access_status', access_status,
      'paused_at', paused_at,
      'revoked_at', revoked_at
    ) into after_state;
  elsif p_access_status = 'paused' then
    update public.control_devices
    set access_status = 'paused',
        paused_at = now()
    where id = device.id
    returning jsonb_build_object(
      'label', label,
      'platform', platform,
      'app_version', app_version,
      'access_status', access_status,
      'paused_at', paused_at,
      'revoked_at', revoked_at
    ) into after_state;
  else
    update public.control_devices
    set access_status = 'revoked',
        paused_at = null,
        revoked_at = coalesce(revoked_at, now())
    where id = device.id
    returning jsonb_build_object(
      'label', label,
      'platform', platform,
      'app_version', app_version,
      'access_status', access_status,
      'paused_at', paused_at,
      'revoked_at', revoked_at
    ) into after_state;
  end if;

  insert into public.control_audit_events (
    actor_user_id,
    target_user_id,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state
  ) values (
    p_actor_user_id,
    device.account_id,
    'device.access_status.changed',
    'device',
    device.id::text,
    before_state,
    after_state
  );

  return jsonb_build_object('before', before_state, 'after', after_state);
end;
$$;

revoke all on function public.control_update_device_access(uuid, uuid, public.control_access_status) from public, anon, authenticated;
grant execute on function public.control_update_device_access(uuid, uuid, public.control_access_status) to service_role;

commit;
