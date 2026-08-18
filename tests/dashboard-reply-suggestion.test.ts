import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { replySendFailureMessage, sendReplyResiliently } from "../src/dashboard.js";

describe("dashboard reply suggestions", () => {
  it("allows an explicit owner-requested draft for an Off-mode chat", async () => {
    const dashboard = await readFile(new URL("../src/dashboard.ts", import.meta.url), "utf8");
    const route = dashboard.slice(
      dashboard.indexOf('if (request.method === "POST" && replySuggestionMatch'),
      dashboard.indexOf('if (request.method === "POST" && messageActionMatch'),
    );

    expect(route).not.toContain('contact.mode === "off"');
    expect(route).not.toContain("Enable this chat before asking AmirOS to draft a reply");
    expect(route).toContain("Keep the reply editable and do not send it yourself.");
  });

  it("stores optional reply feedback locally and uses it only to guide a future draft in the same chat", async () => {
    const [dashboard, overview] = await Promise.all([
      readFile(new URL("../src/dashboard.ts", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/components/Overview.tsx", import.meta.url), "utf8"),
    ]);
    const feedbackRoute = dashboard.slice(
      dashboard.indexOf("const replySuggestionFeedbackMatch"),
      dashboard.indexOf('if (request.method === "POST" && messageActionMatch'),
    );
    const improveReply = overview.slice(
      overview.indexOf("const improveReplyFromFeedback"),
      overview.indexOf("const openFocus"),
    );
    expect(dashboard).toContain("replySuggestionFeedbackMatch");
    expect(dashboard).toContain("recordReplySuggestionFeedback");
    expect(dashboard).toContain("getReplySuggestionGuidance(chatId)");
    expect(feedbackRoute).not.toContain("getConversationMemory");
    expect(feedbackRoute).not.toContain("knownMessage");
    expect(overview).toContain("Improve reply");
    expect(overview).toContain("Clear draft");
    expect(overview).toContain("This sounds like me");
    expect(overview).toContain("Doesn’t sound like me");
    expect(improveReply.indexOf("onReplySuggestionFeedback(replyEditor.chatId")).toBeLessThan(improveReply.indexOf("suggestReplyForMessage(replyEditor.chatId"));
  });

  it("uses one WhatsApp-page send and falls back to a normal message when the source cannot be quoted", async () => {
    const evaluate = vi.fn().mockResolvedValue({
      status: "sent",
      id: "sent-message",
      timestamp: 123,
      type: "chat",
      sentAsNewMessage: true,
    });
    const getChatById = vi.fn(() => {
      throw new Error("r");
    });
    const client = {
      pupPage: { evaluate },
      getChatById,
      getMessageById: vi.fn(),
      sendMessage: vi.fn(),
    } as unknown as Parameters<typeof sendReplyResiliently>[0];

    await expect(sendReplyResiliently(client, "person@c.us", "missing-source", "Hello")).resolves.toEqual({
      id: "sent-message",
      timestamp: 123,
      type: "chat",
      sentAsNewMessage: true,
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(getChatById).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it("sends directly without a fragile chat lookup when no WhatsApp page is exposed", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      id: { _serialized: "direct-message" },
      timestamp: 456,
      type: "chat",
    });
    const client = {
      pupPage: null,
      getMessageById: vi.fn().mockResolvedValue(undefined),
      getChatById: vi.fn(() => {
        throw new Error("r");
      }),
      sendMessage,
    } as unknown as Parameters<typeof sendReplyResiliently>[0];

    await expect(sendReplyResiliently(client, "person@c.us", "missing-source", "Hello")).resolves.toMatchObject({
      id: "direct-message",
      sentAsNewMessage: true,
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(client.getChatById).not.toHaveBeenCalled();
  });

  it("does not attempt a second send after a quoted send reports an error", async () => {
    const sendMessage = vi.fn();
    const target = {
      getChat: vi.fn().mockResolvedValue({ id: { _serialized: "person@c.us" } }),
      reply: vi.fn().mockRejectedValue(new Error("delivery acknowledgement failed")),
    };
    const client = {
      pupPage: null,
      getMessageById: vi.fn().mockResolvedValue(target),
      sendMessage,
    } as unknown as Parameters<typeof sendReplyResiliently>[0];

    await expect(sendReplyResiliently(client, "person@c.us", "source", "Hello")).rejects.toThrow(
      "delivery acknowledgement failed",
    );
    expect(target.reply).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("turns opaque WhatsApp failures into a useful retry message", () => {
    expect(replySendFailureMessage(new Error("r"))).toBe(
      "WhatsApp could not send this reply right now. Make sure WhatsApp is connected, then try again.",
    );
  });
});
