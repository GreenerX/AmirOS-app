import type { Config, Context } from "@netlify/functions";
import { getIdentityConfig } from "@netlify/identity";
import { requireAdmin } from "./_shared/auth";
import { ensureControlAccount, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";

const applicationStates = new Set(["requested", "reviewing", "approved", "invited", "device_pending", "active", "declined"]);
const eligibleInvitationStates = new Set(["requested", "reviewing", "approved"]);

type ApplicationRecord = {
  id: string;
  email: string;
  state: "requested" | "reviewing" | "approved" | "invited" | "device_pending" | "active" | "declined";
};

type IdentityUserList = { users?: Array<{ email?: unknown }> };

function safeIdentityConfig(): { url: string; token: string } | undefined {
  const identity = getIdentityConfig();
  if (!identity?.url || !identity.token) return undefined;
  return { url: identity.url, token: identity.token };
}

async function identityUserAlreadyExists(email: string, identity: { url: string; token: string }): Promise<boolean> {
  const response = await fetch(`${identity.url}/admin/users?per_page=100`, {
    headers: { Authorization: `Bearer ${identity.token}` },
  });
  if (!response.ok) throw new Error("identity_user_lookup_failed");
  const payload = await response.json().catch((): IdentityUserList => ({})) as IdentityUserList;
  return Boolean(payload.users?.some((user) => typeof user.email === "string" && user.email.trim().toLowerCase() === email.trim().toLowerCase()));
}

async function sendIdentityInvitation(email: string, identity: { url: string; token: string }): Promise<void> {
  const response = await fetch(`${identity.url}/invite`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${identity.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error("identity_invite_failed");
}

async function moveApplication(
  client: Exclude<ReturnType<typeof getSupabaseAdmin>, Response>,
  actorUserId: string,
  applicationId: string,
  state: string,
): Promise<{ data: unknown; error: { message: string } | null }> {
  return client.rpc("control_update_beta_application", {
    p_actor_user_id: actorUserId,
    p_application_id: applicationId,
    p_next_state: state,
  });
}

async function approveAndInvite(
  applicationId: string,
  client: Exclude<ReturnType<typeof getSupabaseAdmin>, Response>,
  actorUserId: string,
): Promise<Response> {
  const { data, error } = await client
    .from("control_beta_applications")
    .select("id,email,state")
    .eq("id", applicationId)
    .maybeSingle();
  const application = data as ApplicationRecord | null;
  if (error || !application) return json({ message: "That applicant could not be found." }, 404);
  if (!eligibleInvitationStates.has(application.state)) {
    return json({ message: "This applicant is already past the invitation step." }, 409);
  }

  if (application.state !== "approved") {
    const approval = await moveApplication(client, actorUserId, application.id, "approved");
    if (approval.error) return json({ message: "The applicant could not be approved." }, 409);
  }

  const identity = safeIdentityConfig();
  if (!identity) return json({ message: "Netlify Identity is not available, so no invitation was sent." }, 503);

  let delivery: "sent" | "existing_account";
  try {
    if (await identityUserAlreadyExists(application.email, identity)) {
      delivery = "existing_account";
    } else {
      await sendIdentityInvitation(application.email, identity);
      delivery = "sent";
    }
  } catch {
    return json({ message: "The applicant was approved, but Netlify could not send the secure invitation. You can try again or use the Netlify fallback." }, 503);
  }

  const invitation = await moveApplication(client, actorUserId, application.id, "invited");
  if (invitation.error) {
    return json({ message: "Netlify accepted the invitation, but its delivery status could not be saved. Refresh before trying again so AmirOS does not send a duplicate invitation." }, 503);
  }
  const saved = invitation.data as { invited_at?: unknown } | null;
  return json({
    ok: true,
    state: "invited",
    invitedAt: typeof saved?.invited_at === "string" ? saved.invited_at : undefined,
    delivery,
  });
}

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "PATCH") return methodNotAllowed();
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const input = await request.json().catch(() => undefined) as { applicationId?: unknown; state?: unknown; action?: unknown } | undefined;
  if (!input || typeof input.applicationId !== "string") return json({ message: "Choose an applicant first." }, 400);
  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const operator = await ensureControlAccount(client, admin);
  if (operator instanceof Response) return operator;
  if (input.action === "approve_and_invite") return approveAndInvite(input.applicationId, client, operator.netlify_user_id);
  if (typeof input.state !== "string" || !applicationStates.has(input.state)) return json({ message: "Choose a valid lifecycle state." }, 400);
  const { error } = await moveApplication(client, operator.netlify_user_id, input.applicationId, input.state);
  if (error) {
    return json({ message: /transition/i.test(error.message) ? "That applicant cannot move to this stage yet." : "The applicant could not be updated." }, 409);
  }
  return json({ ok: true });
};

export const config: Config = { path: "/api/admin/applicants", method: ["PATCH"] };
