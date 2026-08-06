import { describe, expect, it } from "vitest";
import {
  dashboardCallFromWhatsApp,
  dashboardReactionsFromWhatsApp,
} from "../src/dashboard.js";
import {
  callEventPresentation,
  mergedMessageReactions,
} from "../ui/src/inbox-message-presentation.js";
import type { ChatMessage } from "../ui/src/types.js";

describe("WhatsApp reactions in the dashboard timeline", () => {
  const rawReactions = [
    {
      aggregateEmoji: "❤️",
      senders: [
        { id: "dani@c.us", pushname: "Dani", timestamp: 120 },
        { id: "andrew@c.us", name: "Andrew", timestamp: 121 },
      ],
    },
    {
      aggregateEmoji: "❤️",
      hasReactionByMe: true,
      senders: [{ id: "me@c.us", name: "You", timestamp: 122 }],
    },
    { aggregateEmoji: "😂", senders: [{ id: "dani@c.us", pushname: "Dani", timestamp: 123 }] },
  ];

  it("keeps reactions from every participant and combines matching emoji", () => {
    expect(dashboardReactionsFromWhatsApp(rawReactions)).toEqual([
      {
        emoji: "❤️",
        hasReactionByMe: true,
        senders: [
          { id: "dani@c.us", name: "Dani", timestamp: 120 },
          { id: "andrew@c.us", name: "Andrew", timestamp: 121 },
          { id: "me@c.us", name: "You", timestamp: 122 },
        ],
      },
      {
        emoji: "😂",
        hasReactionByMe: false,
        senders: [{ id: "dani@c.us", name: "Dani", timestamp: 123 }],
      },
    ]);
  });

  it("returns the same synced reaction information after a later refresh", () => {
    const initial = dashboardReactionsFromWhatsApp(rawReactions);
    const refreshed = dashboardReactionsFromWhatsApp(structuredClone(rawReactions));
    expect(refreshed).toEqual(initial);

    const message = {
      id: "message-1",
      body: "A group photo",
      fullBody: "A group photo",
      fromMe: false,
      timestamp: 1,
      type: "image",
      hasMedia: true,
      reactions: refreshed,
      localReaction: "❤️",
    } satisfies ChatMessage;
    expect(mergedMessageReactions(message)).toEqual(initial);
  });
});

describe("WhatsApp call events in the dashboard timeline", () => {
  it("shows supplied voice and video details without guessing missing metadata", () => {
    const incomingMissedVideo = dashboardCallFromWhatsApp({
      type: "call_log",
      isVideoCall: true,
      isMissed: true,
      callDuration: 54,
    }, false);
    expect(incomingMissedVideo).toEqual({
      direction: "incoming",
      kind: "video",
      missed: true,
      durationSeconds: 54,
    });
    expect(callEventPresentation(incomingMissedVideo!)).toEqual({
      title: "Missed video call",
      detail: "Incoming · 54 sec",
    });

    const outgoingVoice = dashboardCallFromWhatsApp({ type: "call", isVoiceCall: true }, true);
    expect(outgoingVoice).toEqual({ direction: "outgoing", kind: "voice" });
    expect(callEventPresentation(outgoingVoice!)).toEqual({
      title: "Voice call",
      detail: "Outgoing",
    });
  });

  it("keeps a call event visible when WhatsApp did not expose its kind or duration", () => {
    const sparseCall = dashboardCallFromWhatsApp({ type: "call_log" }, false);
    expect(sparseCall).toEqual({ direction: "incoming" });
    expect(callEventPresentation(sparseCall!)).toEqual({
      title: "Call",
      detail: "Incoming",
    });
  });
});
