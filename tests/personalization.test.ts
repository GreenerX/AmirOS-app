import { describe, expect, it } from "vitest";
import {
  buildNetworkAnswerInstructions,
  cleanNetworkAnswerText,
  buildContactProfilePrompt,
  buildContextScopeInstructions,
  buildPersonalizedInstructions,
  buildRequesterPerspectiveInstructions,
  buildResponseInput,
  inferMessageLanguage,
  replyConversationKey,
  type ReplyContext,
} from "../src/ai.js";

const context: ReplyContext = {
  chatName: "Product Team",
  senderName: "Sana",
  isGroup: true,
  contact: {
    mode: "auto",
    relationship: "Client",
    tone: "Professional",
    language: "Hebrew",
    memoryEnabled: true,
    knowledgeTracking: "enabled",
    customInstructions: "Always confirm delivery dates before promising them.",
    ownerTriggerAccess: ["knowledge", "calendar"],
    contactTriggerAccess: [],
  },
  memory: [
    {
      role: "user",
      content: "Thursday delivery works best.",
      senderName: "Sana",
      timestamp: 1,
    },
    {
      role: "assistant",
      content: "I will check Thursday availability.",
      timestamp: 2,
    },
  ],
  manualMemory: [
    { id: "fact-1", content: "Never schedule calls before 10:00.", createdAt: 3 },
  ],
  profile: {
    summary: "Direct communicator who values concrete delivery dates.",
    updatedAt: 4,
    sourceMessageCount: 2,
  },
};

