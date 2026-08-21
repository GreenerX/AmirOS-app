import {
  demoChats,
  demoContact,
  demoDashboard,
  demoIntelligenceData,
  demoMessagesForChat,
} from "./demo";
import type {
  ChatMessage,
  ChatMemoryEntry,
  ChatSummary,
  CalendarEvent,
  ContactMemoryItem,
  ContactInsight,
  ContactPreferences,
  ContactProfile,
  DashboardData,
  KnowledgeTrackingDefault,
  ModelPreset,
  GroupConversationSummary,
  IntelligenceData,
  IntelligenceAnswerFeedbackInput,
  IntelligenceAnswerFeedbackSummary,
  IntelligenceFeedbackReviewQueueItem,
  IntelligenceSearchResult,
  AssistantSuggestionContext,
  ProactiveIntelligenceItem,
  RelationshipCommitment,
  TodoTask,
  ThemeName,
  TerminalLog,
  WritingStyleProfile,
  ScheduledMessage,
  AmirOSUpdateStatus,
  ControlCenterStatus,
} from "./types";
import type { CurrentWeather, TimeZoneBackgrounds, TimeZoneCity } from "./timezone-weather";

const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";
const demoManualMemory = new Map<string, ContactMemoryItem[]>();
const demoContacts = new Map<string, ContactPreferences>();
const demoScheduledMessages = new Map<string, ScheduledMessage[]>();

function demoContactFor(chatId: string): ContactPreferences {
  const existing = demoContacts.get(chatId);
  if (existing) return existing;
  const initial = {
    ...structuredClone(demoContact),
    mode: demoChats.find((chat) => chat.id === chatId)?.mode || "off",
  };
  demoContacts.set(chatId, initial);
  return initial;
}

