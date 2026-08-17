import type { Config, Context } from "@netlify/functions";
import { buildActivationChecklist } from "./_shared/activation-checklist";
import { authenticateDevice, parseDeviceCredential } from "./_shared/devices";
import { databaseUnavailable, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";

type OnboardingEvent = "whatsapp_connected" | "first_people_selected";

function parseEvent(value: unknown): OnboardingEvent | Response {
  if (value === "whatsapp_connected" || value === "first_people_selected") return value;
  return json({ message: "The onboarding progress event is invalid." }, 400);
}

/**
 * Receives one-way, device-authenticated onboarding confirmations from local
 * AmirOS. The request carries no WhatsApp, people, conversation, memory, QR,
 * API-key, or other local product data—only an event name and the existing
 * opaque device credential.
 */
export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "POST") return methodNotAllowed();
  const body = await request.json().catch(() => undefined);
  const input = parseDeviceCredential(body);
  if (input instanceof Response) return input;
  const event = parseEvent(body && typeof body === "object" ? (body as Record<string, unknown>).event : undefined);
  if (event instanceof Response) return event;

  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const device = await authenticateDevice(client, input);
  if (device instanceof Response) return device;
  if (device.accessStatus !== "active" || device.account.accessStatus !== "active" || device.account.setupState !== "active") {
    return json({ message: "This Mac does not currently have permission to update beta setup progress." }, 403);
  }

  const { data: current, error: currentError } = await client
    .from("control_devices")
    .select("first_seen_at,whatsapp_connected_at,first_people_selected_at")
    .eq("id", device.id)
    .maybeSingle();
  if (currentError || !current) return databaseUnavailable();
  if (event === "first_people_selected" && !current.whatsapp_connected_at) {
    return json({ message: "Connect WhatsApp in AmirOS before marking your first people as selected." }, 409);
  }

  const timestampColumn = event === "whatsapp_connected" ? "whatsapp_connected_at" : "first_people_selected_at";
  const alreadyCompletedAt = current[timestampColumn];
  if (!alreadyCompletedAt) {
    const checkedAt = new Date().toISOString();
    const { error: updateError } = await client
      .from("control_devices")
      .update({
        [timestampColumn]: checkedAt,
        label: input.label,
        platform: input.platform,
        app_version: input.appVersion,
        last_seen_at: checkedAt,
      })
      .eq("id", device.id)
      .is(timestampColumn, null);
    if (updateError) return databaseUnavailable();
  }

  const [accountResult, devicesResult] = await Promise.all([
    client.from("control_accounts").select("created_at,setup_state").eq("netlify_user_id", device.accountId).maybeSingle(),
    client.from("control_devices").select("first_seen_at,whatsapp_connected_at,first_people_selected_at").eq("account_id", device.accountId),
  ]);
  if (accountResult.error || !accountResult.data || devicesResult.error) return databaseUnavailable();

  return json({
    event,
    activation: buildActivationChecklist({
      accountCreatedAt: accountResult.data.created_at,
      setupState: accountResult.data.setup_state,
      devices: (devicesResult.data || []).map((item) => ({
        firstSeenAt: item.first_seen_at,
        whatsappConnectedAt: item.whatsapp_connected_at,
        firstPeopleSelectedAt: item.first_people_selected_at,
      })),
    }),
  });
};

export const config: Config = { path: "/api/devices/onboarding-progress", method: ["POST"] };
