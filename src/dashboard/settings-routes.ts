import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import type { Client as WhatsAppClient } from "whatsapp-web.js";
import type { AiService } from "../ai.js";
import {
  type AmirosState,
  type AssistantSettings,
  type KnowledgeTrackingDefault,
  type ThemeName,
} from "../amiros-state.js";
import {
  MODEL_PRESETS,
  normalizeOpenAiApiKey,
  saveOpenAiApiKey,
  type AppConfig,
  type ModelPresetName,
} from "../config.js";
import { requestWhatsAppRelink } from "../whatsapp.js";

type SendJson = (response: ServerResponse, status: number, value: unknown) => void;
type ReadJson = <T>(request: IncomingMessage, maxBytes?: number) => Promise<T>;

type SettingsRouteOptions = {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  client: WhatsAppClient;
  config: AppConfig;
  ai: AiService;
  state: AmirosState;
  sendJson: SendJson;
  readJson: ReadJson;
};

type OwnerAvatarRecord = {
  id: string;
  url: string;
  label: string;
};

const OWNER_AVATAR_DIRECTORY = resolve("work/profile-avatars");
const LEGACY_OWNER_AVATAR_PATH = resolve("work/owner-avatar");
const OWNER_AVATAR_ID = /^[a-f0-9]{24}$/;

export const MODEL_OPTIONS = {
  text: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
  image: ["gpt-image-1-mini", "gpt-image-1", "gpt-image-1.5", "gpt-image-2"],
  voice: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
} as const;

function isPresetName(value: unknown): value is ModelPresetName {
  return value === "economy" || value === "balanced" || value === "quality";
}

function isThemeName(value: unknown): value is ThemeName {
  return value === "forest" ||
    value === "ocean" ||
    value === "plum" ||
    value === "sand" ||
    value === "indigo" ||
    value === "rose" ||
    value === "graphite";
}

