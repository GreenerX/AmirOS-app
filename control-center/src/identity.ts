import {
  AUTH_EVENTS,
  acceptInvite,
  getSettings,
  getUser,
  handleAuthCallback,
  login,
  logout,
  onAuthChange,
  signup,
  updateUser,
} from "@netlify/identity";

export type ControlCenterUser = {
  id: string;
  email?: string;
  displayName?: string;
  roles: string[];
};

export type IdentityInitialisation = {
  user?: ControlCenterUser;
  invitationToken?: string;
  passwordRecovery?: boolean;
};

function mapUser(user: unknown): ControlCenterUser | undefined {
  if (!user || typeof user !== "object") return undefined;
  const value = user as {
    id?: unknown;
    email?: unknown;
    name?: unknown;
    roles?: unknown;
    userMetadata?: { full_name?: unknown };
    user_metadata?: { full_name?: unknown };
    app_metadata?: { roles?: unknown };
  };
  if (typeof value.id !== "string") return undefined;
  return {
    id: value.id,
    email: typeof value.email === "string" ? value.email : undefined,
    displayName: typeof value.name === "string"
      ? value.name
      : typeof value.userMetadata?.full_name === "string"
        ? value.userMetadata.full_name
        : typeof value.user_metadata?.full_name === "string"
          ? value.user_metadata.full_name
          : undefined,
    roles: Array.isArray(value.roles)
      ? value.roles.filter((role): role is string => typeof role === "string")
      : Array.isArray(value.app_metadata?.roles)
        ? value.app_metadata.roles.filter((role): role is string => typeof role === "string")
      : [],
  };
}

export async function initialiseIdentity(): Promise<IdentityInitialisation> {
  try {
    const callback = await handleAuthCallback();
    if (callback?.type === "invite" && callback.token) {
      return { invitationToken: callback.token };
    }
    if (callback?.type === "recovery") {
      return { user: mapUser(callback.user ?? await getUser()), passwordRecovery: true };
    }
    return { user: mapUser(callback?.user ?? await getUser()) };
  } catch {
    // Identity is intentionally unavailable during an ordinary Vite preview.
    return {};
  }
}

export async function isIdentityAvailable(): Promise<boolean> {
  try {
    await getSettings();
    return true;
  } catch {
    // Some hosted deployments can serve Identity before the client package's
    // settings request is ready. Confirm only the public service endpoint;
    // authentication itself continues to use @netlify/identity.
    try {
      const response = await fetch("/.netlify/identity/settings", { credentials: "same-origin" });
      return response.ok && response.headers.get("content-type")?.includes("application/json") === true;
    } catch {
      return false;
    }
  }
}

export function observeIdentity(onChange: (user: ControlCenterUser | undefined) => void): () => void {
  try {
    return onAuthChange((event, user) => {
      if (event === AUTH_EVENTS.LOGIN || event === AUTH_EVENTS.LOGOUT || event === AUTH_EVENTS.USER_UPDATED) {
        onChange(mapUser(user));
      }
    });
  } catch {
    // A Netlify deployment without Identity enabled should remain a usable sign-in screen.
    return () => undefined;
  }
}

export async function identityAllowsSignup(): Promise<boolean> {
  try {
    const settings = await getSettings();
    return !settings.disableSignup;
  } catch {
    return false;
  }
}

export async function signIn(email: string, password: string): Promise<ControlCenterUser | undefined> {
  return mapUser(await login(email, password));
}

export async function createAccount(email: string, password: string, name: string): Promise<ControlCenterUser | undefined> {
  return mapUser(await signup(email, password, { full_name: name }));
}

export async function acceptInvitation(token: string, password: string, fullName: string): Promise<ControlCenterUser | undefined> {
  const accepted = await acceptInvite(token, password);
  const cleanedName = fullName.trim();
  if (!cleanedName) return mapUser(accepted);
  return mapUser(await updateUser({ data: { full_name: cleanedName } }));
}

export async function resetPassword(password: string): Promise<ControlCenterUser | undefined> {
  return mapUser(await updateUser({ password }));
}

export async function signOut(): Promise<void> {
  await logout();
}
