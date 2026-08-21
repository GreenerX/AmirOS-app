import { describe, expect, it } from "vitest";
import { orderChatsByRecency, orderMessagesChronologically } from "../ui/src/message-order.js";
import type { ChatMessage, ChatSummary } from "../ui/src/types.js";

const message = (id: string, timestamp: number): ChatMessage => ({
  id,
  body: id,
  fullBody: id,
  fromMe: false,
  timestamp,
  type: "chat",
  hasMedia: false,
});

const chat = (id: string, timestamp: number, pinned = false): ChatSummary => ({
  id,
  name: id,
  isGroup: false,
  pinned,
  unreadCount: 0,
  timestamp,
  preview: "Preview",
  mode: "off",
});

describe("Inbox message ordering", () => {
  it("keeps WhatsApp's source order when messages share a second", () => {
    const messages = [
      message("later-in-source-order", 1_725_000_010),
      message("earlier-in-source-order", 1_725_000_010),
      message("older", 1_725_000_009),
    ];

    expect(orderMessagesChronologically(messages).map((item) => item.id)).toEqual([
      "older",
      "later-in-source-order",
      "earlier-in-source-order",
    ]);
  });

  it("orders second and millisecond timestamps on the same timeline", () => {
    const messages = [message("newer", 1_725_000_011_000), message("older", 1_725_000_010)];

    expect(orderMessagesChronologically(messages).map((item) => item.id)).toEqual(["older", "newer"]);
  });

  it("keeps newer conversations above older pinned conversations", () => {
    const chats = [chat("older-pinned", 1_725_000_000, true), chat("newer", 1_725_000_001)];

    expect(orderChatsByRecency(chats).map((item) => item.id)).toEqual(["newer", "older-pinned"]);
  });
});
