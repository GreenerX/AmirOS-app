import { describe, expect, it } from "vitest";
import { derivePeopleGuidePhase, guideState, PEOPLE_GUIDE_STORAGE_KEY, readPeopleGuideState, savePeopleGuideState } from "../ui/src/people-guide-state.js";

function availability(patch: Partial<Parameters<typeof derivePeopleGuidePhase>[0]> = {}) {
  return { onboardingComplete: true, apiKeyConfigured: true, connectionStatus: "ready" as const, chatCount: 0, suggestedPeopleCount: 0, ...patch };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

describe("resumable People guide", () => {
  it("shows an honest waiting state while WhatsApp is ready but chats have not hydrated", () => {
    expect(derivePeopleGuidePhase(availability())).toBe("waiting");
    expect(derivePeopleGuidePhase(availability({ chatCount: 4, suggestedPeopleCount: 2 }))).toBe("available");
  });

  it("keeps no eligible direct chat visible and retryable instead of hiding the guide", () => {
    expect(derivePeopleGuidePhase(availability({ chatCount: 4 }))).toBe("no-result");
  });

  it("does not appear before ordinary local setup is complete", () => {
    expect(derivePeopleGuidePhase(availability({ onboardingComplete: false, suggestedPeopleCount: 1 }))).toBe("hidden");
    expect(derivePeopleGuidePhase(availability({ apiKeyConfigured: false, suggestedPeopleCount: 1 }))).toBe("hidden");
    expect(derivePeopleGuidePhase(availability({ connectionStatus: "qr", suggestedPeopleCount: 1 }))).toBe("hidden");
  });

  it("persists defer and selected state across a restart without treating either as completion", () => {
    const storage = memoryStorage();
    savePeopleGuideState(guideState("deferred", { selectedChatIds: ["dani@c.us"] }), storage);
    const deferred = readPeopleGuideState(storage);
    expect(deferred).toMatchObject({ phase: "deferred", selectedChatIds: ["dani@c.us"] });
    expect(derivePeopleGuidePhase(availability({ suggestedPeopleCount: 1 }), deferred)).toBe("deferred");

    savePeopleGuideState(guideState("selected", { selectedChatIds: ["dani@c.us", "dani@c.us"] }), storage);
    expect(readPeopleGuideState(storage)).toMatchObject({ phase: "selected", selectedChatIds: ["dani@c.us"] });
    expect(storage.getItem(PEOPLE_GUIDE_STORAGE_KEY)).toContain("selected");
  });

  it("recovers an interrupted building marker as an available guide after refresh", () => {
    const storage = memoryStorage();
    storage.setItem(PEOPLE_GUIDE_STORAGE_KEY, JSON.stringify(guideState("building", { selectedChatIds: ["dani@c.us"] })));
    expect(readPeopleGuideState(storage)).toBeUndefined();
    expect(derivePeopleGuidePhase(availability({ suggestedPeopleCount: 1 }))).toBe("available");
  });
});
