import { describe, expect, it } from "vitest";
import { classifyTemporalRequest } from "../src/temporal-classifier.js";

const now = new Date(2026, 7, 10, 9, 0).getTime(); // Monday, August 10, 2026.

describe("shared temporal classifier", () => {
  it("classifies reminder actions as to-dos with a due date", () => {
    const result = classifyTemporalRequest("Remind me to buy batteries tomorrow", now);
    expect(result).toMatchObject({ primaryType: "todo", reason: "reminder_action", confidence: .99 });
    expect(new Date(result!.temporal!.dueAt!).getDate()).toBe(11);
    expect(result!.temporal!.startAt).toBeUndefined();
    expect(classifyTemporalRequest("Remind me to meditate tomorrow", now)).toMatchObject({ primaryType: "todo", reason: "reminder_action" });
  });

  it("classifies a scheduled action with an exact time as a calendar event", () => {
    const result = classifyTemporalRequest("Water the plants Wednesday at noon", now);
    expect(result).toMatchObject({ primaryType: "calendar_event", reason: "scheduled_action" });
    const start = new Date(result!.temporal!.startAt!);
    expect(start.getDay()).toBe(3);
    expect(start.getHours()).toBe(12);
    expect(result!.temporal!.precision).toBe("time");
    expect(classifyTemporalRequest("Add bedtime at 23:30", now)).toMatchObject({
      primaryType: "calendar_event",
      reason: "scheduled_action",
    });
  });

  it("classifies date-only owner actions as to-dos", () => {
    const result = classifyTemporalRequest("Take out the trash tomorrow", now);
    expect(result).toMatchObject({ primaryType: "todo", reason: "task_deadline" });
    expect(new Date(result!.temporal!.dueAt!).getDate()).toBe(11);
    expect(classifyTemporalRequest("Vacuum the apartment tomorrow", now)).toMatchObject({
      primaryType: "todo",
      reason: "task_deadline",
    });
    expect(classifyTemporalRequest("Charge the phone tomorrow", now)).toMatchObject({
      primaryType: "todo",
      reason: "task_deadline",
    });
  });

  it("classifies interpersonal promises and requests as commitments", () => {
    expect(classifyTemporalRequest("I promised Dani I would send the photos tomorrow", now)).toMatchObject({
      primaryType: "commitment",
      reason: "interpersonal_commitment",
    });
    expect(classifyTemporalRequest("Could you call Dani tomorrow?", now)).toMatchObject({
      primaryType: "commitment",
      reason: "interpersonal_commitment",
    });
  });

  it("lets explicit collection language override inferred semantics", () => {
    expect(classifyTemporalRequest("Add dinner tomorrow to my to-do list", now)).toMatchObject({
      primaryType: "todo",
      reason: "explicit_todo",
      confidence: 1,
    });
    expect(classifyTemporalRequest("Add take out the trash tomorrow to my calendar", now)).toMatchObject({
      primaryType: "calendar_event",
      reason: "explicit_calendar",
      confidence: 1,
    });
    expect(classifyTemporalRequest("Add a commitment to send Dani the photos tomorrow", now)).toMatchObject({
      primaryType: "commitment",
      reason: "explicit_commitment",
      confidence: 1,
    });
  });

  it("classifies personal appointments that reserve time as calendar events", () => {
    expect(classifyTemporalRequest("Therapy with Dani Wednesday at 3pm", now)).toMatchObject({
      primaryType: "calendar_event",
      reason: "scheduled_appointment",
    });
    const morning = classifyTemporalRequest("Dentist appointment Friday at 9", now)!;
    const afternoon = classifyTemporalRequest("Doctor appointment Friday at 2pm", now)!;
    const evening = classifyTemporalRequest("Dinner Friday at 19:30", now)!;
    expect(morning.temporal?.precision).toBe("time");
    expect(new Date(morning.temporal!.startAt!).getHours()).toBe(9);
    expect(new Date(afternoon.temporal!.startAt!).getHours()).toBe(14);
    expect(new Date(evening.temporal!.startAt!).getHours()).toBe(19);
    expect(new Date(evening.temporal!.startAt!).getMinutes()).toBe(30);
  });

  it("returns no unsafe classification for unknown wording", () => {
    expect(classifyTemporalRequest("Tomorrow could be interesting", now)).toBeUndefined();
    expect(classifyTemporalRequest("Maybe sometime next week", now)).toBeUndefined();
    expect(classifyTemporalRequest("What's on my calendar tomorrow?", now)).toBeUndefined();
  });
});
