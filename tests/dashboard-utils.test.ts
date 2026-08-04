import { describe, expect, it } from "vitest";
import { resolveQuotedMessageReferences, sanitizeTerminalLog } from "../src/dashboard.js";

describe("dashboard terminal output", () => {
  it("removes terminal control codes and redacts credentials", () => {
    const output = sanitizeTerminalLog(
      "\u001b[32mready\u001b[0m sk-exampleSecret12345 authorization: Bearer private-token",
    );

    expect(output).toBe(
      "ready [redacted OpenAI key] authorization: Bearer [redacted]",
    );
  });
});

describe("dashboard quoted-message identity", () => {
  it("recovers a self-authored quote when WhatsApp omitted its quoted ID", () => {
    const messages = resolveQuotedMessageReferences([
      {
        id: "true_contact@lid_original",
        body: "We can call, eat and watch a movie",
        fromMe: true,
        timestamp: 100,
        type: "chat",
        hasMedia: false,
      },
      {
        id: "true_contact@lid_reply",
        body: "I invited you for dinner",
        fromMe: true,
        timestamp: 200,
        type: "chat",
        hasMedia: false,
        quotedMessage: {
          id: "quoted-200",
          body: "We can call, eat and watch a movie",
          fromMe: false,
        },
      },
    ]);

    expect(messages[1]?.quotedMessage).toMatchObject({
      id: "true_contact@lid_original",
      fromMe: true,
      body: "We can call, eat and watch a movie",
    });
  });

  it("keeps a real contact-authored quote attributed to the contact", () => {
    const messages = resolveQuotedMessageReferences([
      {
        id: "false_contact@lid_original",
        body: "Come for dinner",
        fromMe: false,
        timestamp: 100,
        type: "chat",
        hasMedia: false,
      },
      {
        id: "true_contact@lid_reply",
        body: "Sounds good",
        fromMe: true,
        timestamp: 200,
        type: "chat",
        hasMedia: false,
        quotedMessage: {
          id: "quoted-200",
          body: "Come for dinner",
          fromMe: false,
        },
      },
    ]);

    expect(messages[1]?.quotedMessage).toMatchObject({
      id: "false_contact@lid_original",
      fromMe: false,
    });
  });
});
