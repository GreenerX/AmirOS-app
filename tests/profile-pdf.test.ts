import { describe, expect, it } from "vitest";
import {
  generateContactProfilePdf,
  safePdfFilename,
} from "../src/profile-pdf.js";

describe("contact profile PDF export", () => {
  it("creates safe, descriptive download names", () => {
    expect(safePdfFilename("Sana Farooq / Sales")).toBe(
      "AmirOS-profile-sana-farooq-sales.pdf",
    );
    expect(safePdfFilename("שלום")).toBe("AmirOS-profile-contact.pdf");
  });

  it("creates a valid PDF from saved profile data", async () => {
    const pdf = await generateContactProfilePdf({
      contactName: "Sana Farooq",
      contact: {
        mode: "suggest",
        relationship: "Client",
        tone: "Warm & concise",
        language: "English",
        pronouns: "unspecified",
        memoryEnabled: true,
        knowledgeTracking: "enabled",
        customInstructions: "Keep pricing updates brief.",
        ownerTriggerAccess: ["knowledge", "calendar"],
        contactTriggerAccess: [],
      },
      profile: {
        summary: "Relationship\n• Trusted client relationship.\n\nCommunication style\n• Direct, practical, and deadline-focused.\n\nPreferences & important facts\n• Prefers concise updates and Thursday deliveries.",
        updatedAt: Date.UTC(2026, 7, 1, 10, 30),
        sourceMessageCount: 14,
      },
      manualMemory: [
        {
          id: "memory-1",
          content: "Send delivery updates before noon.",
          createdAt: Date.UTC(2026, 6, 31),
        },
      ],
      isGroup: false,
      insights: [{
        id: "insight-1", kind: "preference", content: "Prefers concise updates.", status: "confirmed", confidence: 0.91,
        evidence: { excerpt: "Please keep the update short.", senderName: "Sana", timestamp: Date.UTC(2026, 6, 31) },
        createdAt: Date.UTC(2026, 6, 31), updatedAt: Date.UTC(2026, 6, 31),
      }],
      commitments: [],
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2_000);
  });
});
