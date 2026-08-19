import type { Config, Context } from "@netlify/functions";
import { requireAdmin } from "./_shared/auth";
import { buildActivationChecklist } from "./_shared/activation-checklist";
import { reconcileDeletedIdentityAccounts } from "./_shared/identity-reconciliation";
import { databaseUnavailable, ensureControlAccount, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "AC";
  return source.split(/[ ._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "AC";
}

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== "GET") return methodNotAllowed();
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const operator = await ensureControlAccount(client, admin);
  if (operator instanceof Response) return operator;
  await reconcileDeletedIdentityAccounts(client);

  const [accountsResult, devicesResult, definitionsResult, assignmentsResult, ticketsResult, applicationsResult] = await Promise.all([
    client.from("control_accounts").select("netlify_user_id,email,display_name,first_name,last_name,access_status,setup_state,release_channel,created_at").order("created_at", { ascending: false }),
    client.from("control_devices").select("id,account_id,label,platform,app_version,first_seen_at,last_seen_at,access_status,revoked_at,whatsapp_connected_at,first_people_selected_at").order("last_seen_at", { ascending: false }),
    client.from("control_feature_definitions").select("feature_key,name,description,default_enabled").order("feature_key"),
    client.from("control_feature_assignments").select("account_id,feature_key,enabled"),
    client.from("control_support_tickets").select("id,account_id,type,subject,details,state,created_at,updated_at").order("created_at", { ascending: false }).limit(25),
    client.from("control_beta_applications").select("id,full_name,first_name,last_name,email,interest,source,internal_note,archived_at,state,created_at,approved_at,invited_at,account_user_id").order("created_at", { ascending: false }).limit(100),
  ]);
  if (accountsResult.error || devicesResult.error || definitionsResult.error || assignmentsResult.error || ticketsResult.error || applicationsResult.error) return databaseUnavailable();

  const devicesByAccount = new Map<string, Array<{
    id: string;
    label: string;
    platform: string;
    appVersion: string;
    firstSeenAt: string;
    lastSeenAt: string;
    status: "active" | "paused" | "revoked";
    whatsappConnectedAt: string | null;
    firstPeopleSelectedAt: string | null;
  }>>();
  for (const device of devicesResult.data || []) {
    const devices = devicesByAccount.get(device.account_id) || [];
    devices.push({
      id: device.id,
      label: device.label,
      platform: device.platform,
      appVersion: device.app_version,
      firstSeenAt: device.first_seen_at,
      lastSeenAt: device.last_seen_at,
      status: device.revoked_at ? "revoked" : device.access_status,
      whatsappConnectedAt: device.whatsapp_connected_at,
      firstPeopleSelectedAt: device.first_people_selected_at,
    });
    devicesByAccount.set(device.account_id, devices);
  }
  const assignments = new Map<string, boolean>();
  for (const assignment of assignmentsResult.data || []) assignments.set(`${assignment.account_id}:${assignment.feature_key}`, assignment.enabled);
  const features = definitionsResult.data || [];

  return json({
    users: (accountsResult.data || []).map((account) => {
      const devices = devicesByAccount.get(account.netlify_user_id) || [];
      const device = devices.find((item) => item.status !== "revoked") || devices[0];
      return {
        id: account.netlify_user_id,
        initials: initials(account.display_name, account.email),
        displayName: account.display_name || account.email,
        firstName: account.first_name || undefined,
        lastName: account.last_name || undefined,
        email: account.email,
        status: account.access_status,
        setupState: account.setup_state,
        lastSeen: device?.lastSeenAt || "Not yet signed in on a device",
        releaseChannel: account.release_channel,
        appVersion: device?.appVersion || "—",
        addedAt: account.created_at,
        devices: devices.map(({ firstSeenAt: _firstSeenAt, whatsappConnectedAt: _whatsappConnectedAt, firstPeopleSelectedAt: _firstPeopleSelectedAt, ...device }) => device),
        activation: buildActivationChecklist({
          accountCreatedAt: account.created_at,
          setupState: account.setup_state,
          devices,
        }),
        features: features.map((feature) => ({
          id: feature.feature_key,
          name: feature.name,
          description: feature.description,
          enabled: assignments.get(`${account.netlify_user_id}:${feature.feature_key}`) ?? feature.default_enabled,
        })),
      };
    }),
    tickets: (ticketsResult.data || []).map((ticket) => {
      const reporter = (accountsResult.data || []).find((account) => account.netlify_user_id === ticket.account_id);
      return {
        ticketId: ticket.id,
        id: `SUP-${String(ticket.id).padStart(3, "0")}`,
        type: ticket.type,
        subject: ticket.subject,
        details: ticket.details,
        state: ticket.state,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        reporter: reporter?.display_name || reporter?.email || "AmirOS tester",
        reporterEmail: reporter?.email || "",
      };
    }),
    applications: (applicationsResult.data || []).map((application) => ({
      id: application.id,
        fullName: application.full_name,
        firstName: application.first_name || undefined,
        lastName: application.last_name || undefined,
        email: application.email,
        source: application.source === "manual" ? "manual" : "landing",
        internalNote: application.internal_note || undefined,
        archivedAt: application.archived_at || undefined,
      interest: application.interest || undefined,
      state: application.state,
      requestedAt: application.created_at,
      approvedAt: application.approved_at || undefined,
      invitedAt: application.invited_at || undefined,
      accountId: application.account_user_id || undefined,
    })),
  });
};

export const config: Config = { path: "/api/admin/overview", method: ["GET"] };