describe("AI contact personalization", () => {
  it("turns every saved contact setting into explicit reply requirements", () => {
    const instructions = buildPersonalizedInstructions(context);

    expect(instructions).toContain("Relationship: Client");
    expect(instructions).toContain("Tone: Professional");
    expect(instructions).toContain("reply in Hebrew");
    expect(instructions).toContain("current sender is Sana");
    expect(instructions).toContain("Always confirm delivery dates");
    expect(instructions).toContain("override any conflicting default personality");
    expect(instructions).toContain("do not silently soften it");
    expect(instructions).toContain("Never schedule calls before 10:00");
    expect(instructions).toContain("Direct communicator");
  });

  it("makes the learned per-chat writing style a mandatory phrasing guide", () => {
    const instructions = buildPersonalizedInstructions({
      ...context,
      styleProfile: {
        summary: "Short, playful messages with clipped punctuation.",
        messageLength: "Usually one sentence",
        emojiUse: "One emoji at the end",
        formality: "Very casual",
        replyGuidance: ["Use playful shorthand."],
        updatedAt: 100,
        sourceMessageCount: 5,
        ownerMessageCountAtUpdate: 5,
      },
    });

    expect(instructions).toContain("mandatory phrasing guide");
    expect(instructions).toContain("Write the reply as Amir would write in this specific chat");
    expect(instructions).toContain("One emoji at the end");
    expect(instructions).toContain("Use playful shorthand");
    expect(instructions).toContain("overrides the default emoji quota");
    expect(instructions).toContain("Never include transport command prefixes");
  });

  it("makes a rude custom style explicit instead of letting the warm default soften it", () => {
    const instructions = buildPersonalizedInstructions({
      ...context,
      contact: {
        ...context.contact!,
        tone: "Rude",
        customInstructions: "Be very rude and keep it brief.",
      },
    });

    expect(instructions).toContain("Tone: Rude");
    expect(instructions).toContain("do not silently soften it");
    expect(instructions).toContain("Be very rude and keep it brief");
    expect(instructions).toContain("rude, sarcastic, blunt, cold, or sassy");
  });

  it("checks matching confirmed knowledge before composing a chat answer", () => {
    const instructions = buildPersonalizedInstructions({
      ...context,
      insights: [
        {
          id: "older-unrelated",
          kind: "fact",
          content: "Sana works from the Tel Aviv office.",
          status: "confirmed",
          confidence: 0.95,
          evidence: { excerpt: "I work in Tel Aviv.", senderName: "Sana", timestamp: 1 },
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "matching-fact",
          kind: "important_date",
          content: "Sana's birthday is on July 5.",
          status: "confirmed",
          confidence: 0.98,
          evidence: { excerpt: "My birthday is July 5.", senderName: "Sana", timestamp: 2 },
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    }, "When is Sana's birthday?");

    expect(instructions).toContain("CONFIRMED KNOWLEDGE FOR THIS CHAT (mandatory before answering)");
    expect(instructions).toContain("do not claim you have no record");
    expect(instructions.indexOf("Sana's birthday is on July 5.")).toBeLessThan(
      instructions.indexOf("Sana works from the Tel Aviv office."),
    );
  });

  it("replays only that chat's saved context and labels group participants", () => {
    expect(buildResponseInput("Can it arrive this week?", context, true)).toEqual([
      { role: "user", content: "[Sana] Thursday delivery works best." },
      { role: "assistant", content: "I will check Thursday availability." },
      { role: "user", content: "[Sana] Can it arrive this week?" },
    ]);
  });

  it("omits prior context when chat memory is disabled", () => {
    const memoryOff: ReplyContext = {
      ...context,
      contact: { ...context.contact!, memoryEnabled: false },
    };

    expect(buildResponseInput("Start fresh", memoryOff, true)).toEqual([
      { role: "user", content: "[Sana] Start fresh" },
    ]);
    expect(buildPersonalizedInstructions(memoryOff)).toContain("chat memory is disabled");
  });

  it("builds a bounded evidence prompt for an on-demand contact profile", () => {
    const prompt = buildContactProfilePrompt({
      contactName: "Sana",
      relationship: "Client",
      manualMemory: context.manualMemory!,
      memory: context.memory!,
      insights: [{
        id: "knowledge-1", kind: "preference", content: "Sana prefers brief status updates.", status: "confirmed", confidence: 0.95,
        evidence: { excerpt: "Keep it brief.", senderName: "Sana", timestamp: 4 }, createdAt: 4, updatedAt: 4,
      }],
      previousSummary: context.profile?.summary,
    });

    expect(prompt).toContain("private relationship profile for Sana");
    expect(prompt).toContain("Configured relationship: Client");
    expect(prompt).toContain("Never schedule calls before 10:00");
    expect(prompt).toContain("[Sana] Thursday delivery works best");
    expect(prompt).toContain("Confirmed relationship knowledge");
    expect(prompt).toContain("Sana prefers brief status updates");
    expect(prompt).toContain("Previous profile to improve");
  });

  it("detects the current chat language for automatic reply suggestions", () => {
    expect(inferMessageLanguage("מה נשמע? נתראה מחר")).toBe("Hebrew");
    expect(inferMessageLanguage("Can we meet tomorrow?")).toBe("English");
    const instructions = buildPersonalizedInstructions({
      ...context,
      currentMessageLanguage: "Hebrew",
      contact: { ...context.contact!, language: "Automatic" },
    });
    expect(instructions).toContain("reply entirely in Hebrew");
    expect(instructions).toContain("Do not switch languages");
  });

  it("announces calendar success only from a verified persisted result", () => {
    const instructions = buildPersonalizedInstructions({
      ...context,
      events: [{
        id: "therapy-1",
        title: "Therapy with Shelly",
        startAt: Date.now() + 3 * 86_400_000,
        allDay: false,
        status: "inferred",
        evidence: { excerpt: "Therapy with Shelly on Wednesday at 12pm", timestamp: Date.now() },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }],
      calendarCapture: {
        requested: true,
        status: "created",
        event: {
          id: "therapy-1",
          title: "Therapy with Shelly",
          startAt: Date.now() + 3 * 86_400_000,
          allDay: false,
          status: "inferred",
          evidence: { excerpt: "Therapy with Shelly on Wednesday at 12pm", timestamp: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });

    expect(instructions).toContain("VERIFIED CALENDAR ACTION RESULT");
    expect(instructions).toContain("SAVED: Therapy with Shelly");
    expect(instructions).toContain("only source of truth");
  });

  it("forbids calendar success claims when persistence failed", () => {
    const instructions = buildPersonalizedInstructions({
      ...context,
      calendarCapture: {
        requested: true,
        status: "not_created",
        reason: "The calendar suggestion was not saved.",
      },
    });

    expect(instructions).toContain("NOT SAVED");
    expect(instructions).toContain("Do not claim or imply that anything was added");
    expect(instructions).toContain("Never announce a successful AmirOS action unless");
  });

  it("provides cross-chat knowledge and the global calendar only in owner scope", () => {
    const ownerInstructions = buildContextScopeInstructions({
      scope: "owner",
      ownerKnowledge: [{
        id: "dani-fact",
        chatId: "dani@c.us",
        contactName: "Dani",
        kind: "memory",
        content: "Dani prefers afternoon plans.",
        status: "confirmed",
        timestamp: new Date("2026-08-01T10:00:00Z").getTime(),
        score: 8,
      }],
      ownerEvents: [{
        id: "theater",
        chatId: "friends@g.us",
        contactName: "The Six",
        title: "Theater night",
        startAt: new Date("2026-08-07T17:30:00Z").getTime(),
        allDay: false,
        status: "confirmed",
        evidence: { excerpt: "Theater on Friday", timestamp: 1 },
        createdAt: 1,
        updatedAt: 1,
      }],
    });

    expect(ownerInstructions).toContain("verified recipient is Amir");
    expect(ownerInstructions).toContain("Dani prefers afternoon plans");
    expect(ownerInstructions).toContain("Theater night");
    expect(ownerInstructions).toContain("Treat CONFIRMED events as scheduled");

    const chatInstructions = buildContextScopeInstructions({
      scope: "chat",
      ownerKnowledge: [{
        id: "must-not-leak",
        chatId: "other@c.us",
        kind: "memory",
        content: "Private information from another chat.",
        timestamp: 1,
        score: 10,
      }],
    });
    expect(chatInstructions).toContain("CHAT-ONLY PRIVACY BOUNDARY");
    expect(chatInstructions).not.toContain("Private information from another chat");
  });

  it("warns owner-triggered chat replies about visibility and includes only selected resources", () => {
    const instructions = buildContextScopeInstructions({
      scope: "owner-trigger",
      ownerKnowledge: [{
        id: "laura-fact",
        chatId: "laura@c.us",
        contactName: "Laura",
        kind: "memory",
        content: "Laura prefers quiet restaurants.",
        timestamp: 1,
        score: 8,
      }],
    });

    expect(instructions).toContain("Amir explicitly triggered this response");
    expect(instructions).toContain("may be read by its participants");
    expect(instructions).toContain("Laura prefers quiet restaurants");
    expect(instructions).not.toContain("GLOBAL AMIROS CALENDAR");
    expect(instructions).not.toContain("verified recipient is Amir in his WhatsApp self-chat");
  });

  it("limits contact-triggered shared context to the resources Amir granted", () => {
    const instructions = buildContextScopeInstructions({
      scope: "contact-trigger",
      ownerEvents: [{
        id: "shopping",
        chatId: "dani@c.us",
        contactName: "Dani",
        title: "Shopping at Osher Ad",
        startAt: new Date("2026-08-03T14:00:00Z").getTime(),
        allDay: false,
        status: "confirmed",
        evidence: { excerpt: "Shopping Monday at 5pm", timestamp: 1 },
        createdAt: 1,
        updatedAt: 1,
      }],
    });

    expect(instructions).toContain("CONTACT-AUTHORED SHARED CONTEXT");
    expect(instructions).toContain("Amir has granted this chat access");
    expect(instructions).toContain("Shopping at Osher Ad");
    expect(instructions).not.toContain("RELEVANT KNOWLEDGE RETRIEVED FROM ALL AMIROS CHATS");
    expect(instructions).not.toContain("OWNER-AUTHORED TRIGGER CONTEXT");
  });

  it("addresses a contact-triggered answer from the contact's perspective", () => {
    const contactContext: ReplyContext = {
      ...context,
      scope: "contact-trigger",
      triggerAuthor: "contact",
      requesterName: "Dani Faitelson",
      ownerName: "Amir Friedman",
      chatName: "Dani Faitelson",
      senderName: undefined,
      isGroup: false,
      ownerKnowledge: [{
        id: "karen",
        chatId: "family@g.us",
        contactName: "The Six",
        kind: "memory",
        content: "Karen Faitelson is Dani's mom.",
        status: "confirmed",
        timestamp: 1,
        score: 10,
      }],
    };
    const perspective = buildRequesterPerspectiveInstructions(contactContext);
    const instructions = buildPersonalizedInstructions(contactContext);

    expect(perspective).toContain("reply is for Dani Faitelson");
    expect(perspective).toContain('Address Dani Faitelson as "you"');
    expect(perspective).toContain("Amir Friedman is the AmirOS owner and is a different person");
    expect(perspective).toContain('"Karen is your mother"');
    expect(instructions).toContain("do not guess and do not use a generic error message");
    expect(buildResponseInput("who is Karen?", contactContext, false)).toEqual([
      { role: "user", content: "[Dani Faitelson] who is Karen?" },
    ]);
  });

  it("isolates continued AI conversations by requester and trigger author", () => {
    const contactKey = replyConversationKey("dani@c.us", {
      triggerAuthor: "contact",
      requesterName: "Dani Faitelson",
    });
    const ownerKey = replyConversationKey("dani@c.us", {
      triggerAuthor: "owner",
      requesterName: "Amir Friedman",
    });
    const groupMemberKey = replyConversationKey("friends@g.us", {
      triggerAuthor: "contact",
      requesterName: "Andrew Friedman",
    });

    expect(contactKey).not.toBe(ownerKey);
    expect(groupMemberKey).not.toBe(replyConversationKey("friends@g.us", {
      triggerAuthor: "contact",
      requesterName: "Dani Faitelson",
    }));
  });

  it("tells relationship intelligence to interpret Amir's first-person facts correctly", () => {
    const instructions = buildNetworkAnswerInstructions("Amir Friedman");
    expect(instructions).toContain('sourceAuthor "owner"');
    expect(instructions).toContain('"Michal is like your little sister"');
    expect(instructions).toContain("source conversation, not necessarily the speaker");
    expect(instructions).toContain("Never put record IDs");
  });

  it("removes leaked evidence identifiers from visible intelligence answers", () => {
    const knownId = "false_972505281356-1331979438@g.us_3A80A040D8AA369C83B3";
    const answer = [
      "Alon is your cousin. [49778754908389@lid-message-148]",
      `He hosted a birthday gathering. [${knownId}, 28e45f4d-9699-4902-a446-774a1e774112]`,
      "The relationship is confirmed.",
    ].join("\n");

    expect(cleanNetworkAnswerText(answer, [knownId, "49778754908389@lid-message-148"])).toBe([
      "Alon is your cousin.",
      "He hosted a birthday gathering.",
      "The relationship is confirmed.",
    ].join("\n"));
  });
});
