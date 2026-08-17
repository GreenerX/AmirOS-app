import type { Config, Context } from "@netlify/functions";
import { deviceHash, validActivationCode } from "./_shared/devices";
import { requireUser } from "./_shared/auth";
import { databaseUnavailable, ensureControlAccount, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "POST") return methodNotAllowed();
  const user = await requireUser();
  if (user instanceof Response) return user;
  const activationCode = validActivationCode((await request.json().catch(() => undefined) as { activationCode?: unknown } | undefined)?.activationCode);
  if (!activationCode) return json({ message: "Open this page from AmirOS to approve a device." }, 400);
  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const account = await ensureControlAccount(client, user);
  if (account instanceof Response) return account;
  if (account.access_status !== "active") return json({ message: "This account does not currently have AmirOS access." }, 403);
  if (account.setup_state === "setup_required") {
    return json({ message: "Your invitation must be approved before you can connect a Mac." }, 403);
  }
  const { error } = await client.rpc("control_approve_device_activation", {
    p_actor_user_id: account.netlify_user_id,
    p_activation_code_hash: deviceHash(activationCode),
  });
  if (error) {
    const message = /expired/i.test(error.message) ? "This device approval link has expired. Return to AmirOS and create a new one." : "This device could not be approved. Return to AmirOS and try again.";
    return json({ message }, 409);
  }
  return json({ ok: true });
};

export const config: Config = { path: "/api/devices/activation-approve", method: ["POST"] };
