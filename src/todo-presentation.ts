export type TodoPriority = "low" | "normal" | "high";

export type TodoPresentation = {
  title: string;
  priority: TodoPriority;
  emoji: string;
};

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * Preserve the priority as structured data instead of letting wording such as
 * “low priority” leak into the owner-facing task title.
 */
export function todoPriorityFromText(value: string): TodoPriority {
  const text = value.toLocaleLowerCase();
  if (/\b(?:low[- ]priority|low priority|not urgent|whenever)\b|(?:לא דחוף|בעדיפות נמוכה)/iu.test(text)) return "low";
  if (/\b(?:urgent|urgently|asap|critical|high[- ]priority|high priority)\b|(?:דחוף|בעדיפות גבוהה)/iu.test(text)) return "high";
  return "normal";
}

export function normalizeTodoPriority(value: unknown, source = ""): TodoPriority {
  const detected = todoPriorityFromText(source);
  // A clear priority in the owner's own words is safer than an accidental
  // generic “normal” from a model response.
  if (detected !== "normal") return detected;
  if (value === "low" || value === "high") return value;
  return "normal";
}

export function defaultTodoEmoji(value: string): string {
  const text = value.normalize("NFKC").toLocaleLowerCase();
  if (/\b(?:watermelon)\b/iu.test(text)) return "🍉";
  if (/\b(?:melon)\b/iu.test(text)) return "🍈";
  if (/\b(?:dog|dogs|walk the dog)\b|(?:כלב)/iu.test(text)) return "🐕";
  if (/\b(?:buy|shop|shopping|grocery|groceries|market)\b|(?:לקנות|קניות)/iu.test(text)) return "🛒";
  if (/\b(?:call|phone|ring)\b|(?:להתקשר)/iu.test(text)) return "📞";
  if (/\b(?:email|message|reply|text|follow[- ]?up)\b|(?:מייל|להשיב|הודעה)/iu.test(text)) return "💬";
  if (/\b(?:pay|payment|bill|invoice)\b|(?:לשלם|תשלום|חשבון)/iu.test(text)) return "💳";
  if (/\b(?:doctor|dentist|therapy|medical)\b|(?:רופא|רופאה|רופא שיניים|טיפול)/iu.test(text)) return "🩺";
  if (/\b(?:book|flight|travel|trip|hotel)\b|(?:להזמין|טיסה|נסיעה|מלון)/iu.test(text)) return "✈️";
  if (/\b(?:office|work|report|presentation)\b|(?:עבודה|משרד|דוח|מצגת)/iu.test(text)) return "💼";
  if (/\b(?:clean|laundry|home|house)\b|(?:לנקות|כביסה|בית)/iu.test(text)) return "🏠";
  return "✅";
}

function oneEmoji(value: string): string | undefined {
  return value.match(/\p{Extended_Pictographic}(?:\uFE0F|\u200D|\p{Emoji_Modifier}|\p{Extended_Pictographic})*/u)?.[0];
}

function cleanTitle(value: string): string {
  return compact(value)
    .replace(/\s+(?:[\p{Extended_Pictographic}\uFE0F\u200D]+)\s*$/gu, "")
    .replace(/\b(?:with\s+)?(?:low|medium|normal|high)[-\s]+priority\b/giu, "")
    .replace(/\b(?:urgent|urgently|asap|not urgent)\b/giu, "")
    .replace(/(?:בעדיפות\s+(?:נמוכה|גבוהה)|לא דחוף|דחוף)/giu, "")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/[\s,;:–—-]+$/u, "")
    .trim()
    .slice(0, 116);
}

/**
 * Turns either an AI result or a deterministic fallback into the one compact
 * title used by every to-do surface. The title always ends with one emoji and
 * never contains the task priority.
 */
export function presentTodo(input: {
  source: string;
  title: string;
  priority?: unknown;
  emoji?: string;
}): TodoPresentation {
  const title = cleanTitle(input.title) || cleanTitle(input.source) || "To-do";
  const emoji = oneEmoji(input.emoji || "") || oneEmoji(input.title) || defaultTodoEmoji(title || input.source);
  return {
    title: `${title} ${emoji}`,
    priority: normalizeTodoPriority(input.priority, input.source),
    emoji,
  };
}
