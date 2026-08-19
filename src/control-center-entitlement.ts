import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type ControlCenterAccessStatus = "unpaired" | "pending" | "active" | "paused" | "revoked" | "offline_grace" | "unavailable";
export type ControlCenterReleaseChannel = "internal" | "beta" | "stable";
export type ControlCenterSetupState = "setup_required" | "device_pending" | "active";
export type ControlCenterOnboardingEvent = "whatsapp_connected" | "first_people_selected";

/**
 * A release decision is supplied by the Control Center for managed beta
 * installs. It is deliberately separate from access: holding a release never
 * pauses AmirOS or changes what the owner can do locally.
 */
export type ControlCenterReleaseDecision = {
  action: "available" | "hold" | "none";
  channel: ControlCenterReleaseChannel;
  version?: string;
  downloadUrl?: string;
  sha256?: string;
  releaseNotesUrl?: string;
};

export type ControlCenterFeature = {
  id: string;
  enabled: boolean;
};

export type ControlCenterSnapshot = {
  configured: boolean;
  status: ControlCenterAccessStatus;
  detail: string;
  activationUrl?: string;
  activationExpiresAt?: string;
  checkedAt?: string;
  setupState: ControlCenterSetupState;
  activationRequired: boolean;
  releaseChannel?: ControlCenterReleaseChannel;
  release?: ControlCenterReleaseDecision;
  features: ControlCenterFeature[];
};

/**
 * A Control Center feature assignment is intentionally opt-in only after this
 * Mac has received a usable entitlement. Standalone and still-pairing copies
 * retain their local behaviour, while an assigned active Mac follows the
 * administrator's explicit setting.
 */
export function controlCenterFeatureEnabled(
  snapshot: Pick<ControlCenterSnapshot, "configured" | "status" | "setupState" | "features">,
  featureId: string,
): boolean {
  // A Control Center feature flag is authoritative only once this Mac is an
  // active, paired managed device. Every other state deliberately retains the
  // local product behaviour, including a temporarily unavailable control plane
  // or a Mac that has not completed its Control Center connection yet.
  if (!snapshot.configured || snapshot.status !== "active" || snapshot.setupState !== "active") return true;
  return snapshot.features.find((feature) => feature.id === featureId)?.enabled ?? true;
}

type EntitlementResponse = {
  status?: unknown;
  detail?: unknown;
  checkedAt?: unknown;
  releaseChannel?: unknown;
  release?: unknown;
  features?: unknown;
  setupState?: unknown;
};

type ActivationResponse = {
  expiresAt?: unknown;
};

type ActivationStatusResponse = {
  status?: unknown;
  expiresAt?: unknown;
};

type SavedEntitlement = {
  status: "active" | "paused" | "revoked";
  detail: string;
  checkedAt: string;
  releaseChannel?: ControlCenterReleaseChannel;
  release?: ControlCenterReleaseDecision;
  features: ControlCenterFeature[];
  setupState: ControlCenterSetupState;
};

