import { describe, expect, it } from "vitest";
import { accountSetupRequired, canShowReleaseNotes, nextOnboardingStepAfterWhatsAppLink, shouldKeepOnboardingOpen, shouldMarkInstalledReleaseSeen, shouldShowOnboarding, shouldShowPeopleSetup } from "../ui/src/release-visibility.js";

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

  it("keeps an active onboarding flow open after WhatsApp becomes ready", () => {
    const input = { onboardingComplete: true, apiKeyConfigured: true, connectionStatus: "ready" as const, seenVersion: "0.10.5", currentVersion };
    expect(shouldShowOnboarding(input)).toBe(false);
    expect(shouldKeepOnboardingOpen(true, input)).toBe(true);
    expect(canShowReleaseNotes(input)).toBe(true);
  });

  it("advances from linking WhatsApp to the learning step without closing setup", () => {
    expect(nextOnboardingStepAfterWhatsAppLink(2, "qr", "ready")).toBe(3);
    expect(nextOnboardingStepAfterWhatsAppLink(2, "ready", "ready")).toBe(2);
    expect(nextOnboardingStepAfterWhatsAppLink(3, "qr", "ready")).toBe(3);
  });

  it("shows the People picker only after setup is complete and recent chats are ready", () => {
    const ready = { onboardingComplete: true, apiKeyConfigured: true, connectionStatus: "ready" as const, currentVersion, peopleSetupComplete: false, suggestedPeopleCount: 12 };
    expect(shouldShowPeopleSetup(ready)).toBe(true);
    expect(shouldShowPeopleSetup({ ...ready, suggestedPeopleCount: 0 })).toBe(false);
    expect(shouldShowPeopleSetup({ ...ready, peopleSetupComplete: true })).toBe(false);
    expect(shouldShowPeopleSetup({ ...ready, onboardingComplete: false })).toBe(false);
  });
});
