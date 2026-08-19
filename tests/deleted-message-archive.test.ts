import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "whatsapp-web.js";
import { AmirosState } from "../src/amiros-state.js";
import { DeletedMessageArchive } from "../src/deleted-message-archive.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "amiros-deleted-message-archive-"));
  directories.push(directory);
  const state = new AmirosState(join(directory, "state.json"));
  return { directory, state, archive: new DeletedMessageArchive(state, join(directory, "archive")) };
}

function deletedMessage(overrides: Record<string, unknown> = {}): Message {
  return {
    id: { _serialized: "deleted-1" },
    from: "dani@c.us",
    to: "owner@c.us",
    fromMe: false,
    timestamp: 1_700_000_000,
    type: "chat",
    body: "Please keep this private.",
    hasMedia: false,
    ...overrides,
  } as unknown as Message;
}

describe("deleted-message archive", () => {
  it("is off by default and only records a deleted message after the owner opts in", async () => {
    const { state, archive } = setup();
    await archive.capture(deletedMessage());
    expect(state.listDeletedMessageArchive("dani@c.us")).toEqual([]);

    state.updateDeletedMessageArchiveSettings({ enabled: true });
    await archive.capture(deletedMessage());
    const saved = state.listDeletedMessageArchive("dani@c.us");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ messageId: "deleted-1", body: "Please keep this private.", media: undefined });

    await archive.capture(deletedMessage());
    expect(state.listDeletedMessageArchive("dani@c.us")).toHaveLength(1);
  });

  it("keeps the opt-in preference after AmirOS restarts", () => {
    const { directory, state } = setup();
    state.updateDeletedMessageArchiveSettings({ enabled: true, saveMedia: true });

    const reloaded = new AmirosState(join(directory, "state.json"));
    expect(reloaded.getDeletedMessageArchiveSettings()).toEqual({ enabled: true, saveMedia: true });
  });

  it("returns the same flat archive preferences to the dashboard and disables media with the archive", () => {
    const { state } = setup();
    state.updateDeletedMessageArchiveSettings({ enabled: true, saveMedia: true });

    expect(state.getDashboardSettings().deletedMessageArchive).toEqual({ enabled: true, saveMedia: true });

    state.updateDeletedMessageArchiveSettings({ enabled: false });
    expect(state.getDashboardSettings().deletedMessageArchive).toEqual({ enabled: false, saveMedia: false });
  });

  it("keeps opted-in media in a local archive and clears it on request", async () => {
    const { directory, state, archive } = setup();
    state.updateDeletedMessageArchiveSettings({ enabled: true, saveMedia: true });
    const media = Buffer.from("private voice note").toString("base64");
    await archive.capture(deletedMessage({
      id: { _serialized: "deleted-media" },
      type: "ptt",
      hasMedia: true,
      body: "",
      downloadMedia: async () => ({ data: media, mimetype: "audio/ogg", filename: "voice.ogg" }),
    }));

    const saved = state.listDeletedMessageArchive("dani@c.us");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.media).toMatchObject({ status: "saved", mimetype: "audio/ogg", filename: "voice.ogg" });
    expect(saved[0]?.media?.path).toBeTruthy();
    expect(existsSync(saved[0]!.media!.path!)).toBe(true);
    expect(readFileSync(saved[0]!.media!.path!, "utf8")).toBe("private voice note");

    expect(archive.clear()).toBe(1);
    expect(state.listDeletedMessageArchive("dani@c.us")).toEqual([]);
    expect(existsSync(join(directory, "archive"))).toBe(false);
  });

  it("tries to save opted-in one-time media as soon as it arrives", async () => {
    const { state, archive } = setup();
    state.updateDeletedMessageArchiveSettings({ enabled: true, saveMedia: true });
    const media = Buffer.from("one-time photo").toString("base64");
    await archive.captureViewOnce(deletedMessage({
      id: { _serialized: "view-once-1" },
      type: "image",
      hasMedia: true,
      isViewOnce: true,
      downloadMedia: async () => ({ data: media, mimetype: "image/jpeg", filename: "photo.jpg" }),
    }));

    const [saved] = state.listDeletedMessageArchive("dani@c.us");
    expect(saved).toMatchObject({ kind: "view_once", viewOnce: true, media: { status: "saved" } });
    expect(saved?.media?.path && existsSync(saved.media.path)).toBe(true);
  });

  it("keeps archived deletion placeholders out of the normal memory ingestion path", () => {
    const dashboard = readFileSync(resolve(process.cwd(), "src/dashboard.ts"), "utf8");

    expect(dashboard).toContain("if (message.deletedArchive || message.deleted) return [];");
  });

  it("keeps archived deletion rendering separate from ordinary media and saves the preference immediately", () => {
    const settings = readFileSync(resolve(process.cwd(), "ui/src/components/SecondaryViews.tsx"), "utf8");
    const inbox = readFileSync(resolve(process.cwd(), "ui/src/components/InboxView.tsx"), "utf8");
    const app = readFileSync(resolve(process.cwd(), "ui/src/App.tsx"), "utf8");
    const dashboard = readFileSync(resolve(process.cwd(), "src/dashboard.ts"), "utf8");

    expect(settings).toContain("const saveDeletedMessageArchive");
    expect(settings).toContain('pendingDeletedMessageArchiveRef.current = next');
    expect(settings).toContain("The saved archive preference was not confirmed");
    expect(settings).toContain("Saved on this Mac");
    expect(settings).toContain("Saved immediately.");
    expect(inbox).toContain("Reveal saved content");
    expect(inbox).toContain("This message was deleted in WhatsApp. It was not saved on this Mac.");
    expect(inbox).toContain("const deletedMessage = deletedArchive || message.deleted");
    expect(inbox).toContain("deleted-message-revealed-content");
    expect(inbox).toContain("message.hasMedia && !message.call && !deletedMessage");
    expect(dashboard).toContain('messageWithCaption._data?.type === "revoked"');
    expect(dashboard).toContain('normalized._data?.type || message.type || message._data?.type');
    expect(app).toContain("revealedText: saved.body");
    expect(app).toContain("revealedMediaUrl: saved.mediaUrl");
  });
});
