import type { Config, Context } from "@netlify/functions";
import { requireAdmin } from "./_shared/auth";
import { databaseUnavailable, ensureControlAccount, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";

const ticketStates = new Set(["New", "Investigating", "Resolved"]);

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "PATCH") return methodNotAllowed();
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const input = await request.json().catch(() => undefined) as { ticketId?: unknown; state?: unknown } | undefined;
  if (!input || !Number.isSafeInteger(input.ticketId) || (input.ticketId as number) < 1 || typeof input.state !== "string" || !ticketStates.has(input.state)) {
    return json({ message: "Choose a support ticket and a valid state." }, 400);
  }
  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const operator = await ensureControlAccount(client, admin);
  if (operator instanceof Response) return operator;
  const ticketId = input.ticketId as number;
  const state = input.state as "New" | "Investigating" | "Resolved";
  const { error } = await client.rpc("control_update_support_ticket_state", {
    p_actor_user_id: operator.netlify_user_id,
    p_ticket_id: ticketId,
    p_state: state,
  });
  if (error) return databaseUnavailable();
  return json({ ok: true });
};

export const config: Config = { path: "/api/admin/support-tickets", method: ["PATCH"] };
