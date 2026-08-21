import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { commitmentCoversReply, commitmentPresentation, compactRelationshipItemTitle, conciseTopicLabel, isOwnerContact, isRelationshipCommitmentNoise, normalizeTopicTitle, ownerPerspectiveSummary, personSummary, relationshipItemTemporalText, topicLabelQuality, topicTitleForInsight } from "../ui/src/components/PeopleExperience.js";
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

  it("describes contact relationships from the owner's perspective", () => {
    expect(ownerPerspectiveSummary("Dani is Amir Friedman's partner. Amir and Dani live in Tel Aviv.", "Amir Friedman"))
      .toBe("Dani is your partner. You and Dani live in Tel Aviv.");
    expect(ownerPerspectiveSummary("Dani says Amir is reliable.", "Amir Friedman"))
      .toBe("Dani says you are reliable.");
    expect(personSummary({
      contactName: "Dani", isGroup: false,
      profile: { summary: "Dani is Amir's partner and close friend.", updatedAt: 1, sourceMessageCount: 2 },
    } as IntelligenceChat, "Amir Friedman")).toBe("Dani is your partner and close friend.");
  });

  it("surfaces a newer autonomously confirmed current fact before an older profile is regenerated", () => {
    const contact = {
      contactName: "Dani",
      isGroup: false,
      profile: {
        summary: "Dani is Amir's partner and they live in Tel Aviv.",
        updatedAt: 100,
        sourceMessageCount: 2,
      },
      insights: [{
        id: "new-york", kind: "fact", content: "Dani lives in New York.", canonicalKey: "residence",
        validity: "current", evolution: "replace", status: "confirmed", confidence: .98,
        autonomouslyConfirmedAt: 200, autonomousConfirmationReason: "direct_contact_statement",
        evidence: { excerpt: "I moved to New York.", timestamp: 200 }, createdAt: 200, updatedAt: 200,
      }],
    } as IntelligenceChat;

    expect(personSummary(contact, "Amir Friedman")).toContain("Dani lives in New York.");
    expect(personSummary(contact, "Amir Friedman")).not.toContain("Tel Aviv");
  });

  it("never lets stale generated profile prose override current canonical truth", () => {
    const contact = {
      contactName: "David",
      isGroup: false,
      profile: {
        summary: "David works at Apple and enjoys the team.",
        updatedAt: 300,
        sourceMessageCount: 2,
        staleAt: 400,
        staleReason: "canonical_knowledge_changed",
      },
      insights: [{
        id: "anthropic", kind: "fact", content: "David works at Anthropic.", canonicalKey: "employer",
        validity: "current", evolution: "replace", status: "confirmed", confidence: .98,
        evidence: { excerpt: "I joined Anthropic.", timestamp: 200 }, createdAt: 200, updatedAt: 200,
      }],
    } as IntelligenceChat;

    expect(personSummary(contact, "Amir Friedman")).toBe("David works at Anthropic.");
    expect(personSummary(contact, "Amir Friedman")).not.toContain("Apple");
  });

  it("shows evidence time and due date for relationship follow-ups", () => {
    const temporalText = relationshipItemTemporalText({
      evidence: { messageId: "message-1", excerpt: "Please send the details.", timestamp: 1_786_000_000_000 },
      dueAt: 1_786_100_000_000,
    });

    expect(temporalText).toContain("from");
    expect(temporalText).toContain("due");
  });

  it("projects long commitments into a concise title and supporting detail", () => {
    expect(commitmentPresentation("Bring Amir a sandwich when returning, from any place...")).toEqual({
      title: "Bring Amir a sandwich",
      detail: "When returning from any place.",
    });
    expect(commitmentPresentation("Call Dani")).toEqual({ title: "Call Dani", detail: undefined });
    expect(commitmentPresentation("Last login: Fri Aug 7 on ttys001 The default interactive shell is now zsh. Updating AmirOS...")).toEqual({
      title: "Review shared terminal output",
      detail: "A terminal log was shared in this conversation.",
    });
  });

  it("keeps pasted terminal output out of relationship commitments", () => {
    expect(isRelationshipCommitmentNoise({
      content: "Last login: Thu Aug 6 on ttys000 The default interactive shell is now zsh. ChromeLauncher.launch failed.",
      evidence: { excerpt: "Pasted terminal output", timestamp: 1 },
    })).toBe(true);
    expect(isRelationshipCommitmentNoise({
      content: "Bring Dani a cappuccino",
      evidence: { excerpt: "Can you bring me coffee?", timestamp: 1 },
    })).toBe(false);
  });

  it("normalizes and safely shortens titles for compact cards", () => {
    expect(compactRelationshipItemTitle("  Book   dinner  , tomorrow ")).toBe("Book dinner, tomorrow");
    expect(compactRelationshipItemTitle("Discuss the detailed summer travel itinerary and confirm every reservation with the entire family before departure", 54)).toBe("Discuss the detailed summer travel itinerary and…");
  });

  it("keeps the reply follow-up projection free of a matching commitment duplicate", () => {
    expect(commitmentCoversReply([
      { id: "photos", content: "Send Dani the photos", owner: "me", status: "open", evidence: { excerpt: "Please send the photos", timestamp: 1 }, createdAt: 1, updatedAt: 1 },
    ], "Can you send Dani the photos?")).toBe(true);
    expect(commitmentCoversReply([
      { id: "photos", content: "Send Dani the photos", owner: "me", status: "open", evidence: { excerpt: "Please send the photos", timestamp: 1 }, createdAt: 1, updatedAt: 1 },
    ], "Can you call me tomorrow?")).toBe(false);
  });

  it("creates semantic noun-phrase topic labels for the real QA examples", () => {
    expect(conciseTopicLabel("Amir and Michal agreed to try to sit together this week.")).toBe("Meeting This Week");
    expect(conciseTopicLabel("Michal is considering joining Amir for a flamenco event at the Lighthouse.")).toBe("Flamenco Night");
    expect(conciseTopicLabel("Amir is temporarily caring for a female puppy and invited Michal to visit and play with her.")).toBe("Puppy Visit");
    expect(conciseTopicLabel("Michal has not been to Lolita in a long time.")).toBe("Lolita Restaurant");
    expect(conciseTopicLabel("Michal likes the check-in-a-bowl dish at Lolita and is curious about the burrito.")).toBe("Burrito at Lolita");
    expect(conciseTopicLabel("Michal said she has been going through a difficult few weeks.")).toBe("Personal Check-in");
    expect(conciseTopicLabel("Dani is considering a long trip to Italy. They are deciding dates with Amir.")).toBe("Trip to Italy");
    expect(conciseTopicLabel("Amir Friedman wants Dani Faitelson to remember to check the security camera.")).toBe("Security Camera");
    expect(conciseTopicLabel("Dani Faitelson expressed pride in Amir Friedman's work project.")).toBe("Work Project");
    expect(conciseTopicLabel("They talked about the scooter reservation.")).toBe("Scooter Reservation");
    expect(conciseTopicLabel("Dani Faitelson is checking for tickets to the Spider-Man iMax outing.")).toBe("Spider-Man IMAX Outing");
    expect(conciseTopicLabel("Dani Faitelson agreed that Andrew Friedman can bring Devorah.")).toBe("Devorah Visit");
    expect(conciseTopicLabel("Dani Faitelson and Karen Faitelson expressed enthusiasm about Amir Friedman's new project.")).toBe("New Project");
    expect(conciseTopicLabel("Dani Faitelson lives or spends time in 37A, where poodles were playing.")).toBe("Poodles at 37A");
    expect(conciseTopicLabel("Amir affectionately reassured Dani that she could read it later if needed.")).toBe("");
    expect(topicLabelQuality("Security Camera")).toBeGreaterThanOrEqual(0.7);
    expect(topicLabelQuality("And Dedication to It")).toBe(0);
    expect(topicLabelQuality("Is Curious Trying Burrito")).toBe(0);
    expect(topicLabelQuality("Going Difficult Few Weeks")).toBe(0);
    expect(topicLabelQuality("To Sit Together Week")).toBe(0);
    expect(topicLabelQuality("Excitement and Dedication Inspiring")).toBe(0);
    expect(normalizeTopicTitle("Burrito at Lolita.")).toBe("Burrito at Lolita");
  });

  it("prefers a confident AI topic title and suppresses weak AI output", () => {
    expect(topicTitleForInsight({ content: "Original insight remains intact.", topicTitle: "Puppy Visit", topicTitleConfidence: 0.94 })).toBe("Puppy Visit");
    expect(topicTitleForInsight({ content: "Original insight remains intact.", topicTitle: "To Sit Together Week", topicTitleConfidence: 0.94 })).toBe("");
    expect(topicTitleForInsight({ content: "Original insight remains intact.", topicTitle: "Useful Topic", topicTitleConfidence: 0.62 })).toBe("");
  });

  it("uses the existing relationship records for the directory and selected contact view", async () => {
    const [people, intelligence, sidebar, styles, dashboard] = await Promise.all([
      readFile(new URL("../ui/src/components/PeopleExperience.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/components/IntelligenceView.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/components/Sidebar.tsx", import.meta.url), "utf8"),
      readFile(new URL("../ui/src/styles.css", import.meta.url), "utf8"),
      readFile(new URL("../src/dashboard.ts", import.meta.url), "utf8"),
    ]);
    expect(people).toContain("Coming up together");
    expect(people).toContain("What needs your attention");
    expect(people).toContain("What AmirOS knows now");
    expect(people).toContain("Earlier context");
    expect(people).toContain("Conversation timeline");
    expect(people).toContain("They’re following up");
    expect(people).toContain("data?.todos || []");
    expect(people).toContain("!isOwnerContact(person, ownerName)");
    expect(people).toContain("people-relationship-picker");
    expect(people).toContain("label=\"Favorites\"");
    expect(people).toContain("people-card-visibility");
    expect(people).toContain('className="page-header compact-header people-page-header"');
    expect(people).toContain("Generate summary");
    expect(people).toContain("filter === \"hidden\"");
    expect(people).toContain("interactionTimestamp");
    expect(people).toContain('item.owner === "me"');
    expect(people).toContain('item.owner !== "me"');
    expect(people).toContain("topicTitleForInsight(item)");
    expect(people).toContain('"needs_review"');
    expect(people).toContain("Needs review");
    expect(people).toContain("RelationshipCommitmentItem");
    expect(people).toContain("EvidenceHistory");
    expect(people).toContain("MemoryExplanationPanel");
    expect(people).toContain("How AmirOS knows this");
    expect(people).toContain('className="relationship-item-disclosure"');
    expect(people).toContain("Supporting evidence");
    expect(people).toContain("relationship-status-badge");
    expect(people).toContain("contact-topic-item");
    expect(people).toContain("contact-intelligence-priority-grid");
    expect(people).toContain("contact-intelligence-name-row");
    expect(people).toContain("isRelationshipCommitmentNoise");
    expect(people).toContain("contact-item-remove");
    expect(people).toContain("onCommitmentStatus");
    expect(styles).toContain("contact-intelligence-priority-grid");
    expect(styles).toContain(".contact-memory-history");
    expect(styles).toContain("overflow: visible; overscroll-behavior: auto");
    expect(styles).toContain("padding: 34px 37px 56px");
    expect(styles).toContain(".contact-item-list > article.relationship-commitment-item.needs-review");
    expect(styles).toContain(".relationship-evidence");
    expect(styles).toContain(".memory-explanation");
    expect(styles).toContain(".floating-ai-memory-explanation");
    expect(styles).toContain("Shared functional-page rhythm");
    expect(styles).toContain("font-size: 34px");
    expect(dashboard).toContain('commitment.status === "open" || commitment.status === "needs_review"');
    expect(intelligence).toContain('if (activeTab === "people") return <PeopleExperience');
    expect(sidebar).toContain('label: "People"');
  });
});
