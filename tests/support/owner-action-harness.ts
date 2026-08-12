import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "whatsapp-web.js";
import type { AiService } from "../../src/ai.js";
import {
  AmirosState,
  type CalendarEvent,
  type PendingOwnerActionClarification,
  type RelationshipCommitment,
  type TodoTask,
} from "../../src/amiros-state.js";
import type { AppConfig } from "../../src/config.js";
import { MessageProcessor } from "../../src/processor.js";
import type { PendingOwnerLifecycleClarification } from "../../src/owner-lifecycle.js";
import type { OwnerRecordReference } from "../../src/owner-lifecycle.js";

const OWNER_CHAT_ID = "owner@c.us";

const harnessConfig = {
  allowGroups: true,
  allowOutgoingTriggerCommands: true,
  autoReplySelfChat: true,
  botTriggerPrefix: "!bot",
  webTriggerPrefix: "!web",
  imageTriggerPrefix: "!image",
  modelsTriggerPrefix: "!models",
  voiceBotTriggerPrefix: "bot",
  voiceWebTriggerPrefix: "web",
  voiceImageTriggerPrefix: "image",
  conversationTurnLimit: 10,
} as AppConfig;

export type OwnerActionHarnessOptions = {
  now?: number;
  chatId?: string;
  ownerName?: string;
  todoPresentation?: (input: { source: string; currentTitle: string }) => Promise<{
    title: string;
    priority: "low" | "normal" | "high";
    emoji: string;
  }>;
  ownerActionTitle?: (input: { kind: string; source: string; currentTitle: string }) => Promise<string>;
  generalReply?: (prompt: string) => Promise<string>;
};

export type OwnerActionHarnessSnapshot = {
  todos: TodoTask[];
  events: CalendarEvent[];
  commitments: RelationshipCommitment[];
  pending?: PendingOwnerActionClarification;
  pendingLifecycle?: PendingOwnerLifecycleClarification;
  references: OwnerRecordReference[];
  dashboard: {
    todos: Array<TodoTask & { chatId: string; contactName?: string }>;
    events: Array<CalendarEvent & { chatId: string }>;
  };
};

export type OwnerActionHarnessTurn = {
  request: string;
  at: number;
  replies: string[];
  snapshot: OwnerActionHarnessSnapshot;
};

function defaultEmoji(title: string): string {
  const normalized = title.toLocaleLowerCase();
  if (normalized.includes("batter")) return "🔋";
  if (normalized.includes("trash")) return "🗑️";
  if (normalized.includes("cat food")) return "🐱";
  if (normalized.includes("vacuum")) return "🧹";
  if (normalized.includes("milk")) return "🥛";
  return "✅";
}

/**
 * Test-only owner/self-chat runtime.
 *
 * It deliberately uses the production MessageProcessor and file-backed
 * AmirosState. Only the external boundaries are replaced: WhatsApp messages
 * are in-memory objects and AI enrichment is deterministic and network-free.
 */
export class OwnerActionHarness {
  readonly directory: string;
  readonly statePath: string;
  readonly replies: string[] = [];
  readonly turns: OwnerActionHarnessTurn[] = [];
  readonly aiCalls = { todoPresentation: 0, ownerActionTitle: 0, generalReply: 0, clearConversation: 0 };

  state: AmirosState;
  private processor: MessageProcessor;
  private sequence = 0;
  private currentTime: number;
  private readonly chatId: string;
  private readonly ownerName: string;
  private readonly ai: AiService;

  constructor(private readonly options: OwnerActionHarnessOptions = {}) {
    this.directory = mkdtempSync(join(tmpdir(), "amiros-owner-e2e-"));
    this.statePath = join(this.directory, "state.json");
    this.chatId = options.chatId || OWNER_CHAT_ID;
    this.ownerName = options.ownerName || "Amir Friedman";
    this.currentTime = options.now ?? new Date(2026, 7, 11, 9, 0).getTime();
    this.state = new AmirosState(this.statePath);
    this.state.updateOwnerProfile({ displayName: this.ownerName });
    // Match a fully enabled owner/self-chat without allowing the automatic
    // intelligence reconciler to become a second lifecycle writer.
    this.state.updateContact(this.chatId, { knowledgeTracking: "enabled" });

    this.ai = {
      generateTodoPresentation: async (input: { source: string; currentTitle: string }) => {
        this.aiCalls.todoPresentation += 1;
        return options.todoPresentation?.(input) || {
          title: input.currentTitle,
          priority: "normal" as const,
          emoji: defaultEmoji(input.currentTitle),
        };
      },
      generateOwnerActionTitle: async (input: { kind: string; source: string; currentTitle: string }) => {
        this.aiCalls.ownerActionTitle += 1;
        return options.ownerActionTitle?.(input) || input.currentTitle;
      },
      reply: async (_chatId: string, prompt: string) => {
        this.aiCalls.generalReply += 1;
        return options.generalReply?.(prompt) || "No owner action was taken.";
      },
      clearConversation: () => { this.aiCalls.clearConversation += 1; },
    } as unknown as AiService;
    this.processor = this.createProcessor();
  }

