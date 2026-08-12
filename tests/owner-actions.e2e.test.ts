import { describe, expect, it } from "vitest";
import { withOwnerActionHarness } from "./support/owner-action-harness.js";

describe("owner action end-to-end QA", () => {
  it("routes owner messages through classification, persistence, confirmation, and dashboard projections", async () => {
    await withOwnerActionHarness("direct owner collections", {
      now: new Date(2026, 7, 11, 9, 0).getTime(),
    }, async (qa) => {
      await qa.send("Add buy milk to my todo list");
      await qa.send("Dentist appointment Friday at 9");
      await qa.send("I promised Dani I would send the photos tomorrow.");

      const snapshot = qa.snapshot();
      expect(snapshot.todos).toEqual([
        expect.objectContaining({ title: "buy milk 🥛", status: "open", evidence: expect.objectContaining({ source: "whatsapp_bot" }) }),
      ]);
      expect(snapshot.events).toEqual([
        expect.objectContaining({ title: "Dentist appointment", status: "confirmed", evidence: expect.objectContaining({ source: "whatsapp_bot" }) }),
      ]);
      expect(new Date(snapshot.events[0]!.startAt).getHours()).toBe(9);
      expect(snapshot.commitments).toEqual([
        expect.objectContaining({ content: "I promised Dani I would send the photos", owner: "me", status: "open" }),
      ]);
      expect(qa.replies).toEqual([
        expect.stringContaining("Added to *AmirOS To-dos*"),
        expect.stringContaining("Added to *AmirOS Calendar*"),
        expect.stringContaining("Added to *AmirOS Commitments*"),
      ]);
      expect(snapshot.dashboard.todos).toHaveLength(1);
      expect(snapshot.dashboard.events).toHaveLength(1);
    });
  });

  it("continues a clarification after restart and persists exactly one dated to-do", async () => {
    await withOwnerActionHarness("clarification with restart", {
      now: new Date(2026, 7, 11, 9, 0).getTime(),
    }, async (qa) => {
      await qa.send("Take out the trash tomorrow");
      expect(qa.replies.at(-1)).toContain("What time should I set");
      expect(qa.snapshot().todos).toEqual([]);
      expect(qa.snapshot().pending).toMatchObject({ title: "Take out the trash" });

      qa.restart();
      await qa.send("13:00", { advanceMs: 60_000 });

      let snapshot = qa.snapshot();
      expect(snapshot.todos).toHaveLength(1);
      expect(snapshot.todos[0]).toMatchObject({ title: "Take out the trash 🗑️", status: "open" });
      expect(new Date(snapshot.todos[0]!.dueAt!).getDate()).toBe(12);
      expect(new Date(snapshot.todos[0]!.dueAt!).getHours()).toBe(13);
      expect(snapshot.pending).toBeUndefined();
      expect(qa.replies.at(-1)).toContain("Added to *AmirOS To-dos*");

      qa.restart();
      snapshot = qa.snapshot();
      expect(snapshot.todos).toHaveLength(1);
      expect(snapshot.dashboard.todos).toHaveLength(1);
    });
  });

  it("deduplicates repeated submissions and reopens completed owner work", async () => {
    await withOwnerActionHarness("duplicates and completion", {
      now: new Date(2026, 7, 11, 9, 0).getTime(),
    }, async (qa) => {
      await qa.send("Add buy batteries tomorrow at 6pm to my to-do list");
      await qa.send("Add buy batteries tomorrow at 6pm to my to-do list");
      expect(qa.snapshot().todos).toHaveLength(1);
      expect(qa.replies.at(-1)).toContain("Already in *AmirOS To-dos*");

      const task = qa.snapshot().todos[0]!;
      qa.state.completeTodoTask("owner@c.us", task.id);
      expect(qa.snapshot().todos[0]?.status).toBe("done");

      await qa.send("Add buy batteries tomorrow at 6pm to my to-do list");
      expect(qa.snapshot().todos).toEqual([
        expect.objectContaining({ id: task.id, status: "open", completedAt: undefined }),
      ]);
      expect(qa.replies.at(-1)).toContain("Moved from completed to open");
    });
  });

  it("keeps ambiguous text safe and does not fabricate a verified write", async () => {
    await withOwnerActionHarness("ambiguous owner message", {
      generalReply: async () => "No action taken.",
    }, async (qa) => {
      await qa.send("Tomorrow could be interesting.");

      expect(qa.snapshot()).toMatchObject({ todos: [], events: [], commitments: [] });
      expect(qa.replies).toEqual(["No action taken."]);
      expect(qa.aiCalls.generalReply).toBe(1);
    });
  });

  it("does not confirm a failed clarified write and keeps the action pending", async () => {
    await withOwnerActionHarness("verified-write failure", {}, async (qa) => {
      await qa.send("Vacuum the apartment tomorrow");
      qa.failNextTodoWrite();
      await qa.send("15:30", { advanceMs: 60_000 });

      const snapshot = qa.snapshot();
      expect(snapshot.todos).toEqual([]);
      expect(snapshot.pending).toMatchObject({ title: "Vacuum the apartment" });
      expect(qa.replies.at(-1)).not.toContain("Added to *AmirOS To-dos*");
      expect(qa.aiCalls.clearConversation).toBe(1);
    });
  });

  it("does not attach an unrelated response to pending clarification", async () => {
    await withOwnerActionHarness("unrelated clarification response", {
      generalReply: async () => "It looks sunny.",
    }, async (qa) => {
      await qa.send("Buy cat food tomorrow");
      await qa.send("How is the weather?");

      expect(qa.snapshot()).toMatchObject({ todos: [], events: [], commitments: [], pending: undefined });
      expect(qa.replies.at(-1)).toBe("It looks sunny.");
    });
  });
});
