import type { SupabaseClient } from "@supabase/supabase-js";
import { getIdentityAdminConfig, listIdentityAdminUsers } from "./identity-admin";

/**
 * Removes only records whose Identity account no longer exists. A failure to
 * list Identity users is fail-safe: it removes nothing and lets the next run
 * retry. No Identity email, tokens, or application content is logged.
 */
export async function reconcileDeletedIdentityAccounts(client: SupabaseClient): Promise<{ removed: number; invitationsRemoved: number; attempted: boolean }> {
  const identity = getIdentityAdminConfig();
  if (!identity) return { removed: 0, invitationsRemoved: 0, attempted: false };
  let identityUsers;
  try {
    identityUsers = await listIdentityAdminUsers(identity);
  } catch {
    return { removed: 0, invitationsRemoved: 0, attempted: false };
  }
  const [{ data: accounts, error: accountsError }, { data: invitations, error: invitationsError }] = await Promise.all([
    client.from("control_accounts").select("netlify_user_id"),
    client.from("control_beta_applications").select("id,email").eq("state", "invited").is("account_user_id", null),
  ]);
  if (accountsError || invitationsError) return { removed: 0, invitationsRemoved: 0, attempted: true };
  const identityIds = new Set(identityUsers.map((user) => user.id));
  const identityEmails = new Set(identityUsers.flatMap((user) => user.email ? [user.email] : []));
  let removed = 0;
  for (const account of accounts || []) {
    if (identityIds.has(account.netlify_user_id)) continue;
    const result = await client.rpc("control_remove_account", {
      p_actor_user_id: null,
      p_target_user_id: account.netlify_user_id,
      p_source: "identity_reconciliation",
    });
    if (!result.error && (result.data as { removed?: unknown } | null)?.removed === true) removed += 1;
  }
  let invitationsRemoved = 0;
  for (const invitation of invitations || []) {
    if (identityEmails.has(invitation.email.trim().toLowerCase())) continue;
    const result = await client.rpc("control_remove_invited_application", {
      p_actor_user_id: null,
      p_application_id: invitation.id,
      p_source: "identity_reconciliation",
    });
    if (!result.error && (result.data as { removed?: unknown } | null)?.removed === true) invitationsRemoved += 1;
  }
  return { removed, invitationsRemoved, attempted: true };
}
