import { describe, expect, it } from "vitest";
import {
  CHAT_BOTTOM_THRESHOLD,
  isNearChatBottom,
  shouldFollowNewMessages,
  shouldShowNewMessageJump,
} from "../ui/src/inbox-scroll.js";

describe("Inbox live-message scrolling", () => {
  it("follows new messages when the reader is already near the newest message", () => {
    expect(isNearChatBottom({ scrollTop: 904, scrollHeight: 2_000, clientHeight: 1_000 })).toBe(true);
    expect(shouldFollowNewMessages(true, [{ fromMe: false }])).toBe(true);
    expect(shouldShowNewMessageJump(1, true)).toBe(false);
  });

  it("does not force-scroll a reader who is looking at older messages", () => {
    expect(isNearChatBottom({ scrollTop: 300, scrollHeight: 2_000, clientHeight: 1_000 })).toBe(false);
    expect(shouldFollowNewMessages(false, [{ fromMe: false }])).toBe(false);
    expect(shouldShowNewMessageJump(2, false)).toBe(true);
  });

  it("returns to the newest message after sending from AmirOS", () => {
    expect(shouldFollowNewMessages(false, [{ fromMe: true }])).toBe(true);
  });

  it("uses a small bottom threshold so normal reading does not feel jumpy", () => {
    expect(CHAT_BOTTOM_THRESHOLD).toBeGreaterThan(0);
  });
});