type SavedDevice = {
  version: 1;
  deviceKey: string;
  deviceSecret: string;
  activation?: {
    code: string;
    expiresAt: string;
  };
  entitlement?: SavedEntitlement;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

const RECONNECTION_REQUIRED_CODE = "device_reconnection_required";

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponse>;

export type ControlCenterEntitlementOptions = {
  origin?: string;
  appVersion: string;
  filePath?: string;
  now?: () => number;
  fetcher?: FetchLike;
  /** New pilot installations may require pairing before normal AmirOS use. */
  requireActivation?: boolean;
};

const DEVICE_KEY_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const ACCESS_STATUSES = new Set(["active", "paused", "revoked"]);
const RELEASE_CHANNELS = new Set(["internal", "beta", "stable"]);
const RELEASE_ACTIONS = new Set(["available", "hold", "none"]);
const SETUP_STATES = new Set(["setup_required", "device_pending", "active"]);
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;
const ACTIVATION_LIFETIME_MS = 10 * 60 * 1_000;

function normalizedOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
    return url.toString().replace(/\/$/u, "");
  } catch {
    return undefined;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

function validFeatures(value: unknown): ControlCenterFeature[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((feature) => {
    if (!feature || typeof feature !== "object") return [];
    const candidate = feature as { id?: unknown; enabled?: unknown };
    if (typeof candidate.id !== "string" || !/^[a-z0-9-]{1,80}$/u.test(candidate.id) || typeof candidate.enabled !== "boolean") return [];
    return [{ id: candidate.id, enabled: candidate.enabled }];
  });
}

function validHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * The local client verifies the rollout decision again instead of trusting an
 * arbitrary server payload. An invalid decision fails closed: no update
 * prompt, no download and no change to the user's existing AmirOS access.
 */
export function validControlCenterReleaseDecision(value: unknown): ControlCenterReleaseDecision | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ControlCenterReleaseDecision>;
  if (!RELEASE_ACTIONS.has(candidate.action || "") || !RELEASE_CHANNELS.has(candidate.channel || "")) return undefined;
  const action = candidate.action as ControlCenterReleaseDecision["action"];
  const channel = candidate.channel as ControlCenterReleaseChannel;
  if (action !== "available") return { action, channel };
  const version = typeof candidate.version === "string" ? candidate.version.trim().replace(/^v/i, "") : "";
  const downloadUrl = validHttpsUrl(candidate.downloadUrl);
  const sha256 = typeof candidate.sha256 === "string" ? candidate.sha256.trim() : "";
  if (!/^\d+\.\d+\.\d+$/u.test(version) || !downloadUrl || !/^[a-f0-9]{64}$/u.test(sha256)) return undefined;
  const releaseNotesUrl = validHttpsUrl(candidate.releaseNotesUrl);
  return { action, channel, version, downloadUrl, sha256, ...(releaseNotesUrl ? { releaseNotesUrl } : {}) };
}

function validSavedDevice(value: unknown): SavedDevice | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SavedDevice>;
  if (candidate.version !== 1 || !DEVICE_KEY_PATTERN.test(candidate.deviceKey || "") || !DEVICE_KEY_PATTERN.test(candidate.deviceSecret || "")) return undefined;
  const activation = candidate.activation
    && typeof candidate.activation.code === "string"
    && DEVICE_KEY_PATTERN.test(candidate.activation.code)
    && validIsoTimestamp(candidate.activation.expiresAt)
      ? { code: candidate.activation.code, expiresAt: candidate.activation.expiresAt }
      : undefined;
  const entitlement = candidate.entitlement
    && ACCESS_STATUSES.has(candidate.entitlement.status || "")
    && typeof candidate.entitlement.detail === "string"
    && validIsoTimestamp(candidate.entitlement.checkedAt)
      ? {
          status: candidate.entitlement.status as SavedEntitlement["status"],
          detail: candidate.entitlement.detail.slice(0, 240),
          checkedAt: candidate.entitlement.checkedAt,
          releaseChannel: RELEASE_CHANNELS.has(candidate.entitlement.releaseChannel || "")
            ? candidate.entitlement.releaseChannel as ControlCenterReleaseChannel
            : undefined,
          release: validControlCenterReleaseDecision(candidate.entitlement.release),
          features: validFeatures(candidate.entitlement.features),
          // Existing paired installations predate the setup-state response and
          // must remain usable when their next entitlement refresh succeeds.
          setupState: SETUP_STATES.has(candidate.entitlement.setupState || "")
            ? candidate.entitlement.setupState as ControlCenterSetupState
            : "active",
        }
      : undefined;
  return { version: 1, deviceKey: candidate.deviceKey!, deviceSecret: candidate.deviceSecret!, activation, entitlement };
}

/**
 * Keeps the Control Center credential in a small, mode-0600 local file. It is
 * intentionally separate from AmirOS memory and never contains conversation
 * data, API keys, or WhatsApp material.
 */
