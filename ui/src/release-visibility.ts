export type SetupConnectionStatus = "starting" | "qr" | "authenticated" | "ready" | "disconnected";

export type ReleaseVisibilityInput = {
  onboardingComplete: boolean;
  apiKeyConfigured: boolean;
  connectionStatus: SetupConnectionStatus;
  seenVersion?: string | null;
  currentVersion: string;
};

/**
 * A missing API key means this browser marker cannot represent a usable
 * AmirOS account. WhatsApp can reconnect after setup, so its live connection
 * state must not reopen onboarding for a returning person.
 */
export function accountSetupRequired(apiKeyConfigured: boolean): boolean {
  return !apiKeyConfigured;
}

export function shouldShowOnboarding(input: ReleaseVisibilityInput): boolean {
  return !input.onboardingComplete || accountSetupRequired(input.apiKeyConfigured);
}

/**
 * Early AmirOS installs stored a personalised owner profile before the
 * browser-only onboarding marker existed. Use that durable local profile to
 * backfill the marker after an update, without treating a fresh profile
 * (whose placeholder is "You") as complete.
 */
export function hasLegacyCompletedOnboarding(
  ownerDisplayName: string,
  apiKeyConfigured: boolean,
): boolean {
  return apiKeyConfigured && ownerDisplayName.trim().toLocaleLowerCase() !== "you";
}

/**
 * The People picker is intentionally delayed until WhatsApp has supplied
 * recent chats. It is a first-run opportunity, not a setup gate.
 */
export function shouldShowPeopleSetup(input: ReleaseVisibilityInput & {
  peopleSetupComplete: boolean;
  suggestedPeopleCount: number;
}): boolean {
  return input.onboardingComplete
    && !input.peopleSetupComplete
    && input.apiKeyConfigured
    && input.connectionStatus === "ready"
    && input.suggestedPeopleCount > 0;
}

/**
 * An onboarding dialog that is already in progress owns the screen until its
 * final confirmation. This avoids a reused browser marker closing setup when
 * WhatsApp changes from QR to ready.
 */
export function shouldKeepOnboardingOpen(onboardingOpen: boolean, input: ReleaseVisibilityInput): boolean {
  return onboardingOpen || shouldShowOnboarding(input);
}

/** Advance only when the current QR-linking step actually becomes ready. */
export function nextOnboardingStepAfterWhatsAppLink(
  currentStep: number,
  previousConnectionStatus: SetupConnectionStatus,
  connectionStatus: SetupConnectionStatus,
): number {
  return currentStep === 2 && previousConnectionStatus !== "ready" && connectionStatus === "ready"
    ? 3
    : currentStep;
}

export function canShowReleaseNotes(input: ReleaseVisibilityInput): boolean {
  // A missing marker means this browser is seeing AmirOS for the first time
  // (or its local storage was cleared). Treat the installed version as the
  // starting point, not as an update worth interrupting the person for.
  return !shouldShowOnboarding(input)
    && typeof input.seenVersion === "string"
    && input.seenVersion !== input.currentVersion;
}

export function shouldMarkInstalledReleaseSeen(input: ReleaseVisibilityInput): boolean {
  return !shouldShowOnboarding(input) && typeof input.seenVersion !== "string";
}
