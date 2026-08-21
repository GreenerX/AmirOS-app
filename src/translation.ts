export type TranslationRequest = {
  body: string;
  targetLanguage: string;
  sourceLanguage?: string;
};

const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const EMAIL_PATTERN = /\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/giu;
const MENTION_PATTERN = /(?<![\p{L}\p{N}_.])@[\p{L}\p{N}_]{1,64}/giu;
const PHONE_PATTERN = /(?<![\p{L}\p{N}])(?:\+?\d[\d().\s-]{5,}\d)(?![\p{L}\p{N}])/gu;
const NUMBER_OR_DATE_PATTERN = /(?<![\p{L}\p{N}])[\d٠-٩][\d٠-٩,.:/\-]*(?![\p{L}\p{N}])/gu;

function canonicalLanguageTag(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 35 || trimmed.toLowerCase() === "und") return undefined;
  try {
    const [canonical] = Intl.getCanonicalLocales(trimmed);
    return canonical;
  } catch {
    return undefined;
  }
}

export function normalizeTranslationLanguage(value: unknown): string | undefined {
  return canonicalLanguageTag(value);
}

/** Tokens that must survive a translation byte-for-byte so a useful message cannot lose an address, ID, or link. */
export function protectedTranslationTokens(value: string): string[] {
  const tokens = new Set<string>();
  for (const pattern of [URL_PATTERN, EMAIL_PATTERN, MENTION_PATTERN, PHONE_PATTERN, NUMBER_OR_DATE_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const token = match[0]?.trim();
      if (token) tokens.add(token);
    }
  }
  return [...tokens];
}

export function validateTranslationRequest(input: Partial<TranslationRequest>): TranslationRequest {
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) throw new Error("Write a message before translating it");
  if (body.length > 4_000) throw new Error("Messages must be 4,000 characters or fewer to translate");
  const targetLanguage = normalizeTranslationLanguage(input.targetLanguage);
  if (!targetLanguage) throw new Error("Choose a supported destination language");
  const sourceLanguage = input.sourceLanguage === undefined ? undefined : normalizeTranslationLanguage(input.sourceLanguage);
  if (input.sourceLanguage !== undefined && !sourceLanguage) throw new Error("Choose a supported source language");
  return { body, targetLanguage, ...(sourceLanguage ? { sourceLanguage } : {}) };
}

/**
 * A deterministic final gate for an AI translation preview. It deliberately
 * declines to guess when protected factual tokens are missing; the user can
 * retry rather than send altered contact details or a broken URL.
 */
export function validateTranslationPreview(source: string, preview: unknown): string {
  const translated = typeof preview === "string" ? preview.trim() : "";
  if (!translated) throw new Error("The translation was empty. Please try again.");
  if (translated.length > Math.max(800, source.trim().length * 4 + 120)) {
    throw new Error("The translation was unexpectedly long. Please try again.");
  }
  const missing = protectedTranslationTokens(source).filter((token) => !translated.includes(token));
  if (missing.length > 0) {
    throw new Error("The translation could not preserve a link, number, mention, or contact detail. Please try again.");
  }
  return translated;
}

export function translationInstructions(): string {
  return [
    "Translate the supplied draft faithfully into the requested target language.",
    "Return only the translated draft; do not add an explanation, greeting, advice, sign-off, or quotation marks.",
    "Preserve names, numbers, dates, times, URLs, emails, phone numbers, @mentions, formatting, attachment placeholders, uncertainty, requests, and emoji exactly unless they are already part of the source text.",
    "Preserve the author's apparent level of formality and tone. Do not invent or omit details.",
  ].join(" ");
}
