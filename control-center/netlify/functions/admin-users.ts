import type { Config, Context } from "@netlify/functions";
import { requireAdmin } from "./_shared/auth";
import { databaseUnavailable, ensureControlAccount, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";

const accessStatuses = new Set(["active", "paused", "revoked"]);
const releaseChannels = new Set(["internal", "beta", "stable"]);

type UpdateInput = {
  userId?: unknown;
  accessStatus?: unknown;
  releaseChannel?: unknown;
  featureId?: unknown;
  enabled?: unknown;
};

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "PATCH") return methodNotAllowed();
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const input = await request.json().catch(() => undefined) as UpdateInput | undefined;
  if (!input || typeof input.userId !== "string") return json({ message: "Choose a user to update." }, 400);

  const hasAccessChange = typeof input.accessStatus === "string";
  const hasChannelChange = typeof input.releaseChannel === "string";
  const hasFeatureChange = typeof input.featureId === "string" || typeof input.enabled === "boolean";
  if (Number(hasAccessChange) + Number(hasChannelChange) + Number(hasFeatureChange) !== 1) {
    return json({ message: "Submit one access, channel, or feature change at a time." }, 400);
  }
  if (hasAccessChange && !accessStatuses.has(input.accessStatus as string)) return json({ message: "Choose a valid access status." }, 400);
  if (hasChannelChange && !releaseChannels.has(input.releaseChannel as string)) return json({ message: "Choose a valid release channel." }, 400);
  if (hasFeatureChange && (typeof input.featureId !== "string" || typeof input.enabled !== "boolean")) return json({ message: "Choose a feature and whether it is enabled." }, 400);

  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const operator = await ensureControlAccount(client, admin);
  if (operator instanceof Response) return operator;
  const { error } = await client.rpc("control_update_account_access", {
    p_actor_user_id: operator.netlify_user_id,
    p_target_user_id: input.userId,
    p_access_status: hasAccessChange ? input.accessStatus : null,
    p_release_channel: hasChannelChange ? input.releaseChannel : null,
    p_feature_key: hasFeatureChange ? input.featureId : null,
    p_feature_enabled: hasFeatureChange ? input.enabled : null,
  });
  if (error) return databaseUnavailable();
  return json({ ok: true });
};

export const config: Config = { path: "/api/admin/users", method: ["PATCH"] };
