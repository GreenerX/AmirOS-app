import { describe, expect, it } from "vitest";
import { buildActivationChecklist } from "../control-center/netlify/functions/_shared/activation-checklist.js";

describe("Control Center beta checklist", () => {
  it("guides an approved Mac through WhatsApp and optional People setup without changing access", () => {
    const accountCreatedAt = "2026-08-18T08:00:00.000Z";
    const firstSeenAt = "2026-08-18T08:05:00.000Z";
    const beforeWhatsApp = buildActivationChecklist({
      accountCreatedAt,
      setupState: "active",
      devices: [{ firstSeenAt, whatsappConnectedAt: null, firstPeopleSelectedAt: null }],
    });
    expect(beforeWhatsApp.completedCount).toBe(3);
    expect(beforeWhatsApp.nextAction).toMatchObject({ id: "connect_whatsapp", target: "local_amiros" });

    const afterWhatsApp = buildActivationChecklist({
      accountCreatedAt,
      setupState: "active",
      devices: [{ firstSeenAt, whatsappConnectedAt: "2026-08-18T08:10:00.000Z", firstPeopleSelectedAt: null }],
    });
    expect(afterWhatsApp.completedCount).toBe(4);
    expect(afterWhatsApp.nextAction).toMatchObject({ id: "choose_people", target: "local_amiros" });

    const complete = buildActivationChecklist({
      accountCreatedAt,
      setupState: "active",
      devices: [{
        firstSeenAt,
        whatsappConnectedAt: "2026-08-18T08:10:00.000Z",
        firstPeopleSelectedAt: "2026-08-18T08:20:00.000Z",
      }],
    });
    expect(complete.completedCount).toBe(5);
    expect(complete.nextAction).toMatchObject({ id: "complete", target: "none" });
  });

  it("does not treat informational WhatsApp or People milestones as Mac approval", () => {
    const checklist = buildActivationChecklist({
      accountCreatedAt: "2026-08-18T08:00:00.000Z",
      setupState: "device_pending",
      devices: [{
        firstSeenAt: "2026-08-18T08:05:00.000Z",
        whatsappConnectedAt: null,
        firstPeopleSelectedAt: null,
      }],
    });
    expect(checklist.completedCount).toBe(1);
    expect(checklist.nextAction).toMatchObject({ id: "connect_mac", target: "control_center_connect" });
    expect(checklist.steps.find((step) => step.id === "whatsapp_connected")?.state).toBe("upcoming");
  });
});
