-- Managed update rollout controls. This stays operational metadata only: a
-- channel either exposes one tested artifact or explicitly holds updates.
-- It never uploads installers, stores credentials, or changes account access.

begin;

alter table public.control_releases
  add column if not exists release_notes_url text,
  add column if not exists updated_at timestamptz not null default now(),
  add constraint control_releases_download_url_https check (download_url ~ '^https://') not valid,
  add constraint control_releases_notes_url_https check (release_notes_url is null or release_notes_url ~ '^https://') not valid;

create table if not exists public.control_release_channels (
  channel public.control_release_channel primary key,
  mode text not null default 'hold' check (mode in ('hold', 'available')),
  approved_release_id bigint references public.control_releases(id) on delete set null,
  updated_by uuid references public.control_accounts(netlify_user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint control_release_channels_available_requires_release
    check (mode <> 'available' or approved_release_id is not null)
);

insert into public.control_release_channels (channel, mode)
values ('internal', 'hold'), ('beta', 'hold'), ('stable', 'hold')
on conflict (channel) do nothing;

drop trigger if exists control_releases_set_updated_at on public.control_releases;
create trigger control_releases_set_updated_at
before update on public.control_releases
for each row execute function public.control_set_updated_at();

drop trigger if exists control_release_channels_set_updated_at on public.control_release_channels;
create trigger control_release_channels_set_updated_at
before update on public.control_release_channels
for each row execute function public.control_set_updated_at();

alter table public.control_release_channels enable row level security;
revoke all on public.control_release_channels from anon, authenticated;
grant select, insert, update, delete on public.control_release_channels to service_role;

create index if not exists control_releases_channel_created_idx
  on public.control_releases (channel, created_at desc);

create or replace function public.control_create_release(
  p_actor_user_id uuid,
  p_channel public.control_release_channel,
  p_version text,
  p_download_url text,
  p_sha256 text,
  p_release_notes_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  release public.control_releases%rowtype;
begin
  if not exists (select 1 from public.control_accounts where netlify_user_id = p_actor_user_id) then
    raise exception 'operator account not found';
  end if;
  if char_length(btrim(p_version)) not between 1 and 80 then
    raise exception 'invalid release version';
  end if;
  if p_download_url !~ '^https://' then
    raise exception 'release download must use https';
  end if;
  if p_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid release sha256';
  end if;
  if p_release_notes_url is not null and p_release_notes_url !~ '^https://' then
    raise exception 'release notes must use https';
  end if;

  insert into public.control_releases (version, channel, download_url, sha256, release_notes_url, published_at, is_active)
  values (btrim(p_version), p_channel, p_download_url, p_sha256, p_release_notes_url, now(), false)
  returning * into release;

  insert into public.control_audit_events (actor_user_id, action, entity_type, entity_id, after_state)
  values (
    p_actor_user_id,
    'release.created',
    'release',
    release.id::text,
    jsonb_build_object('channel', release.channel, 'version', release.version, 'has_release_notes', release.release_notes_url is not null)
  );

  return jsonb_build_object(
    'id', release.id,
    'channel', release.channel,
    'version', release.version,
    'download_url', release.download_url,
    'sha256', release.sha256,
    'release_notes_url', release.release_notes_url,
    'created_at', release.created_at
  );
end;
$$;

create or replace function public.control_set_release_channel(
  p_actor_user_id uuid,
  p_channel public.control_release_channel,
  p_mode text,
  p_release_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  channel_row public.control_release_channels%rowtype;
  release public.control_releases%rowtype;
  before_state jsonb;
begin
  if not exists (select 1 from public.control_accounts where netlify_user_id = p_actor_user_id) then
    raise exception 'operator account not found';
  end if;
  if p_mode not in ('hold', 'available') then
    raise exception 'invalid release channel mode';
  end if;

  select * into channel_row from public.control_release_channels where channel = p_channel for update;
  if not found then
    insert into public.control_release_channels (channel, mode) values (p_channel, 'hold') returning * into channel_row;
  end if;
  before_state := jsonb_build_object('mode', channel_row.mode, 'approved_release_id', channel_row.approved_release_id);

  if p_mode = 'available' then
    if p_release_id is null then raise exception 'an approved release is required'; end if;
    select * into release from public.control_releases where id = p_release_id for update;
    if not found or release.channel <> p_channel then raise exception 'release does not belong to this channel'; end if;
    update public.control_releases set is_active = false where channel = p_channel and is_active;
    update public.control_releases set is_active = true where id = release.id;
    update public.control_release_channels
    set mode = 'available', approved_release_id = release.id, updated_by = p_actor_user_id
    where channel = p_channel;
  else
    update public.control_release_channels
    set mode = 'hold', updated_by = p_actor_user_id
    where channel = p_channel;
  end if;

  select * into channel_row from public.control_release_channels where channel = p_channel;
  insert into public.control_audit_events (actor_user_id, action, entity_type, entity_id, before_state, after_state)
  values (
    p_actor_user_id,
    case when p_mode = 'hold' then 'release.channel.held' else 'release.channel.available' end,
    'release_channel',
    p_channel::text,
    before_state,
    jsonb_build_object('mode', channel_row.mode, 'approved_release_id', channel_row.approved_release_id)
  );
  return jsonb_build_object('channel', channel_row.channel, 'mode', channel_row.mode, 'approved_release_id', channel_row.approved_release_id, 'updated_at', channel_row.updated_at);
end;
$$;

revoke all on function public.control_create_release(uuid, public.control_release_channel, text, text, text, text) from public, anon, authenticated;
grant execute on function public.control_create_release(uuid, public.control_release_channel, text, text, text, text) to service_role;
revoke all on function public.control_set_release_channel(uuid, public.control_release_channel, text, bigint) from public, anon, authenticated;
grant execute on function public.control_set_release_channel(uuid, public.control_release_channel, text, bigint) to service_role;

commit;
