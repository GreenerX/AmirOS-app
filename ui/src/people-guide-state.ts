import type { SetupConnectionStatus } from "./release-visibility";

export const PEOPLE_GUIDE_STORAGE_KEY = "amiros.people-guide.v1";

export type PeopleGuidePhase = "waiting" | "available" | "deferred" | "selected" | "building" | "complete" | "no-result" | "error";

export type PeopleGuideState = {
  version: 1;
  phase: PeopleGuidePhase;
  selectedChatIds?: string[];
  completedChatId?: string;
  message?: string;
};

export type PeopleGuideAvailability = {
  onboardingComplete: boolean;
  apiKeyConfigured: boolean;
  connectionStatus: SetupConnectionStatus;
  chatCount: number;
  suggestedPeopleCount: number;
};

const resumablePhases = new Set<PeopleGuidePhase>(["deferred", "selected", "complete", "no-result", "error"]);

function uniqueIds(ids: unknown): string[] | undefined {
  if (!Array.isArray(ids)) return undefined;
  const normalized = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
  return normalized.length ? [...new Set(normalized)].slice(0, 12) : undefined;
}

export function readPeopleGuideState(storage: Pick<Storage, "getItem"> = window.localStorage): PeopleGuideState | undefined {
  try {
    const raw = storage.getItem(PEOPLE_GUIDE_STORAGE_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<PeopleGuideState>;
    if (value.version !== 1 || typeof value.phase !== "string" || !resumablePhases.has(value.phase as PeopleGuidePhase)) return undefined;
    return {
      version: 1,
      phase: value.phase as PeopleGuidePhase,
      selectedChatIds: uniqueIds(value.selectedChatIds),
      completedChatId: typeof value.completedChatId === "string" ? value.completedChatId : undefined,
      message: typeof value.message === "string" ? value.message.slice(0, 320) : undefined,
    };
  } catch {
    return undefined;
  }
}

export function savePeopleGuideState(state: PeopleGuideState, storage: Pick<Storage, "setItem"> = window.localStorage) {
  storage.setItem(PEOPLE_GUIDE_STORAGE_KEY, JSON.stringify({
    ...state,
    selectedChatIds: uniqueIds(state.selectedChatIds),
  }));
}

/**
 * The guide never changes account access. It appears only after the ordinary
 * local setup is complete and turns chat hydration into an honest waiting
 * state rather than a vanished first-value path.
 */
export function derivePeopleGuidePhase(
  availability: PeopleGuideAvailability,
  stored?: PeopleGuideState,
): PeopleGuidePhase | "hidden" {
  if (!availability.onboardingComplete || !availability.apiKeyConfigured || availability.connectionStatus !== "ready") return "hidden";
  if (stored?.phase === "complete" || stored?.phase === "no-result" || stored?.phase === "error" || stored?.phase === "deferred" || stored?.phase === "selected") {
    return stored.phase;
  }
  if (availability.suggestedPeopleCount > 0) return "available";
  return availability.chatCount === 0 ? "waiting" : "no-result";
}

export function guideState(phase: PeopleGuidePhase, patch: Omit<PeopleGuideState, "version" | "phase"> = {}): PeopleGuideState {
  return { version: 1, phase, ...patch };
}
