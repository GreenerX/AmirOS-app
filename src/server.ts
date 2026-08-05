import { AiService } from "./ai.js";
import { AmirosState } from "./amiros-state.js";
import { loadConfig, MODEL_PRESETS } from "./config.js";
import { startAmirosDashboard } from "./dashboard.js";
import { IntelligenceLearner } from "./intelligence-learner.js";
import { WritingStyleLearner } from "./writing-style.js";
import { MessageProcessor } from "./processor.js";
import { createWhatsAppClient } from "./whatsapp.js";

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
const processor = new MessageProcessor(config, ai, amirosState, writingStyleLearner, intelligenceLearner);
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

const shutdown = async () => {
  console.log("Stopping WhatsApp bot...");
  intelligenceLearner.shutdown();
  dashboard.close();
  await whatsapp.destroy().catch(() => undefined);
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await whatsapp.initialize();
