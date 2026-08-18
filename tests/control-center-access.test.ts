import { describe, expect, it } from "vitest";
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
});
