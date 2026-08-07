import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AmirosState } from "../src/amiros-state.js";
import { resolveTemporalRange } from "../src/temporal-memory.js";

const directories: string[] = [];
const now = new Date(2026, 7, 5, 15, 30).getTime(); // Wednesday, August 5, local time

function createState(): AmirosState {
  const directory = mkdtempSync(join(tmpdir(), "amiros-temporal-"));
  directories.push(directory);
  const state = new AmirosState(join(directory, "state.json"));
  state.updateContact("dani@c.us", { knowledgeTracking: "enabled" });
  return state;
}

function recordMessage(state: AmirosState, id: string, content: string, timestamp: number) {
  state.rememberMessage("dani@c.us", {
    role: "user",
    content,
    senderName: "Dani",
    timestamp,
    messageId: id,
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Temporal Memory Layer", () => {
  it("resolves common phrases as exact local, end-exclusive ranges", () => {
    expect(resolveTemporalRange("what happened today?", now)).toMatchObject({
      start: new Date(2026, 7, 5).getTime(), end: new Date(2026, 7, 6).getTime(),
    });
    expect(resolveTemporalRange("what did I do yesterday?", now)).toMatchObject({
      start: new Date(2026, 7, 4).getTime(), end: new Date(2026, 7, 5).getTime(),
    });
    expect(resolveTemporalRange("what did I promise last week?", now)).toMatchObject({
      start: new Date(2026, 6, 27).getTime(), end: new Date(2026, 7, 3).getTime(),
    });
    expect(resolveTemporalRange("what do I have tonight?", now)).toMatchObject({
      start: new Date(2026, 7, 5, 18).getTime(), end: new Date(2026, 7, 6, 6).getTime(),
    });
  });

  it("resolves supported Hebrew phrases to the same local ranges", () => {
    const expected = {
      today: { start: new Date(2026, 7, 5).getTime(), end: new Date(2026, 7, 6).getTime() },
      yesterday: { start: new Date(2026, 7, 4).getTime(), end: new Date(2026, 7, 5).getTime() },
      tomorrow: { start: new Date(2026, 7, 6).getTime(), end: new Date(2026, 7, 7).getTime() },
      thisWeek: { start: new Date(2026, 7, 3).getTime(), end: new Date(2026, 7, 10).getTime() },
      lastWeek: { start: new Date(2026, 6, 27).getTime(), end: new Date(2026, 7, 3).getTime() },
      morning: { start: new Date(2026, 7, 5).getTime(), end: new Date(2026, 7, 5, 12).getTime() },
      lastNight: { start: new Date(2026, 7, 4, 18).getTime(), end: new Date(2026, 7, 5, 6).getTime() },
    };

    expect(resolveTemporalRange("מה עשיתי אתמול", now)).toMatchObject(expected.yesterday);
    expect(resolveTemporalRange("מה יש לי מחר", now)).toMatchObject(expected.tomorrow);
    expect(resolveTemporalRange("מה קרה השבוע", now)).toMatchObject(expected.thisWeek);
    expect(resolveTemporalRange("מה עשיתי בשבוע שעבר", now)).toMatchObject(expected.lastWeek);
    expect(resolveTemporalRange("מה עשיתי הבוקר", now)).toMatchObject(expected.morning);
    expect(resolveTemporalRange("מה קרה אתמול בלילה", now)).toMatchObject(expected.lastNight);
  });

  it("uses the message date for today and yesterday, excluding two days ago", () => {
    const state = createState();
    recordMessage(state, "two-days-ago", "We visited the museum.", new Date(2026, 7, 3, 14).getTime());
    recordMessage(state, "yesterday", "We had dinner yesterday.", new Date(2026, 7, 4, 14).getTime());
    recordMessage(state, "today", "We had coffee today.", new Date(2026, 7, 5, 14).getTime());

    const yesterday = state.searchIntelligence("What happened yesterday?", 20, new Set(), now).map((record) => record.id);
    const today = state.searchIntelligence("What happened today?", 20, new Set(), now).map((record) => record.id);
    expect(yesterday).toContain("yesterday");
    expect(yesterday).not.toContain("two-days-ago");
    expect(today).toEqual(expect.arrayContaining(["today"]));
    expect(today).not.toEqual(expect.arrayContaining(["yesterday", "two-days-ago"]));
  });

  it("uses calendar start times for tomorrow", () => {
    const state = createState();
    state.mergeAnalyzedIntelligence("dani@c.us", {
      insights: [], commitments: [], todos: [],
      events: [{
        title: "Dentist appointment",
        startAt: new Date(2026, 7, 6, 10).getTime(),
        allDay: false,
        evidence: { excerpt: "Dentist tomorrow at 10", timestamp: new Date(2026, 7, 5, 12).getTime() },
      }],
    });

    const results = state.searchIntelligence("What do I have tomorrow?", 20, new Set(), now);
    expect(results.find((record) => record.kind === "calendar_event")?.content).toContain("Dentist appointment");
  });

  it("uses evidence time instead of when a fact or commitment was later updated", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const state = createState();
      const evidenceTime = new Date(2026, 7, 2, 11).getTime();
      recordMessage(state, "commitment-source", "I will call the dentist.", new Date(2026, 6, 29, 11).getTime());
      state.mergeAnalyzedIntelligence("dani@c.us", {
        insights: [{
          kind: "fact", content: "Dani likes hiking.", confidence: 0.9,
          evidence: { excerpt: "I like hiking", timestamp: evidenceTime, messageId: "fact-source" },
        }],
        commitments: [{
          content: "Dani will call the dentist.", owner: "contact",
          evidence: { excerpt: "I will call the dentist", timestamp: new Date(2026, 6, 29, 11).getTime(), messageId: "commitment-source" },
        }],
        todos: [], events: [],
      });

      const today = state.searchIntelligence("What happened today?", 20, new Set(), now);
      expect(today.some((record) => record.kind === "insight")).toBe(false);
      expect(today.some((record) => record.kind === "commitment")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps non-temporal searches unchanged", () => {
    const state = createState();
    recordMessage(state, "old-message", "Dani likes hiking.", new Date(2026, 7, 2, 11).getTime());

    expect(state.searchIntelligence("Who likes hiking?", 20, new Set(), now).map((record) => record.id)).toContain("old-message");
  });
});
