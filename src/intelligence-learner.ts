import type { AiService } from "./ai.js";
import type { AmirosState } from "./amiros-state.js";

type RelationshipIntelligenceAi = Pick<AiService, "analyzeRelationship">;

export class IntelligenceLearner {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly rerun = new Set<string>();

  constructor(
    private readonly state: AmirosState,
    private readonly ai: RelationshipIntelligenceAi,
  ) {}

  analyzeIncoming(chatId: string): Promise<void> {
    this.rerun.add(chatId);
    const existing = this.inFlight.get(chatId);
    if (existing) return existing;

    const task = this.drain(chatId)
      .catch((error) => {
        console.warn("Automatic relationship intelligence analysis failed", {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => this.inFlight.delete(chatId));
    this.inFlight.set(chatId, task);
    return task;
  }

  private async drain(chatId: string): Promise<void> {
    do {
      this.rerun.delete(chatId);
      await this.analyzeLatest(chatId);
    } while (this.rerun.has(chatId));
  }

  private async analyzeLatest(chatId: string): Promise<void> {
    const contact = this.state.getContact(chatId);
    if (!contact.memoryEnabled) return;
    if (contact.knowledgeTracking !== "enabled") {
      // A chat awaiting approval must never build up a hidden backlog that is
      // unexpectedly analysed later. Recording this cursor makes the choice
      // forward-looking: enable tracking, then new messages are considered.
      const latest = this.state.getConversationMemory(chatId, 1);
      if (latest.length > 0) this.state.markKnowledgeMessagesAnalyzed(chatId, latest);
      return;
    }
    const newEntries = this.state.getUnanalyzedKnowledgeMessages(chatId, 30);
    if (newEntries.length === 0) return;
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
    });
  }
}
