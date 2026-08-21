import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AmirosState } from "../src/amiros-state.js";
import {
  normalizeTranslationLanguage,
  validateTranslationPreview,
  validateTranslationRequest,
} from "../src/translation.js";

const directories: string[] = [];

function createState() {
  const directory = mkdtempSync(join(tmpdir(), "amiros-translation-scheduling-"));
  directories.push(directory);
  const filePath = join(directory, "state.json");
  return { state: new AmirosState(filePath), filePath };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("composer translation safety", () => {
  it("accepts a canonical BCP-47 destination and preserves protected tokens", () => {
    expect(normalizeTranslationLanguage("he-il")).toBe("he-IL");
    const request = validateTranslationRequest({
      body: "Please call +1 (212) 555-0199 on 2026-08-21: https://example.com/a @Maya",
      targetLanguage: "es",
    });
    expect(request.targetLanguage).toBe("es");
    expect(validateTranslationPreview(request.body, "Por favor llama al +1 (212) 555-0199 el 2026-08-21: https://example.com/a @Maya")).toContain("@Maya");
  });

  it("rejects a preview that loses a URL or date instead of letting it be sent", () => {
    expect(() => validateTranslationPreview(
      "Meet on 2026-08-21 at https://example.com/meeting",
      "Nos vemos pronto.",
    )).toThrow(/preserve/i);
  });
});

describe("scheduled messages", () => {
  it("persists an explicit owner snapshot and fails closed after an interrupted delivery", () => {
    const { state, filePath } = createState();
    const chatId = "maya@c.us";
    const scheduled = state.scheduleMessage({
      chatId,
      body: "The reviewed message snapshot",
      scheduledAt: Date.now() + 60_000,
      timezone: "Asia/Jerusalem",
    });
    state.updateContact(chatId, {
      language: "Hebrew",
      composerTranslationPreference: {
        targetLanguage: "es",
        direction: "outgoing_to_target",
        source: "user_confirmed",
        confirmedAt: Date.now(),
      },
    });

    expect(state.getContact(chatId)).toMatchObject({
      language: "Hebrew",
      composerTranslationPreference: { targetLanguage: "es", source: "user_confirmed" },
    });
    expect(state.listScheduledMessages(chatId)).toEqual([expect.objectContaining({ id: scheduled.id, body: "The reviewed message snapshot", status: "pending" })]);

    state.updateScheduledMessage(scheduled.id, { body: "The revised reviewed message snapshot", scheduledAt: Date.now() - 1 });
    expect(state.claimDueScheduledMessages()).toEqual([expect.objectContaining({
      id: scheduled.id,
      body: "The revised reviewed message snapshot",
      status: "sending",
      attemptCount: 1,
    })]);

    const reloaded = new AmirosState(filePath);
    expect(reloaded.listScheduledMessages(chatId)).toEqual([expect.objectContaining({
      id: scheduled.id,
      status: "failed",
      error: expect.stringMatching(/restarted/i),
    })]);
  });

  it("allows a pending message to be cancelled without changing its text snapshot", () => {
    const { state } = createState();
    const scheduled = state.scheduleMessage({
      chatId: "maya@c.us",
      body: "Keep this exact text",
      scheduledAt: Date.now() + 60_000,
      timezone: "UTC",
    });
    expect(state.cancelScheduledMessage(scheduled.id)).toMatchObject({ status: "cancelled", body: "Keep this exact text" });
  });
});
