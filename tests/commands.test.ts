import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/commands.js";

const prefixes = {
  chat: "!bot",
  web: "!web",
  image: "!image",
  models: "!models",
};

describe("parseCommand", () => {
  it("parses chat commands case-insensitively", () => {
    expect(parseCommand("  !BOT What time is it? ", prefixes)).toEqual({
      kind: "chat",
      prompt: "What time is it?",
    });
  });

  it("parses image commands", () => {
    expect(parseCommand("!image a fox in snow", prefixes)).toEqual({
      kind: "image",
      prompt: "a fox in snow",
    });
  });

  it("parses forced web-search commands", () => {
    expect(parseCommand("!web latest AI news", prefixes)).toEqual({
      kind: "web",
      prompt: "latest AI news",
    });
  });

  it("parses the models command only as an exact match", () => {
    expect(parseCommand("!models", prefixes)).toEqual({ kind: "models" });
    expect(parseCommand("!models now", prefixes)).toBeUndefined();
  });

  it("does not trigger on a partial prefix", () => {
    expect(parseCommand("!botany facts", prefixes)).toBeUndefined();
  });

  it("supports natural voice prefixes", () => {
    expect(
      parseCommand("Hey bot explain gravity", {
        chat: "hey bot",
        image: "create image",
      }),
    ).toEqual({ kind: "chat", prompt: "explain gravity" });
  });

  it("can treat unprefixed self-chat messages as chat prompts", () => {
    expect(parseCommand("How is my day looking?", prefixes, true)).toEqual({
      kind: "chat",
      prompt: "How is my day looking?",
    });
    expect(parseCommand("How is my day looking?", prefixes)).toBeUndefined();
  });
});
