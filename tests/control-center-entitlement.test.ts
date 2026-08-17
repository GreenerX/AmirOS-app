import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ControlCenterEntitlement, controlCenterFeatureEnabled } from "../src/control-center-entitlement.js";

type RecordedRequest = { url: string; body: Record<string, unknown> };

function response(payload: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => payload };
}

describe("ControlCenterEntitlement", () => {
  it("applies explicit feature assignments only after this Mac has an entitlement", () => {
    expect(controlCenterFeatureEnabled({ configured: false, status: "unpaired", features: [] }, "auto-mode")).toBe(true);
    expect(controlCenterFeatureEnabled({ configured: true, status: "pending", features: [] }, "auto-mode")).toBe(true);
    expect(controlCenterFeatureEnabled({ configured: true, status: "active", features: [{ id: "auto-mode", enabled: false }] }, "auto-mode")).toBe(false);
    expect(controlCenterFeatureEnabled({ configured: true, status: "offline_grace", features: [{ id: "auto-mode", enabled: true }] }, "auto-mode")).toBe(true);
  });

  it("keeps an unconfigured copy local and does not create a credential", () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-control-center-"));
    try {
      const entitlement = new ControlCenterEntitlement({ appVersion: "0.10.8", filePath: join(directory, "device.json") });
      expect(entitlement.snapshot()).toMatchObject({ configured: false, status: "unpaired" });
      expect(entitlement.blocksAssistant()).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("can require an approved Mac for new managed beta packages without changing old local copies", () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-control-center-"));
    try {
      const entitlement = new ControlCenterEntitlement({
        origin: "https://control.example.com",
        appVersion: "0.10.8",
        filePath: join(directory, "device.json"),
        requireActivation: true,
      });
      expect(entitlement.snapshot()).toMatchObject({ status: "unpaired", setupState: "setup_required", activationRequired: true });
      expect(entitlement.blocksAssistant()).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates a private device credential and waits for signed-in approval", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-control-center-"));
    const requests: RecordedRequest[] = [];
    try {
      const entitlement = new ControlCenterEntitlement({
        origin: "https://control.example.com",
        appVersion: "0.10.8",
        filePath: join(directory, "device.json"),
        now: () => Date.parse("2026-08-17T00:01:00.000Z"),
        fetcher: async (url, init) => {
          requests.push({ url, body: JSON.parse(String(init?.body || "{}")) });
          return response({ expiresAt: "2026-08-17T00:10:00.000Z" });
        },
      });
      const snapshot = await entitlement.beginActivation();
      expect(snapshot).toMatchObject({ configured: true, status: "pending" });
      expect(snapshot.activationUrl).toMatch(/^https:\/\/control\.example\.com\/connect\/\?code=/);
      expect(requests[0]?.url).toBe("https://control.example.com/api/devices/activation-start");
      expect(typeof requests[0]?.body.deviceKey).toBe("string");
      expect(typeof requests[0]?.body.deviceSecret).toBe("string");
      expect(JSON.stringify(snapshot)).not.toContain(String(requests[0]?.body.deviceSecret));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("enforces a paused or revoked entitlement while preserving private local data", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-control-center-"));
    let status = "active";
    try {
      const entitlement = new ControlCenterEntitlement({
        origin: "https://control.example.com",
        appVersion: "0.10.8",
        filePath: join(directory, "device.json"),
        now: () => Date.parse("2026-08-17T00:01:00.000Z"),
        fetcher: async (url) => {
          if (url.endsWith("activation-start")) return response({});
          if (url.endsWith("activation-status")) return response({ status: "approved" });
          return response({
            status,
            detail: status === "active" ? "This Mac is approved." : "Access was changed in the Control Center.",
            checkedAt: "2026-08-17T00:00:00.000Z",
            releaseChannel: "beta",
            features: [{ id: "memory-control", enabled: true }],
          });
        },
      });
      await entitlement.beginActivation();
      await entitlement.checkActivation();
      expect(entitlement.snapshot()).toMatchObject({ status: "active", releaseChannel: "beta" });
      expect(entitlement.blocksAssistant()).toBe(false);

      status = "revoked";
      await entitlement.refresh();
      expect(entitlement.snapshot()).toMatchObject({ status: "revoked" });
      expect(entitlement.blocksAssistant()).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("starts a new approval with a new device credential after a Mac is revoked", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-control-center-"));
    const requests: RecordedRequest[] = [];
    try {
      const entitlement = new ControlCenterEntitlement({
        origin: "https://control.example.com",
        appVersion: "0.10.8",
        filePath: join(directory, "device.json"),
        fetcher: async (url, init) => {
          const body = JSON.parse(String(init?.body || "{}"));
          requests.push({ url, body });
          if (url.endsWith("activation-start")) return response({ expiresAt: "2030-01-01T00:10:00.000Z" });
          if (url.endsWith("activation-status")) return response({ status: "approved" });
          return response({ status: "revoked", detail: "Access revoked", checkedAt: "2026-08-17T00:00:00.000Z", setupState: "active", features: [] });
        },
      });
      await entitlement.beginActivation();
      await entitlement.checkActivation();
      expect(entitlement.snapshot().status).toBe("revoked");
      const snapshot = await entitlement.reconnectThisMac();
      expect(snapshot).toMatchObject({ status: "pending", setupState: "device_pending" });
      const activationRequests = requests.filter((request) => request.url.endsWith("activation-start"));
      expect(activationRequests).toHaveLength(2);
      expect(activationRequests[1]?.body.deviceKey).not.toBe(activationRequests[0]?.body.deviceKey);
      expect(activationRequests[1]?.body.deviceSecret).not.toBe(activationRequests[0]?.body.deviceSecret);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("sends only an explicit support report from an active paired device", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-control-center-"));
    const requests: RecordedRequest[] = [];
    try {
      const entitlement = new ControlCenterEntitlement({
        origin: "https://control.example.com",
        appVersion: "0.10.8",
        filePath: join(directory, "device.json"),
        fetcher: async (url, init) => {
          const body = JSON.parse(String(init?.body || "{}"));
          requests.push({ url, body });
          if (url.endsWith("activation-start")) return response({ expiresAt: "2030-01-01T00:10:00.000Z" });
          if (url.endsWith("activation-status")) return response({ status: "approved" });
          if (url.endsWith("entitlement")) return response({ status: "active", detail: "Approved", checkedAt: "2026-08-17T00:00:00.000Z", setupState: "active", features: [] });
          return response({ ticket: { ticketId: 42, id: "SUP-42", type: "Bug", subject: "Dashboard", details: "It did not load", state: "New", createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-17T00:00:00.000Z" } }, true, 201);
        },
      });
      await entitlement.beginActivation();
      await entitlement.checkActivation();
      const result = await entitlement.submitSupportTicket({ type: "Bug", subject: "Dashboard", details: "It did not load" });
      expect(result.ticket.id).toBe("SUP-42");
      const support = requests.find((request) => request.url.endsWith("support-tickets"));
      expect(support?.body).toMatchObject({ type: "Bug", subject: "Dashboard", details: "It did not load" });
      expect(JSON.stringify(support?.body)).not.toContain("amiros-state");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports only a named onboarding milestone from an active paired device", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-control-center-"));
    const requests: RecordedRequest[] = [];
    try {
      const entitlement = new ControlCenterEntitlement({
        origin: "https://control.example.com",
        appVersion: "0.10.8",
        filePath: join(directory, "device.json"),
        fetcher: async (url, init) => {
          const body = JSON.parse(String(init?.body || "{}"));
          requests.push({ url, body });
          if (url.endsWith("activation-start")) return response({ expiresAt: "2030-01-01T00:10:00.000Z" });
          if (url.endsWith("activation-status")) return response({ status: "approved" });
          if (url.endsWith("entitlement")) return response({ status: "active", detail: "Approved", checkedAt: "2026-08-17T00:00:00.000Z", setupState: "active", features: [] });
          return response({ event: body.event, activation: { completedCount: 4, totalCount: 5 } });
        },
      });
      await entitlement.beginActivation();
      await entitlement.checkActivation();
      await entitlement.reportOnboardingProgress("whatsapp_connected");
      const progress = requests.find((request) => request.url.endsWith("onboarding-progress"));
      expect(progress?.body).toMatchObject({
        label: "This Mac",
        appVersion: "0.10.8",
        event: "whatsapp_connected",
      });
      expect(Object.keys(progress?.body || {}).sort()).toEqual([
        "appVersion", "deviceKey", "deviceSecret", "event", "label", "platform",
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
