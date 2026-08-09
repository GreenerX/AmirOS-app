import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { isOwnerContact, personSummary } from "../ui/src/components/PeopleExperience.js";
import type { IntelligenceChat } from "../ui/src/types.js";

describe("People experience", () => {
  it("keeps the owner out of the directory and limits summaries to relationship context", () => {
    const owner = {
      contactName: "Amir Friedman",
      isGroup: false,
    } as IntelligenceChat;
    const contact = {
      contactName: "Dani",
      isGroup: false,
      profile: {
        summary: "Relationship\n• Amir Friedman is a best friend.\n• Dani is a close friend who checks in regularly.\n\nPreferences & important facts\n• Dani prefers coffee after 10 AM.",
        updatedAt: 1,
        sourceMessageCount: 2,
      },
    } as IntelligenceChat;

    expect(isOwnerContact(owner, "Amir Friedman")).toBe(true);
    expect(personSummary(contact, "Amir Friedman")).toBe("Dani is a close friend who checks in regularly.");
  });

  it("uses the existing relationship records for the directory and selected contact view", async () => {
    const [people, intelligence, sidebar] = await Promise.all([
      readFile(new URL("../ui/src/components/PeopleExperience.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/components/IntelligenceView.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/components/Sidebar.tsx", import.meta.url), "utf8"),
    ]);
    expect(people).toContain("Upcoming plans");
    expect(people).toContain("Open commitments");
    expect(people).toContain("Conversation timeline");
    expect(people).toContain("Follow-ups from them");
    expect(people).toContain("Your follow-ups");
    expect(people).toContain("data?.todos || []");
    expect(people).toContain("!isOwnerContact(person, ownerName)");
    expect(people).toContain("people-relationship-picker");
    expect(people).toContain("label=\"Favorites\"");
    expect(people).toContain("people-card-visibility");
    expect(people).toContain("Generate summary");
    expect(people).toContain("filter === \"hidden\"");
    expect(people).toContain("interactionTimestamp");
    expect(intelligence).toContain('if (activeTab === "people") return <PeopleExperience');
    expect(sidebar).toContain('label: "People"');
  });
});
