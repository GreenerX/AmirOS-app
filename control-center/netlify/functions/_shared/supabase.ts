import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { json, serviceNotConfigured } from "./http";

export type ControlCenterIdentity = {
  id: string;
  email?: string;
  displayName?: string;
  roles: string[];
};

export type ControlAccountRecord = {
  netlify_user_id: string;
  email: string;
  display_name: string | null;
  access_status: "active" | "paused" | "revoked";
  setup_state: "setup_required" | "device_pending" | "active";
  release_channel: "internal" | "beta" | "stable";
  access_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export function getSupabaseAdmin(): SupabaseClient | Response {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return serviceNotConfigured();
  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export async function ensureControlAccount(
  client: SupabaseClient,
  user: ControlCenterIdentity,
): Promise<ControlAccountRecord | Response> {
  if (!user.email) return json({ message: "Your signed-in account does not include an email address." }, 400);
  const { data, error } = await client
    .rpc("control_claim_beta_application", {
      p_user_id: user.id,
      p_email: user.email,
      p_display_name: user.displayName?.trim() || null,
      p_is_admin: user.roles.includes("admin"),
    });
  if (error || !data || typeof data !== "object") return json({ message: "The Control Center database could not load this account." }, 503);
  const account = data as ControlAccountRecord;
  if (
    typeof account.netlify_user_id !== "string"
    || typeof account.email !== "string"
    || typeof account.access_status !== "string"
    || typeof account.setup_state !== "string"
  ) return json({ message: "The Control Center database returned an invalid account record." }, 503);
  return account;
}

export function databaseUnavailable(): Response {
  return json({ message: "The Control Center database is temporarily unavailable. Please try again shortly." }, 503);
}
