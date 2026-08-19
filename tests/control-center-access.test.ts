import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shouldShowControlCenterAccess } from "../ui/src/control-center-access.js";

describe("Control Center access visibility", () => {
  it("keeps Connect this Mac available for a configured but unpaired install", () => {
    expect(shouldShowControlCenterAccess({
      configured: true,
      status: "unpaired",
      detail: "Connect this Mac to AmirOS Control Center.",
      features: [],
    })).toBe(true);
  });

  it("does not introduce a Control Center card to a local-only install", () => {
    expect(shouldShowControlCenterAccess({
      configured: false,
      status: "unpaired",
      detail: "Control Center is not configured.",
      features: [],
    })).toBe(false);
  });

  it("does not read private settings while rendering the activation-only gate", () => {
    const appSource = readFileSync(resolve(process.cwd(), "ui/src/App.tsx"), "utf8");
    expect(appSource).toContain("dashboard && !dashboard.activationOnly ? dashboard.settings.assistant.timeFormat : undefined");
    expect(appSource).not.toContain("dashboard?.settings.assistant.timeFormat");
  });
});
