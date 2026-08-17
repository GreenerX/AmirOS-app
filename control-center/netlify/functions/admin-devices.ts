import type { Config, Context } from "@netlify/functions";
import { requireAdmin } from "./_shared/auth";
import { databaseUnavailable, ensureControlAccount, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";

const accessStatuses = new Set(["active", "paused", "revoked"]);

type UpdateInput = {
  deviceId?: unknown;
  accessStatus?: unknown;
};

/** Changes one authorized Mac. The database function locks, validates, and audits the change. */
export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "PATCH") return methodNotAllowed();
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const input = await request.json().catch(() => undefined) as UpdateInput | undefined;
  if (!input || typeof input.deviceId !== "string" || typeof input.accessStatus !== "string" || !accessStatuses.has(input.accessStatus)) {
    return json({ message: "Choose a device and a valid access status." }, 400);
  }

  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const operator = await ensureControlAccount(client, admin);
  if (operator instanceof Response) return operator;
  const { error } = await client.rpc("control_update_device_access", {
    p_actor_user_id: operator.netlify_user_id,
    p_device_id: input.deviceId,
    p_access_status: input.accessStatus,
  });
  if (error) return json({ message: error.message.includes("cannot be restored") ? "A revoked Mac must be reconnected from AmirOS before it can be used again." : "The device access change could not be saved." }, 409);
  return json({ ok: true });
};

export const config: Config = { path: "/api/admin/devices", method: ["PATCH"] };
