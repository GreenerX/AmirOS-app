import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chooseAssistantHandleCenter } from "../ui/src/assistant-docking.js";
import {
  ASSISTANT_DISCOVERY_VISIBLE_COUNT,
  buildAssistantSuggestionCards,
  rotateAssistantSuggestions,
  type AssistantSuggestionCard,
} from "../ui/src/assistant-suggestions.js";
import type { ChatSummary, IntelligenceData } from "../ui/src/types.js";

const now = new Date(2026, 7, 13, 10).getTime();
const DAY = 86_400_000;

const chats: ChatSummary[] = [
  { id: "david@c.us", name: "David", isGroup: false, unreadCount: 0, timestamp: now, preview: "Dinner tomorrow", mode: "off", avatarUrl: "/david.jpg" },
  { id: "sana@c.us", name: "Sana", isGroup: false, pinned: true, unreadCount: 0, timestamp: now, preview: "Keep it concise", mode: "off", avatarUrl: "/sana.jpg" },
  { id: "maya@c.us", name: "Maya", isGroup: false, pinned: true, unreadCount: 1, timestamp: now, preview: "Can I try the app?", mode: "off", avatarUrl: "/maya.jpg" },
];

function data(): IntelligenceData {
  return {
    generatedAt: now,
    needsReply: [],
    commitments: [],
    changes: [],
    events: [],
    chats: [
      {
        chatId: "sana@c.us", contactName: "Sana", isGroup: false, commitments: [], events: [], needsReply: false, updatedAt: now,
        insights: [{
          id: "sana-preference", kind: "preference", content: "Sana prefers concise decisions and clear outcomes.", status: "confirmed", confidence: .96,
          validity: "current", freshness: "fresh", evidence: { messageId: "sana-message", excerpt: "Please keep it concise", senderName: "Sana", timestamp: now - DAY },
          createdAt: now - DAY, updatedAt: now,
        }],
      },
      {
        chatId: "maya@c.us", contactName: "Maya", isGroup: false, commitments: [], events: [], needsReply: true, updatedAt: now,
        insights: [{
          id: "maya-app", kind: "fact", content: "Maya asked to try your app.", status: "confirmed", confidence: .95,
          validity: "current", freshness: "fresh", evidence: { messageId: "maya-message", excerpt: "Can I try the app?", senderName: "Maya", timestamp: now - 2 * DAY },
          createdAt: now - 2 * DAY, updatedAt: now - 2 * DAY,
        }],
      },
    ],
    questionHistory: [],
    suggestedQuestions: [],
    proactive: [{
      id: "dinner", fingerprint: "a".repeat(24), kind: "upcoming_context", priority: 10, title: "Before dinner with David",
      detail: "David wants to discuss the launch", why: "A confirmed dinner is tomorrow.", chatId: "david@c.us", contactName: "David",
      sourceIds: ["dinner-event", "david-context"], action: "chat", timestamp: now + DAY, sourceTimestamp: now - DAY,
      hasExplicitDueAt: true,
      aiAssessment: { confidence: 92, reason: "Useful preparation" },
    }],
  };
}

