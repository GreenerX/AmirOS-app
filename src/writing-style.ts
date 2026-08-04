import type { AiService } from "./ai.js";
import type { AmirosState, WritingStyleProfile } from "./amiros-state.js";

export const WRITING_STYLE_REFRESH_INTERVAL = 5;

type WritingStyleAi = Pick<AiService, "analyzeWritingStyle" | "clearConversation">;

export class WritingStyleLearner {
  private readonly inFlight = new Map<string, Promise<WritingStyleProfile | undefined>>();

  constructor(
    private readonly state: AmirosState,
    private readonly ai: WritingStyleAi,
  ) {}

  refreshIfDue(chatId: string): Promise<WritingStyleProfile | undefined> {
    const existing = this.inFlight.get(chatId);
    if (existing) return existing;

    const ownerMessageCount = this.state.getOwnerWritingMessageCount(chatId);
    const learnedMessageCount = this.state.getWritingStyleProfile(chatId)?.ownerMessageCountAtUpdate || 0;
    if (
      ownerMessageCount < WRITING_STYLE_REFRESH_INTERVAL ||
      ownerMessageCount - learnedMessageCount < WRITING_STYLE_REFRESH_INTERVAL
    ) {
      return Promise.resolve(undefined);
    }

    const task = this.learn(chatId, ownerMessageCount)
      .finally(() => this.inFlight.delete(chatId));
    this.inFlight.set(chatId, task);
    return task;
  }

  private async learn(
    chatId: string,
    ownerMessageCount: number,
  ): Promise<WritingStyleProfile | undefined> {
    const messages = this.state.getOwnerWritingMessages(chatId, 120);
    if (messages.length < WRITING_STYLE_REFRESH_INTERVAL) return undefined;

    const analyzed = await this.ai.analyzeWritingStyle({ chatId, messages });
    const profile = this.state.setWritingStyleProfile(chatId, {
      ...analyzed,
      sourceMessageCount: ownerMessageCount,
      ownerMessageCountAtUpdate: ownerMessageCount,
    });
    this.ai.clearConversation(chatId);
    this.state.addActivity(
      "system",
      "Writing style refreshed automatically",
      this.state.getChatName(chatId) || chatId,
    );
    return profile;
  }
}
