import { describe, expect, it } from "vitest";
import {
  isDisplayableWhatsAppChat,
  isKnownIntelligenceChat,
  isReplyWorthyIntelligenceMessage,
} from "../src/dashboard.js";

describe("WhatsApp conversation-list filtering", () => {
  it("removes group-participant pseudo-chats", () => {
    expect(isDisplayableWhatsAppChat({
      id: { _serialized: "209306725179617@lid" },
      isGroup: false,
      t: 0,
      lastMessage: { body: "Media message", remoteId: "120363395951768462@g.us" },
    })).toBe(false);
    expect(isDisplayableWhatsAppChat({
      id: { _serialized: "209306725179617@lid" },
      isGroup: false,
      t: 0,
      lastMessage: { body: "Media message", remoteId: "209306725179617@lid", t: 1_785_587_445 },
    })).toBe(false);
  });

  it("keeps real private and group conversations", () => {
    expect(isDisplayableWhatsAppChat({
      id: { _serialized: "97921009762349@lid" },
      isGroup: false,
      t: 1_785_591_056,
      lastMessage: { body: "Hello", remoteId: "97921009762349@lid" },
    })).toBe(true);
    expect(isDisplayableWhatsAppChat({
      id: { _serialized: "120363395951768462@g.us" },
      isGroup: true,
      t: 1_785_591_056,
      lastMessage: { body: "Hello", remoteId: "120363395951768462@g.us" },
    })).toBe(true);
  });

  it("removes status, broadcast, and unsupported cache collections", () => {
    expect(isDisplayableWhatsAppChat({ id: { _serialized: "status@broadcast" } })).toBe(false);
    expect(isDisplayableWhatsAppChat({ id: { _serialized: "123@newsletter" } })).toBe(false);
  });

  it("keeps unresolved and phone-number contacts out of Intelligence", () => {
    expect(isKnownIntelligenceChat("972501234567@c.us", "WhatsApp contact")).toBe(false);
    expect(isKnownIntelligenceChat("972501234567@c.us", "+972 50-123-4567")).toBe(false);
    expect(isKnownIntelligenceChat("123@newsletter", "Daily News")).toBe(false);
    expect(isKnownIntelligenceChat("972501234567@c.us", "Dani Faitelson")).toBe(true);
    expect(isKnownIntelligenceChat("120363395951768462@g.us", "Family plans")).toBe(true);
  });
});

describe("intelligence reply filtering", () => {
  it("keeps real questions and requests in private conversations", () => {
    expect(isReplyWorthyIntelligenceMessage("friend@c.us", "Can you send me the address?"))
      .toBe(true);
    expect(isReplyWorthyIntelligenceMessage("friend@lid", "מתי אתה הולך"))
      .toBe(true);
    expect(isReplyWorthyIntelligenceMessage("friend@c.us", "We have therapy on Wednesday at 12pm"))
      .toBe(false);
    expect(isReplyWorthyIntelligenceMessage("friend@c.us", "ממש"))
      .toBe(false);
  });

  it("does not treat general group chatter as a reply for Amir", () => {
    expect(isReplyWorthyIntelligenceMessage("family@g.us", "Hi someone at dentsu pls?"))
      .toBe(false);
    expect(isReplyWorthyIntelligenceMessage("family@g.us", "שבוע טוב חברים, מה יש הערב?"))
      .toBe(false);
    expect(isReplyWorthyIntelligenceMessage("family@g.us", "Amir, can you bring the tickets?"))
      .toBe(true);
    expect(isReplyWorthyIntelligenceMessage("family@g.us", "תוכל לשלוח לי את הכתובת?"))
      .toBe(true);
  });

  it("requires the latest saved message to still be incoming", () => {
    expect(isReplyWorthyIntelligenceMessage("friend@c.us", "Can you help?", false)).toBe(false);
  });
});
