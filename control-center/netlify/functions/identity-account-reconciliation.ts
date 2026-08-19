import type { Config } from "@netlify/functions";
import { json } from "./_shared/http";
import { reconcileDeletedIdentityAccounts } from "./_shared/identity-reconciliation";
import { getSupabaseAdmin } from "./_shared/supabase";

export default async (): Promise<Response> => {
  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const result = await reconcileDeletedIdentityAccounts(client);
  return json(result);
};

// Runs only on published deploys. Admin overview requests also reconcile, so
// this is a safety net rather than the only way a deletion is reflected.
export const config: Config = { schedule: "@hourly" };
