import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

export const GENERATED_IMAGE_FORMATS = ["webp", "png"] as const;
export type GeneratedImageFormat = typeof GENERATED_IMAGE_FORMATS[number];

export type CachedGeneratedImage = {
  path: string;
  format: GeneratedImageFormat;
};

/**
 * Prefer the compact format for new artwork while continuing to serve the
 * PNGs created by older AmirOS versions. This avoids spending again just to
 * migrate a user's existing cache.
 */
export function cachedGeneratedImage(directory: string, name: string): CachedGeneratedImage | undefined {
  for (const format of GENERATED_IMAGE_FORMATS) {
    const path = join(directory, `${name}.${format}`);
    if (existsSync(path)) return { path, format };
  }
  return undefined;
}

export function generatedImageContentType(format: GeneratedImageFormat): string {
  return format === "webp" ? "image/webp" : "image/png";
}

export function generatedImageUrl(prefix: string, name: string, format: GeneratedImageFormat): string {
  return `${prefix}/${name}.${format}`;
}

/** Resize freshly generated artwork before it becomes a persistent cache entry. */
export async function compactGeneratedImageToWebp(
  image: Buffer,
  options: { width: number; quality: number },
): Promise<Buffer> {
  return sharp(image)
    .rotate()
    .resize({ width: options.width, withoutEnlargement: true })
    .webp({ quality: options.quality, effort: 4 })
    .toBuffer();
}
