import { describe, expect, it } from "vitest";
import { withOwnerActionHarness } from "./support/owner-action-harness.js";

const start = new Date(2026, 7, 11, 9, 0).getTime();

describe("owner lifecycle end-to-end QA", () => {
  it("cancels the to-do just created in this conversation instead of an unrelated global item", async () => {
    await withOwnerActionHarness("conversation-scoped cancellation", { now: start }, async (qa) => {
      await qa.send("Add buy a watch to my todo list");
      qa.advance(31 * 60_000);
      await qa.send("Call David tomorrow");
      await qa.send("15:00");
      qa.restart();
      await qa.send("Never mind, cancel it.");

      const watch = qa.snapshot().todos.find((item) => item.title.toLocaleLowerCase().includes("watch"));
      const call = qa.snapshot().todos.find((item) => item.title.toLocaleLowerCase().includes("call david"));
      expect(watch?.status).toBe("open");
      expect(call?.status).toBe("dismissed");
      expect(qa.replies.at(-1)).toContain("Cancelled in *AmirOS To-dos*");

      await qa.send("Cancel buy a watch");
      expect(qa.snapshot().todos.find((item) => item.id === watch?.id)?.status).toBe("dismissed");
    });
  });

  it("moves the current event to another day while preserving its explicit time", async () => {
    await withOwnerActionHarness("conversation-scoped day change", { now: start }, async (qa) => {
      await qa.send("Dinner Friday at 19:00");
      const original = qa.snapshot().events[0]!;
      await qa.send("Move it to Sunday.");

      const moved = qa.snapshot().events[0]!;
      expect(moved.id).toBe(original.id);
      expect([new Date(moved.startAt).getDay(), new Date(moved.startAt).getHours(), new Date(moved.startAt).getMinutes()]).toEqual([0, 19, 0]);
      expect(qa.snapshot().events).toHaveLength(1);
    });
  });

  it("changes only the time of the current event", async () => {
    await withOwnerActionHarness("conversation-scoped time change", { now: start }, async (qa) => {
      await qa.send("Late lunch with Andrew Monday at 6pm");
      const original = qa.snapshot().events[0]!;
      await qa.send("Actually make it 20:30");

      const changed = qa.snapshot().events[0]!;
      expect(changed.id).toBe(original.id);
      expect(new Date(changed.startAt).getDate()).toBe(new Date(original.startAt).getDate());
      expect([new Date(changed.startAt).getHours(), new Date(changed.startAt).getMinutes()]).toEqual([20, 30]);
    });
  });

  it("renames the clarified to-do created in the current conversation", async () => {
    await withOwnerActionHarness("conversation-scoped rename", { now: start }, async (qa) => {
      await qa.send("Buy cheese tomorrow");
      await qa.send("16:00");
      const original = qa.snapshot().todos[0]!;
      await qa.send("Rename it to Buy cheddar cheese");

      expect(qa.snapshot().todos).toHaveLength(1);
      expect(qa.snapshot().todos[0]).toMatchObject({ id: original.id, title: expect.stringContaining("Buy cheddar cheese") });
    });
  });

  it("completes and cancels to-dos and calendar events without creating duplicates", async () => {
    await withOwnerActionHarness("completion and cancellation", { now: start }, async (qa) => {
      await qa.send("Add buy batteries to my todo list");
      await qa.send("Dentist appointment Wednesday at 9");
      await qa.send("I finished buying batteries");
      await qa.send("Mark the dentist appointment as completed");

      expect(qa.snapshot().todos).toEqual([expect.objectContaining({ status: "done", completedAt: expect.any(Number) })]);
      expect(qa.snapshot().events).toEqual([expect.objectContaining({ status: "completed", completedAt: expect.any(Number) })]);
      expect(qa.replies.slice(-2)).toEqual([
        expect.stringContaining("Completed in *AmirOS To-dos*"),
        expect.stringContaining("Completed in *AmirOS Calendar*"),
      ]);

      await qa.send("Add buy milk to my todo list");
      await qa.send("Doctor appointment Thursday at 2pm");
      await qa.send("Never mind about buying milk");
      await qa.send("Cancel Thursday's doctor appointment");

      expect(qa.snapshot().todos.find((item) => item.title.includes("milk"))?.status).toBe("dismissed");
      expect(qa.state.getCalendarEvents("owner@c.us").find((item) => item.title.startsWith("Doctor"))?.status).toBe("dismissed");
      expect(qa.snapshot().todos).toHaveLength(2);
      expect(qa.state.getCalendarEvents("owner@c.us")).toHaveLength(2);
    });
  });

  it("reschedules event times and to-do due dates while preserving unspecified components", async () => {
    await withOwnerActionHarness("rescheduling", { now: start }, async (qa) => {
      await qa.send("Dinner Friday at 7pm");
      await qa.send("Add buy batteries tomorrow at 6pm to my to-do list");
      await qa.send("Move dinner to tomorrow");
      let event = qa.snapshot().events[0]!;
      expect([new Date(event.startAt).getDate(), new Date(event.startAt).getHours()]).toEqual([12, 19]);

      await qa.send("Change dinner to Friday at 3 PM");
      event = qa.snapshot().events[0]!;
      expect([new Date(event.startAt).getDay(), new Date(event.startAt).getHours()]).toEqual([5, 15]);

      await qa.send("Change the due date of buy batteries to Friday");
      let todo = qa.snapshot().todos[0]!;
      expect([new Date(todo.dueAt!).getDay(), new Date(todo.dueAt!).getHours()]).toEqual([5, 18]);

      await qa.send("Push buy batteries back one week");
      todo = qa.snapshot().todos[0]!;
      expect(new Date(todo.dueAt!).getDate()).toBe(21);
      expect(qa.snapshot().events).toHaveLength(1);
      expect(qa.snapshot().todos).toHaveLength(1);
    });
  });

  it("changes a lone record by conversational reference and manages commitments", async () => {
    await withOwnerActionHarness("contextual mutation and commitments", { now: start }, async (qa) => {
      await qa.send("Dinner Friday at 7pm");
      await qa.send("Make it 3 PM instead");
      expect(new Date(qa.snapshot().events[0]!.startAt).getHours()).toBe(15);

      await qa.send("Mark dinner as completed");
      await qa.send("I promised Dani I would send the photos tomorrow");
      await qa.send("I finished sending Dani the photos");
      expect(qa.snapshot().commitments).toEqual([expect.objectContaining({ status: "done" })]);

      await qa.send("I promised Dani I would call tomorrow");
      await qa.send("Never mind about call Dani");
      expect(qa.snapshot().commitments).toEqual(expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("call"), status: "dismissed" }),
      ]));
    });
  });

  it("renames, reprioritizes, and annotates existing records", async () => {
    await withOwnerActionHarness("editing", { now: start }, async (qa) => {
      await qa.send("Add buy batteries to my todo list");
      await qa.send("Rename buy batteries to Buy AA batteries");
      await qa.send("Make Buy AA batteries high priority");
      await qa.send("Add a note to Buy AA batteries that Get rechargeable ones");

      qa.restart();

      expect(qa.snapshot().todos).toEqual([
        expect.objectContaining({ title: "Buy AA batteries 🛒", priority: "high", note: "Get rechargeable ones" }),
      ]);
      expect(qa.replies.slice(-3)).toEqual([
        expect.stringContaining("Renamed in *AmirOS To-dos*"),
        expect.stringContaining("now high priority"),
        expect.stringContaining("Added a note in *AmirOS To-dos*"),
      ]);
    });
  });

  it("persists ambiguity across restart and mutates only the selected record", async () => {
    await withOwnerActionHarness("ambiguous lifecycle selection", { now: start }, async (qa) => {
      await qa.send("Add buy batteries to my todo list");
      await qa.send("Add buy cat food to my todo list");
      await qa.send("I finished it");

      expect(qa.replies.at(-1)).toContain("more than one possible match");
      expect(qa.snapshot().pendingLifecycle?.candidates).toHaveLength(2);
      qa.restart();
      await qa.send("2");

      const statuses = Object.fromEntries(qa.snapshot().todos.map((item) => [item.title, item.status]));
      expect(Object.values(statuses).filter((status) => status === "done")).toHaveLength(1);
      expect(Object.values(statuses).filter((status) => status === "open")).toHaveLength(1);
      expect(qa.snapshot().pendingLifecycle).toBeUndefined();
    });
  });

  it("does not guess an unmatched target or consume unrelated clarification text", async () => {
    await withOwnerActionHarness("safe lifecycle matching", { now: start, generalReply: async () => "Unrelated answer." }, async (qa) => {
      await qa.send("Add buy batteries to my todo list");
      await qa.send("Add buy cat food to my todo list");
      await qa.send("I finished something imaginary");
      expect(qa.replies.at(-1)).toContain("couldn’t find an active AmirOS item");

      await qa.send("I finished it");
      await qa.send("How is the weather?");
      expect(qa.snapshot().pendingLifecycle).toBeUndefined();
      expect(qa.snapshot().todos.every((item) => item.status === "open")).toBe(true);
      expect(qa.replies.at(-1)).toBe("Unrelated answer.");
    });
  });

  it("blocks a general AI reply from claiming an unverified lifecycle mutation", async () => {
    await withOwnerActionHarness("unverified lifecycle claim", {
      now: start,
      generalReply: async () => "I rescheduled your calendar event.",
    }, async (qa) => {
      qa.state.updateContact("owner@c.us", { knowledgeTracking: "disabled" });
      await qa.send("Could you shift the dentist thing?");
      expect(qa.snapshot()).toMatchObject({ todos: [], events: [], commitments: [] });
      expect(qa.replies.at(-1)).toContain("couldn’t confirm that AmirOS saved that change");
    });
  });

  it("never confirms a failed lifecycle write and retains a selected pending mutation", async () => {
    await withOwnerActionHarness("lifecycle persistence failure", { now: start }, async (qa) => {
      await qa.send("Add buy batteries to my todo list");
      await qa.send("Add buy cat food to my todo list");
      await qa.send("I finished it");
      qa.failNextTodoUpdate();
      await qa.send("1");

      expect(qa.snapshot().todos.every((item) => item.status === "open")).toBe(true);
      expect(qa.snapshot().pendingLifecycle).toBeDefined();
      expect(qa.replies.at(-1)).not.toContain("Completed in *AmirOS To-dos*");
      expect(qa.aiCalls.clearConversation).toBe(1);
    });
  });
});
