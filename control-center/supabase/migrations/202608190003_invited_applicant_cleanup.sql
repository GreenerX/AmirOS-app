-- Pending invited applicants have a Netlify Identity record but may not yet
-- have a Control Center account. Clean them up separately from user accounts.

begin;

create or replace function public.control_remove_invited_application(
  p_actor_user_id uuid,
  p_application_id uuid,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application public.control_beta_applications%rowtype;
begin
  if p_source not in ('admin_delete', 'identity_reconciliation') then
    raise exception 'invalid invited application removal source';
  end if;
  if p_actor_user_id is not null and not exists (select 1 from public.control_accounts where netlify_user_id = p_actor_user_id) then
    raise exception 'operator account not found';
  end if;

  select * into application
  from public.control_beta_applications
  where id = p_application_id
  for update;
  if not found then
    return jsonb_build_object('removed', false);
  end if;
  if application.state <> 'invited' or application.account_user_id is not null then
    raise exception 'only an unclaimed invited application can be removed';
  end if;

  -- Remove application-scoped audit detail before deleting the record. The
  -- remaining tombstone deliberately contains no applicant or Identity data.
  delete from public.control_audit_events
  where entity_type = 'beta_application' and entity_id = application.id::text;
  delete from public.control_beta_applications where id = application.id;

  insert into public.control_audit_events (actor_user_id, action, entity_type, entity_id, after_state)
  values (
    p_actor_user_id,
    'beta_application.removed',
    'beta_application',
    'removed',
    jsonb_build_object('source', p_source)
  );

  return jsonb_build_object('removed', true);
end;
$$;

revoke all on function public.control_remove_invited_application(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.control_remove_invited_application(uuid, uuid, text) to service_role;

commit;
