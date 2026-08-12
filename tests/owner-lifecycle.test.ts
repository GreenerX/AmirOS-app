import { describe, expect, it } from "vitest";
import {
  continueOwnerLifecycleSelection,
  parseOwnerLifecycleRequest,
  resolveLifecycleTimestamp,
  resolveOwnerLifecycleTarget,
  type OwnerLifecycleCandidate,
  type OwnerRecordReference,
} from "../src/owner-lifecycle.js";

const now = new Date(2026, 7, 11, 9, 0).getTime();

describe("owner lifecycle parsing", () => {
  it("recognizes completion, cancellation, edits, and temporal changes", () => {
    expect(parseOwnerLifecycleRequest("I finished buying batteries.", now)).toMatchObject({ operation: "complete", targetQuery: "buying batteries" });
    expect(parseOwnerLifecycleRequest("Cancel tomorrow's dentist appointment.", now)).toMatchObject({ operation: "cancel", targetQuery: "dentist appointment", targetKind: "calendar" });
    expect(parseOwnerLifecycleRequest("Move dinner to tomorrow.", now)).toMatchObject({ operation: "reschedule", targetQuery: "dinner", temporal: { hasDate: true, hasTime: false } });
    expect(parseOwnerLifecycleRequest("Make it 3 PM instead.", now)).toMatchObject({ operation: "reschedule", temporal: { hasDate: false, hasTime: true } });
    expect(parseOwnerLifecycleRequest("Push it back one week.", now)).toMatchObject({ operation: "reschedule", relativeShiftMs: 7 * 86_400_000 });
    expect(parseOwnerLifecycleRequest("Rename Buy batteries to Buy AA batteries.", now)).toMatchObject({ operation: "rename", targetQuery: "Buy batteries", newTitle: "Buy AA batteries" });
    expect(parseOwnerLifecycleRequest("Make it high priority.", now)).toMatchObject({ operation: "priority", targetKind: "todo", priority: "high" });
    expect(parseOwnerLifecycleRequest("Add a note that Dani is joining.", now)).toMatchObject({ operation: "note", note: "Dani is joining" });
    expect(parseOwnerLifecycleRequest("Never mind, cancel it.", now)).toMatchObject({ operation: "cancel", targetQuery: undefined });
    expect(parseOwnerLifecycleRequest("Actually make it 20:30", now)).toMatchObject({ operation: "reschedule", temporal: { hasDate: false, hasTime: true } });
  });

  it("preserves the existing date or clock when only one part changes", () => {
    const current = new Date(2026, 7, 14, 19, 30).getTime();
    const timeOnly = parseOwnerLifecycleRequest("Make it 3 PM instead", now)!;
    const movedTime = new Date(resolveLifecycleTimestamp(current, timeOnly)!);
    expect([movedTime.getFullYear(), movedTime.getMonth(), movedTime.getDate(), movedTime.getHours(), movedTime.getMinutes()]).toEqual([2026, 7, 14, 15, 0]);

    const dayOnly = parseOwnerLifecycleRequest("Move dinner to tomorrow", now)!;
    const movedDay = new Date(resolveLifecycleTimestamp(current, dayOnly)!);
    expect([movedDay.getFullYear(), movedDay.getMonth(), movedDay.getDate(), movedDay.getHours(), movedDay.getMinutes()]).toEqual([2026, 7, 12, 19, 30]);
  });
});

describe("owner lifecycle target resolution", () => {
  const candidates: OwnerLifecycleCandidate[] = [
    { kind: "todo", chatId: "owner", id: "batteries", title: "Buy batteries 🔋", status: "open", updatedAt: 3 },
    { kind: "todo", chatId: "owner", id: "groceries", title: "Grocery shopping 🛒", status: "open", updatedAt: 2 },
    { kind: "calendar", chatId: "owner", id: "dentist", title: "Dentist appointment", status: "confirmed", timestamp: new Date(2026, 7, 12, 9).getTime(), updatedAt: 1 },
  ];

  it("matches lexical variants but asks when a reference is ambiguous", () => {
    expect(resolveOwnerLifecycleTarget(parseOwnerLifecycleRequest("I finished buying batteries", now)!, candidates)).toMatchObject({ status: "matched", candidate: { id: "batteries" } });
    const ambiguous = resolveOwnerLifecycleTarget({ operation: "complete", source: "I finished it" }, candidates);
    expect(ambiguous).toMatchObject({ status: "ambiguous" });
    if (ambiguous.status !== "ambiguous") throw new Error("Expected ambiguity");
    expect(continueOwnerLifecycleSelection({ request: { operation: "complete", source: "I finished it" }, candidates: ambiguous.candidates, createdAt: now }, "2")).toEqual(ambiguous.candidates[1]);
  });

  it("uses a target date to distinguish matching calendar records", () => {
    const request = parseOwnerLifecycleRequest("Cancel tomorrow's dentist appointment", now)!;
    const result = resolveOwnerLifecycleTarget(request, [
      candidates[2]!,
      { ...candidates[2]!, id: "later-dentist", timestamp: new Date(2026, 7, 19, 9).getTime() },
    ]);
    expect(result).toMatchObject({ status: "matched", candidate: { id: "dentist" } });
  });

  it("prefers current-conversation references for pronouns but keeps ambiguity safe", () => {
    const references: OwnerRecordReference[] = [
      { kind: "todo", chatId: "owner", id: "batteries", title: "Buy batteries", referencedAt: now - 2_000 },
    ];
    expect(resolveOwnerLifecycleTarget(
      { operation: "cancel", source: "Cancel it" },
      candidates,
      { recentReferences: references, now },
    )).toMatchObject({ status: "matched", candidate: { id: "batteries" } });

    const ambiguous = resolveOwnerLifecycleTarget(
      { operation: "complete", source: "I finished it" },
      candidates,
      { recentReferences: [
        ...references,
        { kind: "todo", chatId: "owner", id: "groceries", title: "Grocery shopping", referencedAt: now - 1_000 },
      ], now },
    );
    expect(ambiguous).toMatchObject({ status: "ambiguous" });
  });

  it("keeps strong explicit lookup authoritative over an unrelated recent record", () => {
    const request = parseOwnerLifecycleRequest("Cancel buy batteries", now)!;
    expect(resolveOwnerLifecycleTarget(request, candidates, {
      recentReferences: [{ kind: "calendar", chatId: "owner", id: "dentist", title: "Dentist appointment", referencedAt: now }],
      now,
    })).toMatchObject({ status: "matched", candidate: { id: "batteries" } });
  });
});
