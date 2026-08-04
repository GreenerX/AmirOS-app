import { MODEL_PRESETS } from "./config.js";

console.table(
  Object.entries(MODEL_PRESETS).map(([preset, models]) => ({
    preset,
    text: models.textModel,
    image: `${models.imageModel} (${models.imageQuality})`,
    voice: models.transcribeModel,
    outputTokenCap: models.maxOutputTokens,
    conversationTurns: models.conversationTurnLimit,
  })),
);
