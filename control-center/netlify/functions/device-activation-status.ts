import type { Config, Context } from "@netlify/functions";
import { deviceHash, hashesMatch, parseDeviceActivationProof } from "./_shared/devices";
import { databaseUnavailable, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "POST") return methodNotAllowed();
  const input = parseDeviceActivationProof(await request.json().catch(() => undefined));
  if (input instanceof Response) return input;
  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const { data, error } = await client
    .from("control_device_activations")
    .select("device_key,device_secret_hash,expires_at,approved_at")
    .eq("activation_code_hash", deviceHash(input.activationCode))
    .maybeSingle();
  if (error) return databaseUnavailable();
  if (!data || data.device_key !== input.deviceKey || !hashesMatch(data.device_secret_hash, deviceHash(input.deviceSecret))) {
    return json({ message: "This device activation request could not be found." }, 404);
  }
  if (Date.parse(data.expires_at) <= Date.now()) return json({ status: "expired" });
  return json({ status: data.approved_at ? "approved" : "pending", expiresAt: data.expires_at });
};

export const config: Config = { path: "/api/devices/activation-status", method: ["POST"] };
