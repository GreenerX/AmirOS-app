import type { Handler, HandlerContext, HandlerEvent } from "@netlify/functions";

/**
 * Identity lifecycle hooks are Netlify's one documented exception to the
 * modern default-export Function form. Roles belong in app_metadata because
 * browser-controlled user_metadata must never authorize an administrator.
 */
const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  const payload = JSON.parse(event.body || "{}") as { user?: { app_metadata?: Record<string, unknown> } };
  const existingRoles = payload.user?.app_metadata?.roles;
  const roles = Array.isArray(existingRoles)
    ? existingRoles.filter((role): role is string => typeof role === "string")
    : [];

  return {
    statusCode: 200,
    body: JSON.stringify({
      app_metadata: {
        ...payload.user?.app_metadata,
        // Keep any administrator role assigned by a Netlify operator before an
        // invite is accepted; ordinary signups receive the member role.
        roles: roles.length > 0 ? roles : ["member"],
      },
    }),
  };
};

export { handler };