function ownerAvatarContentType(path: string): string {
  const descriptor = openSync(path, "r");
  try {
    const header = Buffer.alloc(12);
    readSync(descriptor, header, 0, header.length, 0);
    if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
    if (header[0] === 0xff && header[1] === 0xd8) return "image/jpeg";
    if (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP") return "image/webp";
    return "application/octet-stream";
  } finally {
    closeSync(descriptor);
  }
}

function ownerAvatarPath(id: string): string | undefined {
  if (!OWNER_AVATAR_ID.test(id)) return undefined;
  return join(OWNER_AVATAR_DIRECTORY, `${id}.png`);
}

function listOwnerAvatars(): OwnerAvatarRecord[] {
  const avatars: Array<OwnerAvatarRecord & { updatedAt: number }> = [];
  if (existsSync(LEGACY_OWNER_AVATAR_PATH)) {
    avatars.push({
      id: "legacy",
      url: `/api/profile/avatar?library=${statSync(LEGACY_OWNER_AVATAR_PATH).mtimeMs}`,
      label: "Uploaded photo",
      updatedAt: statSync(LEGACY_OWNER_AVATAR_PATH).mtimeMs,
    });
  }
  if (existsSync(OWNER_AVATAR_DIRECTORY)) {
    for (const filename of readdirSync(OWNER_AVATAR_DIRECTORY)) {
      const id = filename.replace(/\.png$/i, "");
      const path = ownerAvatarPath(id);
      if (!path || filename !== `${id}.png` || !existsSync(path)) continue;
      const updatedAt = statSync(path).mtimeMs;
      avatars.push({
        id,
        url: `/api/profile/avatars/${id}?library=${updatedAt}`,
        label: "Uploaded photo",
        updatedAt,
      });
    }
  }
  return avatars
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(({ updatedAt: _updatedAt, ...avatar }) => avatar);
}

function updatePreset(
  presetName: ModelPresetName,
  config: AppConfig,
  ai: AiService,
  state: AmirosState,
): void {
  const preset = MODEL_PRESETS[presetName];
  config.modelPresetName = presetName;
  config.openaiTextModel = preset.textModel;
  config.openaiImageModel = preset.imageModel;
  config.openaiTranscribeModel = preset.transcribeModel;
  config.openaiImageQuality = preset.imageQuality;
  config.openaiReasoningEffort = preset.reasoningEffort;
  config.openaiTextMaxOutputTokens = preset.maxOutputTokens;
  config.conversationTurnLimit = preset.conversationTurnLimit;
  ai.updateOptions({
    textModel: preset.textModel,
    imageModel: preset.imageModel,
    transcribeModel: preset.transcribeModel,
    imageQuality: preset.imageQuality,
    reasoningEffort: preset.reasoningEffort,
    maxOutputTokens: preset.maxOutputTokens,
    conversationTurnLimit: preset.conversationTurnLimit,
  });
  state.updateSettings({
    modelPreset: presetName,
    models: { text: preset.textModel, image: preset.imageModel, voice: preset.transcribeModel },
  });
  state.addActivity("system", "Model preset changed", presetName);
}

/**
 * Handles only the API requests used by the Settings screen. Returning false
 * lets dashboard.ts continue routing every other AmirOS endpoint unchanged.
 */
export async function handleSettingsApiRoute(options: SettingsRouteOptions): Promise<boolean> {
  const { request, response, pathname, client, config, ai, state, sendJson, readJson } = options;

  if (request.method === "GET" && pathname === "/api/profile/avatars") {
    sendJson(response, 200, { avatars: listOwnerAvatars() });
    return true;
  }

  const uploadedAvatarMatch = pathname.match(/^\/api\/profile\/avatars\/([a-f0-9]{24})$/);
  if (request.method === "GET" && uploadedAvatarMatch) {
    const avatarPath = ownerAvatarPath(uploadedAvatarMatch[1]!);
    if (!avatarPath || !existsSync(avatarPath)) {
      sendJson(response, 404, { error: "Profile image not found" });
      return true;
    }
    response.writeHead(200, {
      "content-type": ownerAvatarContentType(avatarPath),
      "cache-control": "private, max-age=300",
    });
    createReadStream(avatarPath).pipe(response);
    return true;
  }

  if (request.method === "DELETE" && (uploadedAvatarMatch || pathname === "/api/profile/avatars/legacy")) {
    const avatarId = uploadedAvatarMatch?.[1] || "legacy";
    const avatarPath = avatarId === "legacy" ? LEGACY_OWNER_AVATAR_PATH : ownerAvatarPath(avatarId);
    if (!avatarPath || !existsSync(avatarPath)) {
      sendJson(response, 404, { error: "Profile image not found" });
      return true;
    }
    const selectedPath = state.getSettings().ownerProfile.avatarUrl.split("?")[0];
    const deletingSelectedAvatar = avatarId === "legacy"
      ? selectedPath === "/api/profile/avatar"
      : selectedPath === `/api/profile/avatars/${avatarId}`;
    unlinkSync(avatarPath);
    const profile = deletingSelectedAvatar
      ? state.updateOwnerProfile({ avatarUrl: "/profile-avatars/avatar-01.png?v=2" })
      : state.getSettings().ownerProfile;
    sendJson(response, 200, { profile, avatars: listOwnerAvatars() });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/profile/avatar") {
    if (!existsSync(LEGACY_OWNER_AVATAR_PATH)) {
      sendJson(response, 404, { error: "No custom profile image has been uploaded" });
      return true;
    }
    response.writeHead(200, {
      "content-type": ownerAvatarContentType(LEGACY_OWNER_AVATAR_PATH),
      "cache-control": "private, max-age=300",
    });
    createReadStream(LEGACY_OWNER_AVATAR_PATH).pipe(response);
    return true;
  }

  if (request.method === "PATCH" && pathname === "/api/profile") {
    const body = await readJson<{ displayName?: string; avatarUrl?: string }>(request);
    const displayName = body.displayName?.replace(/\s+/g, " ").trim();
    const avatarUrl = body.avatarUrl?.trim();
    if (displayName !== undefined && (!displayName || displayName.length > 120)) {
      sendJson(response, 400, { error: "Profile name must be 1–120 characters" });
      return true;
    }
    if (avatarUrl !== undefined && !avatarUrl.startsWith("/profile-avatars/") && !avatarUrl.startsWith("/api/profile/avatar")) {
      sendJson(response, 400, { error: "Choose an AmirOS profile image or upload one" });
      return true;
    }
    sendJson(response, 200, { profile: state.updateOwnerProfile({ displayName, avatarUrl }) });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/profile/avatar") {
    const body = await readJson<{ dataUrl?: string }>(request, 9 * 1024 * 1024);
    const match = body.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      sendJson(response, 400, { error: "Upload a PNG, JPEG, or WebP image" });
      return true;
    }
    const bytes = Buffer.from(match[2]!, "base64");
    if (!bytes.length || bytes.length > 6 * 1024 * 1024) {
      sendJson(response, 413, { error: "Profile image must be under 6 MB" });
      return true;
    }
    mkdirSync(OWNER_AVATAR_DIRECTORY, { recursive: true, mode: 0o700 });
    const avatarId = randomBytes(12).toString("hex");
    const avatarPath = ownerAvatarPath(avatarId)!;
    writeFileSync(avatarPath, bytes, { mode: 0o600 });
    const avatarUrl = `/api/profile/avatars/${avatarId}?updated=${Date.now()}`;
    sendJson(response, 200, { profile: state.updateOwnerProfile({ avatarUrl }) });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/bot/pause") {
    const body = await readJson<{ paused?: boolean }>(request);
    state.setPaused(Boolean(body.paused));
    sendJson(response, 200, { paused: state.isPaused() });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/model-preset") {
    const body = await readJson<{ preset?: unknown }>(request);
    if (!isPresetName(body.preset)) {
      sendJson(response, 400, { error: "Unknown model preset" });
      return true;
    }
    updatePreset(body.preset, config, ai, state);
    sendJson(response, 200, { preset: body.preset });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/settings/openai-key") {
    const body = await readJson<{ apiKey?: unknown }>(request);
    let apiKey: string;
    try {
      apiKey = normalizeOpenAiApiKey(body.apiKey);
      saveOpenAiApiKey(apiKey);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Could not save the OpenAI API key" });
      return true;
    }
    config.openaiApiKey = apiKey;
    ai.updateApiKey(apiKey);
    state.addActivity("system", "OpenAI API key connected", "Stored locally on this Mac");
    sendJson(response, 200, { apiKeyConfigured: true });
    return true;
  }

  if (request.method === "PATCH" && pathname === "/api/settings") {
    const patch = await readJson<{
      theme?: unknown;
      quietHours?: { enabled: boolean; start: string; end: string };
      monthlyBudgetUsd?: number;
      assistant?: Partial<AssistantSettings>;
      models?: { text?: string; image?: string; voice?: string };
      ownerProfile?: { displayName?: string; avatarUrl?: string };
      knowledgeTrackingDefault?: KnowledgeTrackingDefault;
    }>(request);
    if (patch.theme !== undefined && !isThemeName(patch.theme)) {
      sendJson(response, 400, { error: "Unknown color theme" });
      return true;
    }
    if (patch.monthlyBudgetUsd !== undefined &&
        (!Number.isFinite(patch.monthlyBudgetUsd) || patch.monthlyBudgetUsd < 1)) {
      sendJson(response, 400, { error: "Monthly budget must be at least 1" });
      return true;
    }
    if (patch.knowledgeTrackingDefault !== undefined &&
        patch.knowledgeTrackingDefault !== "ask" &&
        patch.knowledgeTrackingDefault !== "private" &&
        patch.knowledgeTrackingDefault !== "off") {
      sendJson(response, 400, { error: "Choose how AmirOS should handle knowledge tracking" });
      return true;
    }
    if (patch.assistant) {
      for (const key of [
        "botTriggerPrefix",
        "webTriggerPrefix",
        "imageTriggerPrefix",
        "modelsTriggerPrefix",
      ] as const) {
        const value = patch.assistant[key];
        if (value !== undefined && (!value.trim() || value.length > 30)) {
          sendJson(response, 400, { error: "Command triggers must be 1–30 characters" });
          return true;
        }
      }
      Object.assign(config, patch.assistant);
      ai.updateOptions({ webSearchEnabled: config.webSearchEnabled });
    }
    if (patch.models) {
      const selected = {
        text: patch.models.text || config.openaiTextModel,
        image: patch.models.image || config.openaiImageModel,
        voice: patch.models.voice || config.openaiTranscribeModel,
      };
      if (!MODEL_OPTIONS.text.includes(selected.text as (typeof MODEL_OPTIONS.text)[number]) ||
          !MODEL_OPTIONS.image.includes(selected.image as (typeof MODEL_OPTIONS.image)[number]) ||
          !MODEL_OPTIONS.voice.includes(selected.voice as (typeof MODEL_OPTIONS.voice)[number])) {
        sendJson(response, 400, { error: "Choose models from the supported AmirOS list" });
        return true;
      }
      config.openaiTextModel = selected.text;
      config.openaiImageModel = selected.image;
      config.openaiTranscribeModel = selected.voice;
      ai.updateOptions({
        textModel: selected.text,
        imageModel: selected.image,
        transcribeModel: selected.voice,
      });
      state.addActivity("system", "Assistant models updated", `${selected.text} · ${selected.image} · ${selected.voice}`);
    }
    if (patch.ownerProfile) {
      const displayName = patch.ownerProfile.displayName?.replace(/\s+/g, " ").trim();
      const avatarUrl = patch.ownerProfile.avatarUrl?.trim();
      if (displayName !== undefined && (!displayName || displayName.length > 120)) {
        sendJson(response, 400, { error: "Profile name must be 1–120 characters" });
        return true;
      }
      if (avatarUrl !== undefined && !avatarUrl.startsWith("/profile-avatars/") && !avatarUrl.startsWith("/api/profile/avatar")) {
        sendJson(response, 400, { error: "Choose an AmirOS profile image or upload one" });
        return true;
      }
      state.updateOwnerProfile({ displayName, avatarUrl });
    }
    sendJson(response, 200, {
      settings: {
        ...state.updateSettings({
          ...patch,
          theme: patch.theme as ThemeName | undefined,
          models: patch.models
            ? {
                text: patch.models.text || config.openaiTextModel,
                image: patch.models.image || config.openaiImageModel,
                voice: patch.models.voice || config.openaiTranscribeModel,
              }
            : state.getSettings().models,
        }),
        apiKeyConfigured: ai.isConfigured(),
      },
    });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/whatsapp/relink") {
    state.setConnection("starting", "Preparing a new WhatsApp QR code");
    void requestWhatsAppRelink(client).catch((error) => {
      console.error("Could not regenerate the WhatsApp QR code:", error);
    });
    sendJson(response, 202, { connection: state.connection() });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/qr") {
    const qrPath = resolve("work/whatsapp-qr.png");
    if (state.connection().status !== "qr" || !existsSync(qrPath)) {
      sendJson(response, 404, { error: "No QR code is currently available" });
      return true;
    }
    response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
    createReadStream(qrPath).pipe(response);
    return true;
  }

  return false;
}
