export type SetupConnectionStatus = "starting" | "qr" | "authenticated" | "ready" | "disconnected";

export type ReleaseVisibilityInput = {
  onboardingComplete: boolean;
  apiKeyConfigured: boolean;
  connectionStatus: SetupConnectionStatus;
  seenVersion?: string | null;
  currentVersion: string;
};

/**
 * Browser storage can survive a reinstall because the dashboard keeps the
 * same local address. Account readiness must therefore outrank a previously
 * saved onboarding-complete flag.
 */
export function accountSetupRequired(apiKeyConfigured: boolean, connectionStatus: SetupConnectionStatus): boolean {
  return !apiKeyConfigured || connectionStatus !== "ready";
}

export function shouldShowOnboarding(input: ReleaseVisibilityInput): boolean {
  return !input.onboardingComplete || accountSetupRequired(input.apiKeyConfigured, input.connectionStatus);
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
