-- Atomic, audited control-plane changes. This function is callable only by
-- Netlify Functions using Supabase's server-only secret key.

create or replace function public.control_update_account_access(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_access_status public.control_access_status default null,
  p_release_channel public.control_release_channel default null,
  p_feature_key text default null,
  p_feature_enabled boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_state jsonb;
  after_state jsonb;
  audit_action text;
  audit_entity_type text;
  audit_entity_id text;
begin
  if ((p_access_status is not null)::integer + (p_release_channel is not null)::integer + (p_feature_key is not null)::integer) <> 1 then
    raise exception 'submit exactly one access, release channel, or feature change';
  end if;
  if p_feature_key is not null and p_feature_enabled is null then
    raise exception 'feature changes require an enabled value';
  end if;
  if not exists (select 1 from public.control_accounts where netlify_user_id = p_actor_user_id) then
    raise exception 'operator account not found';
  end if;
  if not exists (select 1 from public.control_accounts where netlify_user_id = p_target_user_id) then
    raise exception 'target account not found';
  end if;

  if p_access_status is not null then
    select to_jsonb(account) into before_state
    from public.control_accounts account
    where account.netlify_user_id = p_target_user_id;

    update public.control_accounts
    set access_status = p_access_status
    where netlify_user_id = p_target_user_id
    returning to_jsonb(control_accounts) into after_state;

    audit_action := 'account.access_status.changed';
    audit_entity_type := 'account';
    audit_entity_id := p_target_user_id::text;
  elsif p_release_channel is not null then
    select to_jsonb(account) into before_state
    from public.control_accounts account
    where account.netlify_user_id = p_target_user_id;

    update public.control_accounts
    set release_channel = p_release_channel
    where netlify_user_id = p_target_user_id
    returning to_jsonb(control_accounts) into after_state;

    audit_action := 'account.release_channel.changed';
    audit_entity_type := 'account';
    audit_entity_id := p_target_user_id::text;
  else
    if not exists (select 1 from public.control_feature_definitions where feature_key = p_feature_key) then
      raise exception 'feature not found';
    end if;

    select to_jsonb(assignment) into before_state
    from public.control_feature_assignments assignment
    where assignment.account_id = p_target_user_id and assignment.feature_key = p_feature_key;

    insert into public.control_feature_assignments (account_id, feature_key, enabled, updated_by)
    values (p_target_user_id, p_feature_key, p_feature_enabled, p_actor_user_id)
    on conflict (account_id, feature_key) do update
    set enabled = excluded.enabled,
        updated_by = excluded.updated_by
    returning to_jsonb(control_feature_assignments) into after_state;

    audit_action := 'account.feature.changed';
    audit_entity_type := 'feature_assignment';
    audit_entity_id := concat(p_target_user_id::text, ':', p_feature_key);
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
    p_target_user_id,
    audit_action,
    audit_entity_type,
    audit_entity_id,
    before_state,
    after_state
  );

  return jsonb_build_object('before', before_state, 'after', after_state);
end;
$$;

revoke all on function public.control_update_account_access(uuid, uuid, public.control_access_status, public.control_release_channel, text, boolean) from public, anon, authenticated;
grant execute on function public.control_update_account_access(uuid, uuid, public.control_access_status, public.control_release_channel, text, boolean) to service_role;
