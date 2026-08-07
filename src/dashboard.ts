import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import whatsappWeb from "whatsapp-web.js";
import type { Client as WhatsAppClient } from "whatsapp-web.js";
import { cleanNetworkAnswerText, type AiService } from "./ai.js";
import {
  AmirosState,
  type ContactPreferences,
  type TodoTask,
} from "./amiros-state.js";
import {
  type AppConfig,
} from "./config.js";
import {
  generateContactProfilePdf,
  safePdfFilename,
} from "./profile-pdf.js";
import { buildCalendarSubscriptionFeed } from "./calendar-feed.js";
import type { WritingStyleLearner } from "./writing-style.js";
import type { IntelligenceLearner } from "./intelligence-learner.js";
import { CURRENT_RELEASE } from "./release.js";
import { checkForAmirosUpdate, type UpdateStatus } from "./update-check.js";
import { handleAiUsageApiRoute } from "./dashboard/ai-usage-routes.js";
import { handleSettingsApiRoute } from "./dashboard/settings-routes.js";
import { handleSystemApiRoute } from "./dashboard/system-routes.js";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const { MessageMedia } = whatsappWeb;

type DashboardOptions = {
  client: WhatsAppClient;
  config: AppConfig;
  ai: AiService;
  state: AmirosState;
  writingStyleLearner?: WritingStyleLearner;
  intelligenceLearner?: IntelligenceLearner;
  /** Lets isolated checks keep their calendar token outside a user's data folder. */
  calendarFeedTokenPath?: string;
  port: number;
};

type VisibleTodoTask = Pick<TodoTask, "status" | "dueAt" | "createdAt" | "updatedAt" | "completedAt">;

/**
 * Reviewed to-dos are history, not disposable queue items. Keep completed
 * tasks in every dashboard response (only dismissed suggestions disappear),
 * and place them after tasks that still need attention.
 */
export function visibleTodoTasks<T extends VisibleTodoTask>(todos: T[]): T[] {
  const statusRank = (status: TodoTask["status"]) =>
    status === "inferred" ? 0 : status === "open" ? 1 : status === "done" ? 2 : 3;
  return [...todos]
    .filter((todo) => todo.status !== "dismissed")
    .sort((left, right) => {
      const rankDifference = statusRank(left.status) - statusRank(right.status);
      if (rankDifference) return rankDifference;
      if (left.status === "done" && right.status === "done") {
        return (right.completedAt || right.updatedAt) - (left.completedAt || left.updatedAt);
      }
      return (left.dueAt || left.createdAt) - (right.dueAt || right.createdAt)
        || right.updatedAt - left.updatedAt;
    });
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "http://127.0.0.1:5173",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  });
  response.end(JSON.stringify(value));
}

function persistentCalendarFeedToken(tokenPath = resolve("work/calendar-feed-token")): string {
  mkdirSync(dirname(tokenPath), { recursive: true });
  if (existsSync(tokenPath)) {
    const saved = readFileSync(tokenPath, "utf8").trim();
    if (/^[a-f0-9]{48}$/i.test(saved)) return saved;
  }
  const token = randomBytes(24).toString("hex");
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}

function safeTokenMatch(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson<T>(request: IncomingMessage, maxBytes = 64 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

const CHAT_ID_PATTERN = /@(c\.us|lid|g\.us)$/;
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -\/]*[@-~]/g;

export function sanitizeTerminalLog(value: string): string {
  return value
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted OpenAI key]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, "$1[redacted]");
}

