import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, normalizeOpenAiApiKey, saveOpenAiApiKey } from "../src/config.js";

describe("model presets", () => {
  it("uses economy by default", () => {
    const config = loadConfig({ OPENAI_API_KEY: "test" });
    expect(config.modelPresetName).toBe("economy");
    expect(config.openaiTextModel).toBe("gpt-5.6-luna");
    expect(config.openaiImageModel).toBe("gpt-image-1-mini");
    expect(config.openaiTranscribeModel).toBe("gpt-4o-mini-transcribe");
    expect(config.botInstructions).toMatch(/ends of sentences or paragraphs/);
    expect(config.webSearchEnabled).toBe(true);
    expect(config.webSearchContextSize).toBe("low");
    expect(config.autoReplySelfChat).toBe(true);
    expect(config.allowOutgoingTriggerCommands).toBe(true);
  });

  it("can disable outgoing trigger commands without affecting incoming routing", () => {
    const config = loadConfig({
      OPENAI_API_KEY: "test",
      ALLOW_OUTGOING_TRIGGER_COMMANDS: "false",
    });
    expect(config.allowOutgoingTriggerCommands).toBe(false);
  });

  it("supports a preset with individual overrides", () => {
    const config = loadConfig({
      OPENAI_API_KEY: "test",
      OPENAI_MODEL_PRESET: "balanced",
      OPENAI_TEXT_MODEL: "custom-text-model",
      OPENAI_TEXT_MAX_OUTPUT_TOKENS: "250",
    });
    expect(config.modelPresetName).toBe("balanced");
    expect(config.openaiTextModel).toBe("custom-text-model");
    expect(config.openaiImageModel).toBe("gpt-image-2");
    expect(config.openaiTextMaxOutputTokens).toBe(250);
  });

  it("rejects unknown presets", () => {
    expect(() =>
      loadConfig({ OPENAI_API_KEY: "test", OPENAI_MODEL_PRESET: "unlimited" }),
    ).toThrow(/economy, balanced, or quality/);
  });

  it("normalizes and validates the public AmirOS calendar origin", () => {
    expect(loadConfig({
      OPENAI_API_KEY: "test",
      AMIROS_PUBLIC_URL: "https://amiros.example.com/",
    }).amirosPublicUrl).toBe("https://amiros.example.com");
    expect(() => loadConfig({
      OPENAI_API_KEY: "test",
      AMIROS_PUBLIC_URL: "webcal://amiros.example.com",
    })).toThrow(/valid http or https URL/);
  });

  it("accepts a safe beta support destination and validates its optional email fallback", () => {
    expect(loadConfig({ OPENAI_API_KEY: "test", AMIROS_BETA_SUPPORT_URL: "https://support.example.com/amiros/" }).betaSupportUrl).toBe("https://support.example.com/amiros");
    expect(loadConfig({ OPENAI_API_KEY: "test", AMIROS_BETA_SUPPORT_EMAIL: "beta@example.com" }).betaSupportEmail).toBe("beta@example.com");
    expect(() => loadConfig({ OPENAI_API_KEY: "test", AMIROS_BETA_SUPPORT_URL: "http://support.example.com" })).toThrow(/https URL/);
    expect(() => loadConfig({ OPENAI_API_KEY: "test", AMIROS_BETA_SUPPORT_URL: "https://support.example.com/?token=secret" })).toThrow(/query parameters/);
  });

  it("stores a customer key only in the local env file and replaces an existing value", () => {
    const directory = mkdtempSync(join(tmpdir(), "amiros-config-test-"));
    const envPath = join(directory, ".env.local");
    const key = "sk-test_customer_key_1234567890";
    try {
      saveOpenAiApiKey(key, envPath);
      saveOpenAiApiKey("sk-test_replaced_key_1234567890", envPath);
      const saved = readFileSync(envPath, "utf8");
      expect(saved).toContain("OPENAI_API_KEY=sk-test_replaced_key_1234567890");
      expect(saved).not.toContain("customer_key");
      expect(existsSync(envPath)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects values that are not OpenAI API keys", () => {
    expect(() => normalizeOpenAiApiKey("not-a-key")).toThrow(/doesn't look/i);
  });
});
