export type WhatsAppFormatOptions = {
  ensureEmoji?: boolean;
  emojiFallback?: string;
  removeParenthesizedLinks?: boolean;
};

const emojiPattern = /\p{Extended_Pictographic}/u;
const leadingEmojiPattern = /^((?:\p{Extended_Pictographic}(?:\uFE0F|\u200D|\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*)+)(\S[\s\S]*)$/u;

export function formatWhatsAppText(
  input: string,
  options: WhatsAppFormatOptions = {},
): string {
  const {
    ensureEmoji = true,
    emojiFallback = "✨",
    removeParenthesizedLinks = false,
  } = options;

  let text = input.replace(/\r\n?/g, "\n");

  if (removeParenthesizedLinks) {
    text = text.replace(
      /\s*\(\[([^\]]+)]\((https?:\/\/[^)\s]+)\)\)/g,
      "",
    );
  }

  text = text
    .replace(/!\[([^\]]*)]\((https?:\/\/[^)\s]+)\)/g, "$1")
    .replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, "$1")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/__([^_\n]+)__/g, "*$1*")
    .replace(/^[ \t]*[-*][ \t]+/gm, "• ")
    .replace(/^[ \t]*_{3,}[ \t]*$/gm, "")
    .replace(/^[ \t]*-{3,}[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const leadingEmoji = text.match(leadingEmojiPattern);
  const leadingEmojiBody = leadingEmoji?.[2];
  const leadingEmojiCluster = leadingEmoji?.[1];
  if (leadingEmojiBody && leadingEmojiCluster) {
    text = `${leadingEmojiBody.trim()} ${leadingEmojiCluster.trim()}`;
  } else if (ensureEmoji && text && !emojiPattern.test(text)) {
    text = `${text} ${emojiFallback}`;
  }
  return text;
}

export function cleanSourceUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}