export class ControlCenterEntitlement {
  private readonly origin: string | undefined;
  private readonly filePath: string;
  private readonly now: () => number;
  private readonly fetcher: FetchLike;
  private saved: SavedDevice | undefined;
  private transientDetail: string | undefined;

  constructor(private readonly options: ControlCenterEntitlementOptions) {
    this.origin = normalizedOrigin(options.origin);
    this.filePath = options.filePath || resolve("work/control-center-device.json");
    this.now = options.now || Date.now;
    this.fetcher = options.fetcher || fetch;
    this.saved = this.read();
  }

  snapshot(): ControlCenterSnapshot {
    if (!this.origin) {
      return { configured: false, status: "unpaired", detail: "Control Center connection is not configured for this AmirOS copy.", setupState: "setup_required", activationRequired: Boolean(this.options.requireActivation), features: [] };
    }
    const activation = this.saved?.activation;
    if (activation && Date.parse(activation.expiresAt) > this.now()) {
      return {
        configured: true,
        status: "pending",
        detail: "Finish approving this Mac in the Control Center.",
        activationUrl: `${this.origin}/connect/?code=${encodeURIComponent(activation.code)}`,
        activationExpiresAt: activation.expiresAt,
        setupState: "device_pending",
        activationRequired: Boolean(this.options.requireActivation),
        features: [],
      };
    }
    const entitlement = this.saved?.entitlement;
    if (!entitlement) {
      return { configured: true, status: "unpaired", detail: this.transientDetail || "Connect this Mac to your AmirOS account.", setupState: "setup_required", activationRequired: Boolean(this.options.requireActivation), features: [] };
    }
    if (entitlement.status === "paused" || entitlement.status === "revoked") {
      return {
        configured: true,
        status: entitlement.status,
        detail: entitlement.detail,
        checkedAt: entitlement.checkedAt,
        setupState: entitlement.setupState,
        activationRequired: Boolean(this.options.requireActivation),
        releaseChannel: entitlement.releaseChannel,
        release: entitlement.release,
        features: entitlement.features,
      };
    }
    const checkedAt = Date.parse(entitlement.checkedAt);
    const withinGrace = Number.isFinite(checkedAt) && this.now() - checkedAt <= OFFLINE_GRACE_MS;
    if (withinGrace) {
      return {
        configured: true,
        status: this.transientDetail ? "offline_grace" : "active",
        detail: this.transientDetail || entitlement.detail,
        checkedAt: entitlement.checkedAt,
        setupState: entitlement.setupState,
        activationRequired: Boolean(this.options.requireActivation),
        releaseChannel: entitlement.releaseChannel,
        release: entitlement.release,
        features: entitlement.features,
      };
    }
    return {
      configured: true,
      status: "unavailable",
      detail: "AmirOS needs to reconnect to the Control Center to confirm access.",
      checkedAt: entitlement.checkedAt,
      setupState: entitlement.setupState,
      activationRequired: Boolean(this.options.requireActivation),
      releaseChannel: entitlement.releaseChannel,
      release: entitlement.release,
      features: entitlement.features,
    };
  }

  blocksAssistant(): boolean {
    const snapshot = this.snapshot();
    return snapshot.status === "paused"
      || snapshot.status === "revoked"
      || snapshot.status === "unavailable"
      || (snapshot.activationRequired && snapshot.setupState !== "active");
  }

  isFeatureEnabled(featureId: string): boolean {
    return controlCenterFeatureEnabled(this.snapshot(), featureId);
  }

  async beginActivation(): Promise<ControlCenterSnapshot> {
    if (!this.origin) return this.snapshot();
    const saved = this.ensureDevice();
    const code = randomBytes(24).toString("base64url");
    const response = await this.request<ActivationResponse>("/api/devices/activation-start", {
      activationCode: code,
      deviceKey: saved.deviceKey,
      deviceSecret: saved.deviceSecret,
      label: "This Mac",
      platform: process.platform === "darwin" ? "macOS" : process.platform,
      appVersion: this.options.appVersion,
    });
    const expiresAt = validIsoTimestamp(response.expiresAt) || new Date(this.now() + ACTIVATION_LIFETIME_MS).toISOString();
    saved.activation = { code, expiresAt };
    this.saved = saved;
    this.transientDetail = undefined;
    this.write(saved);
    return this.snapshot();
  }

