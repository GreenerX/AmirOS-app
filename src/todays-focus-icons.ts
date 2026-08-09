import { createHash } from "node:crypto";

export type TodaysFocusIconRequest = {
  title: string;
  type: "commitment" | "todo" | "calendar" | "reply";
};

const FOCUS_ICON_TYPES = new Set<TodaysFocusIconRequest["type"]>(["commitment", "todo", "calendar", "reply"]);

export function normalizeTodaysFocusIconRequest(input: unknown): TodaysFocusIconRequest | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  const title = typeof value.title === "string" ? value.title.replace(/\s+/gu, " ").trim() : "";
  const type = typeof value.type === "string" && FOCUS_ICON_TYPES.has(value.type as TodaysFocusIconRequest["type"])
    ? value.type as TodaysFocusIconRequest["type"]
    : undefined;
  if (!title || title.length > 180 || !type) return undefined;
  return { title, type };
}

export function todaysFocusIconCacheKey(item: TodaysFocusIconRequest): string {
  return createHash("sha256")
    .update(`v1|${item.type}|${item.title.toLocaleLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
}

export function todaysFocusIconPrompt(item: TodaysFocusIconRequest): string {
  return [
    `Create one premium app icon that clearly represents this ${item.type}: “${item.title}”.`,
    "Use a simple centered visual metaphor, refined dimensional lighting, calm emerald and soft blue accents, and a warm off-white background.",
    "Square composition with generous safe margins, designed to remain recognizable at 64 pixels.",
    "No text, letters, numbers, logos, UI, borders, watermarks, photorealistic people, or extra objects.",
  ].join(" ");
}
