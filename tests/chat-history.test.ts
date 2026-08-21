import { describe, expect, it } from "vitest";
import {
  contactForSelectedChat,
  historyForSelectedChat,
} from "../ui/src/chat-history.js";
import type { ChatMessage, ContactPreferences } from "../ui/src/types.js";

const message: ChatMessage = {
  id: "message-1",
  body: "Hello",
  fullBody: "Hello",
  fromMe: false,
  timestamp: 1,
  type: "chat",
  hasMedia: false,
};

const contact: ContactPreferences = {
  mode: "auto",
  relationship: "Friend",
  pinned: false,
  hidden: false,
  tone: "Friendly",
  language: "Automatic",
  composerTranslationPreference: null,
  pronouns: "unspecified",
  memoryEnabled: true,
  knowledgeTracking: "enabled",
  customInstructions: "",
  ownerTriggerAccess: ["knowledge", "calendar"],
  contactTriggerAccess: [],
};

describe("chat history correlation", () => {
  it("shows messages only under the chat that loaded them", () => {
    expect(historyForSelectedChat("chat-a", "chat-a", [message])).toEqual([message]);
    expect(historyForSelectedChat("chat-b", "chat-a", [message])).toEqual([]);
  });

  it("does not show another chat's contact settings", () => {
    expect(contactForSelectedChat("chat-a", "chat-a", contact)).toBe(contact);
    expect(contactForSelectedChat("chat-b", "chat-a", contact)).toBeUndefined();
  });
});
