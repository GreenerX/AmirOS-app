import { json } from "./http";

export const supportTicketTypes = new Set(["Bug", "Feedback", "Feature request", "Setup help"]);

export type SupportTicketInput = {
  type: "Bug" | "Feedback" | "Feature request" | "Setup help";
  subject: string;
  details: string;
};

/** Only explicit user-written text is accepted; no local diagnostics are attached implicitly. */
export function parseSupportTicket(value: unknown): SupportTicketInput | Response {
  if (!value || typeof value !== "object") return json({ message: "Enter a support type, subject, and details." }, 400);
  const input = value as Record<string, unknown>;
  if (
    typeof input.type !== "string"
    || !supportTicketTypes.has(input.type)
    || typeof input.subject !== "string"
    || typeof input.details !== "string"
  ) return json({ message: "Enter a support type, subject, and details." }, 400);

  const subject = input.subject.trim();
  const details = input.details.trim();
  if (!subject || subject.length > 140 || !details || details.length > 6_000) {
    return json({ message: "Keep the subject under 140 characters and details under 6,000 characters." }, 400);
  }
  return { type: input.type as SupportTicketInput["type"], subject, details };
}
