-- Support ticket workflow. Ticket details remain only in the ticket record;
-- the audit event records state transitions without duplicating user-written
-- support content.

begin;

alter table public.control_support_tickets
  drop constraint if exists control_support_tickets_details_length,
  add constraint control_support_tickets_details_length check (char_length(details) between 1 and 6000);

create or replace function public.control_update_support_ticket_state(
  p_actor_user_id uuid,
  p_ticket_id bigint,
  p_state public.control_ticket_state
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ticket public.control_support_tickets%rowtype;
  before_state jsonb;
  after_state jsonb;
begin
  if not exists (select 1 from public.control_accounts where netlify_user_id = p_actor_user_id) then
    raise exception 'operator account not found';
  end if;

  select * into ticket
  from public.control_support_tickets
  where id = p_ticket_id
  for update;
  if not found then
    raise exception 'support ticket not found';
  end if;

  before_state := jsonb_build_object('state', ticket.state);

  update public.control_support_tickets
  set state = p_state
  where id = ticket.id
  returning jsonb_build_object('state', state, 'updated_at', updated_at) into after_state;

  if before_state <> after_state - 'updated_at' then
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
      ticket.account_id,
      'support_ticket.state.changed',
      'support_ticket',
      ticket.id::text,
      before_state,
      after_state - 'updated_at'
    );
  end if;

  return after_state;
end;
$$;

revoke all on function public.control_update_support_ticket_state(uuid, bigint, public.control_ticket_state) from public, anon, authenticated;
grant execute on function public.control_update_support_ticket_state(uuid, bigint, public.control_ticket_state) to service_role;

commit;
