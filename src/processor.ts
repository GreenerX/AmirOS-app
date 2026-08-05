import {
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  timingSafeEqual,
} from "node:crypto";
import whatsappWeb from "whatsapp-web.js";
import type { Message } from "whatsapp-web.js";
import type { AiService } from "./ai.js";
import { inferMessageLanguage } from "./ai.js";
import type { AmirosState, ReplyMode } from "./amiros-state.js";
import { parseCommand, type BotCommand } from "./commands.js";
import type { AppConfig } from "./config.js";
import type { IntelligenceLearner } from "./intelligence-learner.js";
import type { WritingStyleLearner } from "./writing-style.js";

const { MessageMedia } = whatsappWeb;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type ConversationAddressMessage = Pick<Message, "fromMe" | "from" | "to" | "getChat"> & {
  id?: { remote?: string | { _serialized?: string } };
};

export async function resolveConversationId(message: ConversationAddressMessage): Promise<string> {
  const remote = message.id?.remote;
  const remoteId = typeof remote === "string" ? remote : remote?._serialized;
  if (remoteId?.endsWith("@g.us")) return remoteId;
  const chat = await message.getChat().catch(() => undefined);
  const chatId = chat?.id?._serialized;
  if (chatId?.endsWith("@g.us")) return chatId;
  return chatId || (message.fromMe ? message.to : message.from);
}

type RawWhatsAppMedia = {
  directPath?: string;
  deprecatedMms3Url?: string;
  mediaKey?: string;
  mimetype?: string;
  filename?: string;
};

type MediaFetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

type ResolvedCommand = {
  command: BotCommand;
  explicit: boolean;
};

type CommandResolution = {
  resolved?: ResolvedCommand;
  sourceText: string;
};

export function allowsMessageDirection(
  fromMe: boolean,
  isSelfChat: boolean,
  allowOutgoingTriggerCommands: boolean,
): boolean {
  return !fromMe || isSelfChat || allowOutgoingTriggerCommands;
}

export function resolveAutomationMode(
  fromMe: boolean,
  isSelfChat: boolean,
  isGroup: boolean,
  allowGroups: boolean,
  savedMode: ReplyMode,
): ReplyMode {
  if (fromMe || isSelfChat) return "off";
  if (isGroup && !allowGroups) return "off";
  return savedMode;
}

export function naturalFailureMessage(error: unknown): string {
  const value = error && typeof error === "object" ? error as { status?: number; code?: string; type?: string; message?: string; cause?: { message?: string } } : undefined;
  const detail = [value?.code, value?.type, value?.message, value?.cause?.message, error instanceof Error ? error.message : typeof error === "string" ? error : ""]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  const status = value?.status;
  if (/invalid body|parse json|invalid json|malformed/.test(detail)) {
    return "I hit a temporary formatting problem while preparing that answer. I cleared the bad context rather than guess—please send the question once more and I’ll answer from the saved facts I can read.";
  }
  if (/insufficient_quota|quota|billing|credit|spend limit/.test(detail)) {
    return "I can't complete that answer because AmirOS has reached its current AI usage limit. Amir will need to check the Usage settings before I can try again.";
  }
  if (/rate[_ -]?limit|too many requests/.test(detail) || status === 429) {
    return "I'm receiving too many requests at once and couldn't finish that answer. Give me a moment, then ask me again.";
  }
  if (/invalid[_ -]?api[_ -]?key|authentication|unauthorized|missing.*key/.test(detail) || status === 401) {
    return "I can't reach the AI service because AmirOS's connection needs attention. Amir will need to reconnect it in Settings.";
  }
  if (/model_not_found|model.*access|permission|forbidden/.test(detail) || status === 403) {
    return "The selected AI model isn't available to AmirOS right now. Amir can choose another model in Settings and then I can try again.";
  }
  if (/timeout|timed out|econnreset|enotfound|fetch failed|network|socket/.test(detail)) {
    return "I'm having trouble reaching the AI service right now, so I couldn't look that up. Try me again in a moment.";
  }
  if (/safety|policy|content filter|moderation/.test(detail)) {
    return "I couldn't help with that exact request because it may cross a safety boundary. If you rephrase what you need, I can try a safer version.";
  }
  return "Something went wrong while I was putting that answer together, and I can't tell exactly which part failed. I stopped rather than risk giving you the wrong information—please ask me once more.";
}

