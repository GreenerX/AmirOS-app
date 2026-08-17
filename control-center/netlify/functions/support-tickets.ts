import type { Config, Context } from "@netlify/functions";
import { requireUser } from "./_shared/auth";
import { databaseUnavailable, ensureControlAccount, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";
import { parseSupportTicket } from "./_shared/support";

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "POST") return methodNotAllowed();
  const user = await requireUser();
  if (user instanceof Response) return user;
  const input = parseSupportTicket(await request.json().catch(() => undefined));
  if (input instanceof Response) return input;
  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const account = await ensureControlAccount(client, user);
  if (account instanceof Response) return account;
  const { data, error } = await client
    .from("control_support_tickets")
    .insert({ account_id: account.netlify_user_id, type: input.type, subject: input.subject, details: input.details, source: "account_portal" })
    .select("id,type,subject,details,state,created_at,updated_at")
    .single();
  if (error || !data) return databaseUnavailable();
  return json({
    ticket: {
      ticketId: data.id,
      id: `SUP-${String(data.id).padStart(3, "0")}`,
      type: data.type,
      subject: data.subject,
      details: data.details,
      state: data.state,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  }, 201);
};

export const config: Config = { path: "/api/support-tickets", method: ["POST"] };
