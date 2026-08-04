import { createCipheriv, createHmac, hkdfSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "whatsapp-web.js";
import {
  downloadAndDecryptWhatsAppMedia,
  downloadMessageMediaWithRetry,
} from "../src/processor.js";

describe("voice media download", () => {
  it("retries transient WhatsApp media failures", async () => {
    const media = {
      data: "dGVzdA==",
      mimetype: "audio/ogg; codecs=opus",
      filename: undefined,
      filesize: 4,
    };
    const downloadMedia = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary media-stage failure"))
      .mockResolvedValueOnce(media);
    const reload = vi.fn().mockResolvedValue(undefined);

    const result = await downloadMessageMediaWithRetry(
      { downloadMedia, reload } as unknown as Pick<
        Message,
        "downloadMedia" | "reload"
      >,
      3,
      0,
    );

    expect(result).toEqual(media);
    expect(downloadMedia).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("fails fast on WhatsApp's deterministic r download bug", async () => {
    const downloadMedia = vi.fn().mockRejectedValue(new Error("r"));
    const reload = vi.fn().mockResolvedValue(undefined);

    await expect(
      downloadMessageMediaWithRetry(
        { downloadMedia, reload } as unknown as Pick<
          Message,
          "downloadMedia" | "reload"
        >,
        5,
        0,
      ),
    ).rejects.toThrow("r");
    expect(downloadMedia).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("surfaces a persistent media failure after the retry limit", async () => {
    const downloadMedia = vi.fn().mockRejectedValue(new Error("still unavailable"));
    const reload = vi.fn().mockResolvedValue(undefined);

    await expect(
      downloadMessageMediaWithRetry(
        { downloadMedia, reload } as unknown as Pick<
          Message,
          "downloadMedia" | "reload"
        >,
        3,
        0,
      ),
    ).rejects.toThrow("still unavailable");
    expect(downloadMedia).toHaveBeenCalledTimes(3);
  });

  it("decrypts and verifies the direct WhatsApp audio fallback", async () => {
    const mediaKey = Buffer.alloc(32, 7);
    const plaintext = Buffer.from("OggS synthetic voice payload");
    const expanded = Buffer.from(
      hkdfSync(
        "sha256",
        mediaKey,
        Buffer.alloc(32),
        "WhatsApp Audio Keys",
        112,
      ),
    );
    const iv = expanded.subarray(0, 16);
    const cipherKey = expanded.subarray(16, 48);
    const macKey = expanded.subarray(48, 80);
    const cipher = createCipheriv("aes-256-cbc", cipherKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const mac = createHmac("sha256", macKey)
      .update(Buffer.concat([iv, ciphertext]))
      .digest()
      .subarray(0, 10);
    const encrypted = Buffer.concat([ciphertext, mac]);
    const mediaFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        encrypted.buffer.slice(
          encrypted.byteOffset,
          encrypted.byteOffset + encrypted.byteLength,
        ) as ArrayBuffer,
    });
    const message = {
      mediaKey: mediaKey.toString("base64"),
      _data: {
        directPath: "/voice-test",
        mediaKey: mediaKey.toString("base64"),
        mimetype: "audio/ogg; codecs=opus",
      },
    } as unknown as Message;

    const result = await downloadAndDecryptWhatsAppMedia(message, mediaFetch);

    expect(Buffer.from(result.data, "base64")).toEqual(plaintext);
    expect(result.mimetype).toBe("audio/ogg; codecs=opus");
    expect(mediaFetch).toHaveBeenCalledWith(
      "https://mmg.whatsapp.net/voice-test",
    );
  });
});