  async checkActivation(): Promise<ControlCenterSnapshot> {
    const saved = this.saved;
    const activation = saved?.activation;
    if (!this.origin || !saved || !activation) return this.snapshot();
    if (Date.parse(activation.expiresAt) <= this.now()) {
      saved.activation = undefined;
      this.write(saved);
      return this.snapshot();
    }
    const result = await this.request<ActivationStatusResponse>("/api/devices/activation-status", {
      activationCode: activation.code,
      deviceKey: saved.deviceKey,
      deviceSecret: saved.deviceSecret,
    });
    if (result.status === "approved") {
      saved.activation = undefined;
      this.write(saved);
      return this.refresh();
    }
    if (result.status === "expired") {
      saved.activation = undefined;
      this.write(saved);
      return this.snapshot();
    }
    const expiresAt = validIsoTimestamp(result.expiresAt);
    if (expiresAt) {
      if (saved.activation) {
        saved.activation.expiresAt = expiresAt;
        this.write(saved);
      }
    }
    return this.snapshot();
  }

  async refresh(): Promise<ControlCenterSnapshot> {
    if (!this.origin || !this.saved) return this.snapshot();
    try {
      const result = await this.request<EntitlementResponse>("/api/devices/entitlement", {
        deviceKey: this.saved.deviceKey,
        deviceSecret: this.saved.deviceSecret,
        label: "This Mac",
        platform: process.platform === "darwin" ? "macOS" : process.platform,
        appVersion: this.options.appVersion,
      });
      if (!ACCESS_STATUSES.has(result.status as string)) throw new Error("The Control Center returned an invalid access response.");
      const checkedAt = validIsoTimestamp(result.checkedAt) || new Date(this.now()).toISOString();
      this.saved.entitlement = {
        status: result.status as SavedEntitlement["status"],
        detail: typeof result.detail === "string" && result.detail.trim() ? result.detail.trim().slice(0, 240) : "Access checked by the Control Center.",
        checkedAt,
        releaseChannel: RELEASE_CHANNELS.has(result.releaseChannel as string) ? result.releaseChannel as ControlCenterReleaseChannel : undefined,
        release: validControlCenterReleaseDecision(result.release),
        features: validFeatures(result.features),
        setupState: SETUP_STATES.has(result.setupState as string)
          ? result.setupState as ControlCenterSetupState
          : "active",
      };
      this.transientDetail = undefined;
      this.write(this.saved);
    } catch (error) {
      // A managed device that has been removed in the Control Center is not
      // merely offline. Discard its previous credential immediately so it
      // cannot retain an old entitlement, feature assignment, or release
      // decision during offline grace. This does not touch any local AmirOS
      // data; the owner can reconnect this Mac from the recovery controls.
      if (error instanceof ControlCenterRequestError
        && error.status === 401
        && error.code === RECONNECTION_REQUIRED_CODE) {
        this.forgetThisMac();
        this.transientDetail = "This Mac was removed from the Control Center. Reconnect it to continue.";
        return this.snapshot();
      }
      this.transientDetail = error instanceof Error ? error.message : "AmirOS could not reach the Control Center right now.";
    }
    return this.snapshot();
  }

  forgetThisMac(): ControlCenterSnapshot {
    this.saved = undefined;
    this.transientDetail = undefined;
    if (existsSync(this.filePath) && !lstatSync(this.filePath).isSymbolicLink()) unlinkSync(this.filePath);
    return this.snapshot();
  }

  /**
   * A revoked device must present a new opaque device credential before it can
   * be approved again. This removes only the Control Center credential; it
   * deliberately preserves WhatsApp, local AmirOS data, and the OpenAI key.
   */
  async reconnectThisMac(): Promise<ControlCenterSnapshot> {
    this.forgetThisMac();
    return this.beginActivation();
  }

