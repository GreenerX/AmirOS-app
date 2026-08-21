import { describe, expect, it } from "vitest";
import {
  intelligenceCardDedupeKey,
  isTrustworthyIntelligenceCard,
} from "../shared/intelligence-card-eligibility.js";

const DAY = 86_400_000;
const now = new Date(2026, 7, 20, 10).getTime();

function card(overrides: Partial<Parameters<typeof isTrustworthyIntelligenceCard>[0]> = {}) {
  return {
    chatId: "dana@c.us",
    title: "Call Dana about the launch",
    detail: "A specific, evidence-backed follow-up",
    sourceIds: ["launch-follow-up"],
    evidence: [{ messageId: "dana-message", timestamp: now - DAY }],
    retainedMessageIds: ["dana-message"],
    now,
    ...overrides,
  };
}

describe("shared intelligence card eligibility", () => {
  it("resolves relative dates against their source message and suppresses stale current claims", () => {
    expect(isTrustworthyIntelligenceCard(card({
      title: "Meet Dana tomorrow",
      detail: "A plan mentioned in an old message",
      evidence: [{ messageId: "dana-message", timestamp: now - 2 * DAY }],
    }))).toBe(false);
    expect(isTrustworthyIntelligenceCard(card({
      currentClaim: true,
      evidence: [{ messageId: "dana-message", timestamp: now - 15 * DAY }],
    }))).toBe(false);
  });

  it("rejects expired undated follow-ups, vague promises, unavailable evidence, and group context", () => {
    expect(isTrustworthyIntelligenceCard(card({
      openFollowUp: true,
      evidence: [{ messageId: "dana-message", timestamp: now - 8 * DAY }],
    }))).toBe(false);
    expect(isTrustworthyIntelligenceCard(card({ title: "Something changed" }))).toBe(false);
    expect(isTrustworthyIntelligenceCard(card({ retainedMessageIds: [] }))).toBe(false);
    expect(isTrustworthyIntelligenceCard(card({ isGroup: true }))).toBe(false);
  });

  it("uses stable source keys first and a per-contact theme key for duplicate removal", () => {
    expect(intelligenceCardDedupeKey("dana@c.us", "Call Dana", ["a", "b"]))
      .toBe(intelligenceCardDedupeKey("someone-else@c.us", "Different title", ["b", "a"]));
    expect(intelligenceCardDedupeKey("dana@c.us", "Call Dana", []))
      .toBe(intelligenceCardDedupeKey("dana@c.us", "call   dana", []));
    expect(intelligenceCardDedupeKey("dana@c.us", "Call Dana", []))
      .not.toBe(intelligenceCardDedupeKey("other-dana@c.us", "Call Dana", []));
  });
});
