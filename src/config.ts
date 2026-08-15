import dotenv from "dotenv";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

export type ModelPresetName = "economy" | "balanced" | "quality";
export type ImageQuality = "low" | "medium" | "high" | "auto";
export type ReasoningEffort = "none" | "low" | "medium";
export type WebSearchContextSize = "low" | "medium" | "high";

export type ModelPreset = {
  textModel: string;
  imageModel: string;
  transcribeModel: string;
  imageQuality: ImageQuality;
  reasoningEffort: ReasoningEffort;
  maxOutputTokens: number;
  conversationTurnLimit: number;
};

export const MODEL_PRESETS: Record<ModelPresetName, ModelPreset> = {
  economy: {
    textModel: "gpt-5.6-luna",
    imageModel: "gpt-image-1-mini",
    transcribeModel: "gpt-4o-mini-transcribe",
    imageQuality: "low",
    reasoningEffort: "none",
    maxOutputTokens: 400,
    conversationTurnLimit: 6,
  },
  balanced: {
    textModel: "gpt-5.6-terra",
    imageModel: "gpt-image-2",
    transcribeModel: "gpt-4o-transcribe",
    imageQuality: "low",
    reasoningEffort: "low",
    maxOutputTokens: 700,
    conversationTurnLimit: 10,
  },
  quality: {
    textModel: "gpt-5.6-sol",
    imageModel: "gpt-image-2",
    transcribeModel: "gpt-4o-transcribe",
    imageQuality: "high",
    reasoningEffort: "medium",
    maxOutputTokens: 1_200,
    conversationTurnLimit: 16,
  },
};

export type AppConfig = {
  openaiApiKey: string;
  modelPresetName: ModelPresetName;
  openaiTextModel: string;
  openaiImageModel: string;
  openaiTranscribeModel: string;
  openaiImageQuality: ImageQuality;
  openaiReasoningEffort: ReasoningEffort;
  openaiTextMaxOutputTokens: number;
  conversationTurnLimit: number;
  botTriggerPrefix: string;
  webTriggerPrefix: string;
  imageTriggerPrefix: string;
  modelsTriggerPrefix: string;
  voiceBotTriggerPrefix: string;
  voiceWebTriggerPrefix: string;
  voiceImageTriggerPrefix: string;
  botInstructions: string;
  webSearchEnabled: boolean;
  webSearchContextSize: WebSearchContextSize;
  webSearchMaxSources: number;
  autoReplySelfChat: boolean;
  allowOutgoingTriggerCommands: boolean;
  allowGroups: boolean;
  amirosPort: number;
  amirosPublicUrl?: string;
  betaSupportUrl?: string;
  betaSupportEmail?: string;
  whatsappSessionPath: string;
  puppeteerExecutablePath?: string;
  puppeteerNoSandbox: boolean;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Validates the shape only. The key is deliberately never returned in any
 * dashboard response or written to AmirOS' JSON state.
 */
export function normalizeOpenAiApiKey(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter an OpenAI API key");
  const key = value.trim();
  if (!/^sk-[A-Za-z0-9_-]{16,}$/u.test(key)) {
    throw new Error("That doesn't look like an OpenAI API key");
  }
  return key;
}

/**
 * Stores a user-supplied key only in the ignored, local env file. This keeps
 * customer credentials out of the dashboard state, logs, and release builds.
 */
export function saveOpenAiApiKey(keyValue: unknown, filePath = resolve(".env.local")): void {
  const key = normalizeOpenAiApiKey(keyValue);
  if (existsSync(filePath) && lstatSync(filePath).isSymbolicLink()) {
    throw new Error("AmirOS will not save an API key through a symbolic link");
  }
  const current = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const line = `OPENAI_API_KEY=${key}`;
  const next = /^OPENAI_API_KEY=.*(?:\r?\n|$)/mu.test(current)
    ? current.replace(/^OPENAI_API_KEY=.*(?:\r?\n|$)/mu, `${line}\n`)
    : `${current.replace(/\s*$/u, "")}${current.trim() ? "\n" : ""}${line}\n`;
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, next, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, filePath);
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

function publicAmirosUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = optional(env, "AMIROS_PUBLIC_URL");
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return value.replace(/\/+$/, "");
  } catch {
    throw new Error("AMIROS_PUBLIC_URL must be a valid http or https URL");
  }
}

function betaSupportUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = optional(env, "AMIROS_BETA_SUPPORT_URL");
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/$/u, "");
  } catch {
    throw new Error("AMIROS_BETA_SUPPORT_URL must be an https URL without credentials, query parameters, or fragments");
  }
}

/**
 * The official private-beta destination is public configuration, not customer
 * data. Reading it from the tracked example file lets an updated installation
 * gain the support destination even when its updater correctly preserves an
 * older private `.env` file. Local environment values always take precedence.
 */
export function betaSupportEmailFromExample(filePath = resolve(".env.example")): string | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    return dotenv.parse(readFileSync(filePath, "utf8")).AMIROS_BETA_SUPPORT_EMAIL?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function betaSupportEmail(env: NodeJS.ProcessEnv): string | undefined {
  const value = optional(env, "AMIROS_BETA_SUPPORT_EMAIL")
    // Unit tests and isolated callers pass an explicit environment object.
    // Only the real runtime may inherit the tracked public beta default.
    || (env === process.env ? betaSupportEmailFromExample() : undefined);
  if (!value) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) throw new Error("AMIROS_BETA_SUPPORT_EMAIL must be a valid email address");
  return value;
}

