import { describe, expect, it } from "vitest";
import { accountSetupRequired, canShowReleaseNotes, shouldMarkInstalledReleaseSeen, shouldShowOnboarding } from "../ui/src/release-visibility.js";

const currentVersion = "0.10.6";

describe("first-run release visibility", () => {
  it("shows onboarding instead of release notes when a reused browser flag claims setup is complete but no API key exists", () => {
    const input = { onboardingComplete: true, apiKeyConfigured: false, connectionStatus: "disconnected" as const, seenVersion: undefined, currentVersion };
    expect(shouldShowOnboarding(input)).toBe(true);
    expect(canShowReleaseNotes(input)).toBe(false);
  });

  it("keeps release notes behind WhatsApp setup", () => {
    const input = { onboardingComplete: true, apiKeyConfigured: true, connectionStatus: "qr" as const, seenVersion: undefined, currentVersion };
    expect(accountSetupRequired(input.apiKeyConfigured, input.connectionStatus)).toBe(true);
    expect(shouldShowOnboarding(input)).toBe(true);
    expect(canShowReleaseNotes(input)).toBe(false);
  });

  it("shows unseen release notes only after onboarding and account setup are complete", () => {
    const input = { onboardingComplete: true, apiKeyConfigured: true, connectionStatus: "ready" as const, seenVersion: "0.10.5", currentVersion };
    expect(shouldShowOnboarding(input)).toBe(false);
    expect(canShowReleaseNotes(input)).toBe(true);
  });

  it("records the installed release without showing notes for a newly ready account", () => {
    const input = { onboardingComplete: true, apiKeyConfigured: true, connectionStatus: "ready" as const, seenVersion: undefined, currentVersion };
    expect(shouldShowOnboarding(input)).toBe(false);
    expect(shouldMarkInstalledReleaseSeen(input)).toBe(true);
    expect(canShowReleaseNotes(input)).toBe(false);
  });

  it("still opens onboarding for a genuinely new user with a ready account", () => {
    const input = { onboardingComplete: false, apiKeyConfigured: true, connectionStatus: "ready" as const, seenVersion: undefined, currentVersion };
    expect(shouldShowOnboarding(input)).toBe(true);
    expect(canShowReleaseNotes(input)).toBe(false);
  });
});
