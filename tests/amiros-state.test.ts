import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AmirosState } from "../src/amiros-state.js";

const temporaryDirectories: string[] = [];

function createState(): { state: AmirosState; filePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "amiros-state-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "state.json");
  const state = new AmirosState(filePath);
  // These legacy local-signal tests exercise the opt-in path. Production
  // defaults new chats to approval-needed, while these fixtures explicitly
  // emulate a user who has enabled tracking for every test conversation.
  const rememberMessage = state.rememberMessage.bind(state);
  state.rememberMessage = ((chatId, entry) => {
    if (state.getContact(chatId).knowledgeTracking === "pending") {
      state.updateContact(chatId, { knowledgeTracking: "enabled" });
    }
    rememberMessage(chatId, entry);
  }) as AmirosState["rememberMessage"];
  return { state, filePath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("AmirosState", () => {
  it("keeps automatic replies available by default", () => {
    const { state } = createState();

    expect(state.getSettings().quietHours.enabled).toBe(false);
    expect(state.isQuietHoursNow(new Date(2026, 6, 31, 23, 30))).toBe(false);
  });

  it("persists contact modes and protects the state file", () => {
    const { state, filePath } = createState();

    state.updateContact("contact@c.us", {
      mode: "suggest",
      relationship: "Client",
    });

    expect(state.getContact("contact@c.us")).toMatchObject({
      mode: "suggest",
      relationship: "Client",
      tone: "Warm & concise",
      ownerTriggerAccess: ["knowledge", "calendar"],
      contactTriggerAccess: [],
    });
    expect(new AmirosState(filePath).getContact("contact@c.us").mode).toBe("suggest");
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    expect(readFileSync(filePath, "utf8")).not.toContain("message body");
  });

  it("persists independent owner and contact trigger resource selections per chat", () => {
    const { state, filePath } = createState();

    state.updateContact("dani@c.us", {
      ownerTriggerAccess: ["calendar"],
      contactTriggerAccess: ["calendar"],
    });
    state.updateContact("laura@c.us", { ownerTriggerAccess: [] });

    const reloaded = new AmirosState(filePath);
    expect(reloaded.getContact("dani@c.us").ownerTriggerAccess).toEqual(["calendar"]);
    expect(reloaded.getContact("dani@c.us").contactTriggerAccess).toEqual(["calendar"]);
    expect(reloaded.getContact("laura@c.us").ownerTriggerAccess).toEqual([]);
    expect(reloaded.getContact("laura@c.us").contactTriggerAccess).toEqual([]);
    expect(reloaded.getContact("new@c.us").ownerTriggerAccess).toEqual(["knowledge", "calendar"]);
    expect(reloaded.getContact("new@c.us").contactTriggerAccess).toEqual([]);
  });

  it("asks before automatically tracking a new chat while preserving existing tracked contacts", () => {
    const { state, filePath } = createState();
    expect(state.getContact("new@c.us").knowledgeTracking).toBe("pending");

    writeFileSync(filePath, JSON.stringify({
      contacts: { "legacy@c.us": { mode: "auto", relationship: "Friend", tone: "Friendly", language: "Automatic", memoryEnabled: true, customInstructions: "", ownerTriggerAccess: [], contactTriggerAccess: [] } },
      memories: {},
    }));
    expect(new AmirosState(filePath).getContact("legacy@c.us").knowledgeTracking).toBe("enabled");
  });

  it("uses the chosen first-run tracking policy only for new chats and surfaces a safe approval request", () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-tracking-policy-"));
    temporaryDirectories.push(directory);
    const state = new AmirosState(join(directory, "state.json"));

    state.rememberChatName("dani@c.us", "Dani Faitelson");
    state.rememberMessage("dani@c.us", {
      role: "user",
      author: "contact",
      content: "Want to make plans this weekend?",
      messageId: "dani-message-1",
    });

    expect(state.getContact("dani@c.us").knowledgeTracking).toBe("pending");
    expect(state.listKnowledgeTrackingRequests()).toMatchObject([{
      chatId: "dani@c.us",
      contactName: "Dani Faitelson",
      isGroup: false,
      messageCount: 1,
    }]);

    state.updateSettings({ knowledgeTrackingDefault: "private" });
    expect(state.getContact("new-person@c.us").knowledgeTracking).toBe("enabled");
    expect(state.getContact("new-group@g.us").knowledgeTracking).toBe("pending");
    // The original approval decision remains untouched when the global default changes.
    expect(state.getContact("dani@c.us").knowledgeTracking).toBe("pending");

    state.updateContact("dani@c.us", { knowledgeTracking: "snoozed" });
    expect(state.listKnowledgeTrackingRequests()).toEqual([]);
  });

  it("handles quiet-hour windows that cross midnight", () => {
    const { state } = createState();
    state.updateSettings({
      quietHours: { enabled: true, start: "23:00", end: "07:00" },
    });

    expect(state.isQuietHoursNow(new Date(2026, 6, 31, 23, 30))).toBe(true);
    expect(state.isQuietHoursNow(new Date(2026, 7, 1, 6, 59))).toBe(true);
    expect(state.isQuietHoursNow(new Date(2026, 7, 1, 7, 0))).toBe(false);
    expect(state.isQuietHoursNow(new Date(2026, 7, 1, 12, 0))).toBe(false);
  });

  it("keeps draft bodies in memory rather than persisted state", () => {
    const { state, filePath } = createState();
    state.updateSettings({ monthlyBudgetUsd: 35 });
    const draft = state.addDraft({
      chatId: "contact@c.us",
      contactName: "Contact",
      sourcePreview: "Incoming message",
      body: "Sensitive draft body",
    });

    expect(state.listDrafts()).toHaveLength(1);
    state.setDraftStatus(draft.id, "sent");
    expect(state.listDrafts()).toHaveLength(0);
    expect(readFileSync(filePath, "utf8")).not.toContain("Sensitive draft body");
  });

  it("persists dashboard assistant settings and the chosen model preset", () => {
    const { state, filePath } = createState();
    state.updateSettings({
      modelPreset: "quality",
      theme: "plum",
      assistant: {
        allowGroups: true,
        webSearchEnabled: false,
        botTriggerPrefix: "!amiros",
      },
    });

    const reloaded = new AmirosState(filePath).getSettings();
    expect(reloaded.modelPreset).toBe("quality");
    expect(reloaded.theme).toBe("plum");
    expect(reloaded.assistant).toMatchObject({
      allowGroups: true,
      webSearchEnabled: false,
      botTriggerPrefix: "!amiros",
      imageTriggerPrefix: "!image",
    });
  });

  it("persists the expanded color themes", () => {
    const { state, filePath } = createState();
    state.updateSettings({ theme: "rose" });

    expect(new AmirosState(filePath).getSettings().theme).toBe("rose");
  });

  it("keeps bounded conversation memory isolated and persistent per chat", () => {
    const { state, filePath } = createState();
    state.rememberExchange(
      "client-a@c.us",
      "My preferred delivery day is Thursday.",
      "I will remember Thursday for future delivery planning.",
      "Alex",
    );
    state.rememberMessage("client-b@c.us", {
      role: "user",
      content: "This belongs to another conversation.",
    });

    const reloaded = new AmirosState(filePath);
    expect(reloaded.getConversationMemory("client-a@c.us")).toMatchObject([
      { role: "user", senderName: "Alex", content: "My preferred delivery day is Thursday." },
      { role: "assistant", content: "I will remember Thursday for future delivery planning." },
    ]);
    expect(reloaded.getConversationMemory("client-a@c.us")).not.toEqual(
      reloaded.getConversationMemory("client-b@c.us"),
    );
    expect(reloaded.getSettings()).toMatchObject({ memories: {} });
  });

  it("clears saved context when memory is disabled for a contact", () => {
    const { state, filePath } = createState();
    state.rememberMessage("private@c.us", {
      role: "user",
      content: "A private preference",
    });

    state.updateContact("private@c.us", { memoryEnabled: false });

    expect(state.getConversationMemory("private@c.us")).toEqual([]);
    expect(readFileSync(filePath, "utf8")).not.toContain("A private preference");
  });

  it("persists, removes, and applies manual contact memory", () => {
    const { state, filePath } = createState();
    const item = state.addManualMemory(
      "friend@c.us",
      "  Prefers coffee meetings after 10:00.  ",
    );

    expect(new AmirosState(filePath).getManualMemory("friend@c.us")).toMatchObject([
      { id: item.id, content: "Prefers coffee meetings after 10:00." },
    ]);
    expect(state.removeManualMemory("friend@c.us", item.id)).toBe(true);
    expect(new AmirosState(filePath).getManualMemory("friend@c.us")).toEqual([]);
  });

  it("stores a contact profile and marks how many incoming messages it summarizes", () => {
    const { state, filePath } = createState();
    state.rememberMessage("client@c.us", {
      role: "user",
      content: "I prefer Thursday deliveries.",
      messageId: "message-1",
    });
    state.rememberMessage("client@c.us", {
      role: "user",
      content: "Please keep updates short.",
      messageId: "message-2",
    });
    state.rememberMessage("client@c.us", {
      role: "user",
      content: "Duplicate delivery",
      messageId: "message-2",
    });

    const profile = state.setContactProfile("client@c.us", "Direct and deadline-focused.");
    const reloaded = new AmirosState(filePath);
    expect(profile.sourceMessageCount).toBe(2);
    expect(reloaded.getIncomingMessageCount("client@c.us")).toBe(2);
    expect(reloaded.getContactProfile("client@c.us")?.summary).toBe(
      "Direct and deadline-focused.",
    );
    expect(reloaded.intelligenceSnapshot()[0]?.profile?.summary).toBe(
      "Direct and deadline-focused.",
    );
  });

  it("captures evidence-backed preferences and commitments without an API call", () => {
    const { state, filePath } = createState();
    state.rememberMessage("friend@c.us", {
      role: "user",
      content: "I prefer quiet restaurants. Can you book one for Thursday?",
      senderName: "Noa",
      messageId: "source-1",
      timestamp: 1_800_000_000_000,
    });

    const reloaded = new AmirosState(filePath);
    expect(reloaded.getInsights("friend@c.us")).toMatchObject([
      {
        kind: "preference",
        status: "inferred",
        evidence: { messageId: "source-1", senderName: "Noa" },
      },
    ]);
    expect(reloaded.getCommitments("friend@c.us")).toMatchObject([
      { owner: "me", status: "open", evidence: { messageId: "source-1" } },
    ]);
    expect(reloaded.intelligenceSnapshot()[0]).toMatchObject({
      chatId: "friend@c.us",
      needsReply: true,
    });
  });

  it("supports reviewing intelligence and searching across isolated chats", () => {
    const { state } = createState();
    state.rememberMessage("alex@c.us", { role: "user", content: "I love hiking in Greece.", messageId: "greece-1" });
    state.rememberMessage("sam@c.us", { role: "user", content: "The quarterly report is ready.", messageId: "report-1" });
    const insight = state.getInsights("alex@c.us")[0];
    expect(insight).toBeDefined();

    state.updateInsight("alex@c.us", insight!.id, { status: "confirmed" });
    expect(state.getInsights("alex@c.us")[0]?.status).toBe("confirmed");
    expect(state.searchIntelligence("Greece")[0]).toMatchObject({ chatId: "alex@c.us" });
  });

  it("retrieves saved facts ahead of earlier questions with the same name", () => {
    const { state } = createState();
    state.rememberChatName("six@g.us", "The Six");
    state.rememberMessage("six@g.us", {
      role: "user",
      author: "group_member",
      senderName: "Karen",
      content: "Lionel Faitelson is Karen's husband and Dani's father.",
      timestamp: 10,
      messageId: "lionel-fact",
    });
    state.rememberMessage("owner@c.us", {
      role: "user",
      author: "owner",
      senderName: "Amir",
      content: "Who is Lionel?",
      timestamp: 20,
      messageId: "lionel-question",
      countAsIncoming: false,
    });

    const records = state.searchIntelligence("What can you tell me about Lionel?", 10);
    expect(records[0]).toMatchObject({ id: "lionel-fact", content: expect.stringContaining("Dani's father") });
    expect(records.some((record) => record.id === "lionel-question")).toBe(false);
  });

  it("does not suggest reworded knowledge that is already confirmed", () => {
    const { state } = createState();
    const chatId = "dani@c.us";
    const evidence = { messageId: "restaurant-1", excerpt: "My favorite restaurant is Pronto.", timestamp: Date.now() };
    state.mergeAnalyzedIntelligence(chatId, {
      insights: [{ kind: "preference", content: "Dani's favorite restaurant is Pronto.", confidence: 0.96, evidence }],
      commitments: [],
    });
    const confirmed = state.getInsights(chatId)[0]!;
    state.updateInsight(chatId, confirmed.id, { status: "confirmed" });

    state.mergeAnalyzedIntelligence(chatId, {
      insights: [{
        kind: "preference",
        content: "Dani loves eating at Pronto restaurant.",
        confidence: 0.98,
        evidence: { ...evidence, messageId: "restaurant-2", excerpt: "I love eating at Pronto." },
      }],
      commitments: [],
    });

    expect(state.getInsights(chatId)).toEqual([
      expect.objectContaining({ id: confirmed.id, status: "confirmed", content: "Dani's favorite restaurant is Pronto." }),
    ]);
  });

  it("collapses duplicate pending knowledge while keeping distinct conflicting details", () => {
    const { state } = createState();
    const chatId = "dani@c.us";
    const timestamp = Date.now();
    state.mergeAnalyzedIntelligence(chatId, {
      insights: [
        { kind: "important_date", content: "Dani's birthday is July 5th.", confidence: 0.95, evidence: { excerpt: "Dani's birthday is July 5th.", timestamp } },
        { kind: "fact", content: "Dani was born on July 5.", confidence: 0.97, evidence: { excerpt: "Dani was born on July 5.", timestamp } },
        { kind: "important_date", content: "Dani's birthday is July 7th.", confidence: 0.9, evidence: { excerpt: "Dani's birthday is July 7th.", timestamp } },
      ],
      commitments: [],
    });

    expect(state.getInsights(chatId)).toHaveLength(2);
    expect(state.getInsights(chatId).filter((item) => /July 5(?:th)?\b/u.test(item.content))).toHaveLength(1);
    expect(state.getInsights(chatId).filter((item) => /July 7(?:th)?\b/u.test(item.content))).toHaveLength(1);
  });

  it("does not suggest knowledge that already exists as manual memory or was dismissed", () => {
    const { state } = createState();
    const chatId = "dani@c.us";
    state.addManualMemory(chatId, "Karen is Dani's mother.");
    state.mergeAnalyzedIntelligence(chatId, {
      insights: [{ kind: "relationship_change", content: "Karen is Dani's mom.", confidence: 0.98, evidence: { excerpt: "Karen is my mom.", timestamp: Date.now() } }],
      commitments: [],
    });
    expect(state.getInsights(chatId)).toEqual([]);

    state.mergeAnalyzedIntelligence(chatId, {
      insights: [{ kind: "fact", content: "Dani lives on King Street.", confidence: 0.95, evidence: { excerpt: "I live on King Street.", timestamp: Date.now() } }],
      commitments: [],
    });
    const dismissed = state.getInsights(chatId)[0]!;
    state.updateInsight(chatId, dismissed.id, { status: "outdated" });
    state.mergeAnalyzedIntelligence(chatId, {
      insights: [{ kind: "fact", content: "Dani resides at King Street.", confidence: 0.99, evidence: { excerpt: "My home is on King Street.", timestamp: Date.now() } }],
      commitments: [],
    });
    expect(state.getInsights(chatId)).toEqual([
      expect.objectContaining({ id: dismissed.id, status: "outdated" }),
    ]);
  });

  it("routes one shared knowledge suggestion to every named person and reviews it once", () => {
    const { state } = createState();
    const sourceChatId = "owner@c.us";
    state.rememberMessage(sourceChatId, { role: "user", content: "Hello", messageId: "owner-hello" });
    state.rememberMessage("dani@c.us", { role: "user", content: "Hello", messageId: "dani-hello" });
    state.rememberChatName(sourceChatId, "Amir Friedman");
    state.rememberChatName("dani@c.us", "Dani Faitelson");

    state.mergeRoutedAnalyzedIntelligence(sourceChatId, {
      insights: [{
        kind: "fact",
        content: "Amir and Dani live on King Street.",
        confidence: 0.98,
        subjectNames: ["Amir Friedman", "Dani Faitelson"],
        evidence: { messageId: "shared-home", excerpt: "Dani and I live on King Street.", timestamp: Date.now() },
      }],
      commitments: [],
    });

    const ownerInsight = state.getInsights(sourceChatId)[0]!;
    const daniInsight = state.getInsights("dani@c.us")[0]!;
    expect(ownerInsight.clusterId).toBe(daniInsight.clusterId);
    expect(ownerInsight.subjectNames).toEqual(expect.arrayContaining(["Amir Friedman", "Dani Faitelson"]));

    state.updateInsight(sourceChatId, ownerInsight.id, { status: "confirmed" });
    expect(state.getInsights(sourceChatId)[0]?.status).toBe("confirmed");
    expect(state.getInsights("dani@c.us")[0]?.status).toBe("confirmed");

    state.mergeRoutedAnalyzedIntelligence(sourceChatId, {
      insights: [{
        kind: "fact",
        content: "Dani and Amir reside on King Street.",
        confidence: 0.99,
        subjectNames: ["Dani Faitelson", "Amir Friedman"],
        evidence: { messageId: "shared-home-repeat", excerpt: "We both live on King Street.", timestamp: Date.now() },
      }],
      commitments: [],
    });
    expect(state.getInsights(sourceChatId)).toHaveLength(1);
    expect(state.getInsights("dani@c.us")).toHaveLength(1);
  });

  it("reviews matching legacy knowledge suggestions together even before they share a cluster", () => {
    const { state } = createState();
    const timestamp = Date.now();
    state.mergeAnalyzedIntelligence("amir@c.us", {
      insights: [{
        kind: "fact",
        content: "Dani and Amir live on King Street.",
        confidence: 0.95,
        evidence: { messageId: "amir-home", excerpt: "Dani and I live on King Street.", timestamp },
      }],
      commitments: [],
    });
    state.mergeAnalyzedIntelligence("dani@c.us", {
      insights: [{
        kind: "fact",
        content: "Dani and Amir live on King Street.",
        confidence: 0.96,
        evidence: { messageId: "dani-home", excerpt: "We live on King Street.", timestamp },
      }],
      commitments: [],
    });

    const amirInsight = state.getInsights("amir@c.us")[0]!;
    const daniInsight = state.getInsights("dani@c.us")[0]!;
    expect(amirInsight.clusterId).not.toBe(daniInsight.clusterId);

    state.updateInsight("amir@c.us", amirInsight.id, { status: "outdated" });

    expect(state.getInsights("amir@c.us")[0]?.status).toBe("outdated");
    expect(state.getInsights("dani@c.us")[0]?.status).toBe("outdated");
  });

  it("migrates matching legacy knowledge copies into one shared decision cluster", () => {
    const { state, filePath } = createState();
    const evidence = { messageId: "shared-message", excerpt: "Let's watch a movie and take a walk.", timestamp: Date.now() };
    state.rememberMessage("amir@c.us", { role: "user", content: "Hello", messageId: "owner-memory" });
    state.rememberMessage("andrew@c.us", { role: "user", content: "Hello", messageId: "andrew-memory" });
    state.rememberChatName("amir@c.us", "Amir Friedman");
    state.rememberChatName("andrew@c.us", "Andrew Friedman");
    state.mergeAnalyzedIntelligence("amir@c.us", {
      insights: [{ kind: "preference", content: "Andrew enjoys walks and movies with Amir.", confidence: 0.9, evidence }], commitments: [],
    });
    state.mergeAnalyzedIntelligence("andrew@c.us", {
      insights: [{ kind: "preference", content: "Andrew enjoys going for walks and watching movies with Amir.", confidence: 0.95, evidence }], commitments: [],
    });
    state.updateInsight("andrew@c.us", state.getInsights("andrew@c.us")[0]!.id, { status: "confirmed" });

    const reloaded = new AmirosState(filePath);
    const ownerCopy = reloaded.getInsights("amir@c.us")[0]!;
    const andrewCopy = reloaded.getInsights("andrew@c.us")[0]!;
    expect(ownerCopy.clusterId).toBe(andrewCopy.clusterId);
    expect(ownerCopy.status).toBe("confirmed");
    expect(ownerCopy.subjectNames).toEqual(expect.arrayContaining(["Amir Friedman", "Andrew Friedman"]));
  });

  it("keeps completed or dismissed commitments from returning after a rescan", () => {
    const { state, filePath } = createState();
    const chatId = "klad@g.us";
    const evidence = { messageId: "promise-1", excerpt: "I will contact Citizen Cafe about the teaching role.", timestamp: Date.now() };
    state.mergeAnalyzedIntelligence(chatId, {
      insights: [],
      commitments: [{ content: "Contact Citizen Cafe about the part-time Hebrew teaching role.", owner: "me", evidence }],
    });
    const original = state.getCommitments(chatId)[0]!;
    state.updateCommitment(chatId, original.id, "dismissed");

    state.mergeAnalyzedIntelligence(chatId, {
      insights: [],
      commitments: [{
        content: "Look into and contact Citizen Cafe for the part time Hebrew teacher position.",
        owner: "me",
        evidence: { ...evidence, messageId: "promise-2" },
      }],
    });

    const reloaded = new AmirosState(filePath);
    expect(reloaded.getCommitments(chatId)).toEqual([
      expect.objectContaining({ id: original.id, status: "dismissed" }),
    ]);
  });

  it("replaces a raw local suggestion with richer distinct suggestions from the same message", () => {
    const { state } = createState();
    const chatId = "dani@c.us";
    const timestamp = Date.now();
    const source = "I love dark chocolate when I am in a bad mood, and I also love bright fresh flowers.";
    state.rememberMessage(chatId, {
      role: "user",
      content: source,
      senderName: "Dani",
      messageId: "compound-preferences",
      timestamp,
    });
    state.mergeAnalyzedIntelligence(chatId, {
      insights: [
        { kind: "preference", content: "Dani likes dark chocolate when she is in a bad mood.", confidence: 0.98, evidence: { messageId: "compound-preferences", excerpt: source, senderName: "Dani", timestamp } },
        { kind: "preference", content: "Dani loves bright fresh flowers.", confidence: 0.97, evidence: { messageId: "compound-preferences", excerpt: source, senderName: "Dani", timestamp } },
      ],
      commitments: [],
    });

    expect(state.getInsights(chatId)).toHaveLength(2);
    expect(state.getInsights(chatId).some((item) => item.content === source)).toBe(false);
    expect(state.getInsights(chatId).map((item) => item.content)).toEqual(expect.arrayContaining([
      "Dani likes dark chocolate when she is in a bad mood.",
      "Dani loves bright fresh flowers.",
    ]));
  });

  it("extracts dated plans and returns every upcoming event for schedule questions", () => {
    const { state } = createState();
    const saturday = new Date(2026, 7, 1, 10, 0).getTime();
    state.rememberMessage("laura@c.us", {
      role: "user",
      content: "Save the date - August 27 house party at 7pm",
      senderName: "Laura",
      timestamp: saturday,
      messageId: "party-1",
    });
    state.rememberMessage("plans@c.us", {
      role: "user",
      content: "We're going shopping on Monday",
      timestamp: saturday,
      messageId: "shopping-1",
    });
    state.rememberMessage("plans@c.us", {
      role: "user",
      content: "We're going to the theater on Friday evening",
      timestamp: saturday,
      messageId: "theater-1",
    });

    const party = state.getCalendarEvents("laura@c.us")[0]!;
    expect(party.title).toBe("Laura's house party");
    expect(party.allDay).toBe(false);
    const editedStart = party.startAt + 30 * 60_000;
    state.updateCalendarEvent("laura@c.us", party.id, {
      title: "Laura's rooftop party",
      status: "confirmed",
      startAt: editedStart,
      endAt: editedStart + 90 * 60_000,
      location: "Laura's place",
    });
    expect(state.getCalendarEvents("laura@c.us")[0]).toMatchObject({
      title: "Laura's rooftop party",
      status: "confirmed",
      startAt: editedStart,
      endAt: editedStart + 90 * 60_000,
      location: "Laura's place",
      allDay: false,
    });
    expect(new Date(party.startAt)).toMatchObject({});
    expect(new Date(party.startAt).getMonth()).toBe(7);
    expect(new Date(party.startAt).getDate()).toBe(27);
    const theater = state.getCalendarEvents("plans@c.us").find((event) => /theater/i.test(event.title));
    expect(new Date(theater!.startAt).getHours()).toBe(19);
    expect(theater!.allDay).toBe(false);

    const schedule = state.searchIntelligence("What is on my schedule this week?")
      .filter((record) => record.kind === "calendar_event");
    expect(schedule.map((record) => record.content)).toEqual(expect.arrayContaining([
      expect.stringContaining("rooftop party"),
      expect.stringContaining("theater"),
    ]));
  });

  it("suggests dated drop-off reminders and understands next Sunday", () => {
    const { state, filePath } = createState();
    const saturday = new Date(2026, 7, 1, 16, 30).getTime();

    state.rememberMessage("dani@c.us", {
      role: "user",
      content: "Hi babe- don’t forget that Tomer is dropping off the puppies next Sunday at 3pm",
      senderName: "Dani Faitelson",
      timestamp: saturday,
      messageId: "puppies-1",
    });

    const event = state.getCalendarEvents("dani@c.us")[0]!;
    expect(event).toMatchObject({
      title: "Tomer is dropping off the puppies",
      status: "inferred",
      allDay: false,
    });
    expect(new Date(event.startAt)).toMatchObject({});
    expect(new Date(event.startAt).getFullYear()).toBe(2026);
    expect(new Date(event.startAt).getMonth()).toBe(7);
    expect(new Date(event.startAt).getDate()).toBe(9);
    expect(new Date(event.startAt).getHours()).toBe(15);
    expect(new Date(event.startAt).getMinutes()).toBe(0);

    state.updateCalendarEvent("dani@c.us", event.id, { status: "dismissed" });
    const reloaded = new AmirosState(filePath);
    expect(reloaded.getCalendarEvents("dani@c.us")).toHaveLength(1);
    expect(reloaded.getCalendarEvents("dani@c.us")[0]?.status).toBe("dismissed");
  });

  it("captures calendar commands for therapy and weekday-ordinal plans without duplicates", () => {
    const { state, filePath } = createState();
    const saturday = new Date(2026, 7, 1, 17, 37).getTime();

    state.rememberMessage("dani@c.us", {
      role: "user",
      content: "Remember that we have therapy with Shelly on Wednesday at 12pm",
      timestamp: saturday,
      messageId: "therapy-remember",
    });
    state.rememberMessage("dani@c.us", {
      role: "user",
      content: "Add therapy on Wednesday at 12pm to your calendar",
      timestamp: saturday + 60_000,
      messageId: "therapy-add",
    });
    state.rememberMessage("dani@c.us", {
      role: "user",
      content: "We have therapy on Wednesday at 12pm",
      timestamp: saturday + 120_000,
      messageId: "therapy-repeat",
    });
    state.rememberMessage("dani@c.us", {
      role: "user",
      content: "We have a party on Saturday the 8th",
      timestamp: saturday + 180_000,
      messageId: "party-ordinal",
    });

    const events = new AmirosState(filePath).getCalendarEvents("dani@c.us");
    expect(events).toHaveLength(2);

    const therapy = events.find((event) => /therapy/i.test(event.title));
    expect(therapy).toMatchObject({
      title: "Therapy with Shelly",
      status: "inferred",
      allDay: false,
    });
    expect(new Date(therapy!.startAt).getFullYear()).toBe(2026);
    expect(new Date(therapy!.startAt).getMonth()).toBe(7);
    expect(new Date(therapy!.startAt).getDate()).toBe(5);
    expect(new Date(therapy!.startAt).getHours()).toBe(12);

    const party = events.find((event) => /party/i.test(event.title));
    expect(party).toMatchObject({ title: "Party", status: "inferred", allDay: false });
    expect(new Date(party!.startAt).getMonth()).toBe(7);
    expect(new Date(party!.startAt).getDate()).toBe(8);
    expect(new Date(party!.startAt).getHours()).toBe(12);
  });

  it("captures a time-only plan with a named companion and verifies a referential calendar follow-up", () => {
    const { state, filePath } = createState();
    const sunday = new Date(2026, 7, 2, 17, 55).getTime();
    const chatId = "owner@c.us";
    const plan = "Dani and I are going for a sunset swim at 7:15pm";

    state.rememberMessage(chatId, {
      role: "user",
      author: "owner",
      content: plan,
      timestamp: sunday,
      messageId: "sunset-swim",
      countAsIncoming: false,
      extractSignals: true,
    });

    const reloaded = new AmirosState(filePath);
    const event = reloaded.getCalendarEvents(chatId)[0]!;
    expect(event).toMatchObject({
      title: "Sunset swim with Dani",
      status: "inferred",
      allDay: false,
      evidence: { messageId: "sunset-swim" },
    });
    expect(new Date(event.startAt).getFullYear()).toBe(2026);
    expect(new Date(event.startAt).getMonth()).toBe(7);
    expect(new Date(event.startAt).getDate()).toBe(2);
    expect(new Date(event.startAt).getHours()).toBe(19);
    expect(new Date(event.startAt).getMinutes()).toBe(15);
    expect(reloaded.getCalendarCaptureResult(chatId, plan, sunday, "sunset-swim"))
      .toMatchObject({ status: "created", event: { title: "Sunset swim with Dani" } });
    expect(reloaded.getCalendarCaptureResult(
      chatId,
      "Suggest it in the calendar",
      sunday + 3 * 60_000,
      "calendar-follow-up",
    )).toMatchObject({ status: "already_exists", event: { title: "Sunset swim with Dani" } });
  });

  it("captures dated birthday facts from incoming contacts and owner self-chat messages", () => {
    const sunday = new Date(2026, 7, 2, 14, 20).getTime();
    const incoming = createState();
    incoming.state.rememberMessage("dani@c.us", {
      role: "user",
      content: "Andrew’s birthday is on Saturday",
      senderName: "Dani",
      timestamp: sunday,
      messageId: "dani-birthday",
    });
    const incomingEvent = new AmirosState(incoming.filePath).getCalendarEvents("dani@c.us")[0];
    expect(incomingEvent).toMatchObject({ title: "Andrew's birthday", status: "inferred", allDay: false });
    expect(new Date(incomingEvent!.startAt).getDate()).toBe(8);
    expect(new Date(incomingEvent!.startAt).getHours()).toBe(12);

    const selfChat = createState();
    selfChat.state.rememberMessage("owner@c.us", {
      role: "user",
      content: "its Andrews birthday on Saturday",
      senderName: "Amir Friedman",
      timestamp: sunday,
      messageId: "owner-birthday",
      countAsIncoming: false,
      extractSignals: true,
    });
    const selfEvent = new AmirosState(selfChat.filePath).getCalendarEvents("owner@c.us")[0];
    expect(selfEvent).toMatchObject({ title: "Andrew's birthday", status: "inferred", allDay: false });
    expect(new Date(selfEvent!.startAt).getDate()).toBe(8);
    expect(new Date(selfEvent!.startAt).getHours()).toBe(12);
  });

  it("deduplicates the same birthday suggested from different chats", () => {
    const { state, filePath } = createState();
    const sunday = new Date(2026, 7, 2, 14, 20).getTime();
    state.rememberMessage("owner@c.us", {
      role: "user", content: "Andrew's birthday is on Saturday", timestamp: sunday,
      messageId: "owner-birthday", countAsIncoming: false, extractSignals: true,
    });
    state.rememberMessage("dani@c.us", {
      role: "user", content: "Andrew’s birthday is on Saturday", senderName: "Dani",
      timestamp: sunday + 60_000, messageId: "dani-birthday",
    });

    const reloaded = new AmirosState(filePath);
    expect(reloaded.listCalendarEvents().filter((event) => /Andrew.*birthday/i.test(event.title))).toHaveLength(1);
  });

  it("keeps an explicit changed time after a related suggestion was dismissed in another chat", () => {
    const { state, filePath } = createState();
    const sunday = new Date(2026, 7, 2, 15, 26).getTime();
    state.rememberMessage("dani@c.us", {
      role: "user",
      content: "Let’s go shopping at Osher Ad on Monday afternoon at 5pm",
      senderName: "Dani",
      timestamp: sunday - 86_400_000,
      messageId: "dani-shopping",
    });
    const dismissed = state.getCalendarEvents("dani@c.us")[0]!;
    state.updateCalendarEvent("dani@c.us", dismissed.id, { status: "dismissed" });

    state.rememberMessage("owner@c.us", {
      role: "user",
      author: "owner",
      content: "Need to go shopping on Monday",
      timestamp: sunday,
      messageId: "owner-shopping-vague",
      countAsIncoming: false,
      extractSignals: true,
    });
    state.rememberMessage("owner@c.us", {
      role: "user",
      author: "owner",
      content: "Add shopping tomorrow at 3pm to the calendar",
      timestamp: sunday + 60_000,
      messageId: "owner-shopping-3pm",
      countAsIncoming: false,
      extractSignals: true,
    });

    const reloaded = new AmirosState(filePath);
    const ownerEvents = reloaded.getCalendarEvents("owner@c.us");
    expect(ownerEvents).toHaveLength(1);
    expect(ownerEvents[0]).toMatchObject({
      title: "Shopping",
      status: "inferred",
      evidence: { messageId: "owner-shopping-3pm" },
    });
    expect(new Date(ownerEvents[0]!.startAt).getHours()).toBe(15);
    expect(reloaded.getCalendarCaptureResult(
      "owner@c.us",
      "Add shopping tomorrow at 3pm to the calendar",
      sunday + 60_000,
      "owner-shopping-3pm",
    )).toMatchObject({ status: "created", event: { status: "inferred" } });
  });

  it("keeps different events at the same time and verifies a keep-both follow-up", () => {
    const { state, filePath } = createState();
    const sunday = new Date(2026, 7, 2, 18, 40).getTime();
    const chatId = "owner@c.us";

    state.rememberMessage(chatId, {
      role: "user",
      author: "owner",
      content: "Add shopping tomorrow at 3pm to the calendar",
      timestamp: sunday,
      messageId: "shopping-at-3",
      countAsIncoming: false,
      extractSignals: true,
    });
    const shopping = state.getCalendarEvents(chatId)[0]!;
    state.updateCalendarEvent(chatId, shopping.id, { status: "confirmed" });

    const houseRequest = "Dani needs the house tomorrow at 3pm, add it to the calendar";
    state.rememberMessage(chatId, {
      role: "user",
      author: "owner",
      content: houseRequest,
      timestamp: sunday + 3 * 60_000,
      messageId: "dani-needs-house",
      countAsIncoming: false,
      extractSignals: true,
    });

    const events = state.getCalendarEvents(chatId);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.title)).toEqual(expect.arrayContaining([
      "Shopping",
      "Dani needs the house",
    ]));
    expect(events[0]?.startAt).toBe(events[1]?.startAt);
    expect(state.getCalendarCaptureResult(
      chatId,
      houseRequest,
      sunday + 3 * 60_000,
      "dani-needs-house",
    )).toMatchObject({ status: "created", event: { title: "Dani needs the house" } });

    state.rememberMessage(chatId, {
      role: "user",
      author: "owner",
      content: "keep both",
      timestamp: sunday + 4 * 60_000,
      messageId: "keep-both",
      countAsIncoming: false,
      extractSignals: true,
    });
    expect(state.getCalendarCaptureResult(
      chatId,
      "keep both",
      sunday + 4 * 60_000,
      "keep-both",
    )).toMatchObject({
      requested: true,
      status: "already_exists",
      event: { title: "Dani needs the house" },
    });
    expect(new AmirosState(filePath).getCalendarEvents(chatId)).toHaveLength(2);
  });

  it("retrieves old owner-chat knowledge beyond the short-term conversation window", () => {
    const { state, filePath } = createState();
    const ownerChatId = "owner@c.us";
    state.rememberMessage(ownerChatId, {
      role: "user",
      author: "owner",
      content: "I moved in with Dani in August 2023",
      timestamp: 1,
      messageId: "move-in-fact",
      countAsIncoming: false,
      extractSignals: true,
    });
    for (let index = 0; index < 450; index += 1) {
      state.rememberMessage(ownerChatId, {
        role: "user",
        content: `Unrelated saved message ${index}`,
        timestamp: index + 2,
        messageId: `noise-${index}`,
        countAsIncoming: false,
      });
    }
    state.rememberMessage(ownerChatId, {
      role: "assistant",
      content: "I do not have the move-in date",
      timestamp: 1_000,
      messageId: "incorrect-assistant-answer",
      countAsIncoming: false,
    });

    const reloaded = new AmirosState(filePath);
    const knowledge = reloaded.ownerAssistantContext(
      "When did Dani and I move in together?",
      ownerChatId,
      { knowledge: true, calendar: false },
    ).knowledge;
    expect(knowledge.some((record) => record.content === "I moved in with Dani in August 2023")).toBe(true);
    expect(knowledge.some((record) => record.content === "I do not have the move-in date")).toBe(false);
  });

  it("resolves a requester's parent before retrieving cross-chat family facts", () => {
    const { state } = createState();
    state.rememberMessage("dani@c.us", {
      role: "user", author: "contact", senderName: "Dani Faitelson", content: "Hi Amir.", timestamp: 1, messageId: "dani-hi",
    });
    state.rememberChatName("dani@c.us", "Dani Faitelson");
    state.rememberMessage("six@g.us", {
      role: "user",
      author: "group_member",
      senderName: "Karen Faitelson",
      content: "Lionel Faitelson is Dani Faitelson's father.",
      timestamp: 10,
      messageId: "dani-father",
    });
    state.rememberMessage("lionel@c.us", {
      role: "user",
      author: "contact",
      senderName: "Lionel Faitelson",
      content: "Lionel Faitelson enjoys restoring vintage radios.",
      timestamp: 20,
      messageId: "lionel-radio",
    });
    state.rememberChatName("lionel@c.us", "Lionel Faitelson");
    state.rememberMessage("owner@c.us", {
      role: "user",
      author: "owner",
      senderName: "Amir Friedman",
      content: "Amir Friedman's dad is in the hospital.",
      timestamp: 30,
      messageId: "amir-father-hospital",
      countAsIncoming: false,
    });
    state.rememberChatName("owner@c.us", "Amir Friedman");

    const context = state.ownerAssistantContext(
      "What can you tell me about my dad?",
      "dani@c.us",
      {
        knowledge: true,
        calendar: false,
        requesterName: "Dani Faitelson",
        ownerName: "Amir Friedman",
      },
    );

    expect(context.relationshipContext.join("\n")).toContain("Dani Faitelson's father");
    expect(context.knowledge.some((record) => record.id === "dani-father")).toBe(true);
    expect(context.knowledge.some((record) => record.id === "lionel-radio")).toBe(true);
    expect(context.knowledge.some((record) => record.id === "amir-father-hospital")).toBe(false);
  });

  it("preserves Amir as the author of self-chat and outgoing relationship facts", () => {
    const { state, filePath } = createState();
    state.rememberMessage("owner@c.us", {
      role: "user",
      content: "Michal is like my little sister",
      timestamp: 1,
      messageId: "legacy-owner-fact",
      countAsIncoming: false,
    });
    state.rememberChatName("owner@c.us", "Amir Friedman");
    state.rememberMessage("michal@c.us", {
      role: "assistant",
      author: "owner",
      content: "Michal was my roommate at Dizengoff 285",
      timestamp: 2,
      messageId: "outgoing-owner-fact",
      countAsIncoming: false,
    });
    state.rememberMessage("owner@c.us", {
      role: "assistant",
      author: "assistant",
      content: "Another contact described Michal as a little sister",
      timestamp: 3,
      messageId: "assistant-paraphrase",
      countAsIncoming: false,
    });

    const records = new AmirosState(filePath).searchIntelligence("Who is Michal?", 20);
    expect(records.find((record) => record.id === "legacy-owner-fact")?.sourceAuthor).toBe("owner");
    expect(records.find((record) => record.id === "outgoing-owner-fact")?.sourceAuthor).toBe("owner");
    expect(records.some((record) => record.id === "assistant-paraphrase")).toBe(false);
  });

  it("suggests events only for genuine plans, not every day or date mention", () => {
    const { state } = createState();
    const saturday = new Date(2026, 7, 1, 10, 0).getTime();
    const messages = [
      { id: "weekday", content: "Could you send me the presentation on Thursday at 4pm?" },
      { id: "numeric", content: "The blue folder is for 12/08/2026 at 09:30" },
      { id: "iso", content: "I will be offline 2026-08-10" },
      { id: "relative", content: "Tomorrow I can send the details" },
      { id: "hebrew-weekday", content: "נדבר ביום חמישי בשעה 18:00" },
      { id: "hebrew-date", content: "ניפגש ב-5 באוגוסט בשעה 18:00" },
      { id: "news", content: "Top headlines on Saturday August 1st at 6pm GMT https://news.example/story" },
      { id: "puppies", content: "Tomer is bringing the puppies next Sunday at 3pm" },
      { id: "no-date", content: "This message has no day or date in it" },
    ];

    for (const message of messages) {
      state.rememberMessage("dates@c.us", {
        role: "user",
        content: message.content,
        timestamp: saturday,
        messageId: message.id,
      });
    }

    const events = state.getCalendarEvents("dates@c.us");
    expect(events).toHaveLength(3);
    expect(events.some((event) => event.evidence.messageId === "no-date")).toBe(false);
    expect(events.some((event) => ["weekday", "numeric", "iso", "relative", "news"].includes(event.evidence.messageId || ""))).toBe(false);

    const hebrewWeekday = events.find((event) => event.evidence.messageId === "hebrew-weekday")!;
    expect(new Date(hebrewWeekday.startAt).getDate()).toBe(6);
    expect(new Date(hebrewWeekday.startAt).getHours()).toBe(18);

    const hebrewDate = events.find((event) => event.evidence.messageId === "hebrew-date")!;
    expect(new Date(hebrewDate.startAt).getDate()).toBe(5);
    expect(new Date(hebrewDate.startAt).getHours()).toBe(18);

    const puppies = events.find((event) => event.evidence.messageId === "puppies")!;
    expect(puppies.title).toContain("Tomer");
    expect(new Date(puppies.startAt).getHours()).toBe(15);
  });

  it("does not repeat calendar events after they are rejected or approved", () => {
    const saturday = new Date(2026, 7, 1, 16, 30).getTime();

    for (const status of ["dismissed", "confirmed"] as const) {
      const { state, filePath } = createState();
      const chatId = `${status}@c.us`;
      state.rememberMessage(chatId, {
        role: "user",
        content: "Tomer is dropping off the puppies next Sunday at 3pm",
        timestamp: saturday,
        messageId: `${status}-original`,
      });
      const original = state.getCalendarEvents(chatId)[0]!;
      state.updateCalendarEvent(chatId, original.id, {
        status,
        title: status === "confirmed" ? "Puppies arrive" : original.title,
      });

      state.mergeAnalyzedIntelligence(chatId, {
        insights: [],
        commitments: [],
        events: [{
          title: "Tomer bringing the puppies",
          startAt: original.startAt,
          allDay: false,
          evidence: {
            messageId: `${status}-analysis-repeat`,
            excerpt: "Reminder: Tomer is bringing the puppies next Sunday at 3pm",
            timestamp: saturday + 30_000,
          },
        }],
      });

      state.rememberMessage(chatId, {
        role: "user",
        content: "Reminder: Tomer is bringing the puppies next Sunday at 3pm",
        timestamp: saturday + 60_000,
        messageId: `${status}-repeat`,
      });

      const reloaded = new AmirosState(filePath);
      expect(reloaded.getCalendarEvents(chatId)).toHaveLength(1);
      expect(reloaded.getCalendarEvents(chatId)[0]).toMatchObject({ status });
    }
  });

  it("persists a compact intelligence question history", () => {
    const { state, filePath } = createState();
    state.rememberIntelligenceAnswer("What is planned?", "Theater on Friday.", [{
      id: "event-1",
      chatId: "friend@c.us",
      kind: "calendar_event",
      content: "Theater — Friday",
      timestamp: Date.now(),
      score: 10,
    }]);

    expect(new AmirosState(filePath).intelligenceQuestionHistory()[0]).toMatchObject({
      question: "What is planned?",
      answer: "Theater on Friday.",
    });
  });
});
