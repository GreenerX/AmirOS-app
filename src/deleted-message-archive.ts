import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { Message } from "whatsapp-web.js";
import { AmirosState, type DeletedMessageArchiveItem } from "./amiros-state.js";

type ArchivedMedia = NonNullable<DeletedMessageArchiveItem["media"]>;

function chatIdFor(message: Message): string | undefined {
  const raw = message as unknown as {
    from?: string;
    to?: string;
    fromMe?: boolean;
    id?: { remote?: string; _serialized?: string };
  };
  const candidate = raw.fromMe ? raw.to : raw.from;
  return typeof candidate === "string" && candidate ? candidate : raw.id?.remote;
}

function messageIdFor(message: Message): string | undefined {
  const raw = message as unknown as { id?: { _serialized?: string; id?: string } };
  return raw.id?._serialized || raw.id?.id;
}

function safeExtension(mimetype?: string, filename?: string): string {
  const fromFilename = filename ? extname(filename).replace(/[^a-z0-9.]/giu, "").slice(0, 12) : "";
  if (fromFilename) return fromFilename;
  if (mimetype === "image/jpeg") return ".jpg";
  if (mimetype === "image/png") return ".png";
  if (mimetype === "image/webp") return ".webp";
  if (mimetype?.startsWith("audio/")) return ".audio";
  if (mimetype?.startsWith("video/")) return ".video";
  return ".bin";
}

/**
 * Local-only, opt-in archive for WhatsApp's revoke-for-everyone event and
 * one-time media while WhatsApp still makes the content available.
 * It intentionally has no learner, intelligence, suggestion, or Control
 * Center dependency: saved items are visible only when the owner asks to see
 * them in the originating chat.
 */
export class DeletedMessageArchive {
  private readonly root: string;

  constructor(private readonly state: AmirosState, root = resolve("work/deleted-message-archive")) {
    this.root = root;
  }

  async capture(message: Message, original?: Message, kind: "deleted" | "view_once" = "deleted"): Promise<void> {
    const source = original || message;
    const chatId = chatIdFor(source);
    const messageId = messageIdFor(source);
    if (!chatId || !messageId || !this.state.shouldArchiveDeletedMessages(chatId)) return;

    const raw = source as unknown as {
      body?: string;
      caption?: string;
      fromMe?: boolean;
      timestamp?: number;
      type?: string;
      hasMedia?: boolean;
      isViewOnce?: boolean;
      _data?: { body?: string; caption?: string; isViewOnce?: boolean; isViewOnceV2?: boolean; type?: string };
    };
    const body = (raw.body || raw.caption || raw._data?.body || raw._data?.caption || "").trim();
    const timestamp = Number(raw.timestamp || Date.now());
    const mediaType = raw.type || raw._data?.type || "chat";
    const hasMedia = raw.hasMedia === true || ["image", "video", "audio", "ptt", "document", "sticker"].includes(mediaType);
    const wantsMedia = this.state.getDeletedMessageArchiveSettings().saveMedia;
    const item = this.state.addDeletedMessageArchiveItem({
      messageId,
      chatId,
      kind,
      fromMe: raw.fromMe === true,
      timestamp: timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp,
      body: body || undefined,
      type: mediaType,
      viewOnce: raw.isViewOnce === true || raw._data?.isViewOnce === true || raw._data?.isViewOnceV2 === true,
      media: hasMedia ? { status: wantsMedia ? "unavailable" : "not_saved" } : undefined,
    });
    if (!item || !hasMedia || !wantsMedia) return;

    try {
      const media = await source.downloadMedia();
      if (!media?.data) return;
      const bytes = Buffer.from(media.data, "base64");
      // Deleted-message media should stay bounded even when the owner opted in.
      if (!bytes.length || bytes.length > 30 * 1024 * 1024) return;
      const chatDirectory = resolve(this.root, item.chatId.replace(/[^a-z0-9@._-]/giu, "_").slice(0, 160));
      mkdirSync(chatDirectory, { recursive: true, mode: 0o700 });
      const filePath = resolve(chatDirectory, `${item.id}${safeExtension(media.mimetype ?? undefined, media.filename ?? undefined)}`);
      writeFileSync(filePath, bytes, { mode: 0o600 });
      this.state.updateDeletedMessageArchiveMedia(chatId, item.id, {
        status: "saved",
        path: filePath,
        mimetype: media.mimetype ?? undefined,
        filename: media.filename ?? undefined,
        bytes: bytes.length,
      });
    } catch {
      // WhatsApp may revoke view-once or remote media before it can be read.
      // The text/metadata record remains honest about that limitation.
    }
  }

  /**
   * One-time media may disappear without WhatsApp emitting a revoke event, so
   * capture it immediately. This remains best-effort: WhatsApp can deny the
   * download before the local client gets to it.
   */
  async captureViewOnce(message: Message): Promise<void> {
    const raw = message as unknown as { isViewOnce?: boolean; _data?: { isViewOnce?: boolean; isViewOnceV2?: boolean } };
    if (raw.isViewOnce !== true && raw._data?.isViewOnce !== true && raw._data?.isViewOnceV2 !== true) return;
    await this.capture(message, undefined, "view_once");
  }

  read(chatId: string, id: string): { body?: string; media?: ArchivedMedia; mediaBytes?: Buffer } | undefined {
    const item = this.state.getDeletedMessageArchiveItem(chatId, id);
    if (!item) return undefined;
    const media = item.media;
    if (!media || media.status !== "saved" || !media.path || !existsSync(media.path)) {
      return { body: item.body, media: media && media.status === "saved" ? { ...media, status: "unavailable", path: undefined } : media };
    }
    try {
      return { body: item.body, media, mediaBytes: readFileSync(media.path) };
    } catch {
      return { body: item.body, media: { ...media, status: "unavailable", path: undefined } };
    }
  }

  clear(): number {
    const removed = this.state.clearDeletedMessageArchive().length;
    rmSync(this.root, { recursive: true, force: true });
    return removed;
  }
}
