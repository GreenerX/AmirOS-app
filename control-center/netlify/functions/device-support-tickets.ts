import type { Config, Context } from "@netlify/functions";
import { authenticateDevice, parseDeviceCredential } from "./_shared/devices";
import { databaseUnavailable, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";
import { parseSupportTicket } from "./_shared/support";

/**
 * Allows an already paired AmirOS Mac to submit a report without depending on
 * browser session state. The device credential is random, scoped to one Mac,
 * and never identifies an account in the request body.
 */
export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "POST") return methodNotAllowed();
  const body = await request.json().catch(() => undefined);
  const deviceInput = parseDeviceCredential(body);
  if (deviceInput instanceof Response) return deviceInput;
  const ticketInput = parseSupportTicket(body);
  if (ticketInput instanceof Response) return ticketInput;

  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const device = await authenticateDevice(client, deviceInput);
  if (device instanceof Response) return device;
  if (device.accessStatus !== "active" || device.account.accessStatus !== "active" || device.account.setupState !== "active") {
    return json({ message: "This Mac does not currently have permission to send a support report." }, 403);
  }

  const checkedAt = new Date().toISOString();
  const { data, error } = await client
    .from("control_support_tickets")
    .insert({
      account_id: device.accountId,
      type: ticketInput.type,
      subject: ticketInput.subject,
      details: ticketInput.details,
      source: "paired_device",
    })
    .select("id,type,subject,details,state,created_at,updated_at")
    .single();
  if (error || !data) return databaseUnavailable();

  // A report is already durable at this point. A best-effort freshness update
  // must not turn a successful submission into an ambiguous retry for the Mac.
  await client.from("control_devices").update({
    label: deviceInput.label,
    platform: deviceInput.platform,
    app_version: deviceInput.appVersion,
    last_seen_at: checkedAt,
  }).eq("id", device.id);

  return json({
    ticket: {
      ticketId: data.id,
      id: `SUP-${String(data.id).padStart(3, "0")}`,
      type: data.type,
      subject: data.subject,
      details: data.details,
      state: data.state,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  }, 201);
};

export const config: Config = { path: "/api/devices/support-tickets", method: ["POST"] };
