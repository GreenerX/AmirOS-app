import { AiService } from "./ai.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const testWebSearch = process.argv.includes("--web");
const ai = new AiService({
  apiKey: config.openaiApiKey,
  textModel: config.openaiTextModel,
  imageModel: config.openaiImageModel,
  transcribeModel: config.openaiTranscribeModel,
  imageQuality: config.openaiImageQuality,
  reasoningEffort: config.openaiReasoningEffort,
  maxOutputTokens: testWebSearch ? 200 : 20,
  conversationTurnLimit: 1,
  instructions: testWebSearch
    ? "Answer briefly and use web search."
    : "Reply with exactly OK.",
  webSearchEnabled: testWebSearch,
  webSearchContextSize: config.webSearchContextSize,
  webSearchMaxSources: config.webSearchMaxSources,
});

try {
  const prompt = testWebSearch
    ? "Find one positive technology news story from today. Reply in one sentence."
    : "Reply with exactly OK.";
  const answer = await ai.reply("local-diagnostic", prompt, testWebSearch);
  console.log(`OpenAI diagnostic succeeded with ${config.openaiTextModel}: ${answer}`);
} catch (error) {
  const details = error as {
    status?: number;
    code?: string;
    type?: string;
    message?: string;
    request_id?: string;
  };
  console.error("OpenAI diagnostic failed", {
    model: config.openaiTextModel,
    status: details.status,
    code: details.code,
    type: details.type,
    message: details.message || String(error),
    requestId: details.request_id,
  });
  process.exitCode = 1;
}