export async function downloadAndDecryptWhatsAppMedia(
  message: Message,
  mediaFetch: MediaFetch = fetch,
): Promise<InstanceType<typeof MessageMedia>> {
  const raw = (message as Message & { _data?: RawWhatsAppMedia })._data;
  const mediaKey = raw?.mediaKey || message.mediaKey;
  const mediaUrl = raw?.deprecatedMms3Url || raw?.directPath;
  if (!mediaKey || !mediaUrl) {
    throw new Error("Voice message is missing its encrypted media key or URL");
  }

  const resolvedUrl = mediaUrl.startsWith("http")
    ? mediaUrl
    : `https://mmg.whatsapp.net${mediaUrl}`;
  const response = await mediaFetch(resolvedUrl);
  if (!response.ok) {
    throw new Error(`WhatsApp media CDN returned HTTP ${response.status}`);
  }

  const encrypted = Buffer.from(await response.arrayBuffer());
  if (encrypted.length <= 10) throw new Error("Encrypted voice payload is too short");

  const expanded = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(mediaKey, "base64"),
      Buffer.alloc(32),
      "WhatsApp Audio Keys",
      112,
    ),
  );
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const macKey = expanded.subarray(48, 80);
  const ciphertext = encrypted.subarray(0, -10);
  const receivedMac = encrypted.subarray(-10);
  const expectedMac = createHmac("sha256", macKey)
    .update(Buffer.concat([iv, ciphertext]))
    .digest()
    .subarray(0, 10);
  if (!timingSafeEqual(receivedMac, expectedMac)) {
    throw new Error("WhatsApp voice payload failed integrity verification");
  }

  const decipher = createDecipheriv("aes-256-cbc", cipherKey, iv);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return new MessageMedia(
    raw?.mimetype || "audio/ogg; codecs=opus",
    decrypted.toString("base64"),
    raw?.filename || "voice.ogg",
    decrypted.length,
  );
}

export async function downloadMessageMediaWithRetry(
  message: Pick<Message, "downloadMedia" | "reload">,
  attempts = 5,
  retryDelayMs = 1_500,
): Promise<Awaited<ReturnType<Message["downloadMedia"]>>> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const media = await message.downloadMedia();
      if (media?.data) return media;
      lastError = new Error("WhatsApp media is not ready yet");
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (message === "r") throw error;
    }

    if (attempt < attempts) {
      await wait(retryDelayMs * attempt);
      await message.reload().catch(() => undefined);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`WhatsApp media download failed: ${String(lastError)}`);
}

