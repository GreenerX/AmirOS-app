import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("People experience", () => {
  it("uses the existing relationship records for the directory and selected contact view", async () => {
    const [people, intelligence, sidebar] = await Promise.all([
      readFile(new URL("../ui/src/components/PeopleExperience.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/components/IntelligenceView.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/components/Sidebar.tsx", import.meta.url), "utf8"),
    ]);
    expect(people).toContain("Upcoming plans");
    expect(people).toContain("Open commitments");
    expect(people).toContain("Conversation timeline");
    expect(people).toContain("Waiting on them");
    expect(people).toContain("Waiting on me");
    expect(people).toContain("data?.todos || []");
    expect(intelligence).toContain('if (activeTab === "people") return <PeopleExperience');
    expect(sidebar).toContain('label: "People"');
  });
});