describe("Ask AmirOS proactive suggestions", () => {
  it("keeps the floating handle near its preferred lower position while clearing page controls", () => {
    expect(chooseAssistantHandleCenter({
      viewportHeight: 900,
      handleLeft: 1386,
      handleRight: 1428,
      controls: [{ top: 717, right: 1400, bottom: 737, left: 1364 }],
    })).toBe(689);
    expect(chooseAssistantHandleCenter({
      viewportHeight: 900,
      handleLeft: 1386,
      handleRight: 1428,
      controls: [{ top: 717, right: 1360, bottom: 737, left: 1320 }],
    })).toBe(720);
  });

  it("surfaces confirmed relationship context instead of duplicating the action queue", () => {
    const value = data();
    value.proactive = [{
      ...value.proactive[0]!,
      id: "unassessed-change",
      kind: "meaningful_change",
      aiAssessment: undefined,
    }];
    const suggestions = buildAssistantSuggestionCards(value, chats, now);
    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((item) => item.contactName)).toEqual(["Sana", "Maya"]);
    expect(suggestions.every((item) => item.kind === "knowledge")).toBe(true);
    expect(suggestions[0]).toMatchObject({
      icon: "communication",
      title: "Sana shared a preference",
      preview: "Sana prefers concise decisions and clear outcomes.",
      avatarUrl: "/sana.jpg",
      question: "What current context should I keep in mind about Sana?",
    });
  });

  it("labels knowledge by its evidence date rather than a later maintenance update", () => {
    const value = data();
    value.chats[0]!.insights[0]!.evidence.timestamp = now - 10 * DAY;
    value.chats[0]!.insights[0]!.updatedAt = now;
    const sana = buildAssistantSuggestionCards(value, chats, now).find((item) => item.contactName === "Sana");
    expect(sana?.detail).toContain("Updated Aug 3");
    expect(sana?.detail).not.toContain("Today");
  });

  it("uses AI-authored discovery copy while keeping the full summary visible", () => {
    const value = data();
    value.proactive = [];
    value.chats[0]!.insights[0] = {
      ...value.chats[0]!.insights[0]!,
      discoveryTitle: "Sana wants sharper decisions",
      discoverySummary: "Sana prefers concise decisions and clear outcomes when you work together.",
    };
    const sana = buildAssistantSuggestionCards(value, chats, now).find((item) => item.contactName === "Sana");
    expect(sana).toMatchObject({
      title: "Sana wants sharper decisions",
      preview: "Sana prefers concise decisions and clear outcomes when you work together.",
    });
    expect(sana?.preview).not.toContain("…");
  });

  it("keeps weak, inferred, group, and source-free knowledge out while allowing private confirmed knowledge", () => {
    const value = data();
    const insight = value.chats[0]!.insights[0]!;
    value.proactive = [];
    value.chats = [
      { ...value.chats[0]!, insights: [
        { ...insight, confidence: .7 },
        { ...insight, id: "sensitive", content: "Sana shared a medical diagnosis." },
      ] },
      { ...value.chats[0]!, chatId: "inferred@c.us", insights: [{ ...insight, id: "inferred", status: "inferred" }] },
      { ...value.chats[0]!, chatId: "group@g.us", isGroup: true },
      { ...value.chats[0]!, chatId: "source-free@c.us", insights: [{ ...insight, id: "source-free", evidence: { ...insight.evidence, messageId: undefined } }] },
    ];
    const suggestions = buildAssistantSuggestionCards(value, chats, now);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ contactName: "Sana", title: "Sana shared a preference" });
  });

  it("keeps only one card when mirrored memories point to the same evidence", () => {
    const value = data();
    value.proactive = [];
    value.chats.push({
      ...value.chats[0]!,
      chatId: "amir@c.us",
      contactName: "Amir",
      insights: [{
        ...value.chats[0]!.insights[0]!,
        id: "amir-mirror",
        content: "Sana prefers concise decisions and clear outcomes.",
        evidence: { ...value.chats[0]!.insights[0]!.evidence },
      }],
    });
    const suggestions = buildAssistantSuggestionCards(value, chats, now);
    expect(suggestions.filter((item) => item.title.includes("Sana"))).toHaveLength(1);
  });

  it("keeps every click anchored to the exact source records", () => {
    const suggestions = buildAssistantSuggestionCards(data(), chats, now);
    expect(suggestions.find((item) => item.contactName === "Sana")?.suggestionContext).toEqual({
      chatId: "sana@c.us",
      sourceIds: ["sana-preference"],
    });
  });

  it("uses a reveal preview with one visible freshness cue per discovery", () => {
    const component = readFileSync(new URL("../ui/src/components/FloatingAssistant.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../ui/src/styles.css", import.meta.url), "utf8");
    expect(component).toContain('className="ask-drawer-discovery-hero"');
    expect(component).toContain('className="ask-drawer-discovery-row-avatar"');
    expect(component).toContain("See what changed");
    expect(component).toContain("Also worth knowing");
    expect(component).toContain("Only timely, grounded context appears here.");
    expect(component).toContain("ASSISTANT_DISCOVERY_ROTATION_MS");
    expect(styles).toContain("padding: 20px 30px 26px;");
    expect(styles).toContain(".ask-drawer-discoveries { display: grid; margin-top: 20px;");
    expect(styles).toContain("padding: 0 0 20px;");
    expect(styles).toContain(".ask-drawer-discoveries-more { display: grid; margin-top: 20px; }");
    expect(styles).toContain(".ask-drawer-discoveries-more h3 { margin: 0 0 20px;");
    expect(styles).toContain(".ask-drawer-discovery-hero-copy > small { display: block; overflow: visible;");
    expect(styles).toContain(".ask-drawer-discovery-row small { display: block; overflow: visible;");
    expect(component).toContain("suggestion.suggestionContext.chatId");
    expect(component).not.toContain("Suggested for you");
  });

  it("addresses owner knowledge in second person and never surfaces old milestone facts", () => {
    const value = data();
    value.proactive = [];
    value.chats.push({
      chatId: "amir@c.us", contactName: "Amir Friedman", isGroup: false, commitments: [], events: [], needsReply: false, updatedAt: now,
      insights: [
        {
          id: "owner-context", kind: "fact", content: "Amir is considering how to make the product feel more personal.", status: "confirmed", confidence: .96,
          validity: "current", freshness: "fresh", evidence: { messageId: "owner-message", excerpt: "I want it to feel more personal", senderName: "Amir Friedman", timestamp: now },
          createdAt: now, updatedAt: now,
        },
        {
          id: "old-birthday", kind: "important_date", content: "Andrew's birthday was August 8, 1985.", status: "confirmed", confidence: .99,
          validity: "current", freshness: "fresh", evidence: { messageId: "birthday-message", excerpt: "My birthday is August 8", senderName: "Amir Friedman", timestamp: now },
          createdAt: now, updatedAt: now,
        },
      ],
    });
    const suggestions = buildAssistantSuggestionCards(value, chats, now, { displayName: "Amir Friedman", avatarUrl: "/amir.jpg" });
    const owner = suggestions.find((item) => item.contactName === "You");
    expect(owner).toMatchObject({
      avatarUrl: "/amir.jpg",
      question: "What current, evidence-backed context should I keep in mind about myself?",
      preview: "You are considering how to make the product feel more personal.",
    });
    expect(`${owner?.title} ${owner?.preview}`).not.toMatch(/\bAmir\b/u);
    expect(suggestions.some((item) => /birthday|important date/i.test(item.title))).toBe(false);
  });

  it("keeps every discovery card in the owner's voice when it mentions the owner", () => {
    const value = data();
    value.proactive = [];
    value.chats[0]!.insights[0] = {
      ...value.chats[0]!.insights[0]!,
      discoveryTitle: "Amir and Sana's shared work style",
      discoverySummary: "Sana is Amir Friedman's colleague; Amir and Sana work together.",
    };
    const sana = buildAssistantSuggestionCards(value, chats, now, { displayName: "Amir Friedman" })
      .find((item) => item.contactName === "Sana");
    expect(sana).toMatchObject({
      title: "You and Sana's shared work style",
      preview: "Sana is your colleague; you and Sana work together.",
    });
    expect(`${sana?.title} ${sana?.preview}`).not.toMatch(/\bAmir\b/u);
  });

  it("fails closed when a memory is attributed to someone other than the selected person", () => {
    const value = data();
    value.proactive = [];
    value.chats[0]!.insights[0]!.evidence.senderName = "Michelle Soffen";
    const suggestions = buildAssistantSuggestionCards(value, chats, now);
    expect(suggestions.some((item) => item.contactName === "Sana")).toBe(false);
  });

  it("shows four discoveries when four are strong and rotates through a larger pool without filler", () => {
    const cards = Array.from({ length: 6 }, (_, index) => ({
      id: `card-${index}`,
      contactName: `Person ${index}`,
      title: `Useful current detail ${index}`,
      preview: `Directly supported fact ${index}`,
      detail: "1 direct message · Today, 10:00 AM",
      question: `What current context should I keep in mind about Person ${index}?`,
      kind: "knowledge" as const,
      icon: "connection" as const,
      suggestionContext: { chatId: `person-${index}`, sourceIds: [`source-${index}`] },
    })) satisfies AssistantSuggestionCard[];
    expect(rotateAssistantSuggestions(cards, 0)).toHaveLength(ASSISTANT_DISCOVERY_VISIBLE_COUNT);
    expect(rotateAssistantSuggestions(cards, 1).map((card) => card.id)).toEqual(["card-1", "card-2", "card-3", "card-4"]);
  });

  it("ships the selected contour rail with transient—not constant—illumination and no counter", () => {
    const styles = readFileSync(new URL("../ui/src/styles.css", import.meta.url), "utf8");
    const component = readFileSync(new URL("../ui/src/components/FloatingAssistant.tsx", import.meta.url), "utf8");
    expect(styles).toContain("--ask-rail-curve-width: 66px;");
    expect(styles).toContain("transform: translateX(100%);");
    expect(styles).toContain("clip-path: polygon(63.65% 0, 58.85% 7%, 53.85% 15%");
    expect(styles).toContain(".floating-assistant.open::before");
    expect(styles).toContain("transition: clip-path .82s cubic-bezier(.4, 0, .2, 1);");
    expect(styles).toContain("89.2% 100%, 93.2% 93%, 96.2% 85%");
    expect(styles).not.toContain("64% 100%, 100% 100%, 100% 0");
    expect(styles).toContain("left: -2px;");
    expect(styles).toContain("border: 0;\n  border-radius: 13px 0 0 13px;");
    expect(styles).toContain(".floating-assistant.motion-opening::after");
    expect(styles).toContain(".floating-assistant.motion-closing::after");
    expect(styles).not.toContain(".floating-assistant-count");
    expect(styles).toContain("var(--ask-handle-y, 80%)");
    expect(component).not.toContain("floating-assistant-count");
    expect(component).not.toContain("suggestions ready");
    expect(component).toContain('setDrawerMotion("opening")');
    expect(component).toContain('setDrawerMotion("closing")');
  });
});
