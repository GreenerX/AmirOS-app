import { getUser } from "@netlify/identity";
import { json } from "./http";
import type { ControlCenterIdentity } from "./supabase";

type AuthenticatedUser = ControlCenterIdentity;

export async function requireUser(): Promise<AuthenticatedUser | Response> {
  const user = await getUser() as {
    id?: unknown;
    email?: unknown;
    name?: unknown;
    roles?: unknown;
    userMetadata?: { full_name?: unknown };
    user_metadata?: { full_name?: unknown };
    app_metadata?: { roles?: unknown };
  } | null;
  if (!user || typeof user.id !== "string") return json({ message: "Sign in is required." }, 401);
  return {
    id: user.id,
    email: typeof user.email === "string" ? user.email : undefined,
    displayName: typeof user.name === "string"
      ? user.name
      : typeof user.userMetadata?.full_name === "string"
        ? user.userMetadata.full_name
        : typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : undefined,
    // Netlify Identity exposes roles at the top level for the current SDK,
    // while older tokens carry them in app_metadata. Accept both so the
    // client and server agree on administrator access during the transition.
    roles: Array.isArray(user.roles)
      ? user.roles.filter((role): role is string => typeof role === "string")
      : Array.isArray(user.app_metadata?.roles)
        ? user.app_metadata.roles.filter((role): role is string => typeof role === "string")
        : [],
  };
}

export async function requireAdmin(): Promise<AuthenticatedUser | Response> {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return user.roles.includes("admin") ? user : json({ message: "Administrator access is required." }, 403);
}
