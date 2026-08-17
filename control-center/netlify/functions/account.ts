import type { Config, Context } from "@netlify/functions";
import { requireUser } from "./_shared/auth";
import { buildActivationChecklist } from "./_shared/activation-checklist";
import { databaseUnavailable, ensureControlAccount, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";

/**
 * The local AmirOS app and the account portal call this endpoint for a signed-in
 * user's entitlement snapshot. It contains operational information only.
 */
export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "GET") return methodNotAllowed();
  const user = await requireUser();
  if (user instanceof Response) return user;
  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const account = await ensureControlAccount(client, user);
  if (account instanceof Response) return account;

  const [devicesResult, definitionsResult, assignmentsResult] = await Promise.all([
    client.from("control_devices").select("id,label,platform,app_version,first_seen_at,last_seen_at,access_status,revoked_at,whatsapp_connected_at,first_people_selected_at").eq("account_id", account.netlify_user_id).order("last_seen_at", { ascending: false }),
    client.from("control_feature_definitions").select("feature_key,name,description,default_enabled").order("feature_key"),
    client.from("control_feature_assignments").select("feature_key,enabled").eq("account_id", account.netlify_user_id),
  ]);
  if (devicesResult.error || definitionsResult.error || assignmentsResult.error) return databaseUnavailable();

  const featureStates = new Map((assignmentsResult.data || []).map((assignment) => [assignment.feature_key, assignment.enabled]));
  const devices = devicesResult.data || [];
  return json({
    productName: "AmirOS",
    status: account.access_status,
    setupState: account.setup_state,
    releaseChannel: account.release_channel,
    expiresAt: account.access_expires_at || undefined,
    devices: devices.map((device, index) => ({
      id: device.id,
      label: device.label,
      platform: device.platform,
      appVersion: device.app_version,
      lastSeenAt: device.last_seen_at,
      status: device.revoked_at ? "revoked" : device.access_status,
      isCurrent: index === 0 && !device.revoked_at,
    })),
    activation: buildActivationChecklist({
      accountCreatedAt: account.created_at,
      setupState: account.setup_state,
      devices: devices.map((device) => ({
        firstSeenAt: device.first_seen_at,
        whatsappConnectedAt: device.whatsapp_connected_at,
        firstPeopleSelectedAt: device.first_people_selected_at,
      })),
    }),
    features: (definitionsResult.data || []).map((feature) => ({
      id: feature.feature_key,
      name: feature.name,
      description: feature.description,
      enabled: featureStates.get(feature.feature_key) ?? feature.default_enabled,
    })),
  });
};

export const config: Config = { path: "/api/account", method: ["GET"] };
