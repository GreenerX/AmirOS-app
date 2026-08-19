import type { AccountSnapshot, AdminOverview, BetaApplicationState, ReleaseChannel, ReleaseControlSnapshot, SupportTicket } from "./types";

type ApiResult<T> = { data?: T; message?: string; status: number };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") || false;
  const body = isJson
    ? await response.json().catch(() => ({})) as { message?: string } & T
    : undefined;
  if (response.ok && body) return { data: body, status: response.status };
  return { message: body?.message || "The Control Center API is unavailable in this preview.", status: response.status };
}

export function getAccountSnapshot(): Promise<ApiResult<AccountSnapshot>> {
  return request<AccountSnapshot>("/api/account");
}

export function getAdminOverview(): Promise<ApiResult<AdminOverview>> {
  return request<AdminOverview>("/api/admin/overview");
}

export function updateAdminUser(input: {
  userId: string;
  accessStatus?: "active" | "paused" | "revoked";
  releaseChannel?: "internal" | "beta" | "stable";
  featureId?: string;
  enabled?: boolean;
  firstName?: string;
  lastName?: string;
}): Promise<ApiResult<{ ok: true }>> {
  return request<{ ok: true }>("/api/admin/users", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteAdminUser(input: { userId: string }): Promise<ApiResult<{ removed: boolean }>> {
  return request<{ removed: boolean }>("/api/admin/users", {
    method: "DELETE",
    body: JSON.stringify({ ...input, confirmation: "delete" }),
  });
}

export function updateAdminDevice(input: {
  deviceId: string;
  accessStatus: "active" | "paused" | "revoked";
}): Promise<ApiResult<{ ok: true }>> {
  return request<{ ok: true }>("/api/admin/devices", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function updateAdminSupportTicket(input: {
  ticketId: number;
  state: SupportTicket["state"];
}): Promise<ApiResult<{ ok: true }>> {
  return request<{ ok: true }>("/api/admin/support-tickets", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function updateBetaApplication(input: {
  applicationId: string;
  state: BetaApplicationState;
}): Promise<ApiResult<{ ok: true }>> {
  return request<{ ok: true }>("/api/admin/applicants", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function createManualBetaApplication(input: { firstName: string; lastName: string; email: string; internalNote?: string }): Promise<ApiResult<{ application: unknown }>> {
  return request<{ application: unknown }>("/api/admin/applicants", { method: "POST", body: JSON.stringify({ ...input, action: "create_manual" }) });
}

export function updateBetaApplicationProfile(input: { applicationId: string; firstName: string; lastName: string; email: string; internalNote?: string }): Promise<ApiResult<{ application: unknown }>> {
  return request<{ application: unknown }>("/api/admin/applicants", { method: "PATCH", body: JSON.stringify({ ...input, action: "update_profile" }) });
}

export function archiveBetaApplication(input: { applicationId: string; archived: boolean }): Promise<ApiResult<{ application: unknown }>> {
  return request<{ application: unknown }>("/api/admin/applicants", { method: "PATCH", body: JSON.stringify({ applicationId: input.applicationId, action: input.archived ? "archive" : "restore" }) });
}

export function removeBetaApplicantIdentity(input: { applicationId: string; confirmation: string }): Promise<ApiResult<{ removed: boolean }>> {
  return request<{ removed: boolean }>("/api/admin/applicants", {
    method: "PATCH",
    body: JSON.stringify({ ...input, action: "remove_invited_identity" }),
  });
}

export function approveAndInviteBetaApplication(input: {
  applicationId: string;
}): Promise<ApiResult<{ ok: true; state: "invited"; invitedAt?: string; delivery: "sent" | "existing_account" }>> {
  return request<{ ok: true; state: "invited"; invitedAt?: string; delivery: "sent" | "existing_account" }>("/api/admin/applicants", {
    method: "PATCH",
    body: JSON.stringify({ ...input, action: "approve_and_invite" }),
  });
}

export function getAdminReleases(): Promise<ApiResult<ReleaseControlSnapshot>> {
  return request<ReleaseControlSnapshot>("/api/admin/releases");
}

export function createAdminRelease(input: {
  channel: ReleaseChannel;
  version: string;
  downloadUrl: string;
  sha256: string;
  releaseNotesUrl?: string;
}): Promise<ApiResult<{ release: unknown }>> {
  return request<{ release: unknown }>("/api/admin/releases", {
    method: "POST",
    body: JSON.stringify({ ...input, action: "create" }),
  });
}

export function setAdminReleaseChannel(input: {
  channel: ReleaseChannel;
  mode: "hold" | "available";
  releaseId?: number;
}): Promise<ApiResult<{ channel: unknown }>> {
  return request<{ channel: unknown }>("/api/admin/releases", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function approveDeviceActivation(activationCode: string): Promise<ApiResult<{ ok: true }>> {
  return request<{ ok: true }>("/api/devices/activation-approve", {
    method: "POST",
    body: JSON.stringify({ activationCode }),
  });
}

export function createSupportTicket(input: {
  type: SupportTicket["type"];
  subject: string;
  details: string;
}): Promise<ApiResult<{ ticket: SupportTicket }>> {
  return request<{ ticket: SupportTicket }>("/api/support-tickets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
