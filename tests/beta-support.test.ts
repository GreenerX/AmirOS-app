import { describe, expect, it } from "vitest";
import { betaSupportQuestions, buildBetaSupportReport, highLevelConnection, safeSupportText, supportAction, validationError } from "../ui/src/beta-support.js";

const draft = { category: "Bug" as const, featureArea: "Overview", trying: "Open the agenda", happened: "The card did not open", expected: "The event opens", includeDiagnostics: false };

describe("beta support report", () => {
  it("validates the two required tester fields", () => {
    expect(validationError({ ...draft, trying: "" })).toMatch(/trying/i);
    expect(validationError({ ...draft, happened: "" })).toMatch(/happened/i);
    expect(validationError(draft)).toBeUndefined();
  });

  it("prefers a configured email draft, then a support URL, then a transparent copy fallback", () => {
    expect(supportAction({ url: "https://support.example.com", email: "beta@example.com" })).toBe("email");
    expect(supportAction({ url: "https://support.example.com" })).toBe("url");
    expect(supportAction({})).toBe("copy");
  });

  it("uses short, category-specific questions instead of one generic report form", () => {
    expect(betaSupportQuestions.Bug.trying).toMatch(/trying to do/i);
    expect(betaSupportQuestions.Feedback.happened).toMatch(/like us to know/i);
    expect(betaSupportQuestions["Feature request"].trying).toMatch(/help with/i);
    expect(betaSupportQuestions["Setup help"].happened).toMatch(/stuck/i);
  });

  it("includes diagnostics only when explicitly supplied and limits them to safe metadata", () => {
    const withoutDiagnostics = buildBetaSupportReport(draft);
    expect(withoutDiagnostics).not.toContain("Basic technical details");
    const withDiagnostics = buildBetaSupportReport(draft, { version: "0.10.1", build: "abc123", timestamp: "2026-08-15T12:00:00.000Z", browser: "macOS · Chrome", connection: highLevelConnection("authenticated"), featureArea: "Overview" });
    expect(withDiagnostics).toContain("Basic technical details (opt-in)");
    expect(withDiagnostics).toContain("Connection: disconnected");
    expect(withDiagnostics).not.toContain("authenticated");
    expect(withDiagnostics).not.toContain("connectionDetail");
  });

  it("redacts keys, sensitive files, QR references, and chat identifiers", () => {
    const safe = safeSupportText("sk-super_secret_key_123456789 .env.local .wwebjs_auth amiros-state.json WhatsApp QR 123456789@c.us");
    expect(safe).not.toContain("super_secret");
    expect(safe).not.toContain(".env.local");
    expect(safe).not.toContain(".wwebjs_auth");
    expect(safe).not.toContain("amiros-state.json");
    expect(safe).not.toContain("123456789@c.us");
    expect(safe).toContain("[redacted");
  });

  it("does not claim that a report was sent", () => {
    expect(buildBetaSupportReport(draft)).not.toMatch(/\bsent\b/i);
  });
});
