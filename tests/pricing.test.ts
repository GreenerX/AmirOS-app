import { describe, expect, it } from "vitest";
import {
  imageCostUsd,
  textCostUsd,
  transcriptionCostUsd,
  webSearchCostUsd,
} from "../src/pricing.js";

describe("official OpenAI pricing calculations", () => {
  it("prices the three text presets per million tokens", () => {
    expect(textCostUsd("gpt-5.6-luna", 1_000_000, 1_000_000)).toBeCloseTo(1.4);
    expect(textCostUsd("gpt-5.6-terra", 1_000_000, 1_000_000)).toBeCloseTo(14);
    expect(textCostUsd("gpt-5.6-sol", 1_000_000, 1_000_000)).toBeCloseTo(35);
  });

  it("uses the discounted cached-input rate", () => {
    expect(textCostUsd("gpt-5.6-terra", 1_000_000, 0, 1_000_000)).toBeCloseTo(0.2);
  });

  it("prices web searches at one cent per call", () => {
    expect(webSearchCostUsd(7)).toBeCloseTo(0.07);
  });

  it("prices transcription by measured duration", () => {
    expect(transcriptionCostUsd("gpt-4o-mini-transcribe", 120)).toBeCloseTo(0.006);
    expect(transcriptionCostUsd("gpt-transcribe", 120)).toBeCloseTo(0.009);
  });

  it("uses image token usage when returned", () => {
    expect(
      imageCostUsd("gpt-image-2", "low", {
        inputTextTokens: 100,
        inputImageTokens: 0,
        outputTokens: 196,
      }),
    ).toBeCloseTo(0.00638);
  });

  it("falls back to the published square-image estimate", () => {
    expect(imageCostUsd("gpt-image-2", "low")).toBeCloseTo(0.006);
    expect(imageCostUsd("gpt-image-1-mini", "high")).toBeCloseTo(0.036);
  });
});
