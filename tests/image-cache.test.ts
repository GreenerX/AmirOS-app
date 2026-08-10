import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  cachedGeneratedImage,
  compactGeneratedImageToWebp,
  generatedImageContentType,
  generatedImageUrl,
} from "../src/image-cache.js";

describe("generated artwork cache", () => {
  it("keeps existing PNGs valid while preferring compact WebP cache entries", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-image-cache-"));
    const name = "city-art";
    try {
      const source = await sharp({
        create: { width: 1024, height: 768, channels: 3, background: "#eabf7a" },
      }).png().toBuffer();
      writeFileSync(join(directory, `${name}.png`), source);
      expect(cachedGeneratedImage(directory, name)?.format).toBe("png");

      const compact = await compactGeneratedImageToWebp(source, { width: 640, quality: 76 });
      writeFileSync(join(directory, `${name}.webp`), compact);
      expect(cachedGeneratedImage(directory, name)?.format).toBe("webp");
      await expect(sharp(compact).metadata()).resolves.toMatchObject({ format: "webp", width: 640, height: 480 });
      expect(generatedImageUrl("/api/timezones/backgrounds/city", name, "webp")).toBe("/api/timezones/backgrounds/city/city-art.webp");
      expect(generatedImageContentType("webp")).toBe("image/webp");
      expect(generatedImageContentType("png")).toBe("image/png");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
