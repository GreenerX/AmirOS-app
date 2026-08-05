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
  IntelligenceSearchResult,
  RelationshipCommitment,
  TodoTask,
  ThemeName,
  TerminalLog,
  WritingStyleProfile,
  AmirOSUpdateStatus,
} from "./types";

const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";
const demoManualMemory = new Map<string, ContactMemoryItem[]>();
const demoContacts = new Map<string, ContactPreferences>();

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

export async function getChats(): Promise<ChatSummary[]> {
  if (isDemo) return structuredClone(demoChats);
  return (await request<{ chats: ChatSummary[] }>("/api/chats")).chats;
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

export async function askIntelligence(
  query: string,
  options?: {
    followUp?: { question: string; answer: string };
    scope?: { knowledge: boolean; calendar: boolean };
    signal?: AbortSignal;
  },
): Promise<IntelligenceSearchResult> {
  if (isDemo) return { answer: "Sana prefers concise pricing updates and Thursday deliveries.", evidenceIds: [], sources: [] };
  return request("/api/intelligence/search", {
    method: "POST",
    body: JSON.stringify({ query, followUp: options?.followUp, scope: options?.scope }),
    signal: options?.signal,
  });
}

export async function analyzeContactIntelligence(chatId: string): Promise<{
  insights: ContactInsight[];
  commitments: RelationshipCommitment[];
}> {
  return request(`/api/contacts/${encodeURIComponent(chatId)}/intelligence/analyze`, { method: "POST", body: "{}" });
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

export async function generateImageForChat(chatId: string, prompt: string): Promise<ChatMessage> {
  if (isDemo) return { id: `generated-${Date.now()}`, body: `${prompt} 🎨`, fullBody: `${prompt} 🎨`, fromMe: true, timestamp: Math.floor(Date.now() / 1_000), type: "image", hasMedia: true, mediaUrl: demoMessagesForChat(chatId).find((message) => message.hasMedia)?.mediaUrl };
  return (await request<{ message: ChatMessage }>(`/api/chats/${encodeURIComponent(chatId)}/generate-image`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  })).message;
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
