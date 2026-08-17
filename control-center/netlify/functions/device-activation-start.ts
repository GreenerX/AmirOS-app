import type { Config, Context } from "@netlify/functions";
import { parseDeviceActivation, deviceHash } from "./_shared/devices";
import { databaseUnavailable, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";

const ACTIVATION_LIFETIME_MS = 10 * 60 * 1_000;

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "POST") return methodNotAllowed();
  const input = parseDeviceActivation(await request.json().catch(() => undefined));
  if (input instanceof Response) return input;
  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const expiresAt = new Date(Date.now() + ACTIVATION_LIFETIME_MS).toISOString();
  const { error } = await client.from("control_device_activations").upsert({
    activation_code_hash: deviceHash(input.activationCode),
    device_key: input.deviceKey,
    device_secret_hash: deviceHash(input.deviceSecret),
    label: input.label,
    platform: input.platform,
    app_version: input.appVersion,
    expires_at: expiresAt,
    approved_account_id: null,
    approved_at: null,
    completed_at: null,
  }, { onConflict: "device_key" });
  if (error) return databaseUnavailable();
  return json({ expiresAt });
};

export const config: Config = { path: "/api/devices/activation-start", method: ["POST"] };
