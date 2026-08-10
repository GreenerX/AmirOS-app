import { AiService } from "./ai.js";
import { AmirosState } from "./amiros-state.js";
import { loadConfig, MODEL_PRESETS } from "./config.js";
import { startAmirosDashboard } from "./dashboard.js";
import { IntelligenceLearner } from "./intelligence-learner.js";
import { WritingStyleLearner } from "./writing-style.js";
import { MessageProcessor } from "./processor.js";
import { createWhatsAppClient } from "./whatsapp.js";
import { todaysFocusIconCacheKey, todaysFocusIconPrompt } from "./todays-focus-icons.js";
import {
  cachedGeneratedImage,
  compactGeneratedImageToWebp,
  generatedImageUrl,
} from "./image-cache.js";

const config = loadConfig();
const amirosState = new AmirosState();
const savedSettings = amirosState.getSettings();
const savedAssistantSettings = savedSettings.assistant;
Object.assign(config, savedAssistantSettings);
if (savedSettings.modelPreset) {
  const preset = MODEL_PRESETS[savedSettings.modelPreset];
  Object.assign(config, {
    modelPresetName: savedSettings.modelPreset,
    openaiTextModel: preset.textModel,
    openaiImageModel: preset.imageModel,
    openaiTranscribeModel: preset.transcribeModel,
    openaiImageQuality: preset.imageQuality,
    openaiReasoningEffort: preset.reasoningEffort,
    openaiTextMaxOutputTokens: preset.maxOutputTokens,
    conversationTurnLimit: preset.conversationTurnLimit,
  });
}
if (savedSettings.models) {
  Object.assign(config, {
    openaiTextModel: savedSettings.models.text,
    openaiImageModel: savedSettings.models.image,
    openaiTranscribeModel: savedSettings.models.voice,
  });
}
const ai = new AiService({
  apiKey: config.openaiApiKey,
  textModel: config.openaiTextModel,
  imageModel: config.openaiImageModel,
  transcribeModel: config.openaiTranscribeModel,
  imageQuality: config.openaiImageQuality,
  reasoningEffort: config.openaiReasoningEffort,
  maxOutputTokens: config.openaiTextMaxOutputTokens,
  conversationTurnLimit: config.conversationTurnLimit,
  instructions: config.botInstructions,
  webSearchEnabled: config.webSearchEnabled,
  webSearchContextSize: config.webSearchContextSize,
  webSearchMaxSources: config.webSearchMaxSources,
}, {
  monthlySpendLimitUsd: () => amirosState.getSettings().monthlyBudgetUsd,
  monthlySpendUsd: () => amirosState.monthlySpendUsd(),
  recordSpendUsd: (amount) => amirosState.recordAiSpend(amount),
});
const writingStyleLearner = new WritingStyleLearner(amirosState, ai);
const intelligenceLearner = new IntelligenceLearner(amirosState, ai);
const eventImageJobs = new Map<string, Promise<string>>();
const generateEventImage = (title: string): Promise<string> => {
  const item = { title, type: "calendar" as const };
  const key = todaysFocusIconCacheKey(item);
  const directory = resolve("work/todays-focus-icons");
  const cached = cachedGeneratedImage(directory, key);
  if (cached) return Promise.resolve(generatedImageUrl("/api/todays-focus/icons", key, cached.format));
  const current = eventImageJobs.get(key);
  if (current) return current;
  const job = (async () => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const image = await ai.generateImage(todaysFocusIconPrompt(item), {
      model: "gpt-image-1.5",
      size: "1024x1024",
      quality: "low",
      outputFormat: "webp",
      outputCompression: 72,
    });
    const compactImage = await compactGeneratedImageToWebp(image, { width: 256, quality: 72 });
    writeFileSync(resolve(directory, `${key}.webp`), compactImage, { mode: 0o600 });
    return generatedImageUrl("/api/todays-focus/icons", key, "webp");
  })().finally(() => eventImageJobs.delete(key));
  eventImageJobs.set(key, job);
  return job;
};
const processor = new MessageProcessor(
  config,
  ai,
  amirosState,
  writingStyleLearner,
  intelligenceLearner,
  generateEventImage,
);
const whatsapp = createWhatsAppClient(config, (message, isSelfChat) =>
  processor.process(message, isSelfChat),
  amirosState,
);
const dashboard = startAmirosDashboard({
  client: whatsapp,
  config,
  ai,
  state: amirosState,
  writingStyleLearner,
  intelligenceLearner,
  port: config.amirosPort,
});

console.log(
  `Starting with ${config.modelPresetName} preset: ` +
    `${config.openaiTextModel}, ${config.openaiImageModel}, ${config.openaiTranscribeModel}`,
);

let shutdownPromise: Promise<never> | undefined;

const shutdown = (exitCode = 0): Promise<never> => {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    console.log("Stopping WhatsApp bot...");
    intelligenceLearner.shutdown();
    dashboard.close();
    // Client.destroy() closes the dedicated Puppeteer browser profile. Run it
    // for both normal stops and a failed startup so a restart never inherits a
    // half-open WhatsApp session.
    await whatsapp.destroy().catch(() => undefined);
    process.exit(exitCode);
  })();
  return shutdownPromise;
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await whatsapp.initialize();
} catch (error) {
  console.error("WhatsApp could not start; closing the local service cleanly.", error);
  await shutdown(1);
}
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
