import { getIdentityConfig } from "@netlify/identity";

export type IdentityAdminUser = {
  id: string;
  email?: string;
  roles: string[];
};

type IdentityAdminConfig = { url: string; token: string };
type IdentityUserPayload = {
  id?: unknown;
  email?: unknown;
  roles?: unknown;
  app_metadata?: { roles?: unknown };
};
type IdentityUserListPayload = { users?: IdentityUserPayload[] };

export function getIdentityAdminConfig(): IdentityAdminConfig | undefined {
  const identity = getIdentityConfig();
  if (!identity?.url || !identity.token) return undefined;
  return { url: identity.url, token: identity.token };
}

function asIdentityUser(value: IdentityUserPayload): IdentityAdminUser | undefined {
  if (typeof value.id !== "string") return undefined;
  const candidateRoles = Array.isArray(value.roles)
    ? value.roles
    : Array.isArray(value.app_metadata?.roles)
      ? value.app_metadata.roles
      : [];
  return {
    id: value.id,
    email: typeof value.email === "string" ? value.email.trim().toLowerCase() || undefined : undefined,
    roles: candidateRoles.filter((role): role is string => typeof role === "string"),
  };
}

function headers(identity: IdentityAdminConfig): HeadersInit {
  return { Authorization: `Bearer ${identity.token}` };
}

export async function getIdentityAdminUser(identity: IdentityAdminConfig, userId: string): Promise<IdentityAdminUser | "missing"> {
  const response = await fetch(`${identity.url}/admin/users/${encodeURIComponent(userId)}`, { headers: headers(identity) });
  if (response.status === 404) return "missing";
  if (!response.ok) throw new Error("identity_user_lookup_failed");
  const payload = await response.json().catch((): IdentityUserPayload => ({})) as IdentityUserPayload;
  const user = asIdentityUser(payload);
  if (!user) throw new Error("identity_user_invalid");
  return user;
}

/** Lists IDs only. The bounded pagination protects the scheduled function. */
export async function listIdentityAdminUsers(identity: IdentityAdminConfig): Promise<IdentityAdminUser[]> {
  const users: IdentityAdminUser[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(`${identity.url}/admin/users?per_page=100&page=${page}`, { headers: headers(identity) });
    if (!response.ok) throw new Error("identity_users_list_failed");
    const payload = await response.json().catch((): IdentityUserListPayload => ({})) as IdentityUserListPayload;
    const batch = Array.isArray(payload.users) ? payload.users.flatMap((item) => {
      const user = asIdentityUser(item);
      return user && !seen.has(user.id) ? [user] : [];
    }) : [];
    for (const user of batch) seen.add(user.id);
    users.push(...batch);
    if (!Array.isArray(payload.users) || payload.users.length < 100 || batch.length === 0) break;
  }
  return users;
}

export async function deleteIdentityAdminUser(identity: IdentityAdminConfig, userId: string): Promise<"deleted" | "missing"> {
  const response = await fetch(`${identity.url}/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: headers(identity),
  });
  if (response.status === 404) return "missing";
  if (!response.ok) throw new Error("identity_user_delete_failed");
  return "deleted";
}

export async function findIdentityAdminUserByEmail(identity: IdentityAdminConfig, email: string): Promise<IdentityAdminUser | "missing"> {
  const normalized = email.trim().toLowerCase();
  const users = await listIdentityAdminUsers(identity);
  return users.find((user) => user.email === normalized) || "missing";
}
