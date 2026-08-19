-- Controlled beta capabilities. These definitions contain only product-control
-- metadata; they do not store messages, contacts, archived content, or memory.
-- Defaults preserve the current opt-in local behavior until an administrator
-- creates an account-specific assignment.

insert into public.control_feature_definitions (feature_key, name, description, default_enabled)
values
  ('deleted-message-archive', 'Saved deleted messages', 'Allow an opted-in local archive of deleted WhatsApp messages on this Mac.', true),
  ('relationship-suggestions', 'Relationship suggestions', 'Show carefully qualified relationship suggestions from recent direct evidence.', true),
  ('reply-suggestions', 'Reply suggestions', 'Offer suggested replies, including a reliable new-message fallback when quoting is unavailable.', true)
on conflict (feature_key) do update
set name = excluded.name,
    description = excluded.description,
    default_enabled = excluded.default_enabled;
