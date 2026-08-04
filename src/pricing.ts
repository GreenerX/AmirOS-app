import type { ImageQuality } from "./config.js";

export const OPENAI_PRICING_SOURCE = "https://developers.openai.com/api/docs/pricing";
export const OPENAI_IMAGE_PRICING_SOURCE =
  "https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency";
export const OPENAI_PRICING_UPDATED_AT = "2026-07-31";

type TextRates = { input: number; cachedInput: number; output: number };
type ImageRates = { textInput: number; imageInput: number; imageOutput: number };

const TEXT_RATES_PER_MILLION: Record<string, TextRates> = {
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-sol": { input: 5, cachedInput: 0.5, output: 30 },
};

const IMAGE_RATES_PER_MILLION: Record<string, ImageRates> = {
  "gpt-image-1-mini": { textInput: 2, imageInput: 2.5, imageOutput: 8 },
  "gpt-image-2": { textInput: 5, imageInput: 8, imageOutput: 30 },
};

const TRANSCRIPTION_USD_PER_MINUTE: Record<string, number> = {
  "gpt-4o-mini-transcribe": 0.003,
  "gpt-transcribe": 0.0045,
};

const IMAGE_OUTPUT_COST_1024_SQUARE: Record<string, Record<string, number>> = {
  "gpt-image-1-mini": { low: 0.005, medium: 0.011, high: 0.036 },
  "gpt-image-2": { low: 0.006, medium: 0.053, high: 0.211 },
};

function ratesFor<T>(model: string, rates: Record<string, T>): T | undefined {
  const exact = rates[model];
  if (exact) return exact;
  const base = Object.keys(rates).find((name) => model.startsWith(`${name}-`));
  return base ? rates[base] : undefined;
}

export function textCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): number {
  const rates = ratesFor(model, TEXT_RATES_PER_MILLION);
  if (!rates) return 0;
  const cached = Math.min(Math.max(0, cachedInputTokens), Math.max(0, inputTokens));
  const uncached = Math.max(0, inputTokens) - cached;
  return (
    uncached * rates.input + cached * rates.cachedInput + outputTokens * rates.output
  ) / 1_000_000;
}

export type ImageTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  inputTextTokens?: number;
  inputImageTokens?: number;
};

export function imageCostUsd(
  model: string,
  quality: ImageQuality,
  usage?: ImageTokenUsage,
): number {
  const rates = ratesFor(model, IMAGE_RATES_PER_MILLION);
  if (rates && usage && (usage.inputTokens || usage.outputTokens)) {
    const textInput = usage.inputTextTokens ?? usage.inputTokens ?? 0;
    const imageInput = usage.inputImageTokens ?? 0;
    return (
      textInput * rates.textInput +
      imageInput * rates.imageInput +
      (usage.outputTokens || 0) * rates.imageOutput
    ) / 1_000_000;
  }

  const costs = ratesFor(model, IMAGE_OUTPUT_COST_1024_SQUARE);
  const resolvedQuality = quality === "auto" ? "medium" : quality;
  return costs?.[resolvedQuality] || 0;
}

export function transcriptionCostUsd(model: string, seconds: number): number {
  const perMinute = ratesFor(model, TRANSCRIPTION_USD_PER_MINUTE);
  return perMinute ? (Math.max(0, seconds) / 60) * perMinute : 0;
}

export function webSearchCostUsd(calls: number): number {
  return Math.max(0, calls) * 0.01;
}

export function textRateSummary(model: string): TextRates | undefined {
  const rates = ratesFor(model, TEXT_RATES_PER_MILLION);
  return rates ? { ...rates } : undefined;
}

export function transcriptionRatePerMinute(model: string): number | undefined {
  return ratesFor(model, TRANSCRIPTION_USD_PER_MINUTE);
}
