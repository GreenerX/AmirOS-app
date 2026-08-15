import type { DashboardData, ViewName } from "./types";

export const BETA_SUPPORT_CATEGORIES = ["Bug", "Feedback", "Feature request", "Setup help"] as const;
export type BetaSupportCategory = (typeof BETA_SUPPORT_CATEGORIES)[number];

export type BetaSupportDraft = {
  category: BetaSupportCategory;
  featureArea: string;
  trying: string;
  happened: string;
  expected: string;
  includeDiagnostics: boolean;
};

export type BetaSupportDiagnostics = {
  version: string;
  build?: string;
  timestamp: string;
  browser: string;
  connection: "ready" | "qr" | "disconnected";
  featureArea: string;
};

export const betaSupportQuestions: Record<BetaSupportCategory, { title: string; description: string; trying: string; happened: string; expected?: string }> = {
  Bug: { title: "Report a problem", description: "A few details help us reproduce the problem.", trying: "What were you trying to do?", happened: "What happened instead?", expected: "What did you expect?" },
  Feedback: { title: "Share feedback", description: "Tell us what is working well or what could feel better.", trying: "What were you using?", happened: "What would you like us to know?" },
  "Feature request": { title: "Request a feature", description: "Describe the outcome that would make AmirOS more useful for you.", trying: "What would you like AmirOS to help with?", happened: "How would this help you?" },
  "Setup help": { title: "Get setup help", description: "Tell us where you are in setup and what is getting in the way.", trying: "What are you trying to set up?", happened: "Where are you stuck?" },
};

const sensitivePatterns: Array<[RegExp, string]> = [
  [/\bsk-[a-z0-9_-]{8,}\b/giu, "[redacted API key]"],
  [/(?:\.env(?:\.local)?|amiros-state\.json|\.wwebjs_auth|whatsapp(?:\s+web)?\s+session)/giu, "[redacted sensitive file]"],
  [/\b(?:qr\s*code|whatsapp\s+qr)\b/giu, "[redacted QR reference]"],
  [/\b\d{5,}@(?!example\.com\b)[a-z]+\.us\b/giu, "[redacted chat reference]"],
];

export function safeSupportText(value: string, limit = 1_500): string {
  return sensitivePatterns.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value.trim().slice(0, limit),
  );
}

export function validationError(draft: BetaSupportDraft): string | undefined {
  const questions = betaSupportQuestions[draft.category];
  if (!draft.trying.trim()) return `Please answer: ${questions.trying}`;
  if (!draft.happened.trim()) return `Please answer: ${questions.happened}`;
  return undefined;
}

export function supportAction(destination: DashboardData["betaSupport"]): "url" | "email" | "copy" {
  return destination.email ? "email" : destination.url ? "url" : "copy";
}

export function highLevelConnection(status: DashboardData["connection"]["status"]): BetaSupportDiagnostics["connection"] {
  return status === "ready" ? "ready" : status === "qr" ? "qr" : "disconnected";
}

export function featureAreaForView(view: ViewName): string {
  return ({
    overview: "Overview",
    intelligence: "People",
    calendar: "Calendar",
    inbox: "Inbox",
    contacts: "Contacts",
    automations: "Automations",
    usage: "Usage",
    terminal: "Terminal",
    settings: "Settings",
  } satisfies Record<ViewName, string>)[view];
}

export function browserLabel(userAgent: string): string {
  const system = /Mac OS X/i.test(userAgent) ? "macOS" : /Windows/i.test(userAgent) ? "Windows" : /Linux/i.test(userAgent) ? "Linux" : "Unknown device";
  const browser = /Edg\//i.test(userAgent) ? "Edge" : /Chrome\//i.test(userAgent) ? "Chrome" : /Safari\//i.test(userAgent) ? "Safari" : "Browser";
  return `${system} · ${browser}`;
}

export function buildBetaSupportReport(draft: BetaSupportDraft, diagnostics?: BetaSupportDiagnostics): string {
  const lines = [
    "AmirOS beta feedback",
    `Category: ${draft.category}`,
    `Feature area: ${safeSupportText(draft.featureArea, 80)}`,
    "",
    "What I was trying to do:",
    safeSupportText(draft.trying),
    "",
    "What happened:",
    safeSupportText(draft.happened),
  ];
  if (draft.expected.trim()) lines.push("", "What I expected:", safeSupportText(draft.expected));
  lines.push("", "Screenshot: Attach one to this email if it would help explain the issue.");
  if (diagnostics) {
    lines.push("", "Basic technical details (opt-in):", `AmirOS version: ${diagnostics.version}`, `Build: ${diagnostics.build || "Not available"}`, `Time: ${diagnostics.timestamp}`, `Device: ${diagnostics.browser}`, `Connection: ${diagnostics.connection}`, `Selected area: ${diagnostics.featureArea}`);
  }
  lines.push("", "Privacy note: This report never automatically includes API keys, WhatsApp access files, QR codes, conversations, contacts, saved AmirOS data, or full activity records.");
  return lines.join("\n");
}
