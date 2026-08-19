-- Account removal is intentionally separate from a pause or revoke. It clears
-- Control Center operational records after the Identity account is removed;
-- it never reaches into a tester's local AmirOS data.

begin;

create or replace function public.control_remove_account(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_account public.control_accounts%rowtype;
  removed_devices integer := 0;
  removed_applications integer := 0;
begin
  if p_source not in ('admin_delete', 'identity_reconciliation') then
    raise exception 'invalid account removal source';
  end if;
  if p_actor_user_id is not null and not exists (select 1 from public.control_accounts where netlify_user_id = p_actor_user_id) then
    raise exception 'operator account not found';
  end if;
  if p_actor_user_id is not null and p_actor_user_id = p_target_user_id then
    raise exception 'administrators cannot delete their own account here';
  end if;

  select * into target_account
  from public.control_accounts
  where netlify_user_id = p_target_user_id
  for update;
  if not found then
    return jsonb_build_object('removed', false);
  end if;

  select count(*) into removed_devices from public.control_devices where account_id = p_target_user_id;
  select count(*) into removed_applications from public.control_beta_applications
  where account_user_id = p_target_user_id or email_normalized = lower(btrim(target_account.email));

  -- Purge prior target/application audit records, which may otherwise retain
  -- operational profile data after account removal. Keep one anonymous event.
  delete from public.control_audit_events
  where target_user_id = p_target_user_id
    or entity_id = p_target_user_id::text
    or entity_id in (
      select id::text from public.control_beta_applications
      where account_user_id = p_target_user_id or email_normalized = lower(btrim(target_account.email))
    );

  delete from public.control_device_activations
  where approved_account_id = p_target_user_id
    or device_key in (select device_key from public.control_devices where account_id = p_target_user_id);
  delete from public.control_beta_applications
  where account_user_id = p_target_user_id or email_normalized = lower(btrim(target_account.email));
  delete from public.control_accounts where netlify_user_id = p_target_user_id;

  insert into public.control_audit_events (actor_user_id, action, entity_type, entity_id, after_state)
  values (
    p_actor_user_id,
    'account.removed',
    'account',
    'removed',
    jsonb_build_object('source', p_source, 'devices_removed', removed_devices, 'applications_removed', removed_applications)
  );

  return jsonb_build_object('removed', true, 'devices_removed', removed_devices, 'applications_removed', removed_applications);
end;
$$;

revoke all on function public.control_remove_account(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.control_remove_account(uuid, uuid, text) to service_role;

commit;
