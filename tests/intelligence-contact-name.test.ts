import { describe, expect, it } from "vitest";
import { replaceIntelligencePhoneReferences, resolveIntelligenceContactName } from "../ui/src/intelligence-contact-name.js";

const chats = [{
  id: "73568545206377@c.us",
  name: "Noa Cohen",
  isGroup: false,
  unreadCount: 0,
  timestamp: 0,
  preview: "",
  mode: "auto" as const,
}];

describe("Intelligence contact names", () => {
  it("uses a known contact name instead of a WhatsApp phone handle", () => {
    expect(resolveIntelligenceContactName("@73568545206377", chats)).toBe("Noa Cohen");
    expect(replaceIntelligencePhoneReferences("@73568545206377 is celebrating today", chats)).toBe("Noa Cohen is celebrating today");
  });

  it("keeps an unknown handle readable without inventing a name", () => {
    expect(resolveIntelligenceContactName("@1234567890", chats)).toBe("1234567890");
  });
});
