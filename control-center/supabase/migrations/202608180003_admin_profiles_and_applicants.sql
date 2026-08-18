-- Admin-managed beta profiles and a recoverable applicant archive. This is
-- operational metadata only; it intentionally excludes AmirOS content.

begin;

alter table public.control_accounts
  add column if not exists first_name text,
  add column if not exists last_name text;

alter table public.control_beta_applications
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists source text not null default 'landing' check (source in ('landing', 'manual')),
  add column if not exists internal_note text,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.control_accounts(netlify_user_id) on delete set null;

update public.control_beta_applications
set first_name = coalesce(first_name, split_part(full_name, ' ', 1)),
    last_name = coalesce(last_name, nullif(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), ''))
where first_name is null;

create index if not exists control_beta_applications_active_state_created_idx
  on public.control_beta_applications (state, created_at desc)
  where archived_at is null;

create or replace function public.control_create_manual_beta_application(
  p_actor_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_internal_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application public.control_beta_applications%rowtype;
  resolved_email text := lower(btrim(p_email));
  resolved_first text := btrim(p_first_name);
  resolved_last text := btrim(p_last_name);
begin
  if not exists (select 1 from public.control_accounts where netlify_user_id = p_actor_user_id) then raise exception 'operator account not found'; end if;
  if char_length(resolved_first) not between 1 and 80 or char_length(resolved_last) not between 1 and 80 then raise exception 'first and last names are required'; end if;
  if resolved_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid email'; end if;
  if p_internal_note is not null and char_length(p_internal_note) > 1000 then raise exception 'internal note is too long'; end if;

  insert into public.control_beta_applications (submission_id, email, email_normalized, full_name, first_name, last_name, source, internal_note)
  values ('manual:' || gen_random_uuid()::text, resolved_email, resolved_email, resolved_first || ' ' || resolved_last, resolved_first, resolved_last, 'manual', nullif(btrim(p_internal_note), ''))
  returning * into application;
  insert into public.control_audit_events (actor_user_id, action, entity_type, entity_id, after_state)
  values (p_actor_user_id, 'beta_application.manual_created', 'beta_application', application.id::text, jsonb_build_object('source', 'manual', 'state', application.state));
  return jsonb_build_object('id', application.id, 'state', application.state, 'created_at', application.created_at);
end;
$$;

create or replace function public.control_update_beta_application_profile(
  p_actor_user_id uuid,
  p_application_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_internal_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application public.control_beta_applications%rowtype;
  resolved_email text := lower(btrim(p_email));
  resolved_first text := btrim(p_first_name);
  resolved_last text := btrim(p_last_name);
begin
  if not exists (select 1 from public.control_accounts where netlify_user_id = p_actor_user_id) then raise exception 'operator account not found'; end if;
  select * into application from public.control_beta_applications where id = p_application_id for update;
  if not found then raise exception 'beta application not found'; end if;
  if application.state not in ('requested', 'reviewing', 'approved') then raise exception 'email changes require a new invitation after an invite is sent'; end if;
  if char_length(resolved_first) not between 1 and 80 or char_length(resolved_last) not between 1 and 80 then raise exception 'first and last names are required'; end if;
  if resolved_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid email'; end if;
  if p_internal_note is not null and char_length(p_internal_note) > 1000 then raise exception 'internal note is too long'; end if;
  update public.control_beta_applications
  set email = resolved_email, email_normalized = resolved_email, first_name = resolved_first, last_name = resolved_last,
      full_name = resolved_first || ' ' || resolved_last, internal_note = nullif(btrim(p_internal_note), '')
  where id = application.id
  returning * into application;
  insert into public.control_audit_events (actor_user_id, action, entity_type, entity_id, after_state)
  values (p_actor_user_id, 'beta_application.profile.changed', 'beta_application', application.id::text, jsonb_build_object('state', application.state));
  return jsonb_build_object('id', application.id, 'full_name', application.full_name, 'email', application.email, 'first_name', application.first_name, 'last_name', application.last_name, 'internal_note', application.internal_note);
end;
$$;

create or replace function public.control_archive_beta_application(
  p_actor_user_id uuid,
  p_application_id uuid,
  p_archive boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application public.control_beta_applications%rowtype;
begin
  if not exists (select 1 from public.control_accounts where netlify_user_id = p_actor_user_id) then raise exception 'operator account not found'; end if;
  select * into application from public.control_beta_applications where id = p_application_id for update;
  if not found then raise exception 'beta application not found'; end if;
  if p_archive and application.state <> 'declined' then raise exception 'only declined applicants can be archived'; end if;
  update public.control_beta_applications
  set archived_at = case when p_archive then now() else null end,
      archived_by = case when p_archive then p_actor_user_id else null end
  where id = application.id
  returning * into application;
  insert into public.control_audit_events (actor_user_id, action, entity_type, entity_id, after_state)
  values (p_actor_user_id, case when p_archive then 'beta_application.archived' else 'beta_application.restored' end, 'beta_application', application.id::text, jsonb_build_object('archived', p_archive));
  return jsonb_build_object('id', application.id, 'archived_at', application.archived_at);
end;
$$;

create or replace function public.control_update_account_profile(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_first_name text,
  p_last_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  account public.control_accounts%rowtype;
  resolved_first text := btrim(p_first_name);
  resolved_last text := btrim(p_last_name);
begin
  if not exists (select 1 from public.control_accounts where netlify_user_id = p_actor_user_id) then raise exception 'operator account not found'; end if;
  if char_length(resolved_first) not between 1 and 80 or char_length(resolved_last) not between 1 and 80 then raise exception 'first and last names are required'; end if;
  update public.control_accounts set first_name = resolved_first, last_name = resolved_last, display_name = resolved_first || ' ' || resolved_last
  where netlify_user_id = p_target_user_id returning * into account;
  if not found then raise exception 'account not found'; end if;
  insert into public.control_audit_events (actor_user_id, target_user_id, action, entity_type, entity_id, after_state)
  values (p_actor_user_id, p_target_user_id, 'account.profile.changed', 'account', p_target_user_id::text, jsonb_build_object('display_name', account.display_name));
  return jsonb_build_object('id', account.netlify_user_id, 'display_name', account.display_name, 'first_name', account.first_name, 'last_name', account.last_name);
end;
$$;

revoke all on function public.control_create_manual_beta_application(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.control_create_manual_beta_application(uuid, text, text, text, text) to service_role;
revoke all on function public.control_update_beta_application_profile(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.control_update_beta_application_profile(uuid, uuid, text, text, text, text) to service_role;
revoke all on function public.control_archive_beta_application(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.control_archive_beta_application(uuid, uuid, boolean) to service_role;
revoke all on function public.control_update_account_profile(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.control_update_account_profile(uuid, uuid, text, text) to service_role;

commit;
