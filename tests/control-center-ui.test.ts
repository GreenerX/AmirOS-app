import { describe, expect, it } from "vitest";
import { requiresControlCenterActivation, shouldShowControlCenterAccess } from "../ui/src/control-center-access.js";

describe("Control Center activation gate", () => {
  it("only gates explicitly managed beta packages until the Mac is active", () => {
    expect(requiresControlCenterActivation({ configured: true, activationRequired: true, setupState: "setup_required", status: "unpaired", detail: "Connect", features: [] })).toBe(true);
    expect(requiresControlCenterActivation({ configured: true, activationRequired: true, setupState: "device_pending", status: "pending", detail: "Approve", features: [] })).toBe(true);
    expect(requiresControlCenterActivation({ configured: true, activationRequired: true, setupState: "active", status: "active", detail: "Ready", features: [] })).toBe(false);
    expect(requiresControlCenterActivation({ configured: true, activationRequired: false, setupState: "setup_required", status: "unpaired", detail: "Connect", features: [] })).toBe(false);
  });

  it("keeps a connection and recovery path visible whenever the Control Center is configured", () => {
    expect(shouldShowControlCenterAccess({ configured: false, activationRequired: false, setupState: "setup_required", status: "unpaired", detail: "Local", features: [] })).toBe(false);
    expect(shouldShowControlCenterAccess({ configured: true, activationRequired: false, setupState: "setup_required", status: "unpaired", detail: "Local", features: [] })).toBe(true);
    expect(shouldShowControlCenterAccess({ configured: true, activationRequired: true, setupState: "setup_required", status: "unpaired", detail: "Connect", features: [] })).toBe(true);
    expect(shouldShowControlCenterAccess({ configured: true, activationRequired: false, setupState: "active", status: "active", detail: "Connected", features: [] })).toBe(true);
  });
});