export class MessageProcessor {
  private readonly processedMessageIds = new Set<string>();
  private readonly suppressedOutputs = new Map<string, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly ai: AiService,
    private readonly amiros?: AmirosState,
    private readonly writingStyleLearner?: WritingStyleLearner,
    private readonly intelligenceLearner?: IntelligenceLearner,
  ) {}

  async process(message: Message, isSelfChat = false): Promise<void> {
    const messageId =
      message.id?._serialized ||
      message.id?.id ||
      createHash("sha256")
        .update(
          [
            message.fromMe ? "1" : "0",
            message.from,
            message.to,
            message.timestamp,
            message.type,
            message.body,
          ].join("|"),
        )
        .digest("hex");
    if (this.processedMessageIds.has(messageId)) return;
    this.processedMessageIds.add(messageId);

    if (message.from === "status@broadcast") return;
    if (["e2e_notification", "notification", "ciphertext", "revoked", "protocol"].includes(message.type)) return;
    const chatId = await resolveConversationId(message);
    if (!chatId) return;
    const isGroup = chatId.endsWith("@g.us");
    let capturedIncomingText = "";
    if (!message.fromMe) {
      try {
        capturedIncomingText = await this.captureIncomingMessage(message, chatId, isGroup);
        if (capturedIncomingText.trim()) void this.intelligenceLearner?.analyzeIncoming(chatId);
      } catch (error) {
        console.warn("Incoming message could not be added to contact memory", {
          messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (message.fromMe) {
      const isSuppressedOutput = this.consumeSuppressedOutput(chatId, message);
      const isRecordedAssistantOutput = this.amiros?.isKnownAssistantOutput(chatId, message.body || "") || false;
      if (isSuppressedOutput || isRecordedAssistantOutput) return;
      if (isSelfChat && message.hasQuotedMsg) return;
    }
    if (
      !allowsMessageDirection(
        message.fromMe,
        isSelfChat,
        this.config.allowOutgoingTriggerCommands,
      )
    ) {
      await this.rememberUnansweredMessage(message, chatId, chatId.endsWith("@g.us"));
      return;
    }
    if (isSelfChat && !this.config.autoReplySelfChat) {
      await this.rememberUnansweredMessage(message, chatId, false);
      return;
    }

    if (isGroup && !this.config.allowGroups && !message.fromMe) {
      console.log("Message ignored: group conversations are disabled", {
        messageId,
      });
      await this.rememberUnansweredMessage(message, chatId, true);
      return;
    }
    if (this.amiros?.isPaused()) {
      console.log("Message ignored: AmirOS is paused", { messageId });
      await this.rememberUnansweredMessage(message, chatId, isGroup);
      return;
    }

    console.log("WhatsApp message received", {
      messageId,
      type: message.type,
      fromMe: message.fromMe,
      isGroup,
      hasMedia: message.hasMedia,
      isSelfChat,
    });

    try {
      const contactMode = resolveAutomationMode(
        message.fromMe,
        isSelfChat,
        isGroup,
        this.config.allowGroups,
        this.amiros?.getContact(chatId).mode || "off",
      );
      const automationAllowed =
        contactMode !== "off" && !this.amiros?.isQuietHoursNow();
      const resolution = await this.getCommand(
        message,
        isSelfChat || automationAllowed,
        capturedIncomingText,
      );
      const { resolved } = resolution;
      if (!resolved) {
        if (message.fromMe) {
          await this.rememberText(chatId, resolution.sourceText, message, isGroup);
        }
        console.log("Message ignored: no recognized bot trigger", { messageId });
        return;
      }
      const { command } = resolved;
      console.log("Bot command recognized", { messageId, kind: command.kind });

      if (command.kind === "models") {
        const summary = this.modelSummary();
        this.suppressOutput(chatId, "chat", summary);
        await message.reply(summary, chatId);
        this.amiros?.rememberMessage(chatId, {
          role: "assistant",
          author: "assistant",
          content: summary,
          timestamp: Date.now(),
          countAsIncoming: false,
        });
        this.amiros?.addActivity("system", "Model summary sent", chatId);
        console.log("Model summary sent", { messageId });
        return;
      }

      if (!command.prompt) {
        const usage =
          command.kind === "image"
            ? `💡 *Try:* ${this.config.imageTriggerPrefix} describe the image you want`
            : command.kind === "web"
              ? `💡 *Try:* ${this.config.webTriggerPrefix} ask a current question`
              : `💡 *Try:* ${this.config.botTriggerPrefix} ask your question`;
        this.suppressOutput(chatId, "chat", usage);
        await message.reply(usage, chatId);
        this.amiros?.rememberMessage(chatId, {
          role: "assistant",
          author: "assistant",
          content: usage,
          timestamp: Date.now(),
          countAsIncoming: false,
        });
        return;
      }

      if (command.kind === "image") {
        const image = await this.ai.generateImage(command.prompt);
        const imageCaption = `🎨 ${command.prompt.slice(0, 895)}`;
        const media = new MessageMedia(
          "image/png",
          image.toString("base64"),
          "generated.png",
        );
        this.suppressOutput(
          chatId,
          "image",
          imageCaption,
        );
        await message.reply(media, chatId, {
          caption: imageCaption,
        });
        this.amiros?.addActivity(
          "image",
          "Image generated",
          command.prompt.slice(0, 90),
        );
        const identity = await this.messageIdentity(message, isGroup);
        if (message.fromMe) {
          this.amiros?.rememberExchange(
            chatId,
            command.prompt,
            imageCaption,
            identity.senderName,
            false,
            "owner",
            isSelfChat && resolved.explicit,
          );
        } else {
          this.amiros?.rememberMessage(chatId, {
            role: "assistant",
            author: "assistant",
            content: imageCaption,
          });
        }
        console.log("Generated image sent", { messageId });
        return;
      }

      const contact = this.amiros?.getContact(chatId);
      const identity = await this.messageIdentity(message, isGroup);
      const ownerName = this.amiros?.getSettings().ownerProfile.displayName || "Amir";
      const triggerAuthor = message.fromMe ? "owner" : "contact";
      const requesterName = message.fromMe
        ? ownerName
        : identity.senderName || identity.chatName || (isGroup ? "Group participant" : "WhatsApp contact");
      this.amiros?.rememberChatName(chatId, identity.chatName);
      const currentMessageId = message.id?._serialized || message.id?.id;
      const currentMessageTimestamp = message.timestamp ? message.timestamp * 1_000 : Date.now();
      const isExplicitSelfChatCommand = message.fromMe && isSelfChat && resolved.explicit;
      if (message.fromMe && command.prompt.trim()) {
        this.amiros?.rememberMessage(chatId, {
          role: "user",
          author: "owner",
          content: command.prompt,
          senderName: ownerName,
          timestamp: currentMessageTimestamp,
          messageId: currentMessageId,
          countAsIncoming: false,
          extractSignals: !isExplicitSelfChatCommand,
          excludeFromAutomaticLearning: isExplicitSelfChatCommand,
        });
        if (!isExplicitSelfChatCommand) {
          void this.intelligenceLearner?.analyzeIncoming(chatId);
          await this.refreshWritingStyle(chatId);
        }
      }
      const calendarCapture = this.amiros?.getCalendarCaptureResult(
        chatId,
        command.prompt,
        currentMessageTimestamp,
        currentMessageId,
      );
      const ownerTriggered = message.fromMe && resolved.explicit && !isSelfChat;
      const contactTriggered = !message.fromMe && resolved.explicit && !isSelfChat;
      const ownerTriggerAccess = contact?.ownerTriggerAccess || [];
      const contactTriggerAccess = contact?.contactTriggerAccess || [];
      const includeGlobalKnowledge = isSelfChat
        || (ownerTriggered && ownerTriggerAccess.includes("knowledge"))
        || (contactTriggered && contactTriggerAccess.includes("knowledge"));
      const includeGlobalCalendar = isSelfChat
        || (ownerTriggered && ownerTriggerAccess.includes("calendar"))
        || (contactTriggered && contactTriggerAccess.includes("calendar"));
      const globalContext = includeGlobalKnowledge || includeGlobalCalendar
        ? this.amiros?.ownerAssistantContext(command.prompt, chatId, {
          knowledge: includeGlobalKnowledge,
          calendar: includeGlobalCalendar,
          requesterName,
          ownerName,
        })
        : undefined;
      if (!isExplicitSelfChatCommand) await this.refreshWritingStyle(chatId);
      const contextScope = isSelfChat
        ? "owner"
        : ownerTriggered && (includeGlobalKnowledge || includeGlobalCalendar)
          ? "owner-trigger"
          : contactTriggered && (includeGlobalKnowledge || includeGlobalCalendar)
            ? "contact-trigger"
          : "chat";
      console.log("AI context prepared", {
        messageId,
        scope: contextScope,
        triggerAuthor,
        requesterName,
        globalKnowledgeAllowed: includeGlobalKnowledge,
        globalCalendarAllowed: includeGlobalCalendar,
        chatMemoryEntries: this.amiros?.getConversationMemory(chatId, this.config.conversationTurnLimit * 2).length || 0,
        ownerKnowledgeRecords: globalContext?.knowledge.length || 0,
        ownerCalendarEvents: globalContext?.events.length || 0,
      });
      const answer = await this.ai.reply(
        chatId,
        command.prompt,
        command.kind === "web",
        {
          scope: contextScope,
          triggerAuthor,
          requesterName,
          ownerName,
          contact,
          chatName: identity.chatName,
          senderName: identity.senderName,
          isGroup,
          memory: this.amiros
            ?.getConversationMemory(chatId, this.config.conversationTurnLimit * 2 + 1)
            .filter((entry) => !currentMessageId || entry.messageId !== currentMessageId)
            .slice(-(this.config.conversationTurnLimit * 2)),
          manualMemory: this.amiros?.getManualMemory(chatId),
          profile: this.amiros?.getContactProfile(chatId),
          insights: this.amiros?.getInsights(chatId),
          styleProfile: this.amiros?.getWritingStyleProfile(chatId),
          events: this.amiros?.getCalendarEvents(chatId),
          ownerKnowledge: includeGlobalKnowledge ? globalContext?.knowledge : undefined,
          ownerEvents: includeGlobalCalendar ? globalContext?.events : undefined,
          relationshipContext: includeGlobalKnowledge ? globalContext?.relationshipContext : undefined,
          currentMessageLanguage: inferMessageLanguage(command.prompt) || inferMessageLanguage(
            (this.amiros?.getConversationMemory(chatId, 8) || [])
              .filter((entry) => entry.role === "user")
              .map((entry) => entry.content)
              .join("\n"),
          ),
          calendarCapture,
        },
      );
      if (
        !resolved.explicit &&
        !message.fromMe &&
        !isSelfChat &&
        contactMode === "suggest"
      ) {
        const chat = await message.getChat().catch(() => undefined);
        this.amiros?.addDraft({
          chatId,
          contactName: chat?.name || "WhatsApp contact",
          sourcePreview: command.prompt.slice(0, 180),
          body: answer,
        });
        console.log("AI draft prepared for AmirOS review", { messageId });
        return;
      }
      this.suppressOutput(chatId, "chat", answer);
      await message.reply(answer, chatId);
      this.amiros?.addActivity(
        command.kind === "web" ? "web" : "text",
        command.kind === "web" ? "Web answer sent" : "Text reply sent",
        chatId,
      );
      if (message.fromMe) {
        this.amiros?.rememberMessage(chatId, {
          role: "assistant",
          author: "assistant",
          content: answer,
          timestamp: Date.now(),
        });
      } else {
        this.amiros?.rememberMessage(chatId, {
          role: "assistant",
          author: "assistant",
          content: answer,
        });
      }
      console.log("AI reply sent", { messageId });
    } catch (error) {
      console.error("Failed to process WhatsApp message", {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.ai.clearConversation(chatId);
      const failureMessage = naturalFailureMessage(error);
      this.suppressOutput(chatId, "chat", failureMessage);
      await message
        .reply(failureMessage, chatId)
        .catch(() => undefined);
      this.amiros?.rememberMessage(chatId, {
        role: "assistant",
        author: "assistant",
        content: failureMessage,
        timestamp: Date.now(),
        countAsIncoming: false,
      });
    }
  }

  private async getCommand(
    message: Message,
    fallbackToChat: boolean,
    capturedTranscript = "",
  ): Promise<CommandResolution> {
    if (message.type === "chat") {
      const prefixes = {
        chat: this.config.botTriggerPrefix,
        web: this.config.webTriggerPrefix,
        image: this.config.imageTriggerPrefix,
        models: this.config.modelsTriggerPrefix,
      };
      const explicit = parseCommand(message.body, prefixes, false);
      if (explicit) {
        return { resolved: { command: explicit, explicit: true }, sourceText: message.body };
      }
      const fallback = parseCommand(
        message.body,
        prefixes,
        fallbackToChat,
      );
      return {
        resolved: fallback ? { command: fallback, explicit: false } : undefined,
        sourceText: message.body,
      };
    }

    if (!message.hasMedia || (message.type !== "ptt" && message.type !== "audio")) {
      return { sourceText: "" };
    }

    const transcript = capturedTranscript || await this.transcribeVoiceMessage(message);
    const prefixes = {
      chat: this.config.voiceBotTriggerPrefix,
      web: this.config.voiceWebTriggerPrefix,
      image: this.config.voiceImageTriggerPrefix,
    };
    const explicit = parseCommand(transcript, prefixes, false);
    if (explicit) {
      return { resolved: { command: explicit, explicit: true }, sourceText: transcript };
    }
    const fallback = parseCommand(
      transcript,
      prefixes,
      fallbackToChat,
    );
    return {
      resolved: fallback ? { command: fallback, explicit: false } : undefined,
      sourceText: transcript,
    };
  }

  private async captureIncomingMessage(
    message: Message,
    chatId: string,
    isGroup: boolean,
  ): Promise<string> {
    if (!this.amiros?.getContact(chatId).memoryEnabled) return "";
    if (message.type === "ptt" || message.type === "audio") {
      try {
        const transcript = await this.transcribeVoiceMessage(message);
        await this.rememberText(chatId, transcript, message, isGroup);
        return transcript;
      } catch (error) {
        console.warn("Incoming voice message could not be added to contact memory", {
          messageId: message.id?._serialized || message.id?.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return "";
      }
    }

    const body = message.body?.trim();
    if (body) {
      await this.rememberText(chatId, body, message, isGroup);
      return body;
    }
    if (message.hasMedia) {
      const identity = await this.messageIdentity(message, isGroup);
      this.amiros.rememberChatName(chatId, identity.chatName);
      this.amiros.rememberMessage(chatId, {
        role: "user",
        author: isGroup ? "group_member" : "contact",
        content: `[Incoming ${message.type || "media"} message]`,
        senderName: identity.senderName,
        timestamp: message.timestamp ? message.timestamp * 1_000 : undefined,
        messageId: message.id?._serialized || message.id?.id,
      });
    }
    return "";
  }

  private async transcribeVoiceMessage(message: Message): Promise<string> {
    console.log("Downloading voice message media", {
      messageId: message.id?._serialized || message.id?.id,
    });
    let media: Awaited<ReturnType<Message["downloadMedia"]>>;
    try {
      media = await downloadMessageMediaWithRetry(message);
    } catch (libraryError) {
      console.warn("WhatsApp library media download failed; using local fallback", {
        messageId: message.id?._serialized || message.id?.id,
        error:
          libraryError instanceof Error
            ? libraryError.message
            : String(libraryError),
      });
      media = await downloadAndDecryptWhatsAppMedia(message);
    }
    const transcript = await this.ai.transcribe(
      Buffer.from(media.data, "base64"),
      media.mimetype || "audio/ogg",
      Number(message.duration) || undefined,
    );
    console.log("Voice message transcribed", {
      messageId: message.id?._serialized || message.id?.id,
    });
    this.amiros?.addActivity("voice", "Voice message transcribed", await resolveConversationId(message));
    return transcript;
  }

  private async messageIdentity(
    message: Message,
    isGroup: boolean,
  ): Promise<{ chatName?: string; senderName?: string; mentionIds?: string[]; ownerMentioned?: boolean }> {
    // Some cached/recovered WhatsApp message shapes do not expose
    // `getMentions()`. Mentions enrich attribution but must never prevent the
    // message itself from being remembered or analysed.
    const getMentions = (message as Message & {
      getMentions?: () => Promise<Array<{ isMe?: boolean }>>;
    }).getMentions;
    const [chat, sender, mentions] = await Promise.all([
      message.getChat().catch(() => undefined),
      isGroup ? message.getContact().catch(() => undefined) : Promise.resolve(undefined),
      isGroup && typeof getMentions === "function" ? getMentions.call(message).catch(() => []) : Promise.resolve([]),
    ]);
    const senderName = sender
      ? sender.name || sender.pushname || sender.shortName || sender.number
      : undefined;
    return {
      chatName: chat?.name,
      senderName: message.fromMe && isGroup ? senderName || "You" : senderName,
      mentionIds: [...new Set((message.mentionedIds || []).filter(Boolean))],
      ownerMentioned: Boolean(message.fromMe || mentions.some((contact) => contact.isMe)),
    };
  }

  private async rememberText(
    chatId: string,
    content: string,
    message: Message,
    isGroup: boolean,
  ): Promise<void> {
    if (!content.trim()) return;
    const identity = await this.messageIdentity(message, isGroup);
    this.amiros?.rememberChatName(chatId, identity.chatName);
    this.amiros?.rememberMessage(chatId, {
      role: "user",
      author: message.fromMe ? "owner" : isGroup ? "group_member" : "contact",
      content,
      senderName: message.fromMe
        ? this.amiros?.getSettings().ownerProfile.displayName || identity.senderName
        : identity.senderName,
      mentionIds: identity.mentionIds,
      ownerMentioned: identity.ownerMentioned,
      timestamp: message.timestamp ? message.timestamp * 1_000 : undefined,
      messageId: message.id?._serialized || message.id?.id,
      countAsIncoming: !message.fromMe,
      extractSignals: message.fromMe,
    });
    if (message.fromMe) {
      void this.intelligenceLearner?.analyzeIncoming(chatId);
      await this.refreshWritingStyle(chatId);
    }
  }

  private async refreshWritingStyle(chatId: string): Promise<void> {
    try {
      await this.writingStyleLearner?.refreshIfDue(chatId);
    } catch (error) {
      console.warn("Automatic writing-style refresh failed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async rememberUnansweredMessage(
    message: Message,
    chatId: string,
    isGroup: boolean,
  ): Promise<void> {
    if (message.type === "chat") {
      await this.rememberText(chatId, message.body, message, isGroup);
    }
  }

  private modelSummary(): string {
    return [
      "🤖 *Active setup*",
      "",
      `• *Preset:* ${this.config.modelPresetName}`,
      `• *Text:* ${this.config.openaiTextModel}`,
      `• *Images:* ${this.config.openaiImageModel} (${this.config.openaiImageQuality})`,
      `• *Voice:* ${this.config.openaiTranscribeModel}`,
      `• *Web search:* ${this.config.webSearchEnabled ? `on (${this.config.webSearchContextSize})` : "off"}`,
      `• *Self-chat:* ${this.config.autoReplySelfChat ? "automatic" : "trigger required"}`,
      `• *Outgoing triggers:* ${this.config.allowOutgoingTriggerCommands ? "on" : "off"}`,
      `• *Maximum reply length:* ${this.config.openaiTextMaxOutputTokens} tokens`,
      `• *Short-term conversation:* ${this.config.conversationTurnLimit} turns`,
      "• *Saved knowledge:* persistent and searched across all tracked messages",
    ].join("\n");
  }

  private suppressOutput(chatId: string, type: string, body: string): void {
    const fingerprint = this.outputFingerprint(chatId, type, body);
    this.suppressedOutputs.set(
      fingerprint,
      (this.suppressedOutputs.get(fingerprint) || 0) + 1,
    );
  }

  private consumeSuppressedOutput(chatId: string, message: Message): boolean {
    const fingerprint = this.outputFingerprint(chatId, message.type, message.body);
    const remaining = this.suppressedOutputs.get(fingerprint) || 0;
    if (remaining === 0) return false;
    if (remaining === 1) this.suppressedOutputs.delete(fingerprint);
    else this.suppressedOutputs.set(fingerprint, remaining - 1);
    return true;
  }

  private outputFingerprint(chatId: string, type: string, body: string): string {
    return createHash("sha256").update(`${chatId}|${type}|${body}`).digest("hex");
  }
}
