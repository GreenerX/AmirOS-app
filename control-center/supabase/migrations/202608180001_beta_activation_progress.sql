-- AmirOS beta activation progress remains operational metadata only. These
-- timestamps confirm that a paired Mac completed an onboarding milestone;
-- they never contain WhatsApp data, contact names, memory, conversations,
-- QR material, API keys, or other local AmirOS content.

begin;

alter table public.control_devices
  add column if not exists whatsapp_connected_at timestamptz,
  add column if not exists first_people_selected_at timestamptz;

alter table public.control_devices
  drop constraint if exists control_devices_people_after_whatsapp;

alter table public.control_devices
  add constraint control_devices_people_after_whatsapp
  check (first_people_selected_at is null or whatsapp_connected_at is not null);

commit;
