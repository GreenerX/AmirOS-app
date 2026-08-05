import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AmirosState } from "../src/amiros-state.js";
import {
  rememberDashboardMessages,
  replaceMentionIdsWithNames,
  resolveQuotedMessageReferences,
  sanitizeTerminalLog,
  visibleTodoTasks,
} from "../src/dashboard.js";

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

describe("dashboard to-do visibility", () => {
  it("keeps completed to-dos in the response and places them below active work", () => {
    const todos = visibleTodoTasks([
      { id: "done", status: "done" as const, createdAt: 10, updatedAt: 30, completedAt: 30 },
      { id: "dismissed", status: "dismissed" as const, createdAt: 10, updatedAt: 40 },
      { id: "open", status: "open" as const, createdAt: 20, updatedAt: 20 },
      { id: "inferred", status: "inferred" as const, createdAt: 15, updatedAt: 15 },
    ]);

    expect(todos.map((todo) => todo.id)).toEqual(["inferred", "open", "done"]);
    expect(todos.find((todo) => todo.id === "done")).toMatchObject({
      status: "done",
      completedAt: 30,
    });
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

describe("dashboard WhatsApp mentions", () => {
  it("replaces a tagged WhatsApp ID with the saved contact name", () => {
    expect(replaceMentionIdsWithNames(
      "@159048016027 left my black bottle by the coffee machine.",
      [{ id: "159048016027@lid", name: "Shelly Varod" }],
    )).toBe("@Shelly Varod left my black bottle by the coffee machine.");
  });

  it("keeps an unresolved mention intact", () => {
    expect(replaceMentionIdsWithNames("Can @159048016027 help?", [])).toBe("Can @159048016027 help?");
  });
});

describe("dashboard stored assistant messages", () => {
  it("does not re-import a known AmirOS reply as an owner message after a restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-dashboard-memory-"));
    try {
      const state = new AmirosState(join(directory, "state.json"));
      const chatId = "self@c.us";
      state.updateContact(chatId, { knowledgeTracking: "enabled" });
      state.rememberMessage(chatId, {
        role: "assistant",
        author: "assistant",
        content: "Please call the dentist tomorrow.",
        messageId: "bot-record",
        countAsIncoming: false,
      });

      const added = rememberDashboardMessages(state, chatId, [{
        id: "whatsapp-replayed-output",
        body: "Please call the dentist tomorrow.",
        fromMe: true,
        timestamp: Date.now(),
        type: "chat",
        hasMedia: false,
      }]);

      expect(added).toBe(0);
      expect(state.getConversationMemory(chatId)).toEqual([
        expect.objectContaining({ author: "assistant", content: "Please call the dentist tomorrow." }),
      ]);
      expect(state.getUnanalyzedKnowledgeMessages(chatId)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