function booleanValue(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = optional(env, name)?.toLowerCase();
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = optional(env, name);
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function presetName(env: NodeJS.ProcessEnv): ModelPresetName {
  const value = (optional(env, "OPENAI_MODEL_PRESET") || "economy").toLowerCase();
  if (value === "economy" || value === "balanced" || value === "quality") {
    return value;
  }
  throw new Error("OPENAI_MODEL_PRESET must be economy, balanced, or quality");
}

function imageQuality(env: NodeJS.ProcessEnv, fallback: ImageQuality): ImageQuality {
  const value = optional(env, "OPENAI_IMAGE_QUALITY")?.toLowerCase();
  if (value === undefined) return fallback;
  if (value === "low" || value === "medium" || value === "high" || value === "auto") {
    return value;
  }
  throw new Error("OPENAI_IMAGE_QUALITY must be low, medium, high, or auto");
}

function webSearchContextSize(env: NodeJS.ProcessEnv): WebSearchContextSize {
  const value = (optional(env, "WEB_SEARCH_CONTEXT_SIZE") || "low").toLowerCase();
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("WEB_SEARCH_CONTEXT_SIZE must be low, medium, or high");
}

function defaultChromePath(): string | undefined {
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  return undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const selectedPresetName = presetName(env);
  const preset = MODEL_PRESETS[selectedPresetName];

  return {
    // A new customer needs to be able to open Settings before adding their own
    // key. AI actions remain unavailable until a key is saved locally.
    openaiApiKey: optional(env, "OPENAI_API_KEY") || "",
    modelPresetName: selectedPresetName,
    openaiTextModel: optional(env, "OPENAI_TEXT_MODEL") || preset.textModel,
    openaiImageModel: optional(env, "OPENAI_IMAGE_MODEL") || preset.imageModel,
    openaiTranscribeModel:
      optional(env, "OPENAI_TRANSCRIBE_MODEL") || preset.transcribeModel,
    openaiImageQuality: imageQuality(env, preset.imageQuality),
    openaiReasoningEffort: preset.reasoningEffort,
    openaiTextMaxOutputTokens: positiveInteger(
      env,
      "OPENAI_TEXT_MAX_OUTPUT_TOKENS",
      preset.maxOutputTokens,
    ),
    conversationTurnLimit: positiveInteger(
      env,
      "CONVERSATION_TURN_LIMIT",
      preset.conversationTurnLimit,
    ),
    botTriggerPrefix: optional(env, "BOT_TRIGGER_PREFIX") || "!bot",
    webTriggerPrefix: optional(env, "WEB_TRIGGER_PREFIX") || "!web",
    imageTriggerPrefix: optional(env, "IMAGE_TRIGGER_PREFIX") || "!image",
    modelsTriggerPrefix: optional(env, "MODELS_TRIGGER_PREFIX") || "!models",
    voiceBotTriggerPrefix: optional(env, "VOICE_BOT_TRIGGER_PREFIX") || "hey bot",
    voiceWebTriggerPrefix:
      optional(env, "VOICE_WEB_TRIGGER_PREFIX") || "search web",
    voiceImageTriggerPrefix:
      optional(env, "VOICE_IMAGE_TRIGGER_PREFIX") || "create image",
    botInstructions:
      optional(env, "BOT_INSTRUCTIONS") ||
      "You are a warm, personal WhatsApp assistant. Write like a thoughtful friend: natural, supportive, and concise. Match the user's language and tone. Use 1 to 3 relevant emojis total, placing them naturally at the ends of sentences or paragraphs. Never begin a reply or sentence with an emoji. Format specifically for WhatsApp: use short paragraphs, blank lines, the • character for bullets, and single asterisks for *bold*. Never use double asterisks, Markdown headings, Markdown tables, or Markdown-style links. For news summaries, use at most 5 focused bullets unless the user asks for more. If the user shares their name, preferences, or personal context, remember and use those details naturally during the conversation. Ask an occasional helpful follow-up question when it genuinely improves the answer. Stay accurate and never pretend to know personal facts the user has not shared.",
    webSearchEnabled: booleanValue(env, "WEB_SEARCH_ENABLED", true),
    webSearchContextSize: webSearchContextSize(env),
    webSearchMaxSources: positiveInteger(env, "WEB_SEARCH_MAX_SOURCES", 4),
    autoReplySelfChat: booleanValue(env, "AUTO_REPLY_SELF_CHAT", true),
    allowOutgoingTriggerCommands: booleanValue(
      env,
      "ALLOW_OUTGOING_TRIGGER_COMMANDS",
      true,
    ),
    allowGroups: booleanValue(env, "ALLOW_GROUPS", false),
    amirosPort: positiveInteger(env, "AMIROS_PORT", 3789),
    amirosPublicUrl: publicAmirosUrl(env),
    betaSupportUrl: betaSupportUrl(env),
    betaSupportEmail: betaSupportEmail(env),
    whatsappSessionPath: optional(env, "WHATSAPP_SESSION_PATH") || ".wwebjs_auth",
    puppeteerExecutablePath:
      optional(env, "PUPPETEER_EXECUTABLE_PATH") || defaultChromePath(),
    puppeteerNoSandbox: booleanValue(env, "PUPPETEER_NO_SANDBOX", false),
  };
}
