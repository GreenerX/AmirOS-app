import type { AiService } from "./ai.js";
import type { AmirosState } from "./amiros-state.js";

type RelationshipIntelligenceAi = Pick<AiService, "analyzeRelationship">;

export const RELATIONSHIP_LEARNING_DEBOUNCE_MS = 45_000;

type ScheduledAnalysis = {
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<void>;
  resolve: () => void;
};

export class IntelligenceLearner {
  /**
   * Keep a single automatic pass economical even when a first history scan
   * discovers a large backlog. Any remaining batches are cooperatively queued
   * after this pass, so they never need a brand-new WhatsApp message to resume.
   */
  private static readonly MAX_BATCHES_PER_DRAIN = 8;
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly rerun = new Set<string>();
  private readonly scheduled = new Map<string, ScheduledAnalysis>();
  private stopped = false;

  constructor(
    private readonly state: AmirosState,
    private readonly ai: RelationshipIntelligenceAi,
  ) {}

  /**
   * Schedule automatic relationship learning. A fresh message in the same
   * chat restarts only that chat's timer, so a burst is analyzed together.
   */
  analyzeIncoming(chatId: string): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.rerun.add(chatId);

    const existing = this.scheduled.get(chatId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.timer = this.startTimer(chatId, existing);
      return existing.promise;
    }

    let resolve!: () => void;
    const scheduled: ScheduledAnalysis = {
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      promise: new Promise<void>((done) => { resolve = done; }),
      resolve: () => resolve(),
    };
    scheduled.timer = this.startTimer(chatId, scheduled);
    this.scheduled.set(chatId, scheduled);
    return scheduled.promise;
  }

  /**
   * Used by intentional/manual work. It bypasses the automatic delay without
   * changing the normal WhatsApp message path.
   */
  analyzeNow(chatId: string): Promise<void> {
    const scheduled = this.scheduled.get(chatId);
    if (scheduled) {
      clearTimeout(scheduled.timer);
      this.scheduled.delete(chatId);
    }

    const task = this.startDrain(chatId);
    if (scheduled) void task.finally(scheduled.resolve);
    return task;
  }

  /** Clear pending timers before the server exits. In-flight API work is not cancelled. */
  shutdown(): void {
    this.stopped = true;
    for (const scheduled of this.scheduled.values()) {
      clearTimeout(scheduled.timer);
      scheduled.resolve();
    }
    this.scheduled.clear();
  }

  private startTimer(chatId: string, scheduled: ScheduledAnalysis): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      if (this.scheduled.get(chatId) !== scheduled) return;
      this.scheduled.delete(chatId);
      void this.startDrain(chatId).finally(scheduled.resolve);
    }, RELATIONSHIP_LEARNING_DEBOUNCE_MS);
    timer.unref?.();
    return timer;
  }

  private startDrain(chatId: string): Promise<void> {
    const existing = this.inFlight.get(chatId);
    if (existing) return existing;

    const task = this.drain(chatId)
      .catch((error) => {
        console.warn("Automatic relationship intelligence analysis failed", {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.inFlight.delete(chatId);
        // The cap above is deliberately finite. Keep draining on a later turn
        // when there is still work, rather than silently leaving an old history
        // batch behind until another message happens to arrive.
        if (this.rerun.has(chatId) && !this.stopped) queueMicrotask(() => void this.analyzeIncoming(chatId));
      });
    this.inFlight.set(chatId, task);
    return task;
  }

  private async drain(chatId: string): Promise<void> {
    let batches = 0;
    do {
      this.rerun.delete(chatId);
      const hasMore = await this.analyzeLatest(chatId);
      batches += 1;
      if (hasMore) this.rerun.add(chatId);
    } while (this.rerun.has(chatId) && batches < IntelligenceLearner.MAX_BATCHES_PER_DRAIN);
  }

  private async analyzeLatest(chatId: string): Promise<boolean> {
    const contact = this.state.getContact(chatId);
    if (!contact.memoryEnabled) return false;
    if (contact.knowledgeTracking !== "enabled") {
      // A chat awaiting approval must never build up a hidden backlog that is
      // unexpectedly analysed later. Recording this cursor makes the choice
      // forward-looking: enable tracking, then new messages are considered.
      const latest = this.state.getConversationMemory(chatId, 1);
      if (latest.length > 0) this.state.markKnowledgeMessagesAnalyzed(chatId, latest);
      return false;
    }
    const newEntries = this.state.getUnanalyzedKnowledgeMessages(chatId, 30);
    if (newEntries.length === 0) return false;
    // Give the model a small amount of preceding context for pronouns and
    // plans, while making it clear that only the unseen entries are candidates
    // for new suggestions. This keeps analysis incremental and affordable.
    const allMemory = this.state.getConversationMemory(chatId, 400);
    const firstNewIndex = newEntries[0]?.messageId
      ? allMemory.findIndex((entry) => entry.messageId === newEntries[0]?.messageId)
      : Math.max(0, allMemory.length - newEntries.length);
    const contextBefore = allMemory.slice(Math.max(0, firstNewIndex - 12), Math.max(0, firstNewIndex));
    const memory = [...contextBefore, ...newEntries];
    const contactName = this.state.getChatName(chatId) || (chatId.endsWith("@g.us") ? "Group conversation" : "WhatsApp contact");
    const ownerName = this.state.getSettings().ownerProfile.displayName || "Amir";
    const analysis = await this.ai.analyzeRelationship({
      chatId,
      contactName,
      isGroup: chatId.endsWith("@g.us"),
      memory,
      candidateMessageIds: newEntries.flatMap((entry) => entry.messageId ? [entry.messageId] : []),
      candidateSince: newEntries.reduce((earliest, entry) => Math.min(earliest, entry.timestamp), newEntries[0]?.timestamp || Date.now()),
      ownerName,
      knownSubjectNames: this.state.getKnownKnowledgeSubjectNames(),
    });
    const routed = this.state.mergeRoutedAnalyzedIntelligence(chatId, analysis);
    this.state.markKnowledgeMessagesAnalyzed(chatId, newEntries);
    console.log("Conversation analyzed for relationship intelligence", {
      chatId,
      messages: newEntries.length,
      insights: analysis.insights.length,
      knowledgeTargets: routed.targetChatIds.length,
      commitments: analysis.commitments.length,
      events: analysis.events.length,
      todos: analysis.todos?.length || 0,
    });
    return this.state.getUnanalyzedKnowledgeMessages(chatId, 1).length > 0;
  }
}
