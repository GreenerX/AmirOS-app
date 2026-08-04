import { describe, expect, it } from "vitest";
import {
  readHiddenIntelligenceActions,
  replyActionId,
  visibleReplyChats,
} from "../ui/src/intelligence-visibility.js";
import type { IntelligenceChat } from "../ui/src/types.js";

function replyChat(messageId: string, timestamp = 1_800_000_000_000): IntelligenceChat {
  return {
    chatId: "friend@c.us",
    contactName: "Friend",
    isGroup: false,
    insights: [],
    commitments: [],
    events: [],
    needsReply: true,
    lastIncoming: { role: "user", content: "Can you help?", timestamp, messageId },
    updatedAt: timestamp,
  };
}

describe("Intelligence reply visibility", () => {
  it("ties a dismissed reply to the specific incoming message", () => {
    const oldMessage = replyChat("message-1");
    const newMessage = replyChat("message-2", oldMessage.updatedAt + 1_000);
    const hidden = new Set([replyActionId(oldMessage)]);

    expect(visibleReplyChats([oldMessage], hidden)).toEqual([]);
    expect(visibleReplyChats([newMessage], hidden)).toEqual([newMessage]);
  });

  it("ignores legacy contact-wide dismissals", () => {
    const chat = replyChat("message-2");
    expect(visibleReplyChats([chat], new Set([`reply:${chat.chatId}`]))).toEqual([chat]);
  });

  it("recovers safely from invalid stored data", () => {
    expect(readHiddenIntelligenceActions({ getItem: () => "not-json" })).toEqual(new Set());
    expect(readHiddenIntelligenceActions({ getItem: () => JSON.stringify(["one", 2]) })).toEqual(new Set(["one"]));
  });
});
