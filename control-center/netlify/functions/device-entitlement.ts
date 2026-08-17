import type { Config, Context } from "@netlify/functions";
import { authenticateDevice, parseDeviceCredential } from "./_shared/devices";
import { databaseUnavailable, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "POST") return methodNotAllowed();
  const input = parseDeviceCredential(await request.json().catch(() => undefined));
  if (input instanceof Response) return input;
  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const device = await authenticateDevice(client, input);
  if (device instanceof Response) return device;
  if (device.revokedAt || device.accessStatus === "revoked") {
    return json({ status: "revoked", setupState: device.account.setupState, detail: "This Mac has been revoked in the Control Center. Your local data remains on this Mac.", checkedAt: new Date().toISOString(), features: [] });
  }
  if (device.accessStatus === "paused") {
    return json({ status: "paused", setupState: device.account.setupState, detail: "This Mac is paused in the Control Center. Your local data remains on this Mac.", checkedAt: new Date().toISOString(), features: [] });
  }

  if (device.account.setupState !== "active") {
    return json({ status: "paused", setupState: device.account.setupState, detail: "Finish Control Center setup before using AmirOS on this Mac.", checkedAt: new Date().toISOString(), features: [] });
  }

  const [definitionsResult, assignmentsResult] = await Promise.all([
    client.from("control_feature_definitions").select("feature_key,default_enabled").order("feature_key"),
    client.from("control_feature_assignments").select("feature_key,enabled").eq("account_id", device.accountId),
  ]);
  if (definitionsResult.error || assignmentsResult.error) return databaseUnavailable();

  const enabledByFeature = new Map((assignmentsResult.data || []).map((assignment) => [assignment.feature_key, assignment.enabled]));
  const checkedAt = new Date().toISOString();
  const { error: heartbeatError } = await client.from("control_devices").update({
    label: input.label,
    platform: input.platform,
    app_version: input.appVersion,
    last_seen_at: checkedAt,
  }).eq("id", device.id);
  if (heartbeatError) return databaseUnavailable();

  const accessStatus = device.account.accessStatus;
  return json({
    status: accessStatus,
    setupState: device.account.setupState,
    detail: accessStatus === "active" ? "This Mac is approved by the Control Center." : accessStatus === "paused" ? "Access is paused in the Control Center. Your local data remains on this Mac." : "Access has been revoked in the Control Center. Your local data remains on this Mac.",
    checkedAt,
    releaseChannel: device.account.releaseChannel,
    features: (definitionsResult.data || []).map((feature) => ({
      id: feature.feature_key,
      enabled: enabledByFeature.get(feature.feature_key) ?? feature.default_enabled,
    })),
  });
};

export const config: Config = { path: "/api/devices/entitlement", method: ["POST"] };