function demoMemoryFor(chatId: string): ContactMemoryItem[] {
  const existing = demoManualMemory.get(chatId);
  if (existing) return existing;
  const initial = [
    {
      id: "demo-memory-1",
      content: "Prefers short pricing updates and Thursday deliveries.",
      createdAt: Date.now() - 86_400_000,
    },
  ];
  demoManualMemory.set(chatId, initial);
  return initial;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function getDashboard(): Promise<DashboardData> {
  return isDemo ? structuredClone(demoDashboard) : request("/api/dashboard");
}

export async function getUpdateStatus(refresh = false): Promise<AmirOSUpdateStatus> {
  if (isDemo) {
    return {
      status: "current",
      currentVersion: demoDashboard.release.version,
      latestVersion: demoDashboard.release.version,
      checkedAt: Date.now(),
    };
  }
  return request(`/api/update${refresh ? "?refresh=1" : ""}`);
}

export async function startAmirosUpdate(): Promise<{ ok: true; latestVersion: string }> {
  if (isDemo) return { ok: true, latestVersion: "0.5.1" };
  return request("/api/update", { method: "POST", body: "{}" });
}

export async function getControlCenterStatus(): Promise<ControlCenterStatus> {
  return isDemo ? structuredClone(demoDashboard.controlCenter) : request("/api/control-center");
}

export async function beginControlCenterActivation(): Promise<ControlCenterStatus> {
  return isDemo
    ? { ...structuredClone(demoDashboard.controlCenter), status: "pending", detail: "Finish approving this Mac in the Control Center.", activationUrl: "https://amiros-control-center.netlify.app/connect/?code=demo" }
    : request("/api/control-center/activation", { method: "POST", body: "{}" });
}

export async function checkControlCenterActivation(): Promise<ControlCenterStatus> {
  return isDemo ? structuredClone(demoDashboard.controlCenter) : request("/api/control-center/activation-status", { method: "POST", body: "{}" });
}

export async function reconnectThisMac(): Promise<ControlCenterStatus> {
  return isDemo
    ? { ...structuredClone(demoDashboard.controlCenter), status: "pending", detail: "Finish approving this Mac in the Control Center.", setupState: "device_pending", activationUrl: "https://amiros-control-center.netlify.app/connect/?code=demo" }
    : request("/api/control-center/reconnect", { method: "POST", body: "{}" });
}

export async function refreshControlCenterStatus(): Promise<ControlCenterStatus> {
  return isDemo ? structuredClone(demoDashboard.controlCenter) : request("/api/control-center/refresh", { method: "POST", body: "{}" });
}

export async function submitBetaSupportTicket(input: {
  type: "Bug" | "Feedback" | "Feature request" | "Setup help";
  subject: string;
  details: string;
}): Promise<{ ticket: { ticketId: number; id: string; state: string } }> {
  if (isDemo) return { ticket: { ticketId: 101, id: "SUP-DEMO", state: "New" } };
  return request("/api/control-center/support-ticket", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function reportControlCenterOnboardingProgress(
  event: "whatsapp_connected" | "first_people_selected",
): Promise<void> {
  if (isDemo) return;
  await request("/api/control-center/onboarding-progress", {
    method: "POST",
    body: JSON.stringify({ event }),
  });
}

export async function summarizeDashboardActionMessage(message: string): Promise<{ summary: string }> {
  if (isDemo) return { summary: message };
  return request("/api/dashboard/action-summary", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export async function ensureTodaysFocusIcon(item: {
  title: string;
  type: "commitment" | "todo" | "calendar" | "reply";
}): Promise<{ url: string; cached: boolean }> {
  if (isDemo) return { url: "", cached: true };
  return request("/api/todays-focus/icon", { method: "POST", body: JSON.stringify(item) });
}

export async function searchTimeZoneCities(query: string): Promise<TimeZoneCity[]> {
  if (isDemo) return [
    { id: 5128581, name: "New York", country: "United States", admin1: "New York", latitude: 40.71427, longitude: -74.00597, timezone: "America/New_York" },
    { id: 293397, name: "Tel Aviv", country: "Israel", admin1: "Tel Aviv", latitude: 32.08088, longitude: 34.78057, timezone: "Asia/Jerusalem" },
    { id: 1850147, name: "Tokyo", country: "Japan", admin1: "Tokyo", latitude: 35.6895, longitude: 139.69171, timezone: "Asia/Tokyo" },
  ].filter((city) => city.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (await request<{ cities: TimeZoneCity[] }>(`/api/timezones/search?q=${encodeURIComponent(query)}`)).cities;
}

export async function getCurrentWeather(latitude: number, longitude: number, timezone = "auto"): Promise<CurrentWeather> {
  if (isDemo) return { temperatureC: 28, weatherCode: 2, isDay: true, observedAt: new Date().toISOString(), timezone };
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), timezone });
  return request(`/api/weather/current?${params.toString()}`);
}

export async function ensureTimeZoneBackgrounds(city: TimeZoneCity): Promise<{
  cityKey: string;
  backgrounds: TimeZoneBackgrounds;
  cached: boolean;
}> {
  if (isDemo) return { cityKey: `demo-${city.id}`, backgrounds: {}, cached: true };
  return request("/api/timezones/backgrounds", { method: "POST", body: JSON.stringify(city) });
}

export type BackendRestartStatus = {
  status: "running" | "restarting" | "offline" | "failed";
  updatedAt: number;
  requestedAt?: number;
};

export async function getBackendRestartStatus(): Promise<BackendRestartStatus> {
  if (isDemo) return { status: "running", updatedAt: Date.now() };
  return request("/api/system/backend-status");
}

export async function restartAmirosBackend(): Promise<{ accepted: true; status: BackendRestartStatus }> {
  if (isDemo) return { accepted: true, status: { status: "restarting", updatedAt: Date.now(), requestedAt: Date.now() } };
  return request("/api/system/backend-restart", { method: "POST", body: "{}" });
}

export type ChatsPage = { chats: ChatSummary[]; hasMore: boolean };

export async function getChats(offset = 0, limit = 80): Promise<ChatsPage> {
  if (isDemo) return { chats: structuredClone(demoChats.slice(offset, offset + limit)), hasMore: offset + limit < demoChats.length };
  return request<ChatsPage>(`/api/chats?offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`);
}

export async function getMessages(chatId: string): Promise<{
  chatId: string;
  messages: ChatMessage[];
  groupDescription?: string;
  contact: ContactPreferences;
  memory: ChatMemoryEntry[];
  manualMemory: ContactMemoryItem[];
  profile?: ContactProfile;
  insights: ContactInsight[];
  commitments: RelationshipCommitment[];
  events: CalendarEvent[];
  styleProfile?: WritingStyleProfile;
  groupSummary?: GroupConversationSummary;
  incomingMessageCount: number;
}> {
  if (isDemo) {
    return {
      chatId,
      messages: structuredClone(demoMessagesForChat(chatId)),
      groupDescription: demoChats.find((chat) => chat.id === chatId)?.isGroup ? "Product launch coordination and team updates" : undefined,
      memory: [
        {
          role: "user",
          content: "Prefers concise pricing updates and clear delivery dates.",
          senderName: demoChats.find((chat) => chat.id === chatId)?.isGroup
            ? "Sana Farooq"
            : undefined,
          timestamp: Date.now() - 3_600_000,
        },
      ],
      manualMemory: structuredClone(demoMemoryFor(chatId)),
      insights: [],
      commitments: [],
      events: [],
      profile: {
        summary: "Relationship\n• Active client relationship.\n\nCommunication style\n• Direct, practical, and deadline-focused.\n\nPreferences & important facts\n• Prefers concise pricing updates and clear Thursday delivery dates.",
        updatedAt: Date.now() - 3_600_000,
        sourceMessageCount: 4,
      },
      incomingMessageCount: 6,
      contact: structuredClone(demoContactFor(chatId)),
    };
  }
  return request(`/api/chats/${encodeURIComponent(chatId)}/messages`);
}

export async function getIntelligence(): Promise<IntelligenceData> {
  if (isDemo) return demoIntelligenceData();
  return request("/api/intelligence");
}

export async function updateProactiveIntelligence(
  item: Pick<ProactiveIntelligenceItem, "id" | "fingerprint" | "kind" | "chatId">,
  status: "opened" | "dismissed" | "resolved",
): Promise<void> {
  if (isDemo) return;
  await request(`/api/intelligence/proactive/${encodeURIComponent(item.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      fingerprint: item.fingerprint,
      status,
      kind: item.kind,
      chatId: item.chatId,
    }),
  });
}

export async function markChatRead(chatId: string): Promise<void> {
  if (isDemo) return;
  await request(`/api/chats/${encodeURIComponent(chatId)}/read`, { method: "POST", body: "{}" });
}

export async function scanChatHistory(chatId: string, limit = 300): Promise<{
  scanned: number;
  added: number;
  messages: ChatMessage[];
  memory: ChatMemoryEntry[];
  incomingMessageCount: number;
}> {
  if (isDemo) {
    const messages = structuredClone(demoMessagesForChat(chatId)).slice(-limit);
    return {
      scanned: messages.length,
      added: messages.length,
      messages,
      memory: [],
      incomingMessageCount: messages.filter((message) => !message.fromMe).length,
    };
  }
  return request(`/api/chats/${encodeURIComponent(chatId)}/history/scan`, {
    method: "POST",
    body: JSON.stringify({ limit }),
  });
}

export async function deleteIntelligenceQuestion(id: string): Promise<void> {
  if (isDemo) return;
  await request(`/api/intelligence/history/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function updateCalendarEvent(
  chatId: string,
  eventId: string,
  patch: { status?: CalendarEvent["status"]; title?: string; startAt?: number; endAt?: number; allDay?: boolean; location?: string },
): Promise<CalendarEvent> {
  return (await request<{ event: CalendarEvent }>(
    `/api/contacts/${encodeURIComponent(chatId)}/calendar/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  )).event;
}

export async function regenerateCalendarTitle(chatId: string, eventId: string): Promise<string> {
  return (await request<{ title: string }>(
    `/api/contacts/${encodeURIComponent(chatId)}/calendar/${encodeURIComponent(eventId)}/regenerate-title`,
    { method: "POST", body: "{}" },
  )).title;
}

export type CalendarSubscriptionInfo = {
  httpUrl: string;
  webcalUrl?: string;
  publicUrlConfigured: boolean;
  confirmedEvents: number;
};

export async function getCalendarSubscription(): Promise<CalendarSubscriptionInfo> {
  if (isDemo) return {
    httpUrl: "http://127.0.0.1:3789/api/calendar/feed.ics?token=demo",
    webcalUrl: undefined,
    publicUrlConfigured: false,
    confirmedEvents: 0,
  };
  return request("/api/calendar/subscription");
}

function demoAskEvidence(
  messageId: string,
  chatId: string,
  conversationName: string,
  authorName: string | undefined,
  timestamp: number,
  originalText: string,
) {
  return { messageId, chatId, conversationName, authorName, timestamp, originalText, exactMessageAvailable: true as const };
}

export async function askIntelligence(
  query: string,
  options?: {
    followUp?: { question: string; answer: string; sourceRefs?: Array<{ id: string; chatId: string; kind: "insight" }> };
    scope?: { knowledge: boolean; calendar: boolean };
    selectedContactId?: string;
    suggestionContext?: AssistantSuggestionContext;
    improvement?: { answerId: string; reasons?: IntelligenceAnswerFeedbackInput["reasons"]; note?: string };
    signal?: AbortSignal;
  },
): Promise<IntelligenceSearchResult> {
  if (isDemo) {
    const answerId = `demo-answer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (/\bmichelle\b/iu.test(query) && !options?.selectedContactId) {
      return {
        answerId,
        answer: "Which Michelle do you mean?",
        evidenceIds: [],
        sources: [],
        disambiguation: [
          {
            chatId: "michelle-soffen@demo",
            contactName: "Michelle Soffen",
            detail: "Director of Product · Vertex Solutions",
            avatarUrl: "/demo-avatars/michelle-soffen.png",
            lastInteractionAt: new Date(2026, 7, 16, 12).getTime(),
          },
          {
            chatId: "michelle-chechi@demo",
            contactName: "Michelle Chechi",
            detail: "Operations Lead · Northstar",
            avatarUrl: "/demo-avatars/michelle-chechi.png",
            lastInteractionAt: new Date(2026, 7, 10, 12).getTime(),
          },
        ],
      };
    }
    if (options?.selectedContactId === "michelle-soffen@demo") {
      const timestamp = new Date(2026, 7, 16, 12).getTime();
      return {
        answerId,
        answer: "The latest I know is from Aug 16: Michelle Soffen was focused on product planning and vendor evaluation, and she preferred clear decisions with practical next steps. I don’t have a newer update on how she is today.",
        evidenceIds: ["demo-michelle-soffen-context"],
        claims: [{ text: "Michelle Soffen was focused on product planning and vendor evaluation.", evidenceIds: ["demo-michelle-soffen-context"] }],
        resolvedContactId: "michelle-soffen@demo",
        sources: [{
          id: "demo-michelle-soffen-context", chatId: "michelle-soffen@demo", contactName: "Michelle Soffen",
          kind: "insight", content: "Michelle was focused on product planning and vendor evaluation and preferred clear decisions with practical next steps.",
          sourceContent: "I’m focused on the product plan and vendor evaluation. Please bring clear decisions and practical next steps.",
          evidence: demoAskEvidence("demo-michelle-soffen-message", "michelle-soffen@demo", "Michelle Soffen", "Michelle Soffen", timestamp, "I’m focused on the product plan and vendor evaluation. Please bring clear decisions and practical next steps."),
          senderName: "Michelle Soffen", timestamp, score: 100,
        }],
      };
    }
    if (options?.selectedContactId === "michelle-chechi@demo") {
      const timestamp = new Date(2026, 7, 10, 12).getTime();
      return {
        answerId,
        answer: "The latest I know is from Aug 10: Michelle Chechi was coordinating the next operational handoff and focused on ownership and timing. I don’t have a newer update on how she is today.",
        evidenceIds: ["demo-michelle-chechi-context"],
        claims: [{ text: "Michelle Chechi was coordinating the next operational handoff.", evidenceIds: ["demo-michelle-chechi-context"] }],
        resolvedContactId: "michelle-chechi@demo",
        sources: [{
          id: "demo-michelle-chechi-context", chatId: "michelle-chechi@demo", contactName: "Michelle Chechi",
          kind: "insight", content: "Michelle was coordinating the next operational handoff and focused on ownership and timing.",
          sourceContent: "I’m coordinating the next operational handoff. Can we confirm who owns each step and when it happens?",
          evidence: demoAskEvidence("demo-michelle-chechi-message", "michelle-chechi@demo", "Michelle Chechi", "Michelle Chechi", timestamp, "I’m coordinating the next operational handoff. Can we confirm who owns each step and when it happens?"),
          senderName: "Michelle Chechi", timestamp, score: 100,
        }],
      };
    }
    const data = demoIntelligenceData();
    if (/icon demo|worth remembering|remember about amir/iu.test(query)) {
      const timestamp = new Date(2026, 7, 18, 10, 30).getTime();
      return {
        answerId,
        answer: [
          "A few things stand out as worth remembering:",
          "- **Flexible collaboration:** Dan is flexible about where you meet and wants to share customer and sales insights relevant to your progress together.",
          "- **Reliable connection:** You need reliable internet when working with Dan, and these are among your most productive hours.",
          "- **A warm invitation:** Maya misses having you around, wants to try your app, and invited you and Dani to a Sweetspot party.",
          "- **Affection matters:** You and Dani use affectionate terms like ‘Babe’ and ‘Love you.’",
          "- **Your Tel Aviv context:** You returned to high-tech after nearly pursuing music and aren’t a professional DJ or musician.",
          "- **Music is part of your story:** Rotem contacted you about possibly playing at her partner’s release party.",
          "- **A useful industry connection:** Payton has a WME connection and wants to help present films to Hollywood.",
        ].join("\n"),
        evidenceIds: ["demo-sana-launch-topic"],
        claims: [{ text: "Sana asked to reserve the first 20 minutes for launch-sequence decisions.", evidenceIds: ["demo-sana-launch-topic"] }],
        listIcons: ["collaboration", "connection", "event", "people", "location", "music", "work"],
        resolvedContactId: "sana@demo",
        sources: [{
          id: "demo-sana-launch-topic", chatId: "sana@demo", contactName: "Sana Farooq", kind: "insight",
          content: "A compact set of remembered relationship details.", senderName: "Sana Farooq", timestamp, score: 100,
          sourceContent: "Let’s keep the first 20 minutes focused on the launch sequence and who owns each decision.",
          evidence: demoAskEvidence("demo-sana-launch-message", "sana@demo", "Sana Farooq", "Sana Farooq", timestamp, "Let’s keep the first 20 minutes focused on the launch sequence and who owns each decision."),
        }],
      };
    }
    if (options?.suggestionContext?.sourceIds.includes("demo-sana-personal-topic")) {
      const relationship = data.changes.find((item) => item.id === "demo-sana-personal-topic")!;
      return {
        answerId,
        answer: "Sana’s role in your work has shifted from a project contact toward a strategic partner. The recent signal is that she values a short personal check-in before moving into project details—useful context for how you open the next conversation.",
        evidenceIds: [relationship.id],
        claims: [{ text: "Sana values a short personal check-in before project details.", evidenceIds: [relationship.id] }],
        resolvedContactId: "sana@demo",
        sources: [{
          id: relationship.id, chatId: relationship.chatId, contactName: relationship.contactName,
          kind: "insight", content: relationship.content, senderName: relationship.evidence.senderName,
          sourceContent: relationship.evidence.excerpt,
          evidence: demoAskEvidence("demo-sana-personal-message", relationship.chatId, relationship.contactName, relationship.evidence.senderName, relationship.updatedAt, relationship.evidence.excerpt),
          timestamp: relationship.updatedAt, score: 100,
        }],
      };
    }
    if (options?.suggestionContext?.sourceIds.includes("demo-bilal-fact")) {
      const relationship = data.changes.find((item) => item.id === "demo-bilal-fact")!;
      return {
        answerId,
        answer: "For delivery planning, Bilal usually needs shipments sent to DHA within three business days. That preference comes from his latest saved delivery conversation, so it’s useful context when you confirm timing with him.",
        evidenceIds: [relationship.id],
        claims: [{ text: "Bilal usually needs shipments sent to DHA within three business days.", evidenceIds: [relationship.id] }],
        resolvedContactId: "bilal@demo",
        sources: [{
          id: relationship.id, chatId: relationship.chatId, contactName: relationship.contactName,
          kind: "insight", content: relationship.content, senderName: relationship.evidence.senderName,
          sourceContent: relationship.evidence.excerpt,
          evidence: demoAskEvidence("demo-bilal-message", relationship.chatId, relationship.contactName, relationship.evidence.senderName, relationship.evidence.timestamp, relationship.evidence.excerpt),
          timestamp: relationship.evidence.timestamp, score: 100,
        }],
      };
    }
    const event = data.events.find((item) => item.id === "demo-next-event")!;
    const insight = data.changes.find((item) => item.id === "demo-sana-launch-topic")!;
    return {
      answerId,
      answer: "Before meeting Sana tomorrow, bring the final pricing sheet and a one-page decision summary. She values concise recommendations, and she asked to reserve the first 20 minutes to agree the launch sequence and named owners.",
      evidenceIds: [event.id, insight.id],
      claims: [
        { text: "The meeting has a final pricing sheet and decision-summary preparation need.", evidenceIds: [event.id] },
        { text: "Sana asked to reserve time for launch-sequence decisions.", evidenceIds: [insight.id] },
      ],
      resolvedContactId: "sana@demo",
      sources: [
        { id: event.id, chatId: event.chatId, contactName: event.contactName, kind: "calendar_event", content: `${event.title} · ${event.location}`, sourceContent: event.evidence.excerpt, evidence: demoAskEvidence("demo-next-event-message", event.chatId, event.contactName, event.evidence.senderName, event.evidence.timestamp, event.evidence.excerpt), senderName: event.evidence.senderName, timestamp: event.startAt, score: 100 },
        { id: insight.id, chatId: insight.chatId, contactName: insight.contactName, kind: "insight", content: insight.content, sourceContent: insight.evidence.excerpt, evidence: demoAskEvidence("demo-sana-launch-topic-message", insight.chatId, insight.contactName, insight.evidence.senderName, insight.evidence.timestamp, insight.evidence.excerpt), senderName: insight.evidence.senderName, timestamp: insight.updatedAt, score: 100 },
      ],
    };
  }
  return request("/api/intelligence/search", {
    method: "POST",
    body: JSON.stringify({
      query,
      followUp: options?.followUp,
      scope: options?.scope,
      selectedContactId: options?.selectedContactId,
      suggestionContext: options?.suggestionContext,
      improvement: options?.improvement,
    }),
    signal: options?.signal,
  });
}

export async function submitIntelligenceAnswerFeedback(
  answerId: string,
  input: IntelligenceAnswerFeedbackInput,
): Promise<IntelligenceAnswerFeedbackSummary> {
  if (isDemo) return { rating: input.rating, reasons: input.reasons || [], note: input.note, createdAt: Date.now() };
  return (await request<{ feedback: IntelligenceAnswerFeedbackSummary }>(
    `/api/intelligence/answers/${encodeURIComponent(answerId)}/feedback`,
    { method: "POST", body: JSON.stringify(input) },
  )).feedback;
}

/** Additive local API contract; no renderer consumes this queue yet. */
export async function getIntelligenceFeedbackReviewQueue(): Promise<IntelligenceFeedbackReviewQueueItem[]> {
  if (isDemo) return [];
  return (await request<{ items: IntelligenceFeedbackReviewQueueItem[] }>("/api/intelligence/feedback/review")).items;
}

export async function updateIntelligenceFeedbackReview(
  feedbackId: string,
  status: IntelligenceFeedbackReviewQueueItem["status"],
): Promise<{ feedbackId: string; status: IntelligenceFeedbackReviewQueueItem["status"]; updatedAt: number }> {
  if (isDemo) return { feedbackId, status, updatedAt: Date.now() };
  return (await request<{ review: { feedbackId: string; status: IntelligenceFeedbackReviewQueueItem["status"]; updatedAt: number } }>(
    `/api/intelligence/feedback/review/${encodeURIComponent(feedbackId)}`,
    { method: "PATCH", body: JSON.stringify({ status }) },
  )).review;
}

export async function analyzeContactIntelligence(
  chatId: string,
  messageLimit?: number,
  advanceLearningCursor = false,
): Promise<{
  insights: ContactInsight[];
  commitments: RelationshipCommitment[];
}> {
  if (isDemo) return { insights: [], commitments: [] };
  return request(`/api/contacts/${encodeURIComponent(chatId)}/intelligence/analyze`, {
    method: "POST",
    body: JSON.stringify({
      ...(messageLimit ? { messageLimit } : {}),
      ...(advanceLearningCursor ? { advanceLearningCursor: true } : {}),
    }),
  });
}

export async function updateContactInsight(
  chatId: string,
  insightId: string,
  patch: { status?: ContactInsight["status"]; content?: string },
): Promise<ContactInsight[]> {
  return (await request<{ insights: ContactInsight[] }>(
    `/api/contacts/${encodeURIComponent(chatId)}/insights/${encodeURIComponent(insightId)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  )).insights;
}

export async function updateContactCommitment(
  chatId: string,
  commitmentId: string,
  status: RelationshipCommitment["status"],
): Promise<RelationshipCommitment[]> {
  return (await request<{ commitments: RelationshipCommitment[] }>(
    `/api/contacts/${encodeURIComponent(chatId)}/commitments/${encodeURIComponent(commitmentId)}`,
    { method: "PATCH", body: JSON.stringify({ status }) },
  )).commitments;
}

export async function updateTodoTask(
  chatId: string,
  todoId: string,
  patch: { status?: TodoTask["status"]; dueAt?: number | null; priority?: TodoTask["priority"] },
): Promise<TodoTask> {
  const status = patch.status;
  if (isDemo) {
    return {
      id: todoId,
      chatId,
      contactName: demoChats.find((chat) => chat.id === chatId)?.name || "WhatsApp contact",
      title: "To-do updated",
      status: status || "open",
      priority: patch.priority || "normal",
      dueAt: patch.dueAt === null ? undefined : patch.dueAt,
      completedAt: status === "done" ? Date.now() : undefined,
      evidence: { excerpt: "Demo to-do", timestamp: Date.now() },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
  const path = `/api/contacts/${encodeURIComponent(chatId)}/todos/${encodeURIComponent(todoId)}`;
  return (await request<{ todo: TodoTask }>(
    status === "done" ? `${path}/complete` : path,
    status === "done"
      ? { method: "POST" }
      : { method: "PATCH", body: JSON.stringify(patch) },
  )).todo;
}

export async function generateWritingStyle(chatId: string): Promise<WritingStyleProfile> {
  return (await request<{ styleProfile: WritingStyleProfile }>(
    `/api/contacts/${encodeURIComponent(chatId)}/style-profile`,
    { method: "POST", body: "{}" },
  )).styleProfile;
}

export async function generateGroupSummary(chatId: string): Promise<GroupConversationSummary> {
  return (await request<{ groupSummary: GroupConversationSummary }>(
    `/api/contacts/${encodeURIComponent(chatId)}/group-summary`,
    { method: "POST", body: "{}" },
  )).groupSummary;
}

export async function getTerminalLog(): Promise<TerminalLog> {
  if (isDemo) {
    return {
      output: [
        "Starting with economy preset: gpt-5.6-luna, gpt-image-1-mini, gpt-4o-mini-transcribe",
        "AmirOS is available at http://127.0.0.1:3789",
        "WhatsApp device authenticated; syncing message listener...",
        "WhatsApp bot is ready.",
        "WhatsApp voice auto-download enabled.",
      ].join("\n"),
      updatedAt: Date.now(),
    };
  }
  return request("/api/terminal");
}

export type TerminalStreamStatus = "connecting" | "live" | "reconnecting";

export function subscribeTerminalLog(handlers: {
  onLog: (log: TerminalLog) => void;
  onHeartbeat: (checkedAt: number) => void;
  onStatus: (status: TerminalStreamStatus) => void;
}): () => void {
  if (isDemo) {
    handlers.onStatus("live");
    handlers.onHeartbeat(Date.now());
    const interval = window.setInterval(() => handlers.onHeartbeat(Date.now()), 2_000);
    return () => window.clearInterval(interval);
  }

  handlers.onStatus("connecting");
  const stream = new EventSource("/api/terminal/stream");
  stream.addEventListener("open", () => handlers.onStatus("live"));
  stream.addEventListener("log", (event) => {
    try {
      handlers.onLog(JSON.parse((event as MessageEvent<string>).data) as TerminalLog);
    } catch {
      handlers.onStatus("reconnecting");
    }
  });
  stream.addEventListener("heartbeat", (event) => {
    try {
      const value = JSON.parse((event as MessageEvent<string>).data) as { checkedAt?: number };
      handlers.onHeartbeat(Number.isFinite(value.checkedAt) ? value.checkedAt! : Date.now());
      handlers.onStatus("live");
    } catch {
      handlers.onHeartbeat(Date.now());
    }
  });
  stream.addEventListener("error", () => handlers.onStatus("reconnecting"));
  return () => stream.close();
}

export async function setPaused(paused: boolean): Promise<void> {
  if (isDemo) return;
  await request("/api/bot/pause", { method: "POST", body: JSON.stringify({ paused }) });
}

export async function setPreset(preset: ModelPreset): Promise<void> {
  if (isDemo) return;
  await request("/api/model-preset", { method: "POST", body: JSON.stringify({ preset }) });
}

export async function updateContact(
  chatId: string,
  patch: Partial<ContactPreferences>,
): Promise<ContactPreferences> {
  if (isDemo) {
    const updated = { ...demoContactFor(chatId), ...patch };
    demoContacts.set(chatId, updated);
    return structuredClone(updated);
  }
  return (
    await request<{ contact: ContactPreferences }>(
      `/api/contacts/${encodeURIComponent(chatId)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    )
  ).contact;
}

export async function addContactMemory(
  chatId: string,
  content: string,
): Promise<ContactMemoryItem[]> {
  if (isDemo) {
    const updated = [
      ...demoMemoryFor(chatId),
      { id: `demo-memory-${Date.now()}`, content, createdAt: Date.now() },
    ];
    demoManualMemory.set(chatId, updated);
    return structuredClone(updated);
  }
  return (
    await request<{ manualMemory: ContactMemoryItem[] }>(
      `/api/contacts/${encodeURIComponent(chatId)}/memory`,
      { method: "POST", body: JSON.stringify({ content }) },
    )
  ).manualMemory;
}

export async function removeContactMemory(
  chatId: string,
  itemId: string,
): Promise<ContactMemoryItem[]> {
  if (isDemo) {
    const updated = demoMemoryFor(chatId).filter((item) => item.id !== itemId);
    demoManualMemory.set(chatId, updated);
    return structuredClone(updated);
  }
  return (
    await request<{ manualMemory: ContactMemoryItem[] }>(
      `/api/contacts/${encodeURIComponent(chatId)}/memory/${encodeURIComponent(itemId)}`,
      { method: "DELETE" },
    )
  ).manualMemory;
}

export async function generateContactProfile(
  chatId: string,
): Promise<{ profile: ContactProfile; incomingMessageCount: number }> {
  if (isDemo) {
    return {
      profile: {
        summary: "Relationship\n• Long-term client with a practical working relationship.\n\nCommunication style\n• Direct, concise, and deadline-focused.\n\nPersonality signals\n• Organized and decisive, based on the available messages.\n\nPreferences & important facts\n• Values clear prices and reliable delivery dates.",
        updatedAt: Date.now(),
        sourceMessageCount: 6,
      },
      incomingMessageCount: 6,
    };
  }
  return request(`/api/contacts/${encodeURIComponent(chatId)}/profile`, {
    method: "POST",
    body: "{}",
  });
}

export function contactProfilePdfUrl(chatId: string): string {
  const query = new URLSearchParams({
    tzOffset: String(new Date().getTimezoneOffset()),
    locale: navigator.language || "en",
  });
  return `/api/contacts/${encodeURIComponent(chatId)}/profile.pdf?${query}`;
}

export function whatsappQrUrl(): string {
  if (isDemo) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="white"/><g fill="#17231e"><path d="M8 8h34v34H8zm8 8v18h18V16zM78 8h34v34H78zm8 8v18h18V16zM8 78h34v34H8zm8 8v18h18V86z"/><path d="M50 8h10v10H50zm14 0h8v18h-8zM48 24h12v8H48zm16 8h8v12h-8zM48 48h10v10H48zm16 0h18v8H64zm24 0h10v18H88zM104 48h8v10h-8zM48 64h18v8H48zm24-2h8v18h-8zm14 8h12v10H86zm18-6h8v18h-8zM50 80h10v10H50zm16 6h12v8H66zm18 0h10v10H84zm20 2h8v24h-8zM48 100h14v12H48zm22 2h26v10H70z"/></g></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
  return `/api/qr?refresh=${Date.now()}`;
}

export async function relinkWhatsApp(): Promise<DashboardData["connection"]> {
  if (isDemo) {
    return {
      status: "qr",
      detail: "Scan the QR code with WhatsApp to link this Mac",
    };
  }
  return (
    await request<{ connection: DashboardData["connection"] }>(
      "/api/whatsapp/relink",
      { method: "POST", body: "{}" },
    )
  ).connection;
}

export async function sendMessage(chatId: string, body: string): Promise<void> {
  if (isDemo) return;
  await request(`/api/chats/${encodeURIComponent(chatId)}/send`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function translateComposerDraft(input: {
  body: string;
  targetLanguage: string;
  sourceLanguage?: string;
}): Promise<{ body: string; targetLanguage: string }> {
  if (isDemo) return { body: input.body, targetLanguage: input.targetLanguage };
  return request("/api/translate", { method: "POST", body: JSON.stringify(input) });
}

export async function getScheduledMessages(chatId: string): Promise<ScheduledMessage[]> {
  if (isDemo) return structuredClone(demoScheduledMessages.get(chatId) || []);
  return (await request<{ scheduledMessages: ScheduledMessage[] }>(`/api/scheduled-messages?chatId=${encodeURIComponent(chatId)}`)).scheduledMessages;
}

export async function scheduleMessage(chatId: string, input: {
  body: string;
  scheduledAt: number;
  timezone: string;
}): Promise<ScheduledMessage> {
  if (isDemo) {
    const now = Date.now();
    const scheduledMessage: ScheduledMessage = {
      id: `scheduled-${now}`,
      chatId,
      ...input,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
      idempotencyKey: `demo-${now}`,
      source: "owner",
    };
    demoScheduledMessages.set(chatId, [...(demoScheduledMessages.get(chatId) || []), scheduledMessage]);
    return structuredClone(scheduledMessage);
  }
  return (await request<{ scheduledMessage: ScheduledMessage }>(`/api/chats/${encodeURIComponent(chatId)}/scheduled-messages`, {
    method: "POST",
    body: JSON.stringify(input),
  })).scheduledMessage;
}

export async function updateScheduledMessage(id: string, patch: {
  body?: string;
  scheduledAt?: number;
  timezone?: string;
}): Promise<ScheduledMessage> {
  if (isDemo) {
    for (const [chatId, messages] of demoScheduledMessages) {
      const index = messages.findIndex((message) => message.id === id);
      if (index < 0) continue;
      const next = { ...messages[index]!, ...patch, updatedAt: Date.now() };
      demoScheduledMessages.set(chatId, messages.map((message, messageIndex) => messageIndex === index ? next : message));
      return structuredClone(next);
    }
    throw new Error("Scheduled message not found");
  }
  return (await request<{ scheduledMessage: ScheduledMessage }>(`/api/scheduled-messages/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })).scheduledMessage;
}

export async function cancelScheduledMessage(id: string): Promise<ScheduledMessage> {
  if (isDemo) {
    return updateScheduledMessage(id, {}).then((message) => {
      const next = { ...message, status: "cancelled" as const, cancelledAt: Date.now(), updatedAt: Date.now() };
      demoScheduledMessages.set(next.chatId, (demoScheduledMessages.get(next.chatId) || []).map((item) => item.id === id ? next : item));
      return next;
    });
  }
  return (await request<{ scheduledMessage: ScheduledMessage }>(`/api/scheduled-messages/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: "{}",
  })).scheduledMessage;
}

export async function sendMedia(chatId: string, input: {
  data: string;
  mimetype: string;
  filename: string;
  caption?: string;
  voiceNote?: boolean;
}): Promise<ChatMessage> {
  if (isDemo) return {
    id: `media-${Date.now()}`,
    body: input.caption || "Media message",
    fullBody: input.caption || "",
    fromMe: true,
    timestamp: Math.floor(Date.now() / 1_000),
    type: input.voiceNote ? "ptt" : input.mimetype.split("/")[0] || "document",
    hasMedia: true,
    mediaUrl: `data:${input.mimetype};base64,${input.data}`,
  };
  return (await request<{ message: ChatMessage }>(`/api/chats/${encodeURIComponent(chatId)}/media`, {
    method: "POST",
    body: JSON.stringify(input),
  })).message;
}

export type GeneratedImageAttachment = {
  data: string;
  mimetype: string;
  filename: string;
  prompt: string;
};

export async function generateImageForChat(chatId: string, prompt: string): Promise<GeneratedImageAttachment> {
  if (isDemo) {
    const safePrompt = prompt.replace(/[<>&]/g, "").slice(0, 72);
    const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768"><rect width="100%" height="100%" fill="#e9f6ef"/><circle cx="512" cy="338" r="170" fill="#0f7b58" opacity=".18"/><path d="M385 470c90-215 165-215 254 0" fill="none" stroke="#087453" stroke-width="34" stroke-linecap="round"/><text x="512" y="630" text-anchor="middle" font-family="Arial" font-size="34" fill="#14523f">${safePrompt || "AmirOS image"}</text></svg>`;
    return { data: btoa(preview), mimetype: "image/svg+xml", filename: "amiros-generated.svg", prompt };
  }
  return (await request<{ attachment: GeneratedImageAttachment }>(`/api/chats/${encodeURIComponent(chatId)}/generate-image`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  })).attachment;
}

export async function reactToMessage(chatId: string, messageId: string, emoji: string): Promise<void> {
  if (isDemo) return;
  await request(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/react`, {
    method: "POST",
    body: JSON.stringify({ emoji }),
  });
}

export async function replyToMessage(chatId: string, messageId: string, body: string): Promise<ChatMessage> {
  if (isDemo) return { id: `reply-${Date.now()}`, body, fullBody: body, fromMe: true, timestamp: Math.floor(Date.now() / 1_000), type: "chat", hasMedia: false };
  return (await request<{ message: ChatMessage }>(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reply`, {
    method: "POST",
    body: JSON.stringify({ body }),
  })).message;
}

function demoReplySuggestionForMessage(chatId: string, messageId: string): { body: string } {
  const selected = demoMessagesForChat(chatId).find((message) => message.id === messageId);
  if (!selected || selected.fromMe) {
    throw new Error("Choose a message from your contact to draft a reply.");
  }
  const targetedDrafts: Record<string, string> = {
    "sana-1": "Thanks, Sana — I’m glad the launch deck is coming together more clearly.",
    "sana-3": "Absolutely — I’ll send the final pricing sheet and keep the recommendations concise.",
    "sana-5": "Of course — I’ll reserve 20 minutes at the start to decide on the launch sequence.",
  };
  if (targetedDrafts[messageId]) return { body: targetedDrafts[messageId]! };
  if (selected.type === "ptt" || selected.type === "audio") {
    return { body: "Thanks for the voice note. I’ll review the details and get back to you shortly." };
  }
  const chatDrafts: Record<string, string> = {
    "bilal@demo": "Delivery to DHA usually takes 2–3 business days. I’ll confirm the exact window for your order.",
    "mariam@demo": "Yes, it’s available in black. Would you like me to reserve one for you?",
    "zain@demo": "I’ll send the bank details to you privately now.",
    "hassan@demo": "Perfect — see you tomorrow!",
    "product-team@demo": "Yes, we can move the launch review. What time works best for everyone?",
  };
  return { body: chatDrafts[chatId] || "Thanks — I’ll look into that and get back to you shortly." };
}

export async function suggestReplyForMessage(chatId: string, messageId: string): Promise<{ body: string }> {
  if (isDemo) return demoReplySuggestionForMessage(chatId, messageId);
  return request<{ body: string }>(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reply-suggestion`, {
    method: "POST",
  });
}

export async function submitReplySuggestionFeedback(
  chatId: string,
  messageId: string,
  input: { rating: "helpful" | "needs_work"; reasons?: string[]; note?: string },
): Promise<void> {
  if (isDemo) return;
  await request(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reply-suggestion/feedback`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type SavedDeletedMessage = {
  body: string;
  media?: { status: "saved" | "unavailable" | "not_saved"; mimetype?: string; filename?: string; bytes?: number };
  mediaUrl?: string;
};

export async function getSavedDeletedMessage(chatId: string, archiveId: string): Promise<SavedDeletedMessage> {
  if (isDemo) return { body: "This is a locally saved deleted message." };
  return request(`/api/chats/${encodeURIComponent(chatId)}/deleted-messages/${encodeURIComponent(archiveId)}`);
}

export async function clearSavedDeletedMessages(): Promise<{ removed: number }> {
  if (isDemo) return { removed: 0 };
  return request("/api/privacy/deleted-message-archive/clear", { method: "POST", body: "{}" });
}

export async function forwardMessage(chatId: string, messageId: string, targetChatId: string): Promise<void> {
  if (isDemo) return;
  await request(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/forward`, {
    method: "POST",
    body: JSON.stringify({ targetChatId }),
  });
}

export async function uploadOwnerAvatar(dataUrl: string): Promise<DashboardData["settings"]["ownerProfile"]> {
  if (isDemo) return { displayName: "Amir Friedman", avatarUrl: dataUrl };
  return (await request<{ profile: DashboardData["settings"]["ownerProfile"] }>("/api/profile/avatar", {
    method: "POST",
    body: JSON.stringify({ dataUrl }),
  })).profile;
}

export type OwnerAvatar = {
  id: string;
  url: string;
  label: string;
};

export async function getOwnerAvatars(): Promise<OwnerAvatar[]> {
  if (isDemo) return [];
  return (await request<{ avatars: OwnerAvatar[] }>("/api/profile/avatars")).avatars;
}

export async function deleteOwnerAvatar(id: string): Promise<{
  profile: DashboardData["settings"]["ownerProfile"];
  avatars: OwnerAvatar[];
}> {
  if (isDemo) return { profile: structuredClone(demoDashboard.settings.ownerProfile), avatars: [] };
  return request(`/api/profile/avatars/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function approveDraft(id: string, body: string): Promise<void> {
  if (isDemo) return;
  await request(`/api/drafts/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function dismissDraft(id: string): Promise<void> {
  if (isDemo) return;
  await request(`/api/drafts/${encodeURIComponent(id)}/dismiss`, { method: "POST" });
}

export async function updateSettings(settings: {
  quietHours?: { enabled: boolean; start: string; end: string };
  monthlyBudgetUsd?: number;
  assistant?: Partial<DashboardData["settings"]["assistant"]>;
  theme?: ThemeName;
  models?: DashboardData["models"];
  ownerProfile?: Partial<DashboardData["settings"]["ownerProfile"]>;
  knowledgeTrackingDefault?: KnowledgeTrackingDefault;
  deletedMessageArchive?: Partial<DashboardData["settings"]["deletedMessageArchive"]>;
}): Promise<DashboardData["settings"]> {
  if (isDemo) {
    const current = structuredClone(demoDashboard.settings);
    return {
      ...current,
      ...settings,
      assistant: settings.assistant
        ? { ...current.assistant, ...settings.assistant }
        : current.assistant,
      ownerProfile: settings.ownerProfile
        ? { ...current.ownerProfile, ...settings.ownerProfile }
        : current.ownerProfile,
      deletedMessageArchive: settings.deletedMessageArchive
        ? { ...current.deletedMessageArchive, ...settings.deletedMessageArchive }
        : current.deletedMessageArchive,
      models: settings.models || current.models,
    };
  }
  return (
    await request<{ settings: DashboardData["settings"] }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(settings),
    })
  ).settings;
}

export async function saveOpenAiApiKey(apiKey: string): Promise<{ apiKeyConfigured: boolean }> {
  if (isDemo) return { apiKeyConfigured: true };
  return request("/api/settings/openai-key", {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  });
}

export const demoMode = isDemo;