  /**
   * Sends a tester-authored, privacy-redacted support report only after the
   * dashboard explicitly asks to submit it. The persisted device credential
   * is never exposed through the dashboard response.
   */
  async submitSupportTicket(input: {
    type: "Bug" | "Feedback" | "Feature request" | "Setup help";
    subject: string;
    details: string;
  }): Promise<{
    ticket: { ticketId: number; id: string; type: string; subject: string; details: string; state: string; createdAt: string; updatedAt: string };
  }> {
    const snapshot = this.snapshot();
    if (!this.origin || !this.saved) throw new ControlCenterRequestError(401, "Connect this Mac before sending a support request.");
    if (snapshot.status === "paused" || snapshot.status === "revoked" || snapshot.setupState !== "active") {
      throw new ControlCenterRequestError(403, "Connect and approve this Mac before sending a support request.");
    }
    if (snapshot.status === "unavailable") throw new ControlCenterRequestError(503, "AmirOS support is unavailable right now. Please try again shortly.");
    return this.request("/api/devices/support-tickets", {
      deviceKey: this.saved.deviceKey,
      deviceSecret: this.saved.deviceSecret,
      label: "This Mac",
      platform: process.platform === "darwin" ? "macOS" : process.platform,
      appVersion: this.options.appVersion,
      type: input.type,
      subject: input.subject,
      details: input.details,
    });
  }

  /**
   * Advances the signed-in tester's informational beta checklist after a real
   * local milestone. Only the event name and ordinary device metadata leave
   * the Mac; this never changes access, entitlements, or feature assignments.
   */
  async reportOnboardingProgress(event: ControlCenterOnboardingEvent): Promise<{
    event: ControlCenterOnboardingEvent;
    activation: unknown;
  }> {
    const snapshot = this.snapshot();
    if (!this.origin || !this.saved) throw new ControlCenterRequestError(401, "Connect this Mac before updating beta setup progress.");
    if (snapshot.status === "paused" || snapshot.status === "revoked" || snapshot.setupState !== "active") {
      throw new ControlCenterRequestError(403, "Connect and approve this Mac before updating beta setup progress.");
    }
    if (snapshot.status === "unavailable") throw new ControlCenterRequestError(503, "The beta checklist is unavailable right now.");
    return this.request("/api/devices/onboarding-progress", {
      deviceKey: this.saved.deviceKey,
      deviceSecret: this.saved.deviceSecret,
      label: "This Mac",
      platform: process.platform === "darwin" ? "macOS" : process.platform,
      appVersion: this.options.appVersion,
      event,
    });
  }

  private ensureDevice(): SavedDevice {
    if (this.saved) return this.saved;
    const created: SavedDevice = {
      version: 1,
      deviceKey: randomBytes(32).toString("base64url"),
      deviceSecret: randomBytes(32).toString("base64url"),
    };
    this.saved = created;
    this.write(created);
    return created;
  }

  private read(): SavedDevice | undefined {
    if (!existsSync(this.filePath) || lstatSync(this.filePath).isSymbolicLink()) return undefined;
    try {
      return validSavedDevice(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch {
      return undefined;
    }
  }

  private write(value: SavedDevice): void {
    if (existsSync(this.filePath) && lstatSync(this.filePath).isSymbolicLink()) {
      throw new Error("AmirOS will not save Control Center access through a symbolic link.");
    }
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${hash(value.deviceKey).slice(0, 12)}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.filePath);
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    if (!this.origin) throw new Error("Control Center connection is not configured.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await this.fetcher(`${this.origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as { message?: unknown; code?: unknown } & T;
      if (!response.ok) {
        const code = typeof payload.code === "string" && /^[a-z0-9_]{1,80}$/u.test(payload.code)
          ? payload.code
          : undefined;
        throw new ControlCenterRequestError(response.status, typeof payload.message === "string" ? payload.message : "AmirOS could not reach the Control Center right now.", code);
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class ControlCenterRequestError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = "ControlCenterRequestError";
  }
}