  async send(request: string, options: { at?: number; advanceMs?: number } = {}): Promise<string[]> {
    const at = options.at ?? this.currentTime;
    const replyStart = this.replies.length;
    this.sequence += 1;
    await this.processor.process(this.ownerMessage(request, at, this.sequence), true);
    const replies = this.replies.slice(replyStart);
    this.turns.push({ request, at, replies, snapshot: this.snapshot(at) });
    this.currentTime = at + (options.advanceMs ?? 1_000);
    return replies;
  }

  /** Reopens the same state file, matching a backend restart between messages. */
  restart(): void {
    this.state = new AmirosState(this.statePath);
    this.processor = this.createProcessor();
  }

  advance(milliseconds: number): void {
    this.currentTime += milliseconds;
  }

  failNextTodoWrite(message = "simulated persistence failure"): void {
    const original = this.state.addOwnerTodo.bind(this.state);
    let pendingFailure = true;
    this.state.addOwnerTodo = ((...args: Parameters<AmirosState["addOwnerTodo"]>) => {
      if (pendingFailure) {
        pendingFailure = false;
        throw new Error(message);
      }
      return original(...args);
    }) as AmirosState["addOwnerTodo"];
  }

  failNextTodoUpdate(message = "simulated lifecycle persistence failure"): void {
    const original = this.state.updateTodoTask.bind(this.state);
    let pendingFailure = true;
    this.state.updateTodoTask = ((...args: Parameters<AmirosState["updateTodoTask"]>) => {
      if (pendingFailure) {
        pendingFailure = false;
        throw new Error(message);
      }
      return original(...args);
    }) as AmirosState["updateTodoTask"];
  }

  snapshot(now = this.currentTime): OwnerActionHarnessSnapshot {
    return {
      todos: this.state.getTodoTasks(this.chatId),
      events: this.state.getCalendarEvents(this.chatId),
      commitments: this.state.getCommitments(this.chatId),
      pending: this.state.getPendingOwnerActionClarification(this.chatId, now),
      pendingLifecycle: this.state.getPendingOwnerLifecycleClarification(this.chatId, now),
      references: this.state.getOwnerRecordReferences(this.chatId),
      dashboard: {
        todos: this.state.listTodoTasks().filter((item) => item.chatId === this.chatId),
        events: this.state.listCalendarEvents().filter((item) => item.chatId === this.chatId),
      },
    };
  }

  diagnostics(): string {
    return JSON.stringify({
      chatId: this.chatId,
      statePath: this.statePath,
      aiCalls: this.aiCalls,
      turns: this.turns,
      final: this.snapshot(),
    }, null, 2);
  }

  dispose(): void {
    rmSync(this.directory, { recursive: true, force: true });
  }

  private createProcessor(): MessageProcessor {
    return new MessageProcessor(harnessConfig, this.ai, this.state);
  }

  private ownerMessage(body: string, timestamp: number, sequence: number): Message {
    return {
      id: { _serialized: `owner-e2e-${sequence}-${timestamp}`, remote: this.chatId },
      from: this.chatId,
      to: this.chatId,
      fromMe: true,
      timestamp: Math.floor(timestamp / 1_000),
      type: "chat",
      body,
      hasMedia: false,
      hasQuotedMsg: false,
      getChat: async () => ({ id: { _serialized: this.chatId }, name: this.ownerName }),
      reply: async (answer: string) => { this.replies.push(answer); },
    } as unknown as Message;
  }
}

export async function withOwnerActionHarness(
  scenarioName: string,
  options: OwnerActionHarnessOptions,
  run: (harness: OwnerActionHarness) => Promise<void>,
): Promise<void> {
  const harness = new OwnerActionHarness(options);
  try {
    await run(harness);
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    throw new Error(`${scenarioName} failed\n\n${detail}\n\nOwner-action trace:\n${harness.diagnostics()}`);
  } finally {
    harness.dispose();
  }
}
