export type BotCommand =
  | { kind: "chat"; prompt: string }
  | { kind: "web"; prompt: string }
  | { kind: "image"; prompt: string }
  | { kind: "models" };

export type CommandPrefixes = {
  chat: string;
  web?: string;
  image: string;
  models?: string;
};

function parsePrefixed(input: string, prefix: string): string | undefined {
  const normalizedInput = input.trim();
  const normalizedPrefix = prefix.trim();
  if (!normalizedInput.toLowerCase().startsWith(normalizedPrefix.toLowerCase())) {
    return undefined;
  }

  const nextCharacter = normalizedInput.at(normalizedPrefix.length);
  if (nextCharacter && !/\s/.test(nextCharacter)) return undefined;
  return normalizedInput.slice(normalizedPrefix.length).trim();
}

export function parseCommand(
  input: string,
  prefixes: CommandPrefixes,
  fallbackToChat = false,
): BotCommand | undefined {
  if (
    prefixes.models &&
    input.trim().toLowerCase() === prefixes.models.trim().toLowerCase()
  ) {
    return { kind: "models" };
  }

  const imagePrompt = parsePrefixed(input, prefixes.image);
  if (imagePrompt !== undefined) return { kind: "image", prompt: imagePrompt };

  if (prefixes.web) {
    const webPrompt = parsePrefixed(input, prefixes.web);
    if (webPrompt !== undefined) return { kind: "web", prompt: webPrompt };
  }

  const chatPrompt = parsePrefixed(input, prefixes.chat);
  if (chatPrompt !== undefined) return { kind: "chat", prompt: chatPrompt };

  const fallbackPrompt = input.trim();
  if (fallbackToChat && fallbackPrompt) {
    return { kind: "chat", prompt: fallbackPrompt };
  }

  return undefined;
}
