import { describe, expect, it } from "vitest";

import { findDeletedMessageArchiveMatch } from "../src/deleted-message-matching.js";

describe("deleted-message archive matching", () => {
  const sentAtSeconds = 1_777_000_000;
  const archived = {
    messageId: "archived-original-id",
    fromMe: false,
    timestamp: sentAtSeconds,
  };

  it("merges a revoked placeholder with a differently identified saved message", () => {
    const match = findDeletedMessageArchiveMatch(
      {
        id: "whatsapp-revoked-placeholder-id",
        fromMe: false,
        timestamp: sentAtSeconds * 1_000 + 1_200,
        type: "revoked",
      },
      [archived],
    );

    expect(match?.messageId).toBe(archived.messageId);
  });

  it("does not merge messages with a different direction or sent time", () => {
    expect(
      findDeletedMessageArchiveMatch(
        {
          id: "different-direction",
          fromMe: true,
          timestamp: sentAtSeconds,
          type: "revoked",
        },
        [archived],
      ),
    ).toBeUndefined();

    expect(
      findDeletedMessageArchiveMatch(
        {
          id: "different-time",
          fromMe: false,
          timestamp: sentAtSeconds + 6,
          type: "revoked",
        },
        [archived],
      ),
    ).toBeUndefined();
  });

  it("never treats an ordinary live message as a deleted-message placeholder", () => {
    expect(
      findDeletedMessageArchiveMatch(
        {
          id: "ordinary-message",
          fromMe: false,
          timestamp: sentAtSeconds,
          type: "chat",
        },
        [archived],
      ),
    ).toBeUndefined();
  });
});
