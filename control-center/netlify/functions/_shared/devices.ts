import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { json } from "./http";

export type DeviceActivationInput = {
  activationCode: string;
  deviceKey: string;
  deviceSecret: string;
  label: string;
  platform: string;
  appVersion: string;
};

export type DeviceCredentialInput = Omit<DeviceActivationInput, "activationCode">;
export type DeviceActivationProof = Pick<DeviceActivationInput, "activationCode" | "deviceKey" | "deviceSecret">;

export type AuthenticatedDevice = {
  id: string;
  accountId: string;
  label: string;
  platform: string;
  appVersion: string;
  accessStatus: "active" | "paused" | "revoked";
  revokedAt: string | null;
  account: {
    accessStatus: "active" | "paused" | "revoked";
    setupState: "setup_required" | "device_pending" | "active";
    releaseChannel: "internal" | "beta" | "stable";
  };
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;

export function deviceHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cleanText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/gu, " ").trim();
  return cleaned && cleaned.length <= maximum ? cleaned : undefined;
}

export function parseDeviceActivation(value: unknown): DeviceActivationInput | Response {
  if (!value || typeof value !== "object") return json({ message: "A device activation request is required." }, 400);
  const input = value as Record<string, unknown>;
  const activationCode = typeof input.activationCode === "string" ? input.activationCode : "";
  const deviceKey = typeof input.deviceKey === "string" ? input.deviceKey : "";
  const deviceSecret = typeof input.deviceSecret === "string" ? input.deviceSecret : "";
  const label = cleanText(input.label, 120);
  const platform = cleanText(input.platform, 80);
  const appVersion = cleanText(input.appVersion, 80);
  if (!TOKEN_PATTERN.test(activationCode) || !TOKEN_PATTERN.test(deviceKey) || !TOKEN_PATTERN.test(deviceSecret) || !label || !platform || !appVersion) {
    return json({ message: "The device activation request is invalid." }, 400);
  }
  return { activationCode, deviceKey, deviceSecret, label, platform, appVersion };
}

export function parseDeviceCredential(value: unknown): DeviceCredentialInput | Response {
  if (!value || typeof value !== "object") return json({ message: "A device credential is required." }, 400);
  const input = value as Record<string, unknown>;
  const deviceKey = typeof input.deviceKey === "string" ? input.deviceKey : "";
  const deviceSecret = typeof input.deviceSecret === "string" ? input.deviceSecret : "";
  const label = cleanText(input.label, 120);
  const platform = cleanText(input.platform, 80);
  const appVersion = cleanText(input.appVersion, 80);
  if (!TOKEN_PATTERN.test(deviceKey) || !TOKEN_PATTERN.test(deviceSecret) || !label || !platform || !appVersion) {
    return json({ message: "The device credential is invalid." }, 400);
  }
  return { deviceKey, deviceSecret, label, platform, appVersion };
}

export function parseDeviceActivationProof(value: unknown): DeviceActivationProof | Response {
  if (!value || typeof value !== "object") return json({ message: "A device activation request is required." }, 400);
  const input = value as Record<string, unknown>;
  const activationCode = typeof input.activationCode === "string" ? input.activationCode : "";
  const deviceKey = typeof input.deviceKey === "string" ? input.deviceKey : "";
  const deviceSecret = typeof input.deviceSecret === "string" ? input.deviceSecret : "";
  if (!TOKEN_PATTERN.test(activationCode) || !TOKEN_PATTERN.test(deviceKey) || !TOKEN_PATTERN.test(deviceSecret)) {
    return json({ message: "The device activation request is invalid." }, 400);
  }
  return { activationCode, deviceKey, deviceSecret };
}

export function validActivationCode(value: unknown): string | undefined {
  return typeof value === "string" && TOKEN_PATTERN.test(value) ? value : undefined;
}

export function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Validates a Mac's opaque credential without accepting a user-controlled
 * account identifier. Consumers decide which account/device states they allow.
 */
export async function authenticateDevice(
  client: SupabaseClient,
  input: DeviceCredentialInput,
): Promise<AuthenticatedDevice | Response> {
  const { data: device, error: deviceError } = await client
    .from("control_devices")
    .select("id,account_id,label,platform,app_version,access_status,revoked_at")
    .eq("device_key", input.deviceKey)
    .maybeSingle();
  if (deviceError) return json({ message: "The Control Center database is temporarily unavailable. Please try again shortly." }, 503);
  if (!device) return json({ message: "This Mac is not approved yet." }, 401);

  const { data: credential, error: credentialError } = await client
    .from("control_device_credentials")
    .select("device_secret_hash")
    .eq("device_id", device.id)
    .maybeSingle();
  if (credentialError) return json({ message: "The Control Center database is temporarily unavailable. Please try again shortly." }, 503);
  if (!credential || !hashesMatch(credential.device_secret_hash, deviceHash(input.deviceSecret))) {
    return json({ message: "This Mac is not approved yet." }, 401);
  }

  const { data: account, error: accountError } = await client
    .from("control_accounts")
    .select("access_status,setup_state,release_channel")
    .eq("netlify_user_id", device.account_id)
    .maybeSingle();
  if (accountError || !account) return json({ message: "The Control Center database is temporarily unavailable. Please try again shortly." }, 503);

  return {
    id: device.id,
    accountId: device.account_id,
    label: device.label,
    platform: device.platform,
    appVersion: device.app_version,
    accessStatus: device.revoked_at ? "revoked" : device.access_status,
    revokedAt: device.revoked_at,
    account: {
      accessStatus: account.access_status,
      setupState: account.setup_state,
      releaseChannel: account.release_channel,
    },
  };
}
