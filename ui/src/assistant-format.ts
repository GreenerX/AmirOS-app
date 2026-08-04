export type AssistantAnswerBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

export function parseAssistantAnswer(answer: string): AssistantAnswerBlock[] {
  const lines = answer
    .replace(/\*\*([^*]+)\*\*(?=\S)/g, "**$1** ")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)(?=\S)/g, "*$1* ")
    .split(/\r?\n/);
  const blocks: AssistantAnswerBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "list", items: list });
    list = [];
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const listItem = line.match(/^(?:[-•]\s+|\d+[.)]\s+)(.+)$/u)?.[1]?.trim();
    if (listItem) {
      flushParagraph();
      list.push(listItem);
      continue;
    }
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}