function readTerminalTail(maxBytes = 96 * 1024): { output: string; updatedAt: number } {
  const logPath = resolve("work/bot.log");
  if (!existsSync(logPath)) return { output: "AmirOS has not written any logs yet.", updatedAt: 0 };
  const stats = statSync(logPath);
  const bytesToRead = Math.min(stats.size, maxBytes);
  if (bytesToRead === 0) return { output: "AmirOS is starting…", updatedAt: stats.mtimeMs };
  const descriptor = openSync(logPath, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    readSync(descriptor, buffer, 0, bytesToRead, stats.size - bytesToRead);
    const output = sanitizeTerminalLog(buffer.toString("utf8"));
    const firstNewline = stats.size > maxBytes ? output.indexOf("\n") : -1;
    return {
      output: firstNewline >= 0 ? output.slice(firstNewline + 1) : output,
      updatedAt: stats.mtimeMs,
    };
  } finally {
    closeSync(descriptor);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Profile image lookup timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getCachedProfilePicUrl(
  client: WhatsAppClient,
  chatId: string,
): Promise<string | undefined> {
  const page = (client as WhatsAppClient & {
    pupPage: null | {
      evaluate<T, A>(callback: (argument: A) => T, argument: A): Promise<T>;
    };
  }).pupPage;
  if (!page) return undefined;
  return page.evaluate((targetChatId: string) => {
    const whatsappWindow = globalThis as typeof globalThis & {
      require(name: string): {
        ProfilePicThumb?: {
          get(id: unknown): { img?: string } | undefined;
        };
        createWid?(id: string): unknown;
      };
    };
    const collections = whatsappWindow.require("WAWebCollections");
    const widFactory = whatsappWindow.require("WAWebWidFactory");
    const wid = widFactory.createWid?.(targetChatId);
    return collections.ProfilePicThumb?.get(targetChatId)?.img ||
      (wid ? collections.ProfilePicThumb?.get(wid)?.img : undefined);
  }, chatId);
}

function safeMessagePreview(body: string | undefined): string {
  if (!body) return "Media message";
  const normalized = body.replace(/\s+/g, " ").trim();
  if (
    normalized.startsWith("/9j/") ||
    normalized.startsWith("iVBOR") ||
    (normalized.length > 240 && /^[A-Za-z0-9+/=._-]+$/.test(normalized))
  ) {
    return "Media message";
  }
  return normalized.slice(0, 160);
}

type ChatLike = {
  id: { _serialized: string; user?: string };
  name?: string;
  formattedTitle?: string;
  isGroup?: boolean;
  unreadCount?: number;
  timestamp?: number;
  t?: number;
  archived?: boolean;
  archive?: boolean;
  lastMessage?: {
    body?: string;
    timestamp?: number;
    t?: number;
    remoteId?: string;
    messageId?: string;
    mentionIds?: string[];
  } | null;
};

export function isDisplayableWhatsAppChat(chat: Pick<ChatLike, "id" | "isGroup" | "lastMessage" | "timestamp" | "t">): boolean {
  const id = chat.id._serialized;
  if (id === "status@broadcast" || !/@(?:c\.us|lid|g\.us)$/.test(id)) return false;
  if ((chat.timestamp || chat.t || 0) <= 0) return false;
  if (id.endsWith("@g.us")) return Boolean(chat.isGroup);
  if (chat.isGroup) return false;
  // WhatsApp Web can create participant-scoped cache entries while hydrating group
  // messages and media. Their chat ID looks private, but the attached message still
  // belongs to a group. Those are not real direct conversations.
  return !chat.lastMessage?.remoteId?.endsWith("@g.us");
}

export function isKnownIntelligenceChat(chatId: string, contactName: string): boolean {
  if (chatId.endsWith("@newsletter") || chatId.endsWith("@broadcast")) return false;
  const name = contactName.replace(/\s+/g, " ").trim();
  if (!name || /^(?:whatsapp contact|group participant|unknown contact)$/iu.test(name)) return false;
  const identity = chatId.split("@")[0]?.replace(/\D/g, "") || "";
  const nameDigits = name.replace(/\D/g, "");
  if (nameDigits.length >= 7 && nameDigits === identity) return false;
  if (/^\+?[\d\s().-]{7,}$/u.test(name)) return false;
  return true;
}

const DIRECT_QUESTION_PATTERN = /(?:[?？]|\b(?:who|what|when|where|why|how|can|could|would|will|do|does|did|are|is|should)\b|(?:^|\s)(?:מי|מה|מתי|איפה|היכן|למה|איך|האם)(?:\s|$))/iu;
const DIRECT_REQUEST_PATTERN = /(?:\b(?:please|pls|can you|could you|would you|will you|send me|tell me|let me know|remind me|don['’]t forget|need you to)\b|(?:^|\s)(?:בבקשה|תוכל|תוכלי|תשלח|תשלחי|תגיד|תגידי|תעדכן|תעדכני|תזכיר|תזכירי|אל תשכח|אל תשכחי)(?:\s|$))/iu;
const OWNER_MENTION_PATTERN = /(?:\bamir\b|אמיר|עמיר)/iu;
const GROUP_DIRECT_REQUEST_PATTERN = /(?:\b(?:can you|could you|would you|will you|please send|please tell|let me know)\b|(?:^|\s)(?:תוכל|תוכלי|תשלח|תשלחי|תגיד|תגידי|תעדכן|תעדכני|תזכיר|תזכירי)(?:\s|$))/iu;

/**
 * A saved incoming message is not automatically an outstanding reply. Private
 * conversations qualify when the latest message contains a real question or
 * request. Groups are intentionally stricter so ordinary chatter does not flood
 * the action queue.
 */
export function isReplyWorthyIntelligenceMessage(
  chatId: string,
  content: string | undefined,
  latestMessageIsIncoming = true,
): boolean {
  if (!latestMessageIsIncoming) return false;
  const message = (content || "").replace(/\s+/g, " ").trim();
  if (!message || message === "Media message" || message.length > 1_200) return false;

  const isQuestion = DIRECT_QUESTION_PATTERN.test(message);
  const isRequest = DIRECT_REQUEST_PATTERN.test(message);
  if (!chatId.endsWith("@g.us")) return isQuestion || isRequest;

  const addressedToOwner = OWNER_MENTION_PATTERN.test(message) && (isQuestion || isRequest);
  return addressedToOwner || GROUP_DIRECT_REQUEST_PATTERN.test(message);
}

type CachedMessageModel = {
  id?: string | {
    _serialized?: string;
    fromMe?: boolean;
    remote?: string | { _serialized?: string };
    id?: string;
    participant?: string | { _serialized?: string };
    toString?(): string;
  };
  fromMe?: boolean;
  body?: string;
  caption?: string;
  directPath?: string;
  author?: string | { _serialized?: string };
  t?: number;
  type?: string;
  mediaData?: { caption?: string };
  mediaObject?: { caption?: string };
  mentionedJidList?: Array<string | { _serialized?: string }>;
  reactions?: unknown;
  isVideoCall?: boolean;
  isVoiceCall?: boolean;
  isMissed?: boolean;
  callDuration?: number;
  duration?: number;
  callType?: string;
  subtype?: string;
  _data?: {
    body?: string;
    caption?: string;
    mediaData?: { caption?: string };
    mediaObject?: { caption?: string };
    mentionedJidList?: Array<string | { _serialized?: string }>;
    reactions?: unknown;
    isVideoCall?: boolean;
    isVoiceCall?: boolean;
    isMissed?: boolean;
    callDuration?: number;
    duration?: number;
    callType?: string;
    subtype?: string;
  };
  quotedMsg?: CachedMessageModel;
  msgContextInfo?: { quotedMsg?: CachedMessageModel };
};

type QuotedDashboardMessage = {
  id: string;
  body: string;
  fromMe: boolean;
  senderId?: string;
  senderName?: string;
};

export type DashboardMessage = {
  id: string;
  body: string;
  fullBody?: string;
  fromMe: boolean;
  timestamp: number;
  type: string;
  hasMedia: boolean;
  senderId?: string;
  senderName?: string;
  mentionIds?: string[];
  ownerMentioned?: boolean;
  quotedMessage?: QuotedDashboardMessage;
  reactions?: Array<{
    emoji: string;
    hasReactionByMe?: boolean;
    senders: Array<{ id: string; name?: string; timestamp?: number }>;
  }>;
  call?: {
    direction: "incoming" | "outgoing";
    kind?: "voice" | "video";
    missed?: boolean;
    durationSeconds?: number;
  };
};

type MetadataRecord = Record<string, unknown>;

function metadataRecord(value: unknown): MetadataRecord | undefined {
  return value && typeof value === "object" ? value as MetadataRecord : undefined;
}

function metadataString(record: MetadataRecord | undefined, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = record?.[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function metadataNumber(record: MetadataRecord | undefined, fields: string[]): number | undefined {
  for (const field of fields) {
    const value = record?.[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

function metadataBoolean(record: MetadataRecord | undefined, fields: string[]): boolean | undefined {
  for (const field of fields) {
    const value = record?.[field];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

/** Converts WhatsApp's reaction collection into a small, stable dashboard shape. */
export function dashboardReactionsFromWhatsApp(raw: unknown): DashboardMessage["reactions"] {
  const root = metadataRecord(raw);
  const entries = Array.isArray(raw)
    ? raw
    : Array.isArray(root?.reactions)
      ? root.reactions
      : [];
  const byEmoji = new Map<string, NonNullable<DashboardMessage["reactions"]>[number]>();

  for (const value of entries) {
    const reaction = metadataRecord(value);
    const emoji = metadataString(reaction, ["aggregateEmoji", "reaction", "emoji"]);
    if (!emoji) continue;
    const existing = byEmoji.get(emoji) || { emoji, hasReactionByMe: false, senders: [] };
    existing.hasReactionByMe ||= metadataBoolean(reaction, ["hasReactionByMe", "isMe"]) === true;
    const senders = Array.isArray(reaction?.senders) ? reaction.senders : [reaction];
    for (const senderValue of senders) {
      const sender = metadataRecord(senderValue);
      const id = metadataString(sender, ["senderId", "id", "userId"]);
      if (!id) continue;
      const timestamp = metadataNumber(sender, ["timestamp", "t"]);
      const name = metadataString(sender, ["name", "pushname", "shortName"]);
      if (existing.senders.some((item) => item.id === id && item.timestamp === timestamp)) continue;
      existing.senders.push({ id, name, timestamp });
    }
    byEmoji.set(emoji, existing);
  }
  return byEmoji.size > 0 ? [...byEmoji.values()] : undefined;
}

/** Call logs expose different fields in different WhatsApp Web versions. Keep only explicit metadata. */
export function dashboardCallFromWhatsApp(
  raw: unknown,
  fromMe: boolean,
  fallbackType?: string,
): DashboardMessage["call"] {
  const record = metadataRecord(raw);
  const type = metadataString(record, ["type", "subtype"]) || fallbackType;
  const callType = metadataString(record, ["callType", "type", "subtype"])?.toLowerCase();
  const video = metadataBoolean(record, ["isVideoCall", "isVideo"]) === true || callType === "video" || callType === "video_call";
  const voice = metadataBoolean(record, ["isVoiceCall", "isVoice"]) === true || callType === "voice" || callType === "voice_call" || callType === "audio";
  const isCall = type === "call_log" || type === "call" || video || voice;
  if (!isCall) return undefined;
  const missed = metadataBoolean(record, ["isMissed", "missed"])
    ?? ["missed", "missed_call"].includes(callType || "");
  const durationSeconds = metadataNumber(record, ["callDuration", "duration", "durationSeconds"]);
  return {
    direction: fromMe ? "outgoing" : "incoming",
    ...(video ? { kind: "video" as const } : voice ? { kind: "voice" as const } : {}),
    ...(missed ? { missed } : {}),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
}

type MentionLabel = { id: string; name: string };

function isUsableContactName(value: string | undefined): value is string {
  if (!value || !value.trim()) return false;
  return !/^\+?[\d\s().-]{7,}$/u.test(value);
}

function mentionIdsInBody(body: string | undefined): string[] {
  if (!body) return [];
  return [...body.matchAll(/@(\d{5,})\b/g)].map((match) => match[1]!);
}

/**
 * WhatsApp stores a displayed @mention as an opaque numeric ID in the message
 * body. Replace it only when we have the matching contact name, leaving any
 * unresolved text exactly as WhatsApp supplied it.
 */
export function replaceMentionIdsWithNames(body: string, mentions: MentionLabel[]): string {
  if (!body || mentions.length === 0) return body;
  const namesByDigits = new Map(
    mentions
      .map(({ id, name }) => [id.replace(/\D/g, ""), name.replace(/\s+/g, " ").trim()] as const)
      .filter(([id, name]) => id.length >= 5 && Boolean(name) && !/^\+?[\d\s().-]{7,}$/u.test(name)),
  );
  if (namesByDigits.size === 0) return body;
  return body.replace(/@(\d{5,})\b/g, (original, digits: string) => {
    const name = namesByDigits.get(digits)
      || [...namesByDigits.entries()].find(([id]) => id.endsWith(digits) || digits.endsWith(id))?.[1];
    return name ? `@${name}` : original;
  });
}

function mentionLabelsForIds(mentionIds: string[], nameCache: Map<string, string>): MentionLabel[] {
  return mentionIds.flatMap((mentionId) => {
    const directName = nameCache.get(mentionId);
    if (directName) return [{ id: mentionId, name: directName }];
    const digits = mentionId.replace(/\D/g, "");
    const matchingEntry = [...nameCache.entries()].find(([cachedId]) => {
      const cachedDigits = cachedId.replace(/\D/g, "");
      return digits.length >= 5 && (cachedDigits.endsWith(digits) || digits.endsWith(cachedDigits));
    });
    return matchingEntry ? [{ id: matchingEntry[0], name: matchingEntry[1] }] : [];
  });
}

/**
 * WhatsApp's cache occasionally keeps a quoted message body but drops the
 * quoted message ID. In that case, recover the identity from the original
 * message in the same conversation instead of assuming the contact wrote it.
 */
export function resolveQuotedMessageReferences(messages: DashboardMessage[]): DashboardMessage[] {
  return messages.map((message) => {
    const quoted = message.quotedMessage;
    if (!quoted?.id.startsWith("quoted-")) return message;
    const quotedBody = safeMessagePreview(quoted.body);
    let match: DashboardMessage | undefined;
    for (const candidate of messages) {
      if (candidate.id === message.id || candidate.timestamp > message.timestamp) continue;
      if (safeMessagePreview(candidate.fullBody || candidate.body) !== quotedBody) continue;
      if (!match || candidate.timestamp > match.timestamp) match = candidate;
    }
    if (!match) return message;
    return {
      ...message,
      quotedMessage: {
        ...quoted,
        id: match.id,
        body: match.fullBody || match.body,
        fromMe: match.fromMe,
        senderId: match.senderId,
        senderName: match.senderName,
      },
    };
  });
}

function mediaUrlFor(chatId: string, messageId: string): string {
  return `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/media`;
}

type MediaDownloadResult =
  | { status: "ready"; data: string; mimetype?: string; filename?: string; type?: string }
  | { status: "not_found" }
  | { status: "unavailable" }
  | { status: "too_large" };

async function downloadMessageMedia(
  client: WhatsAppClient,
  chatId: string,
  messageId: string,
  maxBytes: number,
): Promise<MediaDownloadResult> {
  try {
    const message = await withTimeout(client.getMessageById(messageId), 8_000);
    if (message?.hasMedia) {
      const chat = await withTimeout(message.getChat(), 4_000);
      if (chat.id._serialized === chatId) {
        const media = await withTimeout(message.downloadMedia(), 20_000);
        if (media?.data) {
          const size = Buffer.byteLength(media.data, "base64");
          if (size > maxBytes) return { status: "too_large" };
          return { status: "ready", data: media.data, mimetype: media.mimetype, filename: media.filename || undefined, type: message.type };
        }
      }
    }
  } catch {
    // Fall through to WhatsApp Web's media cache when the public API cannot hydrate older media.
  }
  const page = (client as WhatsAppClient & {
    pupPage: null | {
      evaluate<T, A>(callback: (argument: A) => Promise<T>, argument: A): Promise<T>;
    };
  }).pupPage;
  if (!page) return { status: "unavailable" };

  return page.evaluate(async ({ targetChatId, targetMessageId, maximumBytes }) => {
    const whatsappWindow = globalThis as typeof globalThis & {
      require(name: string): {
        Msg?: {
          get(id: string): CachedMediaMessage | undefined;
          getMessagesById(ids: string[]): Promise<{ messages?: CachedMediaMessage[] }>;
        };
        InMemoryMediaBlobCache?: {
          get(hash: string | undefined): Blob | undefined;
        };
      };
    };
    type CachedMediaMessage = {
      id?: { remote?: string | { _serialized?: string } };
      mediaData?: { mediaStage?: string };
      mediaObject?: {
        filehash?: string;
        mediaBlob?: { forceToBlob?(): Blob };
      };
      mimetype?: string;
      filename?: string;
      size?: number;
      type?: string;
      downloadMedia(options: {
        downloadEvenIfExpensive: boolean;
        rmrReason: number;
        isUserInitiated: boolean;
      }): Promise<void>;
    };
    const messages = whatsappWindow.require("WAWebCollections").Msg;
    if (!messages) return { status: "unavailable" as const };
    const message = messages.get(targetMessageId) ||
      (await messages.getMessagesById([targetMessageId]))?.messages?.[0];
    const remote = message?.id?.remote;
    const remoteId = typeof remote === "string" ? remote : remote?._serialized;
    if (!message || remoteId !== targetChatId) return { status: "not_found" as const };
    if (!message.mediaData || message.mediaData.mediaStage === "REUPLOADING") {
      return { status: "unavailable" as const };
    }

    try {
      // A resolved stage can still have an evicted blob, so always refresh the media cache.
      await message.downloadMedia({
        downloadEvenIfExpensive: true,
        rmrReason: 1,
        isUserInitiated: true,
      });
    } catch {
      return { status: "unavailable" as const };
    }
    const mediaStage = message.mediaData.mediaStage || "";
    if (mediaStage.includes("ERROR") || mediaStage === "FETCHING") {
      return { status: "unavailable" as const };
    }

    const mediaCache = whatsappWindow
      .require("WAWebMediaInMemoryBlobCache")
      .InMemoryMediaBlobCache;
    const cachedBlob = mediaCache?.get(message.mediaObject?.filehash);
    const blob = cachedBlob || message.mediaObject?.mediaBlob?.forceToBlob?.();
    if (!blob) return { status: "unavailable" as const };
    if (blob.size > maximumBytes) return { status: "too_large" as const };
    const data = await new Promise<string>((resolveData, rejectData) => {
      const reader = new FileReader();
      reader.onload = () => resolveData(String(reader.result).split(",")[1] || "");
      reader.onerror = () => rejectData(new Error("Unable to read WhatsApp media"));
      reader.readAsDataURL(blob);
    });
    if (!data) return { status: "unavailable" as const };
    return {
      status: "ready" as const,
      data,
      mimetype: message.mimetype || blob.type,
      filename: message.filename,
      type: message.type,
    };
  }, {
    targetChatId: chatId,
    targetMessageId: messageId,
    maximumBytes: maxBytes,
  });
}

async function sendReactionResiliently(
  client: WhatsAppClient,
  chatId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  const page = (client as WhatsAppClient & {
    pupPage: null | {
      evaluate<T, A>(callback: (argument: A) => Promise<T>, argument: A): Promise<T>;
    };
  }).pupPage;
  if (!page) {
    await client.sendReaction(messageId, emoji);
    return;
  }
  const sent = await page.evaluate(async ({ targetChatId, targetMessageId, reaction }) => {
    const whatsappWindow = globalThis as typeof globalThis & {
      require(name: string): {
        Msg?: {
          get(id: string): { id?: { remote?: string | { _serialized?: string } } } | undefined;
          getMessagesById(ids: string[]): Promise<{ messages?: Array<{ id?: { remote?: string | { _serialized?: string } } }> }>;
        };
        sendReactionToMsg?: (message: unknown, value: string) => Promise<void>;
      };
    };
    const messages = whatsappWindow.require("WAWebCollections").Msg;
    const message = messages?.get(targetMessageId) || (await messages?.getMessagesById([targetMessageId]))?.messages?.[0];
    const remote = message?.id?.remote;
    const remoteId = typeof remote === "string" ? remote : remote?._serialized;
    if (!message || remoteId !== targetChatId) return false;
    const action = whatsappWindow.require("WAWebSendReactionMsgAction").sendReactionToMsg;
    if (!action) return false;
    await action(message, reaction);
    return true;
  }, { targetChatId: chatId, targetMessageId: messageId, reaction: emoji });
  if (!sent) throw new Error("This message is not currently available for reactions");
}

async function sendReplyResiliently(
  client: WhatsAppClient,
  chatId: string,
  messageId: string,
  reply: string,
): Promise<{ id: string; timestamp: number; type: string }> {
  const page = (client as WhatsAppClient & {
    pupPage: null | {
      evaluate<T, A>(callback: (argument: A) => Promise<T>, argument: A): Promise<T>;
    };
  }).pupPage;

  let publicLookupError: unknown;
  try {
    let target = await client.getMessageById(messageId).catch(() => undefined);
    if (!target) {
      const chat = await client.getChatById(chatId);
      const messageToken = messageId.startsWith(`true_${chatId}_`) || messageId.startsWith(`false_${chatId}_`)
        ? messageId.slice(messageId.indexOf(`_${chatId}_`) + chatId.length + 2).split("_")[0]
        : undefined;
      const recentMessages = await chat.fetchMessages({ limit: 500 });
      target = recentMessages.find((message) =>
        message.id._serialized === messageId || Boolean(messageToken && message.id.id === messageToken)
      );
    }
    if (target) {
      const targetChat = await target.getChat();
      if (targetChat.id._serialized !== chatId) throw new Error("Message does not belong to this chat");
      const sent = await target.reply(reply, chatId, { sendSeen: true, waitUntilMsgSent: true });
      if (!sent) throw new Error("WhatsApp did not send the reply");
      return { id: sent.id._serialized, timestamp: sent.timestamp, type: sent.type || "chat" };
    }
  } catch (error) {
    publicLookupError = error;
  }

  if (!page && publicLookupError instanceof Error) throw publicLookupError;
  if (!page) throw new Error("This message is not currently available for replies");

  const result = await page.evaluate(async ({ targetChatId, targetMessageId, replyText }) => {
    type InternalMessage = {
      id?: { _serialized?: string; id?: string; remote?: string | { _serialized?: string } };
      unsafe?(): unknown;
      canReply?(): boolean;
      msgContextInfo?(chat: unknown): Record<string, unknown>;
    };
    const whatsappWindow = globalThis as typeof globalThis & {
      require(name: string): {
        Msg?: {
          get(id: string): InternalMessage | undefined;
          getMessagesById(ids: string[]): Promise<{ messages?: InternalMessage[] }>;
          getModelsArray?(): InternalMessage[];
        };
        canReplyMsg?(message: unknown): boolean;
      };
      WWebJS: {
        getChat(id: string, options: { getAsModel: false }): Promise<unknown>;
        sendSeen(id: string): Promise<void>;
        sendMessage(chat: unknown, content: string, options: Record<string, unknown>): Promise<unknown>;
        getMessageModel(message: unknown): { id?: { _serialized?: string }; t?: number; type?: string };
      };
    };
    const messages = whatsappWindow.require("WAWebCollections").Msg;
    const messageToken = targetMessageId.startsWith(`true_${targetChatId}_`) || targetMessageId.startsWith(`false_${targetChatId}_`)
      ? targetMessageId.slice(targetMessageId.indexOf(`_${targetChatId}_`) + targetChatId.length + 2).split("_")[0]
      : undefined;
    const target = messages?.get(targetMessageId) ||
      (await messages?.getMessagesById([targetMessageId]))?.messages?.[0] ||
      messages?.getModelsArray?.().find((message: InternalMessage) => {
        const remote = message.id?.remote;
        const remoteId = typeof remote === "string" ? remote : remote?._serialized;
        return remoteId === targetChatId && Boolean(messageToken && message.id?.id === messageToken);
      });
    const remote = target?.id?.remote;
    const remoteId = typeof remote === "string" ? remote : remote?._serialized;
    if (!target || remoteId !== targetChatId) return { status: "not_found" as const };
    const chat = await whatsappWindow.WWebJS.getChat(targetChatId, { getAsModel: false });
    if (!chat) return { status: "chat_not_found" as const };
    const replyUtils = whatsappWindow.require("WAWebMsgReply");
    const canReply = replyUtils.canReplyMsg && target.unsafe
      ? replyUtils.canReplyMsg(target.unsafe())
      : target.canReply?.() !== false;
    if (!canReply || !target.msgContextInfo) return { status: "not_replyable" as const };
    const quoteContext = target.msgContextInfo(chat);
    if (!quoteContext || Object.keys(quoteContext).length === 0) return { status: "quote_unavailable" as const };
    await whatsappWindow.WWebJS.sendSeen(targetChatId);
    const sent = await whatsappWindow.WWebJS.sendMessage(chat, replyText, {
      linkPreview: true,
      parseVCards: true,
      mentionedJidList: [],
      groupMentions: [],
      waitUntilMsgSent: true,
      extraOptions: quoteContext,
    });
    // Linked-device chats can accept and enqueue the reply before the newly
    // created message model is added to WAWebCollections.Msg. In that case the
    // injected sender returns undefined even though the reply was sent.
    if (!sent) return {
      status: "sent" as const,
      id: `reply-${Date.now()}`,
      timestamp: Math.floor(Date.now() / 1_000),
      type: "chat",
    };
    const normalized = whatsappWindow.WWebJS.getMessageModel(sent);
    return {
      status: "sent" as const,
      id: normalized.id?._serialized || `reply-${Date.now()}`,
      timestamp: normalized.t || Math.floor(Date.now() / 1_000),
      type: normalized.type || "chat",
    };
  }, { targetChatId: chatId, targetMessageId: messageId, replyText: reply });

  if (result.status === "not_found") throw new Error("This message is not currently available for replies");
  if (result.status === "chat_not_found") throw new Error("WhatsApp could not open this conversation");
  if (result.status === "not_replyable") throw new Error("WhatsApp does not allow replies to this message");
  if (result.status === "quote_unavailable") throw new Error("WhatsApp could not prepare this message for a reply");
  return result;
}

async function getChatModelsResiliently(client: WhatsAppClient): Promise<ChatLike[]> {
  try {
    const page = (client as WhatsAppClient & {
      pupPage: null | {
        evaluate<T>(callback: () => Promise<T>): Promise<T>;
      };
    }).pupPage;
    if (!page) throw new Error("WhatsApp is still syncing");
    return await page.evaluate(async () => {
      const whatsappWindow = globalThis as typeof globalThis & {
        require(name: string): {
          Chat: {
            getModelsArray(): Array<{
              id?: { _serialized?: string; user?: string };
              formattedTitle?: string;
              name?: string;
              groupMetadata?: unknown;
              unreadCount?: number;
              t?: number;
              archive?: boolean;
              msgs?: { getModelsArray?(): Array<{
                body?: string;
                t?: number;
                mentionedJidList?: Array<string | { _serialized?: string }>;
                id?: { _serialized?: string; remote?: string | { _serialized?: string } };
              }> };
            }>;
          };
        };
      };
      const cached = whatsappWindow.require("WAWebCollections").Chat.getModelsArray();
      return cached.flatMap((chat: (typeof cached)[number]) => {
        const id = chat.id?._serialized;
        if (!id) return [];
        const messages = chat.msgs?.getModelsArray?.() || [];
        const lastMessage = messages[messages.length - 1];
        const remote = lastMessage?.id?.remote;
        const remoteId = typeof remote === "string" ? remote : remote?._serialized;
        const bodyMentionIds = typeof lastMessage?.body === "string"
          ? [...lastMessage.body.matchAll(/@(\d{5,})\b/g)].map((match) => match[1]!)
          : [];
        const mentionIds = [
          ...(lastMessage?.mentionedJidList || []).flatMap((mention: string | { _serialized?: string }) => {
          const id = typeof mention === "string" ? mention : mention?._serialized;
          return id ? [id] : [];
          }),
          ...bodyMentionIds,
        ];
        return [{
          id: { _serialized: id, user: chat.id?.user },
          formattedTitle: chat.formattedTitle || chat.name,
          isGroup: Boolean(chat.groupMetadata),
          unreadCount: chat.unreadCount || 0,
          t: chat.t || 0,
          archive: Boolean(chat.archive),
          lastMessage: lastMessage ? {
            body: lastMessage.body,
            t: lastMessage.t,
            remoteId,
            messageId: lastMessage.id?._serialized,
            mentionIds,
          } : null,
        }];
      });
    });
  } catch {
    // Fall back to the library API when its injected collections are not ready.
    const fallbackChats = await client.getChats();
    return fallbackChats.map((chat) => {
      const lastMessage = chat.lastMessage as unknown as {
        from?: string | { _serialized?: string };
        body?: string;
        timestamp?: number;
        mentionedIds?: string[];
        id?: { _serialized?: string };
      };
      const from = lastMessage?.from;
      const remoteId = typeof from === "string" ? from : from?._serialized;
      return {
        id: { _serialized: chat.id._serialized, user: chat.id.user },
        name: chat.name,
        isGroup: chat.isGroup,
        unreadCount: chat.unreadCount,
        timestamp: chat.timestamp,
        archived: chat.archived,
        lastMessage: lastMessage ? {
          body: lastMessage.body,
          timestamp: lastMessage.timestamp,
          remoteId,
          messageId: lastMessage.id?._serialized,
          mentionIds: [...new Set([...(lastMessage.mentionedIds || []), ...mentionIdsInBody(lastMessage.body)])],
        } : null,
      };
    });
  }
}

async function listChats(
  client: WhatsAppClient,
  state: AmirosState,
  chatNameCache?: Map<string, string>,
  senderNameCache?: Map<string, string>,
) {
  const chats = await getChatModelsResiliently(client);
  const displayableChats = chats.filter(isDisplayableWhatsAppChat);
  const contactNameCache = senderNameCache || chatNameCache || new Map<string, string>();
  // Inbox previews can contain WhatsApp's opaque @mention IDs too. Resolve the
  // small set used in the visible chat list before shortening the preview.
  await hydrateContactNames(
    client,
    displayableChats.flatMap((chat) => chat.lastMessage?.mentionIds || []),
    contactNameCache,
  );
  await hydrateMentionNamesFromWebCache(
    client,
    displayableChats.flatMap((chat) => chat.lastMessage?.mentionIds || []),
    contactNameCache,
  );
  await hydratePreviewMentionNames(client, displayableChats, contactNameCache);
  // Some outgoing messages contain a literal LID tag even though WhatsApp's
  // compact chat model omits its mention metadata. The full message reader
  // already resolves those IDs against group senders, so reuse it once and
  // keep the result in the shared sender-name cache for later refreshes.
  await Promise.all(displayableChats
    .filter((chat) => {
      const ids = chat.lastMessage?.mentionIds || [];
      return ids.length > 0 && mentionLabelsForIds(ids, contactNameCache).length < ids.length;
    })
    .map((chat) => listMessages(client, chat.id._serialized, contactNameCache, state, 100).catch(() => [])));
  const namedChats = displayableChats
    .map((chat) => {
      const id = chat.id._serialized;
      const timestamp =
        chat.timestamp || chat.t || chat.lastMessage?.timestamp || chat.lastMessage?.t || 0;
      const name = chat.name || chat.formattedTitle || chat.id.user || "WhatsApp contact";
      contactNameCache.set(id, name);
      const previewMentions = mentionLabelsForIds(chat.lastMessage?.mentionIds || [], contactNameCache);
      return {
        id,
        name,
        isGroup: Boolean(chat.isGroup),
        unreadCount: chat.unreadCount || 0,
        timestamp,
        preview: safeMessagePreview(replaceMentionIdsWithNames(chat.lastMessage?.body || "", previewMentions)),
        mode: state.getContact(id).mode,
        avatarUrl: `/api/chats/${encodeURIComponent(id)}/avatar`,
        archived: Boolean(chat.archived || chat.archive),
      };
    });
  state.rememberChatNames(namedChats);
  return namedChats
    .filter((chat) => !chat.archived && chat.timestamp > 0)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 80)
    .map(({ archived: _archived, ...chat }) => chat);
}

async function archivedChatIds(
  client: WhatsAppClient,
  chatNameCache: Map<string, string>,
): Promise<Set<string>> {
  const archived = new Set<string>();
  for (const chat of await getChatModelsResiliently(client)) {
    const id = chat.id?._serialized;
    if (!id) continue;
    const name = chat.name || chat.formattedTitle || chat.id.user;
    if (name) chatNameCache.set(id, name);
    if (chat.archived || chat.archive) archived.add(id);
  }
  return archived;
}

function suggestedIntelligenceQuestions(
  chats: Array<{ contactName: string; needsReply: boolean }>,
  commitments: Array<{ contactName: string }>,
  events: Array<{ contactName: string; title: string; evidence?: { senderName?: string } }>,
): string[] {
  const suggestions = ["What’s on my schedule this week?"];
  const nextEvent = events[0];
  if (nextEvent) suggestions.push(`What do I know about ${nextEvent.title} with ${nextEvent.evidence?.senderName || nextEvent.contactName}?`);
  const waiting = chats.find((chat) => chat.needsReply);
  if (waiting) suggestions.push(`What should I reply to ${waiting.contactName}?`);
  const commitment = commitments[0];
  if (commitment) suggestions.push(`What did I promise ${commitment.contactName}?`);
  const knownContact = chats.find((chat) => ![waiting?.contactName, commitment?.contactName].includes(chat.contactName));
  if (knownContact) suggestions.push(`What has changed with ${knownContact.contactName} recently?`);
  return [...new Set(suggestions)].slice(0, 4);
}

async function activitiesWithContactNames(
  client: WhatsAppClient,
  state: AmirosState,
  chatNameCache: Map<string, string>,
  limit = 20,
) {
  const activities = state.listActivities(limit);
  const hasMissingNames = activities.some(
    (activity) => CHAT_ID_PATTERN.test(activity.detail) && !chatNameCache.has(activity.detail),
  );
  if (hasMissingNames) {
    try {
      const chats = await getChatModelsResiliently(client);
      for (const chat of chats) {
        const id = chat.id?._serialized;
        const name = chat.name || chat.formattedTitle || chat.id?.user;
        if (id && name) chatNameCache.set(id, name);
      }
    } catch {
      // Keep the activity feed available while WhatsApp is still syncing.
    }
  }
  return activities.map((activity) => ({
    ...activity,
    detail: CHAT_ID_PATTERN.test(activity.detail)
      ? chatNameCache.get(activity.detail) || "WhatsApp contact"
      : activity.detail,
  }));
}

async function hydrateContactNames(
  client: WhatsAppClient,
  ids: Iterable<string>,
  senderNameCache: Map<string, string>,
): Promise<void> {
  const missingIds = [...new Set([...ids].filter((id) => !senderNameCache.has(id)))];
  await Promise.all(
    missingIds.map(async (id) => {
      try {
        const contact = await withTimeout(client.getContactById(id), 4_000);
        const name = contact.name || contact.pushname || contact.shortName || contact.number;
        if (isUsableContactName(name)) senderNameCache.set(id, name);
      } catch {
        // Leave unknown IDs unchanged instead of showing an incorrect name.
      }
    }),
  );
}

async function hydrateMentionNamesFromWebCache(
  client: WhatsAppClient,
  mentionIds: Iterable<string>,
  senderNameCache: Map<string, string>,
): Promise<void> {
  const unresolved = [...new Set([...mentionIds].filter((id) => !senderNameCache.has(id)))];
  if (unresolved.length === 0) return;
  const page = (client as WhatsAppClient & {
    pupPage: null | {
      evaluate<T, A>(callback: (argument: A) => T, argument: A): Promise<T>;
    };
  }).pupPage;
  if (!page) return;
  try {
    const matches = await page.evaluate((targetIds: string[]) => {
      const whatsappWindow = globalThis as typeof globalThis & {
        require(name: string): {
          Contact?: { getModelsArray?(): Array<Record<string, unknown>> };
        };
      };
      const digits = (value: unknown) => typeof value === "string" ? value.replace(/\D/g, "") : "";
      const matchingId = (candidates: unknown[], targetId: string) => {
        const targetDigits = digits(targetId);
        return candidates.some((candidate) => {
          const candidateDigits = digits(candidate);
          return targetDigits.length >= 5 && candidateDigits === targetDigits;
        });
      };
      const collectIdentifierValues = (value: unknown, depth = 0, seen = new Set<unknown>()): string[] => {
        if (typeof value === "string") return [value];
        if (!value || typeof value !== "object" || depth >= 3 || seen.has(value)) return [];
        seen.add(value);
        return Object.values(value as Record<string, unknown>).flatMap((entry) =>
          collectIdentifierValues(entry, depth + 1, seen));
      };
      const contacts = whatsappWindow.require("WAWebCollections").Contact?.getModelsArray?.() || [];
      return targetIds.flatMap((targetId) => {
        const contact = contacts.find((candidate: Record<string, unknown>) => {
          const data = candidate._data as Record<string, unknown> | undefined;
          return matchingId([
            candidate.id,
            candidate.lid,
            candidate.pn,
            candidate.phoneNumber,
            data?.id,
            data?.lid,
            data?.pn,
            data?.phoneNumber,
          ].flatMap((value) => {
            if (typeof value === "string") return [value];
            if (value && typeof value === "object") {
              const record = value as { _serialized?: string; user?: string; server?: string };
              return [record._serialized, record.user && record.server ? `${record.user}@${record.server}` : record.user]
                .filter((entry): entry is string => Boolean(entry));
            }
            return [];
          }).concat(collectIdentifierValues(data)), targetId);
        });
        const data = contact?._data as Record<string, unknown> | undefined;
        const name = [
          contact?.name,
          contact?.pushname,
          contact?.shortName,
          contact?.formattedName,
          data?.name,
          data?.pushname,
          data?.shortName,
          data?.formattedName,
          data?.verifiedName,
        ]
          .find((value): value is string => typeof value === "string" && value.trim().length > 0);
        return isUsableContactName(name) ? [{ id: targetId, name }] : [];
      });
    }, unresolved);
    for (const match of matches) senderNameCache.set(match.id, match.name);
  } catch {
    // WhatsApp's internal contact cache is optional; keep unresolved tags intact.
  }
}

async function hydratePreviewMentionNames(
  client: WhatsAppClient,
  chats: ChatLike[],
  senderNameCache: Map<string, string>,
): Promise<void> {
  await Promise.all(chats.map(async (chat) => {
    const lastMessage = chat.lastMessage;
    const unresolvedMentionIds = (lastMessage?.mentionIds || []).filter((id) => !senderNameCache.has(id));
    if (!lastMessage || unresolvedMentionIds.length === 0) return;
    try {
      let message = lastMessage.messageId
        ? await withTimeout(client.getMessageById(lastMessage.messageId), 4_000).catch(() => undefined)
        : undefined;
      const saveMentionContacts = async (candidate: typeof message): Promise<void> => {
        const mentions = await candidate?.getMentions().catch(() => []);
        for (const contact of mentions || []) {
          const id = contact.id?._serialized;
          const name = contact.name || contact.pushname || contact.shortName || contact.number;
          if (id && isUsableContactName(name)) senderNameCache.set(id, name);
        }
      };
      await saveMentionContacts(message);
      // The lightweight cache can retain an ID but drop its mention contacts.
      // In that case, check the small latest message window and use the group
      // sender identities as an additional LID-to-contact-name fallback.
      if (!message || mentionLabelsForIds(unresolvedMentionIds, senderNameCache).length < unresolvedMentionIds.length) {
        const sourceChat = await withTimeout(client.getChatById(chat.id._serialized), 4_000);
        // A mention can target a quieter group member, so retain enough local
        // history to connect their stable WhatsApp ID to the name we already
        // show beside their own messages.
        const recent = await withTimeout(sourceChat.fetchMessages({ limit: 100 }), 6_000);
        await hydrateContactNames(
          client,
          recent.flatMap((candidate) => typeof candidate.author === "string" ? [candidate.author] : []),
          senderNameCache,
        );
        message = [...recent].reverse().find((candidate) =>
          candidate.mentionedIds?.some((id) => unresolvedMentionIds.includes(id)) ||
          candidate.body === lastMessage.body,
        );
        await saveMentionContacts(message);
      }
    } catch {
      // Keep the preview available if WhatsApp has evicted the original message.
    }
  }));
}

async function withGroupSenderNames(
  client: WhatsAppClient,
  chatId: string,
  messages: DashboardMessage[],
  senderNameCache: Map<string, string>,
): Promise<DashboardMessage[]> {
  const ids = messages.flatMap((message) => [
    ...(chatId.endsWith("@g.us") && !message.fromMe && message.senderId ? [message.senderId] : []),
    ...(message.mentionIds || []),
    ...(message.reactions?.flatMap((reaction) => reaction.senders.map((sender) => sender.id)) || []),
  ]);
  await hydrateContactNames(client, ids, senderNameCache);
  return messages.map((message) => {
    const mentions = mentionLabelsForIds(message.mentionIds || [], senderNameCache);
    const fullBody = message.fullBody
      ? replaceMentionIdsWithNames(message.fullBody, mentions)
      : message.fullBody;
    const body = replaceMentionIdsWithNames(message.body, mentions);
    return {
      ...message,
      body,
      fullBody,
      senderName: chatId.endsWith("@g.us")
        ? message.fromMe
          ? "You"
          : message.senderId
            ? senderNameCache.get(message.senderId) || "Group participant"
            : undefined
        : message.senderName,
      quotedMessage: message.quotedMessage ? {
        ...message.quotedMessage,
        senderName: message.quotedMessage.fromMe
          ? "You"
          : message.quotedMessage.senderId
            ? senderNameCache.get(message.quotedMessage.senderId) || "Group participant"
            : message.quotedMessage.senderName,
      } : undefined,
      reactions: message.reactions?.map((reaction) => ({
        ...reaction,
        senders: reaction.senders.map((sender) => ({
          ...sender,
          name: sender.name || senderNameCache.get(sender.id),
        })),
      })),
    };
  });
}

async function groupDescription(client: WhatsAppClient, chatId: string): Promise<string | undefined> {
  if (!chatId.endsWith("@g.us")) return undefined;
  try {
    const chat = await client.getChatById(chatId) as unknown as { description?: string };
    const description = chat.description?.replace(/\s+/g, " ").trim();
    if (description) return description.slice(0, 500);
  } catch {
    // Fall through to WhatsApp Web's cached group metadata.
  }
  const page = (client as WhatsAppClient & {
    pupPage: null | { evaluate<T, A>(callback: (argument: A) => T, argument: A): Promise<T> };
  }).pupPage;
  if (!page) return undefined;
  try {
    return await page.evaluate((targetChatId: string) => {
      const whatsappWindow = globalThis as typeof globalThis & {
        require(name: string): { Chat?: { get(id: string): { groupMetadata?: { desc?: string; description?: string } } | undefined } };
      };
      const chat = whatsappWindow.require("WAWebCollections").Chat?.get(targetChatId);
      const value = chat?.groupMetadata?.desc || chat?.groupMetadata?.description;
      return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 500) : undefined;
    }, chatId);
  } catch {
    return undefined;
  }
}

function restoreOutgoingMediaCaptions(
  state: AmirosState,
  chatId: string,
  messages: DashboardMessage[],
): DashboardMessage[] {
  const captions = state.getOutgoingMediaCaptions(chatId);
  if (captions.length === 0) return messages;
  const used = new Set<number>();
  return messages.map((message) => {
    if (!message.fromMe || !message.hasMedia || message.fullBody || message.body !== "Media message") {
      return message;
    }
    const messageTime = message.timestamp < 10_000_000_000
      ? message.timestamp * 1_000
      : message.timestamp;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    captions.forEach((item, index) => {
      if (used.has(index)) return;
      const distance = Math.abs(item.timestamp - messageTime);
      if (distance <= 90_000 && distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    });
    if (bestIndex < 0) return message;
    used.add(bestIndex);
    const caption = captions[bestIndex]?.caption;
    return caption ? { ...message, body: safeMessagePreview(caption), fullBody: caption } : message;
  });
}

async function listMessages(
  client: WhatsAppClient,
  chatId: string,
  senderNameCache: Map<string, string>,
  state: AmirosState,
  limit = 100,
) {
  try {
    const chat = await client.getChatById(chatId);
    if (chat.id._serialized !== chatId) {
      throw new Error("WhatsApp returned a different conversation");
    }
    const messages = await chat.fetchMessages({ limit: Math.max(1, Math.min(500, limit)) });
    const dashboardMessages = await Promise.all(messages.map(async (message) => {
      const id = message.id._serialized;
      const messageWithCaption = message as typeof message & CachedMessageModel;
      const rawBody = message.body || messageWithCaption.caption ||
        messageWithCaption._data?.caption || messageWithCaption._data?.body ||
        messageWithCaption.mediaObject?.caption || messageWithCaption.mediaData?.caption ||
        messageWithCaption._data?.mediaObject?.caption || messageWithCaption._data?.mediaData?.caption || "";
      const preview = safeMessagePreview(rawBody);
      let rawReactions: unknown;
      try {
        rawReactions = await message.getReactions();
      } catch {
        // Reactions are optional metadata. A transient WhatsApp lookup must not hide the message.
      }
      const callMetadata = { ...messageWithCaption._data, ...messageWithCaption, type: message.type };
      const mentionIds = new Set([...message.mentionedIds || [], ...mentionIdsInBody(rawBody)]);
      const mentionedContacts = await message.getMentions().catch(() => []);
      for (const mentionedContact of mentionedContacts) {
        const mentionId = mentionedContact.id?._serialized;
        if (!mentionId) continue;
        mentionIds.add(mentionId);
        const name = mentionedContact.name || mentionedContact.pushname || mentionedContact.shortName || mentionedContact.number;
        if (isUsableContactName(name)) senderNameCache.set(mentionId, name);
      }
      let quotedMessage: QuotedDashboardMessage | undefined;
      if (message.hasQuotedMsg) {
        try {
          const quoted = await message.getQuotedMessage();
          const quotedBody = quoted.body || (quoted as typeof quoted & { caption?: string }).caption || "Media message";
          quotedMessage = {
            id: quoted.id._serialized,
            body: safeMessagePreview(quotedBody),
            fromMe: Boolean(
              quoted.fromMe ||
              quoted.id.fromMe ||
              quoted.id._serialized.startsWith("true_"),
            ),
            senderId: chatId.endsWith("@g.us") ? quoted.author : undefined,
          };
        } catch {
          // Keep the current message visible even when WhatsApp has evicted the quoted model.
        }
      }
      return {
        id,
        body: preview,
        fullBody: message.hasMedia && preview === "Media message" ? "" : rawBody,
        fromMe: message.fromMe,
        timestamp: message.timestamp,
        type: message.type,
        hasMedia: message.hasMedia,
        mediaUrl: message.hasMedia ? mediaUrlFor(chatId, id) : undefined,
        senderId: chatId.endsWith("@g.us") ? message.author : undefined,
        mentionIds: [...mentionIds],
        ownerMentioned: Boolean(message.fromMe || mentionedContacts.some((contact) => contact.isMe)),
        quotedMessage,
        reactions: dashboardReactionsFromWhatsApp(rawReactions),
        call: dashboardCallFromWhatsApp(callMetadata, message.fromMe, message.type),
      };
    }));
    const resolvedMessages = resolveQuotedMessageReferences(dashboardMessages);
    const namedMessages = await withGroupSenderNames(client, chatId, resolvedMessages, senderNameCache);
    return restoreOutgoingMediaCaptions(state, chatId, namedMessages);
  } catch {
    // Fall back to WhatsApp Web's per-chat collection while the public API is syncing.
    const page = (client as WhatsAppClient & {
      pupPage: null | {
        evaluate<T, A>(callback: (argument: A) => T | Promise<T>, argument: A): Promise<T>;
      };
    }).pupPage;
    if (!page) throw new Error("WhatsApp is still syncing");
    const result = await page.evaluate(async ({ targetChatId, messageLimit }: { targetChatId: string; messageLimit: number }) => {
      // This callback runs inside WhatsApp Web, not in the Node.js process.
      // Keep the mention parser local to the page context instead of referencing
      // the server-side helper above, which is not available here.
      const mentionIdsInMessageBody = (body: string | undefined): string[] =>
        body ? [...body.matchAll(/@(\d{5,})\b/g)].map((match) => match[1]!) : [];
      const whatsappWindow = globalThis as typeof globalThis & {
        WWebJS: {
          getMessageModel(message: CachedMessageModel): CachedMessageModel;
        };
        require(name: string): {
          Chat?: {
            getModelsArray(): Array<{
              id?: { _serialized?: string };
              msgs?: {
                getModelsArray?(): CachedMessageModel[];
              };
            }>;
          };
          loadEarlierMsgs?: (input: { chat: unknown }) => Promise<CachedMessageModel[]>;
        };
      };
      const chat = whatsappWindow
        .require("WAWebCollections")
        .Chat?.getModelsArray()
        .find((item: { id?: { _serialized?: string } }) => item.id?._serialized === targetChatId);
      if (!chat?.id?._serialized) {
        throw new Error("The requested conversation is not loaded");
      }
      let cached = (chat.msgs?.getModelsArray?.() || []) as CachedMessageModel[];
      const loadEarlier = whatsappWindow.require("WAWebChatLoadMessages").loadEarlierMsgs;
      for (let attempt = 0; loadEarlier && cached.length < messageLimit && attempt < 20; attempt += 1) {
        const older = await loadEarlier({ chat });
        if (!older?.length) break;
        const refreshed = (chat.msgs?.getModelsArray?.() || []) as CachedMessageModel[];
        if (refreshed.length <= cached.length) break;
        cached = refreshed;
      }
      const chatMessages = cached.filter((message) => {
        const messageId = typeof message.id === "string" ? undefined : message.id;
        const remote = messageId?.remote;
        const remoteId = typeof remote === "string" ? remote : remote?._serialized;
        return !remoteId || remoteId === targetChatId;
      });
      return {
        chatId: chat.id._serialized,
        messages: chatMessages.slice(-Math.max(1, Math.min(500, messageLimit))).map((message: CachedMessageModel, index: number) => {
          let normalized = message;
          try {
            normalized = whatsappWindow.WWebJS.getMessageModel(message);
          } catch {
            // Some transient system-message models cannot be serialized; use their cached fields.
          }
          const type = normalized.type || message.type || "chat";
          const rawId = normalized.id;
          const messageId = typeof rawId === "string" ? undefined : rawId;
          const remote = messageId?.remote;
          const remoteId = typeof remote === "string" ? remote : remote?._serialized;
          const participant = messageId?.participant;
          const participantId = typeof participant === "string"
            ? participant
            : participant?._serialized;
          const composedId = messageId?.id && (remoteId || targetChatId)
            ? [
                String(Boolean(messageId.fromMe)),
                remoteId || targetChatId,
                messageId.id,
                participantId,
              ].filter(Boolean).join("_")
            : undefined;
          const stringifiedId = typeof messageId?.toString === "function"
            ? messageId.toString()
            : undefined;
          const rawStringParts = typeof rawId === "string" ? rawId.split("_") : [];
          const author = normalized.author || message.author;
          const senderId = typeof author === "string" ? author : author?._serialized;
          const quoted = normalized.quotedMsg || normalized.msgContextInfo?.quotedMsg || message.quotedMsg || message.msgContextInfo?.quotedMsg;
          const quotedRawId = quoted?.id;
          const quotedId = typeof quotedRawId === "string" ? quotedRawId : quotedRawId?._serialized;
          const quotedFromMe = Boolean(
            quoted?.fromMe ||
            (typeof quotedRawId !== "string" && quotedRawId?.fromMe) ||
            quotedId?.startsWith("true_"),
          );
          const quotedAuthor = quoted?.author;
          const quotedSenderId = typeof quotedAuthor === "string" ? quotedAuthor : quotedAuthor?._serialized;
          const serializedId = rawStringParts.length === 3 || rawStringParts.length === 4
            ? rawId as string
            : messageId?._serialized ||
              (stringifiedId && stringifiedId !== "[object Object]" ? stringifiedId : undefined) ||
              composedId;
          const rawMentionIds = normalized.mentionedJidList || normalized._data?.mentionedJidList ||
            message.mentionedJidList || message._data?.mentionedJidList || [];
          const mentionIds = [
            ...rawMentionIds.flatMap((mention) => {
            const id = typeof mention === "string" ? mention : mention?._serialized;
            return id ? [id] : [];
            }),
            ...mentionIdsInMessageBody(
              normalized.body || normalized.caption || normalized._data?.body || normalized._data?.caption ||
              message.body || message.caption,
            ),
          ];
          return {
            id: serializedId || `${targetChatId}-${normalized.t || message.t || index}`,
            downloadable: Boolean(serializedId),
            body: normalized.body || normalized.caption ||
              normalized.mediaObject?.caption || normalized.mediaData?.caption ||
              normalized._data?.caption || normalized._data?.body ||
              normalized._data?.mediaObject?.caption || normalized._data?.mediaData?.caption ||
              message.body || message.caption ||
              message.mediaObject?.caption || message.mediaData?.caption ||
              message._data?.caption || message._data?.body ||
              message._data?.mediaObject?.caption || message._data?.mediaData?.caption || "",
            fromMe: Boolean(messageId?.fromMe),
            timestamp: normalized.t || message.t || 0,
            type,
            hasMedia:
              Boolean(normalized.directPath || normalized.mediaData || message.mediaData) ||
              ["ptt", "audio", "image", "video", "document", "sticker"].includes(type),
            senderId,
            mentionIds,
            ownerMentioned: Boolean(messageId?.fromMe),
            rawReactions: normalized.reactions || normalized._data?.reactions || message.reactions || message._data?.reactions,
            callData: {
              type,
              isVideoCall: normalized.isVideoCall ?? normalized._data?.isVideoCall ?? message.isVideoCall ?? message._data?.isVideoCall,
              isVoiceCall: normalized.isVoiceCall ?? normalized._data?.isVoiceCall ?? message.isVoiceCall ?? message._data?.isVoiceCall,
              isMissed: normalized.isMissed ?? normalized._data?.isMissed ?? message.isMissed ?? message._data?.isMissed,
              callDuration: normalized.callDuration ?? normalized._data?.callDuration ?? message.callDuration ?? message._data?.callDuration,
              duration: normalized.duration ?? normalized._data?.duration ?? message.duration ?? message._data?.duration,
              callType: normalized.callType ?? normalized._data?.callType ?? message.callType ?? message._data?.callType,
              subtype: normalized.subtype ?? normalized._data?.subtype ?? message.subtype ?? message._data?.subtype,
            },
            quotedMessage: quoted ? {
              id: quotedId || `quoted-${normalized.t || message.t || index}`,
              body: quoted.body || quoted.caption || "Media message",
              fromMe: quotedFromMe,
              senderId: quotedSenderId,
            } : undefined,
          };
        }),
      };
    }, { targetChatId: chatId, messageLimit: limit });
    if (result.chatId !== chatId) {
      throw new Error("WhatsApp returned a different cached conversation");
    }
    type CachedDashboardMessage = DashboardMessage & {
      downloadable?: boolean;
      rawReactions?: unknown;
      callData?: unknown;
    };
    const dashboardMessages = (result.messages as CachedDashboardMessage[]).map((message) => {
      const { downloadable, rawReactions, callData, ...dashboardMessage } = message;
      const body = safeMessagePreview(message.body);
      const hasMedia = message.hasMedia || (body === "Media message" && Boolean(message.body));
      return {
        ...dashboardMessage,
        body,
        hasMedia,
        fullBody: hasMedia && body === "Media message" ? "" : message.body,
        mediaUrl: hasMedia && downloadable
          ? mediaUrlFor(chatId, message.id)
          : undefined,
        reactions: dashboardReactionsFromWhatsApp(rawReactions),
        call: dashboardCallFromWhatsApp(callData, message.fromMe, message.type),
      };
    });
    const resolvedMessages = resolveQuotedMessageReferences(dashboardMessages);
    const namedMessages = await withGroupSenderNames(client, chatId, resolvedMessages, senderNameCache);
    return restoreOutgoingMediaCaptions(state, chatId, namedMessages);
  }
}

export function rememberDashboardMessages(
  state: AmirosState,
  chatId: string,
  messages: DashboardMessage[],
): number {
  return state.rememberMessages(chatId, messages.flatMap((message) => {
    const content = (message.fullBody || message.body).trim();
    if (!content || content === "Media message") return [];
    // WhatsApp can replay an outgoing message after AmirOS restarts. If this
    // exact text was recorded as AmirOS output, keep the existing assistant
    // entry instead of importing it as a new owner-authored message.
    if (message.fromMe && state.isKnownAssistantOutput(chatId, content)) return [];
    return [{
      role: "user" as const,
      author: message.fromMe ? "owner" as const : chatId.endsWith("@g.us") ? "group_member" as const : "contact" as const,
      content,
      senderName: message.fromMe ? state.getSettings().ownerProfile.displayName : message.senderName,
      mentionIds: message.mentionIds,
      ownerMentioned: message.ownerMentioned,
      timestamp: message.timestamp < 10_000_000_000 ? message.timestamp * 1_000 : message.timestamp,
      messageId: message.id,
      countAsIncoming: !message.fromMe,
      extractSignals: message.fromMe,
    }];
  }));
}

function serveStatic(response: ServerResponse, pathname: string): void {
  const root = resolve("ui/dist");
  if (!existsSync(root)) {
    sendJson(response, 503, {
      error: "AmirOS UI has not been built yet. Run pnpm ui:build.",
    });
    return;
  }
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  let filePath = resolve(root, requested);
  if (!filePath.startsWith(`${root}${sep}`) && filePath !== root) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, "index.html");
  }
  response.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(filePath)] || "application/octet-stream",
    "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
  });
  createReadStream(filePath).pipe(response);
}

export function startAmirosDashboard(options: DashboardOptions) {
  const {
    client,
    config,
    ai,
    state,
    writingStyleLearner,
    intelligenceLearner,
    calendarFeedTokenPath,
    port,
  } = options;
  const dashboardStartedAt = Date.now();
  const refreshWritingStyle = (chatId: string) => {
    void writingStyleLearner?.refreshIfDue(chatId).catch((error) => {
      console.warn("Automatic writing-style refresh failed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  const avatarUrlCache = new Map<string, { url?: string; expiresAt: number }>();
  const chatNameCache = new Map<string, string>();
  const senderNameCache = new Map<string, string>();
  const calendarFeedToken = persistentCalendarFeedToken(calendarFeedTokenPath);
  let updateCheck: UpdateStatus | undefined;
  let updateCheckExpiresAt = 0;
  const latestUpdateStatus = async (force = false): Promise<UpdateStatus> => {
    if (!force && updateCheck && Date.now() < updateCheckExpiresAt) return updateCheck;
    updateCheck = await checkForAmirosUpdate(CURRENT_RELEASE.version);
    // Avoid a background GitHub call on every dashboard refresh. A manual
    // request always refreshes immediately, while normal use checks hourly.
    updateCheckExpiresAt = Date.now() + 60 * 60_000;
    return updateCheck;
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        sendJson(response, 204, {});
        return;
      }
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
      const { pathname } = url;

      if (request.method === "GET" && pathname === "/api/calendar/subscription") {
        const baseUrl = config.amirosPublicUrl || `http://127.0.0.1:${port}`;
        const feedUrl = `${baseUrl}/api/calendar/feed.ics?token=${encodeURIComponent(calendarFeedToken)}`;
        sendJson(response, 200, {
          httpUrl: feedUrl,
          // Calendar.app does not reliably subscribe to a webcal URL that
          // points at 127.0.0.1. Keep the direct Apple Calendar action for a
          // real public URL; local users can safely copy the HTTP feed instead.
          webcalUrl: config.amirosPublicUrl ? feedUrl.replace(/^https?:/i, "webcal:") : undefined,
          publicUrlConfigured: Boolean(config.amirosPublicUrl),
          confirmedEvents: state.listCalendarEvents().filter((event) => event.status === "confirmed").length,
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/calendar/feed.ics") {
        if (!safeTokenMatch(url.searchParams.get("token") || "", calendarFeedToken)) {
          sendJson(response, 403, { error: "Invalid calendar subscription token" });
          return;
        }
        const events = state.listCalendarEvents()
          .filter((event) => event.status === "confirmed")
          .map((event) => ({
            ...event,
            contactName: chatNameCache.get(event.chatId) || event.evidence.senderName || "WhatsApp contact",
          }));
        const feed = buildCalendarSubscriptionFeed(events);
        response.writeHead(200, {
          "content-type": "text/calendar; charset=utf-8",
          "content-disposition": 'inline; filename="AmirOS-calendar.ics"',
          "cache-control": "private, max-age=300",
        });
        response.end(feed);
        return;
      }

      if (await handleAiUsageApiRoute({
        request,
        response,
        pathname,
        config,
        ai,
        state,
        chatNameCache,
        sendJson,
        visibleTodoTasks,
        isKnownIntelligenceChat,
        activitiesWithContactNames: () => activitiesWithContactNames(client, state, chatNameCache),
      })) return;

      if (await handleSystemApiRoute({
        request,
        response,
        pathname,
        sendJson,
        dashboardStartedAt,
      })) return;

      if (request.method === "GET" && pathname === "/api/update") {
        sendJson(response, 200, await latestUpdateStatus(url.searchParams.get("refresh") === "1"));
        return;
      }

      if (request.method === "POST" && pathname === "/api/update") {
        const update = await latestUpdateStatus(true);
        if (update.status !== "available") {
          sendJson(response, 409, {
            error: update.status === "current"
              ? "You already have the latest version of AmirOS."
              : update.detail || "AmirOS could not check for an update right now.",
          });
          return;
        }
        const updaterPath = resolve("Update AmirOS.command");
        if (!existsSync(updaterPath)) {
          sendJson(response, 409, { error: "This AmirOS copy needs one final ZIP update before one-click updates are available." });
          return;
        }
        state.addActivity("system", "AmirOS update started", `Updating to v${update.latestVersion}`);
        sendJson(response, 202, { ok: true, latestVersion: update.latestVersion });
        // Respond before opening the updater: it stops this server, restores
        // private data, rebuilds AmirOS, and opens the updated dashboard.
        setTimeout(() => {
          const updater = spawn("/usr/bin/open", [updaterPath], {
            detached: true,
            stdio: "ignore",
          });
          updater.unref();
        }, 350).unref();
        return;
      }

      if (request.method === "POST" && pathname === "/api/dashboard/action-summary") {
        const body = await readJson<{ message?: unknown }>(request);
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (!message) {
          sendJson(response, 400, { error: "A message is required to create a summary." });
          return;
        }
        if (message.length > 4_000) {
          sendJson(response, 400, { error: "That message is too long to summarize." });
          return;
        }
        sendJson(response, 200, { summary: await ai.summarizeDashboardActionMessage(message) });
        return;
      }

      if (request.method === "GET" && pathname === "/api/activity") {
        const limit = Number(url.searchParams.get("limit") || 250);
        sendJson(response, 200, {
          activities: await activitiesWithContactNames(client, state, chatNameCache, limit),
        });
        return;
      }

      if (await handleSettingsApiRoute({
        request,
        response,
        pathname,
        client,
        config,
        ai,
        state,
        sendJson,
        readJson,
      })) return;

      if (request.method === "GET" && pathname === "/api/chats") {
        sendJson(response, 200, { chats: await listChats(client, state, chatNameCache, senderNameCache) });
        return;
      }

      if (request.method === "GET" && pathname === "/api/terminal") {
        sendJson(response, 200, readTerminalTail());
        return;
      }

      if (request.method === "GET" && pathname === "/api/terminal/stream") {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-store",
          "connection": "keep-alive",
          "x-accel-buffering": "no",
          "access-control-allow-origin": "http://127.0.0.1:5173",
        });
        response.flushHeaders();

        let previousOutput = "";
        let previousUpdatedAt = -1;
        const sendTerminalUpdate = () => {
          if (response.destroyed || response.writableEnded) return;
          const next = readTerminalTail();
          if (next.updatedAt !== previousUpdatedAt || next.output !== previousOutput) {
            previousOutput = next.output;
            previousUpdatedAt = next.updatedAt;
            response.write(`event: log\ndata: ${JSON.stringify(next)}\n\n`);
          }
          response.write(`event: heartbeat\ndata: ${JSON.stringify({ checkedAt: Date.now() })}\n\n`);
        };

        sendTerminalUpdate();
        const terminalInterval = setInterval(sendTerminalUpdate, 2_000);
        const stopStreaming = () => clearInterval(terminalInterval);
        request.once("close", stopStreaming);
        response.once("close", stopStreaming);
        return;
      }

      const avatarMatch = pathname.match(/^\/api\/chats\/([^/]+)\/avatar$/);
      if (request.method === "GET" && avatarMatch?.[1]) {
        const chatId = decodeURIComponent(avatarMatch[1]);
        const cached = avatarUrlCache.get(chatId);
        let avatarUrl = cached?.expiresAt && cached.expiresAt > Date.now() ? cached.url : undefined;
        if (!cached || cached.expiresAt <= Date.now()) {
          try {
            avatarUrl = await getCachedProfilePicUrl(client, chatId);
            if (!avatarUrl) {
              avatarUrl = await withTimeout(client.getProfilePicUrl(chatId), 4_000);
            }
          } catch {
            avatarUrl = undefined;
          }
          avatarUrlCache.set(chatId, { url: avatarUrl, expiresAt: Date.now() + 30 * 60_000 });
        }
        if (!avatarUrl) {
          sendJson(response, 404, { error: "Contact has no visible profile image" });
          return;
        }
        response.writeHead(302, {
          location: avatarUrl,
          "cache-control": "private, max-age=1800",
        });
        response.end();
        return;
      }

      const messageMatch = pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
      if (request.method === "GET" && messageMatch?.[1]) {
        const chatId = decodeURIComponent(messageMatch[1]);
        const messages = await listMessages(client, chatId, senderNameCache, state);
        const added = rememberDashboardMessages(state, chatId, messages);
        if (added > 0) void intelligenceLearner?.analyzeIncoming(chatId);
        const contactName = chatNameCache.get(chatId) || state.getChatName(chatId) || "WhatsApp contact";
        sendJson(response, 200, {
          chatId,
          messages,
          groupDescription: await groupDescription(client, chatId),
          contact: state.getContact(chatId),
          memory: state.getConversationMemory(chatId),
          manualMemory: state.getManualMemory(chatId),
          profile: state.getContactProfile(chatId),
          insights: state.getInsights(chatId),
          commitments: state.getCommitments(chatId),
          events: state.getCalendarEvents(chatId),
          todos: state.getTodoTasks(chatId).map((todo) => ({ ...todo, chatId, contactName })),
          styleProfile: state.getWritingStyleProfile(chatId),
          groupSummary: state.getGroupSummary(chatId),
          incomingMessageCount: state.getIncomingMessageCount(chatId),
        });
        return;
      }

      const scanHistoryMatch = pathname.match(/^\/api\/chats\/([^/]+)\/history\/scan$/);
      if (request.method === "POST" && scanHistoryMatch?.[1]) {
        const chatId = decodeURIComponent(scanHistoryMatch[1]);
        const body = await readJson<{ limit?: number }>(request);
        const limit = Math.max(50, Math.min(500, Math.floor(body.limit || 300)));
        const messages = await listMessages(client, chatId, senderNameCache, state, limit);
        const added = rememberDashboardMessages(state, chatId, messages);
        if (added > 0) void intelligenceLearner?.analyzeIncoming(chatId);
        state.addActivity("system", "Older chat history scanned", `${chatNameCache.get(chatId) || chatId} · ${added} new messages saved`);
        sendJson(response, 200, {
          scanned: messages.length,
          added,
          messages,
          memory: state.getConversationMemory(chatId, 400),
          incomingMessageCount: state.getIncomingMessageCount(chatId),
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/intelligence") {
        let archived = new Set<string>();
        try {
          archived = await archivedChatIds(client, chatNameCache);
        } catch {
          // Saved intelligence remains available while WhatsApp is still syncing.
        }
        const chats = state.intelligenceSnapshot()
          .filter((item) => !archived.has(item.chatId))
          .map((item) => {
            const contactName = chatNameCache.get(item.chatId) || "WhatsApp contact";
            return {
              ...item,
              contactName,
              todos: item.todos.map((todo) => ({ ...todo, chatId: item.chatId, contactName })),
              isGroup: item.chatId.endsWith("@g.us"),
              needsReply: isReplyWorthyIntelligenceMessage(
                item.chatId,
                item.lastIncoming?.content,
                item.needsReply,
              ),
            };
          })
          .filter((item) => isKnownIntelligenceChat(item.chatId, item.contactName));
        const commitments = chats.flatMap((item) => item.commitments
          .filter((commitment) => commitment.status === "open")
          .map((commitment) => ({ ...commitment, chatId: item.chatId, contactName: item.contactName })))
          .sort((a, b) => b.updatedAt - a.updatedAt);
        const events = chats.flatMap((item) => item.events
          .filter((event) => event.status !== "dismissed" && event.startAt >= Date.now() - 86_400_000)
          .map((event) => ({ ...event, chatId: item.chatId, contactName: item.contactName })))
          .sort((a, b) => a.startAt - b.startAt);
        const todos = visibleTodoTasks(chats.flatMap((item) => item.todos
          .map((todo) => ({ ...todo, chatId: item.chatId, contactName: item.contactName }))));
        const chatNamesById = new Map(chats.map((chat) => [chat.chatId, chat.contactName]));
        const changesByCluster = new Map<string, (typeof chats)[number]["insights"][number] & {
          chatId: string;
          contactName: string;
          subjectNames: string[];
          subjectChatIds: string[];
        }>();
        for (const chat of chats) {
          for (const insight of chat.insights.filter((item) => item.status === "inferred")) {
            const clusterKey = insight.clusterId || `${chat.chatId}:${insight.id}`;
            const current = changesByCluster.get(clusterKey);
            const subjectChatIds = [...new Set([...(current?.subjectChatIds || []), ...(insight.subjectChatIds || [chat.chatId])])];
            const subjectNames = [...new Set([
              ...(current?.subjectNames || []),
              ...(insight.subjectNames || []),
              ...subjectChatIds.map((chatId) => chatNamesById.get(chatId)).filter((name): name is string => Boolean(name)),
            ])];
            const useCurrent = Boolean(current && current.updatedAt >= insight.updatedAt);
            const representative = useCurrent ? current! : insight;
            const representativeChatId = useCurrent ? current!.chatId : chat.chatId;
            changesByCluster.set(clusterKey, {
              ...representative,
              // Keep the representative insight ID and its owning chat together.
              // Review endpoints address an insight by both values, so mixing them
              // makes multi-person suggestions impossible to approve or dismiss.
              chatId: representativeChatId,
              contactName: chatNamesById.get(representativeChatId) || subjectNames[0] || chat.contactName,
              subjectChatIds,
              subjectNames,
            });
          }
        }
        const questionHistory = state.intelligenceQuestionHistory().map((item) => ({
          ...item,
          answer: cleanNetworkAnswerText(item.answer, []),
          sources: item.sources.filter((source) => isKnownIntelligenceChat(
            source.chatId,
            chatNameCache.get(source.chatId) || state.getChatName(source.chatId) || "WhatsApp contact",
          )).map((source) => ({
            ...source,
            contactName: chatNameCache.get(source.chatId) || state.getChatName(source.chatId) || "WhatsApp contact",
          })),
        }));
        sendJson(response, 200, {
          generatedAt: Date.now(),
          needsReply: chats.filter((item) =>
            item.needsReply &&
            !item.chatId.endsWith("@newsletter") &&
            !item.chatId.endsWith("@broadcast")
          ).slice(0, 20),
          commitments,
          events,
          todos,
          changes: [...changesByCluster.values()]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 30),
          chats,
          questionHistory,
          suggestedQuestions: suggestedIntelligenceQuestions(chats, commitments, events),
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/intelligence/search") {
        const body = await readJson<{
          query?: string;
          followUp?: { question?: string; answer?: string };
          scope?: { knowledge?: boolean; calendar?: boolean };
        }>(request);
        const query = body.query?.replace(/\s+/g, " ").trim() || "";
        if (!query || query.length > 500) {
          sendJson(response, 400, { error: "Ask a question between 1 and 500 characters" });
          return;
        }
        let archived = new Set<string>();
        try {
          archived = await archivedChatIds(client, chatNameCache);
        } catch {
          // Continue with saved memory if WhatsApp is still syncing.
        }
        const followUp = body.followUp?.question && body.followUp?.answer ? {
          question: body.followUp.question.replace(/\s+/g, " ").trim().slice(0, 500),
          answer: body.followUp.answer.replace(/\s+/g, " ").trim().slice(0, 2_000),
        } : undefined;
        const includeKnowledge = body.scope?.knowledge !== false;
        const includeCalendar = body.scope?.calendar !== false;
        if (!includeKnowledge && !includeCalendar) {
          sendJson(response, 400, { error: "Choose at least one knowledge scope" });
          return;
        }
        const records = state.searchIntelligence(`${query} ${followUp?.question || ""}`.trim(), 48, archived)
          .filter((record) => record.kind === "calendar_event" ? includeCalendar : includeKnowledge);
        const enriched = records.map((record) => ({
          ...record,
          content: `[Chat: ${chatNameCache.get(record.chatId) || "WhatsApp contact"}] ${record.content}`,
        }));
        const answer = await ai.answerNetworkQuestion(
          query,
          enriched,
          state.getSettings().ownerProfile.displayName,
          followUp,
        );
        const recordsById = new Map(records.map((record) => [record.id, record]));
        const sources = answer.evidenceIds
          .flatMap((id) => {
            const record = recordsById.get(id);
            return record ? [{
              ...record,
              contactName: chatNameCache.get(record.chatId) || state.getChatName(record.chatId) || "WhatsApp contact",
            }] : [];
          });
        state.rememberIntelligenceAnswer(query, answer.answer, sources);
        state.addActivity("system", "Relationship memory searched", `${records.length} local records reviewed`);
        sendJson(response, 200, { ...answer, sources });
        return;
      }

      const intelligenceHistoryMatch = pathname.match(/^\/api\/intelligence\/history\/([^/]+)$/);
      if (request.method === "DELETE" && intelligenceHistoryMatch?.[1]) {
        if (!state.removeIntelligenceQuestion(decodeURIComponent(intelligenceHistoryMatch[1]))) {
          sendJson(response, 404, { error: "Question history item not found" });
          return;
        }
        sendJson(response, 200, { ok: true });
        return;
      }

      const readMatch = pathname.match(/^\/api\/chats\/([^/]+)\/read$/);
      if (request.method === "POST" && readMatch?.[1]) {
        const chatId = decodeURIComponent(readMatch[1]);
        await client.sendSeen(chatId);
        sendJson(response, 200, { ok: true });
        return;
      }

      const calendarMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/calendar\/([^/]+)$/);
      const regenerateCalendarMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/calendar\/([^/]+)\/regenerate-title$/);
      if (request.method === "POST" && regenerateCalendarMatch?.[1] && regenerateCalendarMatch[2]) {
        const chatId = decodeURIComponent(regenerateCalendarMatch[1]);
        const eventId = decodeURIComponent(regenerateCalendarMatch[2]);
        const existing = state.getCalendarEvents(chatId).find((event) => event.id === eventId);
        if (!existing) {
          sendJson(response, 404, { error: "Calendar event not found" });
          return;
        }
        const title = await ai.regenerateCalendarTitle({
          contactName: chatNameCache.get(chatId) || existing.evidence.senderName || "WhatsApp contact",
          currentTitle: existing.title,
          evidence: existing.evidence.excerpt,
        });
        const event = state.updateCalendarEvent(chatId, eventId, { title });
        sendJson(response, 200, { event, title });
        return;
      }
      if (request.method === "PATCH" && calendarMatch?.[1] && calendarMatch[2]) {
        const chatId = decodeURIComponent(calendarMatch[1]);
        const eventId = decodeURIComponent(calendarMatch[2]);
        const body = await readJson<{
          status?: "inferred" | "confirmed" | "dismissed";
          title?: string;
          startAt?: number;
          endAt?: number;
          allDay?: boolean;
          location?: string;
        }>(request);
        if (body.status && !["inferred", "confirmed", "dismissed"].includes(body.status)) {
          sendJson(response, 400, { error: "Choose inferred, confirmed, or dismissed" });
          return;
        }
        if (body.title !== undefined && (!body.title.trim() || body.title.trim().length > 120)) {
          sendJson(response, 400, { error: "Event title must be 1-120 characters" });
          return;
        }
        if (body.startAt !== undefined && (!Number.isFinite(body.startAt) || body.startAt < 0)) {
          sendJson(response, 400, { error: "Choose a valid event date and time" });
          return;
        }
        const existing = state.getCalendarEvents(chatId).find((event) => event.id === eventId);
        if (!existing) {
          sendJson(response, 404, { error: "Calendar event not found" });
          return;
        }
        const effectiveStart = body.startAt ?? existing.startAt;
        if (body.endAt !== undefined && (!Number.isFinite(body.endAt) || body.endAt <= effectiveStart)) {
          sendJson(response, 400, { error: "Event end time must be after its start time" });
          return;
        }
        if (body.location !== undefined && body.location.length > 240) {
          sendJson(response, 400, { error: "Event location must be 240 characters or fewer" });
          return;
        }
        if (!body.status && body.title === undefined && body.startAt === undefined && body.endAt === undefined && body.allDay === undefined && body.location === undefined) {
          sendJson(response, 400, { error: "Provide an event change" });
          return;
        }
        const event = state.updateCalendarEvent(chatId, eventId, { ...body, allDay: false });
        sendJson(response, 200, { event, events: state.getCalendarEvents(chatId) });
        return;
      }

      const mediaMatch = pathname.match(
        /^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/media$/,
      );
      if (request.method === "GET" && mediaMatch?.[1] && mediaMatch[2]) {
        const chatId = decodeURIComponent(mediaMatch[1]);
        const messageId = decodeURIComponent(mediaMatch[2]);
        const media = await downloadMessageMedia(client, chatId, messageId, 30 * 1024 * 1024);
        if (media.status === "not_found") {
          sendJson(response, 404, { error: "Media message not found" });
          return;
        }
        if (media.status === "unavailable") {
          sendJson(response, 404, { error: "Media is no longer available" });
          return;
        }
        if (media.status === "too_large") {
          sendJson(response, 413, { error: "Media is too large to preview" });
          return;
        }
        const payload = Buffer.from(media.data, "base64");
        const safeFilename = (media.filename || `whatsapp-${media.type || "media"}`)
          .replace(/[\r\n"\\/]/g, "-")
          .slice(0, 120);
        response.writeHead(200, {
          "content-type": media.mimetype || "application/octet-stream",
          "content-length": payload.length,
          "content-disposition": `inline; filename="${safeFilename}"`,
          "cache-control": "private, max-age=300",
        });
        response.end(payload);
        return;
      }

      const messageActionMatch = pathname.match(
        /^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/(react|reply|forward)$/,
      );
      if (request.method === "POST" && messageActionMatch?.[1] && messageActionMatch[2] && messageActionMatch[3]) {
        const chatId = decodeURIComponent(messageActionMatch[1]);
        const messageId = decodeURIComponent(messageActionMatch[2]);
        const action = messageActionMatch[3];
        if (action === "react") {
          const body = await readJson<{ emoji?: string }>(request);
          const emoji = body.emoji?.trim() || "";
          if (!emoji || emoji.length > 16) {
            sendJson(response, 400, { error: "Choose one reaction emoji" });
            return;
          }
          await sendReactionResiliently(client, chatId, messageId, emoji);
          state.addActivity("text", "Message reaction sent", chatNameCache.get(chatId) || chatId);
          sendJson(response, 200, { ok: true });
          return;
        }
        if (action === "reply") {
          const body = await readJson<{ body?: string }>(request);
          const reply = body.body?.trim() || "";
          if (!reply || reply.length > 5_000) {
            sendJson(response, 400, { error: "Reply must be 1–5,000 characters" });
            return;
          }
          const sent = await sendReplyResiliently(client, chatId, messageId, reply);
          state.rememberMessage(chatId, { role: "assistant", author: "owner", content: reply, countAsIncoming: false });
          void intelligenceLearner?.analyzeIncoming(chatId);
          refreshWritingStyle(chatId);
          state.addActivity("text", "Message reply sent", chatNameCache.get(chatId) || chatId);
          sendJson(response, 200, { message: {
            id: sent.id,
            body: reply,
            fullBody: reply,
            fromMe: true,
            timestamp: sent.timestamp,
            type: sent.type,
            hasMedia: false,
          } });
          return;
        }
        const target = await client.getMessageById(messageId);
        if (!target) {
          sendJson(response, 404, { error: "Message not found" });
          return;
        }
        const targetChat = await target.getChat();
        if (targetChat.id._serialized !== chatId) {
          sendJson(response, 400, { error: "Message does not belong to this chat" });
          return;
        }
        const body = await readJson<{ targetChatId?: string }>(request);
        const targetChatId = body.targetChatId?.trim() || "";
        if (!CHAT_ID_PATTERN.test(targetChatId)) {
          sendJson(response, 400, { error: "Choose a WhatsApp conversation to forward to" });
          return;
        }
        await target.forward(targetChatId);
        state.addActivity("text", "Message forwarded", chatNameCache.get(targetChatId) || targetChatId);
        sendJson(response, 200, { ok: true });
        return;
      }

      const sendMediaMatch = pathname.match(/^\/api\/chats\/([^/]+)\/media$/);
      const generateImageMatch = pathname.match(/^\/api\/chats\/([^/]+)\/generate-image$/);
      if (request.method === "POST" && generateImageMatch?.[1]) {
        const chatId = decodeURIComponent(generateImageMatch[1]);
        const body = await readJson<{ prompt?: string }>(request);
        const prompt = body.prompt?.replace(/\s+/g, " ").trim() || "";
        if (!prompt || prompt.length > 1_500) {
          sendJson(response, 400, { error: "Describe an image in 1-1,500 characters" });
          return;
        }
        const image = await ai.generateImage(prompt);
        const encoded = image.toString("base64");
        const caption = `${prompt.slice(0, 890)} 🎨`;
        const sent = await client.sendMessage(chatId, new MessageMedia("image/png", encoded, "amiros-generated.png"), { caption });
        const sentId = sent?.id._serialized || `generated-${Date.now()}`;
        const sentTimestamp = sent?.timestamp || Math.floor(Date.now() / 1_000);
        state.rememberOutgoingMediaCaption(chatId, caption, sentTimestamp * 1_000);
        state.rememberMessage(chatId, { role: "assistant", author: "assistant", content: `Generated image: ${prompt}`, countAsIncoming: false });
        state.addActivity("image", "Image generated and sent", chatNameCache.get(chatId) || chatId);
        sendJson(response, 200, { message: {
          id: sentId,
          body: caption,
          fullBody: caption,
          fromMe: true,
          timestamp: sentTimestamp,
          type: "image",
          hasMedia: true,
          mediaUrl: sent ? mediaUrlFor(chatId, sentId) : `data:image/png;base64,${encoded}`,
        } });
        return;
      }
      if (request.method === "POST" && sendMediaMatch?.[1]) {
        const chatId = decodeURIComponent(sendMediaMatch[1]);
        const body = await readJson<{
          data?: string;
          mimetype?: string;
          filename?: string;
          caption?: string;
          voiceNote?: boolean;
        }>(request, 24 * 1024 * 1024);
        const mimetype = body.mimetype?.trim() || "";
        const data = body.data?.trim() || "";
        if (!data || !/^[A-Za-z0-9+/=]+$/.test(data) || !/^(image|video|audio|application)\//.test(mimetype)) {
          sendJson(response, 400, { error: "Upload a supported image, video, audio, or document" });
          return;
        }
        const bytes = Buffer.from(data, "base64");
        if (!bytes.length || bytes.length > 16 * 1024 * 1024) {
          sendJson(response, 413, { error: "Media must be under 16 MB" });
          return;
        }
        const filename = body.filename?.replace(/[\r\n"\\/]/g, "-").slice(0, 120) || "attachment";
        const caption = body.caption?.trim().slice(0, 2_000) || undefined;
        const sent = await client.sendMessage(chatId, new MessageMedia(mimetype, data, filename), {
          caption,
          sendAudioAsVoice: Boolean(body.voiceNote && mimetype.startsWith("audio/")),
        });
        // As with quoted replies, linked-device chats can enqueue media before
        // WhatsApp exposes the new local message model to whatsapp-web.js.
        const sentId = sent?.id._serialized || `media-${Date.now()}`;
        if (caption) {
          state.rememberOutgoingMediaCaption(chatId, caption, (sent?.timestamp || Math.floor(Date.now() / 1_000)) * 1_000);
          state.rememberMessage(chatId, { role: "assistant", author: "owner", content: caption, countAsIncoming: false });
          void intelligenceLearner?.analyzeIncoming(chatId);
          refreshWritingStyle(chatId);
        }
        state.addActivity(body.voiceNote ? "voice" : "image", body.voiceNote ? "Voice memo sent from AmirOS" : "Media sent from AmirOS", chatId);
        sendJson(response, 200, { message: {
          id: sentId,
          body: caption || "Media message",
          fullBody: caption || "",
          fromMe: true,
          timestamp: sent?.timestamp || Math.floor(Date.now() / 1_000),
          type: sent?.type || (body.voiceNote ? "ptt" : mimetype.split("/")[0] || "document"),
          hasMedia: true,
          mediaUrl: sent ? mediaUrlFor(chatId, sentId) : undefined,
          mediaMimetype: mimetype,
          mediaFilename: filename,
        } });
        return;
      }

      const sendMatch = pathname.match(/^\/api\/chats\/([^/]+)\/send$/);
      if (request.method === "POST" && sendMatch?.[1]) {
        const chatId = decodeURIComponent(sendMatch[1]);
        const body = await readJson<{ body?: string }>(request);
        const message = body.body?.trim();
        if (!message) {
          sendJson(response, 400, { error: "Message is required" });
          return;
        }
        await client.sendMessage(chatId, message);
        state.rememberMessage(chatId, { role: "assistant", author: "owner", content: message, countAsIncoming: false });
        void intelligenceLearner?.analyzeIncoming(chatId);
        refreshWritingStyle(chatId);
        state.addActivity("text", "Message sent from AmirOS", chatId);
        sendJson(response, 200, { ok: true });
        return;
      }

      const contactMatch = pathname.match(/^\/api\/contacts\/([^/]+)$/);
      if (request.method === "PATCH" && contactMatch?.[1]) {
        const chatId = decodeURIComponent(contactMatch[1]);
        const patch = await readJson<Partial<ContactPreferences>>(request);
        for (const key of ["relationship", "tone", "language"] as const) {
          const value = patch[key];
          if (value !== undefined && (!value.trim() || value.length > 80)) {
            sendJson(response, 400, { error: `${key} must be 1–80 characters` });
            return;
          }
          if (value !== undefined) patch[key] = value.trim();
        }
        if (patch.customInstructions !== undefined) {
          if (patch.customInstructions.length > 2_000) {
            sendJson(response, 400, { error: "Custom instructions must be 2,000 characters or fewer" });
            return;
          }
          patch.customInstructions = patch.customInstructions.trim();
        }
        for (const key of ["ownerTriggerAccess", "contactTriggerAccess"] as const) {
          const access = patch[key];
          if (access === undefined) continue;
          if (
            !Array.isArray(access)
            || access.some((item) => item !== "knowledge" && item !== "calendar")
          ) {
            sendJson(response, 400, { error: "Trigger access contains an unsupported resource" });
            return;
          }
          patch[key] = [...new Set(access)];
        }
        if (
          patch.knowledgeTracking !== undefined &&
          patch.knowledgeTracking !== "pending" &&
          patch.knowledgeTracking !== "snoozed" &&
          patch.knowledgeTracking !== "enabled" &&
          patch.knowledgeTracking !== "disabled"
        ) {
          sendJson(response, 400, { error: "Knowledge tracking has an unsupported state" });
          return;
        }
        if (
          patch.pronouns !== undefined &&
          patch.pronouns !== "unspecified" &&
          patch.pronouns !== "she/her" &&
          patch.pronouns !== "he/him" &&
          patch.pronouns !== "they/them"
        ) {
          sendJson(response, 400, { error: "Pronouns contain an unsupported value" });
          return;
        }
        ai.clearConversation(chatId);
        const contact = state.updateContact(chatId, patch);
        // Enabling tracking takes effect immediately. The learner still uses
        // its cursor, so only messages received after the decision are sent
        // for automatic analysis.
        if (patch.knowledgeTracking === "enabled") void intelligenceLearner?.analyzeIncoming(chatId);
        sendJson(response, 200, {
          contact,
          memory: state.getConversationMemory(chatId),
          manualMemory: state.getManualMemory(chatId),
          profile: state.getContactProfile(chatId),
        });
        return;
      }

      const manualMemoryMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/memory$/);
      if (request.method === "POST" && manualMemoryMatch?.[1]) {
        const chatId = decodeURIComponent(manualMemoryMatch[1]);
        const body = await readJson<{ content?: string }>(request);
        const content = body.content?.trim() || "";
        if (!content || content.length > 1_000) {
          sendJson(response, 400, { error: "Memory item must be 1–1,000 characters" });
          return;
        }
        try {
          const item = state.addManualMemory(chatId, content);
          ai.clearConversation(chatId);
          state.addActivity("system", "Contact memory added", chatId);
          sendJson(response, 201, {
            item,
            manualMemory: state.getManualMemory(chatId),
          });
        } catch (error) {
          sendJson(response, 400, {
            error: error instanceof Error ? error.message : "Could not add memory item",
          });
        }
        return;
      }

      const deleteMemoryMatch = pathname.match(
        /^\/api\/contacts\/([^/]+)\/memory\/([^/]+)$/,
      );
      if (request.method === "DELETE" && deleteMemoryMatch?.[1] && deleteMemoryMatch[2]) {
        const chatId = decodeURIComponent(deleteMemoryMatch[1]);
        const itemId = decodeURIComponent(deleteMemoryMatch[2]);
        if (!state.removeManualMemory(chatId, itemId)) {
          sendJson(response, 404, { error: "Memory item not found" });
          return;
        }
        ai.clearConversation(chatId);
        sendJson(response, 200, { manualMemory: state.getManualMemory(chatId) });
        return;
      }

      const profileMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/profile$/);
      if (request.method === "POST" && profileMatch?.[1]) {
        const chatId = decodeURIComponent(profileMatch[1]);
        const contact = state.getContact(chatId);
        if (!contact.memoryEnabled) {
          sendJson(response, 400, { error: "Enable contact memory before generating a profile" });
          return;
        }
        const memory = state.getConversationMemory(chatId, 400);
        const manualMemory = state.getManualMemory(chatId);
        if (memory.length === 0 && manualMemory.length === 0) {
          sendJson(response, 400, { error: "Add memory or receive messages before generating a profile" });
          return;
        }
        let contactName = chatNameCache.get(chatId);
        if (!contactName) {
          const chat = await client.getChatById(chatId).catch(() => undefined);
          contactName = chat?.name || "WhatsApp contact";
          if (contactName) chatNameCache.set(chatId, contactName);
        }
        const summary = await ai.summarizeContact({
          chatId,
          contactName: contactName || "WhatsApp contact",
          relationship: contact.relationship,
          isGroup: chatId.endsWith("@g.us"),
          manualMemory,
          memory,
          insights: state.getInsights(chatId),
          previousSummary: state.getContactProfile(chatId)?.summary,
        });
        const profile = state.setContactProfile(chatId, summary);
        ai.clearConversation(chatId);
        state.addActivity("system", "Contact profile updated", contactName || chatId);
        sendJson(response, 200, {
          profile,
          incomingMessageCount: state.getIncomingMessageCount(chatId),
        });
        return;
      }

      const analyzeMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/intelligence\/analyze$/);
      if (request.method === "POST" && analyzeMatch?.[1]) {
        const chatId = decodeURIComponent(analyzeMatch[1]);
        const memory = state.getConversationMemory(chatId, 400);
        if (memory.length < 2) {
          sendJson(response, 400, { error: "At least two saved messages are needed for relationship analysis" });
          return;
        }
        let contactName = chatNameCache.get(chatId);
        if (!contactName) {
          const chat = await client.getChatById(chatId).catch(() => undefined);
          contactName = chat?.name || "WhatsApp contact";
          chatNameCache.set(chatId, contactName);
        }
        const analysis = await ai.analyzeRelationship({
          chatId,
          contactName,
          isGroup: chatId.endsWith("@g.us"),
          memory,
          ownerName: state.getSettings().ownerProfile.displayName,
          knownSubjectNames: state.getKnownKnowledgeSubjectNames(),
        });
        const intelligence = state.mergeRoutedAnalyzedIntelligence(chatId, analysis).source;
        ai.clearConversation(chatId);
        state.addActivity("system", "Relationship intelligence refreshed", contactName);
        sendJson(response, 200, intelligence);
        return;
      }

      const insightMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/insights\/([^/]+)$/);
      if (request.method === "PATCH" && insightMatch?.[1] && insightMatch[2]) {
        const chatId = decodeURIComponent(insightMatch[1]);
        const insightId = decodeURIComponent(insightMatch[2]);
        const body = await readJson<{ status?: "inferred" | "confirmed" | "outdated"; content?: string }>(request);
        if (body.status && !["inferred", "confirmed", "outdated"].includes(body.status)) {
          sendJson(response, 400, { error: "Unknown insight status" });
          return;
        }
        const insight = state.updateInsight(chatId, insightId, body);
        if (!insight) {
          sendJson(response, 404, { error: "Insight not found" });
          return;
        }
        ai.clearConversation(chatId);
        sendJson(response, 200, { insight, insights: state.getInsights(chatId) });
        return;
      }

      const commitmentMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/commitments\/([^/]+)$/);
      if (request.method === "PATCH" && commitmentMatch?.[1] && commitmentMatch[2]) {
        const chatId = decodeURIComponent(commitmentMatch[1]);
        const commitmentId = decodeURIComponent(commitmentMatch[2]);
        const body = await readJson<{ status?: "open" | "done" | "dismissed" }>(request);
        if (!body.status || !["open", "done", "dismissed"].includes(body.status)) {
          sendJson(response, 400, { error: "Unknown commitment status" });
          return;
        }
        const commitment = state.updateCommitment(chatId, commitmentId, body.status);
        if (!commitment) {
          sendJson(response, 404, { error: "Commitment not found" });
          return;
        }
        sendJson(response, 200, { commitment, commitments: state.getCommitments(chatId) });
        return;
      }

      const todoMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/todos\/([^/]+)$/);
      const todoCompleteMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/todos\/([^/]+)\/complete$/);
      if (request.method === "POST" && todoCompleteMatch?.[1] && todoCompleteMatch[2]) {
        const chatId = decodeURIComponent(todoCompleteMatch[1]);
        const todoId = decodeURIComponent(todoCompleteMatch[2]);
        const todo = state.completeTodoTask(chatId, todoId);
        if (!todo) {
          sendJson(response, 404, { error: "To-do not found" });
          return;
        }
        const contactName = chatNameCache.get(chatId) || state.getChatName(chatId) || "WhatsApp contact";
        sendJson(response, 200, {
          todo: { ...todo, chatId, contactName },
          todos: state.getTodoTasks(chatId).map((item) => ({ ...item, chatId, contactName })),
        });
        return;
      }
      if (request.method === "PATCH" && todoMatch?.[1] && todoMatch[2]) {
        const chatId = decodeURIComponent(todoMatch[1]);
        const todoId = decodeURIComponent(todoMatch[2]);
        const body = await readJson<{
          status?: "inferred" | "open" | "done" | "dismissed";
          title?: string;
          dueAt?: number | null;
          priority?: "low" | "normal" | "high";
        }>(request);
        if (body.status !== undefined && !["inferred", "open", "done", "dismissed"].includes(body.status)) {
          sendJson(response, 400, { error: "Unknown to-do status" });
          return;
        }
        if (body.title !== undefined && (!body.title.trim() || body.title.trim().length > 1_000)) {
          sendJson(response, 400, { error: "To-do title must be between 1 and 1000 characters" });
          return;
        }
        if (body.dueAt !== undefined && body.dueAt !== null && (!Number.isFinite(body.dueAt) || body.dueAt <= 0)) {
          sendJson(response, 400, { error: "To-do due date must be a valid timestamp" });
          return;
        }
        if (body.priority !== undefined && !["low", "normal", "high"].includes(body.priority)) {
          sendJson(response, 400, { error: "Unknown to-do priority" });
          return;
        }
        if (body.status === undefined && body.title === undefined && body.dueAt === undefined && body.priority === undefined) {
          sendJson(response, 400, { error: "Choose a to-do update" });
          return;
        }
        const todo = state.updateTodoTask(chatId, todoId, body);
        if (!todo) {
          sendJson(response, 404, { error: "To-do not found" });
          return;
        }
        const contactName = chatNameCache.get(chatId) || state.getChatName(chatId) || "WhatsApp contact";
        sendJson(response, 200, {
          todo: { ...todo, chatId, contactName },
          todos: state.getTodoTasks(chatId).map((item) => ({ ...item, chatId, contactName })),
        });
        return;
      }

      const styleMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/style-profile$/);
      if (request.method === "POST" && styleMatch?.[1]) {
        const chatId = decodeURIComponent(styleMatch[1]);
        const sentMessages = state.getOwnerWritingMessages(chatId, 120);
        if (sentMessages.length < 3) {
          sendJson(response, 400, { error: "At least three messages written by you are needed to learn this chat's style" });
          return;
        }
        const profile = state.setWritingStyleProfile(chatId, {
          ...await ai.analyzeWritingStyle({ chatId, messages: sentMessages }),
          ownerMessageCountAtUpdate: state.getOwnerWritingMessageCount(chatId),
        });
        ai.clearConversation(chatId);
        state.addActivity("system", "Writing style learned", chatNameCache.get(chatId) || chatId);
        sendJson(response, 200, { styleProfile: profile });
        return;
      }

      const groupSummaryMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/group-summary$/);
      if (request.method === "POST" && groupSummaryMatch?.[1]) {
        const chatId = decodeURIComponent(groupSummaryMatch[1]);
        if (!chatId.endsWith("@g.us")) {
          sendJson(response, 400, { error: "Group summaries are only available for group chats" });
          return;
        }
        const memory = state.getConversationMemory(chatId, 400);
        if (memory.length < 3) {
          sendJson(response, 400, { error: "At least three saved group messages are needed" });
          return;
        }
        const groupName = chatNameCache.get(chatId) || "WhatsApp group";
        const summary = state.setGroupSummary(chatId, await ai.summarizeGroup({ chatId, groupName, memory }));
        state.addActivity("system", "Group summary refreshed", groupName);
        sendJson(response, 200, { groupSummary: summary });
        return;
      }

      const profilePdfMatch = pathname.match(
        /^\/api\/contacts\/([^/]+)\/profile\.pdf$/,
      );
      if (request.method === "GET" && profilePdfMatch?.[1]) {
        const chatId = decodeURIComponent(profilePdfMatch[1]);
        const profile = state.getContactProfile(chatId);
        if (!profile) {
          sendJson(response, 404, {
            error: "Generate a contact profile before exporting it",
          });
          return;
        }
        let contactName = chatNameCache.get(chatId);
        if (!contactName) {
          const chat = await client.getChatById(chatId).catch(() => undefined);
          contactName = chat?.name || "WhatsApp contact";
          chatNameCache.set(chatId, contactName);
        }
        let profileImage: { data: string; mimetype: string } | undefined;
        try {
          const profileImageUrl = await getCachedProfilePicUrl(client, chatId) || await client.getProfilePicUrl(chatId);
          if (profileImageUrl) {
            const imageResponse = await fetch(profileImageUrl);
            const mimetype = imageResponse.headers.get("content-type")?.split(";")[0] || "image/jpeg";
            const bytes = Buffer.from(await imageResponse.arrayBuffer());
            if (imageResponse.ok && mimetype.startsWith("image/") && bytes.length > 0 && bytes.length <= 6 * 1024 * 1024) {
              profileImage = { data: bytes.toString("base64"), mimetype };
            }
          }
        } catch {
          // The analysis still exports with an initials fallback when WhatsApp hides the image.
        }
        const pdf = await generateContactProfilePdf({
          contactName,
          contact: state.getContact(chatId),
          profile,
          manualMemory: state.getManualMemory(chatId),
          isGroup: chatId.endsWith("@g.us"),
          profileImage,
          insights: state.getInsights(chatId),
          commitments: state.getCommitments(chatId),
          styleProfile: state.getWritingStyleProfile(chatId),
          groupSummary: state.getGroupSummary(chatId),
          generatedAt: Date.now(),
          timezoneOffsetMinutes: Number(url.searchParams.get("tzOffset") || new Date().getTimezoneOffset()),
          locale: url.searchParams.get("locale") || request.headers["accept-language"]?.split(",")[0] || "en",
        });
        state.addActivity("system", "Contact profile PDF exported", contactName);
        response.writeHead(200, {
          "content-type": "application/pdf",
          "content-length": String(pdf.length),
          "content-disposition": `attachment; filename="${safePdfFilename(contactName)}"`,
          "cache-control": "private, no-store",
        });
        response.end(pdf);
        return;
      }

      const draftMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/(approve|dismiss)$/);
      if (request.method === "POST" && draftMatch?.[1] && draftMatch[2]) {
        const draft = state.getDraft(draftMatch[1]);
        if (!draft || draft.status !== "pending") {
          sendJson(response, 404, { error: "Draft not found" });
          return;
        }
        if (draftMatch[2] === "approve") {
          const body = await readJson<{ body?: string }>(request);
          const message = body.body?.trim() || draft.body;
          await client.sendMessage(draft.chatId, message);
          state.rememberMessage(draft.chatId, { role: "assistant", author: "assistant", content: message, countAsIncoming: false });
          state.setDraftStatus(draft.id, "sent");
          state.addActivity("text", "Approved draft sent", draft.contactName);
        } else {
          state.setDraftStatus(draft.id, "dismissed");
        }
        sendJson(response, 200, { ok: true });
        return;
      }

      if (pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      serveStatic(response, pathname);
    } catch (error) {
      console.error("AmirOS dashboard request failed:", error);
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Unexpected error",
      });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`AmirOS is available at http://127.0.0.1:${port}`);
  });
  return server;
}
