import type { Config, Context } from "@netlify/functions";
import { requireAdmin } from "./_shared/auth";
import { deleteIdentityAdminUser, getIdentityAdminConfig, getIdentityAdminUser } from "./_shared/identity-admin";
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
  firstName?: unknown;
  lastName?: unknown;
  confirmation?: unknown;
};

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "PATCH" && request.method !== "DELETE") return methodNotAllowed();
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const input = await request.json().catch(() => undefined) as UpdateInput | undefined;
  if (!input || typeof input.userId !== "string") return json({ message: "Choose a user to update." }, 400);

  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const operator = await ensureControlAccount(client, admin);
  if (operator instanceof Response) return operator;
  if (request.method === "DELETE") {
    if (input.confirmation !== "delete") return json({ message: "Confirm this permanent account deletion first." }, 400);
    if (input.userId === operator.netlify_user_id) return json({ message: "Use Netlify Identity recovery to manage your own administrator account." }, 409);
    const identity = getIdentityAdminConfig();
    if (!identity) return json({ message: "Netlify Identity is unavailable, so this account was not deleted." }, 503);
    try {
      const identityUser = await getIdentityAdminUser(identity, input.userId);
      if (identityUser !== "missing" && identityUser.roles.includes("admin")) return json({ message: "Administrator accounts must be managed separately to avoid removing the last administrator." }, 409);
      await deleteIdentityAdminUser(identity, input.userId);
    } catch {
      return json({ message: "Netlify could not delete this Identity account. No Control Center records were removed." }, 503);
    }
    const { data, error } = await client.rpc("control_remove_account", {
      p_actor_user_id: operator.netlify_user_id,
      p_target_user_id: input.userId,
      p_source: "admin_delete",
    });
    if (error) return json({ message: "The Identity account was deleted, but Control Center cleanup is pending. Refreshing the admin view will retry it safely." }, 503);
    return json({ removed: (data as { removed?: unknown } | null)?.removed === true });
  }

  const hasAccessChange = typeof input.accessStatus === "string";
  const hasChannelChange = typeof input.releaseChannel === "string";
  const hasFeatureChange = typeof input.featureId === "string" || typeof input.enabled === "boolean";
  const hasProfileChange = typeof input.firstName === "string" || typeof input.lastName === "string";
  if (Number(hasAccessChange) + Number(hasChannelChange) + Number(hasFeatureChange) + Number(hasProfileChange) !== 1) return json({ message: "Submit one access, channel, feature, or profile change at a time." }, 400);
  if (hasAccessChange && !accessStatuses.has(input.accessStatus as string)) return json({ message: "Choose a valid access status." }, 400);
  if (hasChannelChange && !releaseChannels.has(input.releaseChannel as string)) return json({ message: "Choose a valid release channel." }, 400);
  if (hasFeatureChange && (typeof input.featureId !== "string" || typeof input.enabled !== "boolean")) return json({ message: "Choose a feature and whether it is enabled." }, 400);
  if (hasProfileChange && (typeof input.firstName !== "string" || typeof input.lastName !== "string")) return json({ message: "Enter a first and last name." }, 400);
  if (hasProfileChange) {
    const { error } = await client.rpc("control_update_account_profile", {
      p_actor_user_id: operator.netlify_user_id,
      p_target_user_id: input.userId,
      p_first_name: input.firstName,
      p_last_name: input.lastName,
    });
    if (error) return databaseUnavailable();
    return json({ ok: true });
  }
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

export const config: Config = { path: "/api/admin/users", method: ["PATCH", "DELETE"] };
