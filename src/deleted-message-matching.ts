export type DeletedMessageMatchCandidate = {
  messageId: string;
  fromMe: boolean;
  timestamp: number;
};

export type LiveDeletedMessageCandidate = {
  id: string;
  fromMe: boolean;
  timestamp: number;
  type?: string;
  deleted?: unknown;
};

export function epochMilliseconds(timestamp: number): number {
  return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

/**
 * WhatsApp can expose a revoked message under a different serialized id than
 * the original message delivered to the revoke event. Match those two local
 * representations conservatively by direction and original sent time.
 */
export function findDeletedMessageArchiveMatch<T extends DeletedMessageMatchCandidate>(
  message: LiveDeletedMessageCandidate,
  candidates: Iterable<T>,
): T | undefined {
  if (message.type !== "revoked" && !message.deleted) return undefined;
  const sentAt = epochMilliseconds(message.timestamp);
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.fromMe !== message.fromMe) continue;
    const distance = Math.abs(epochMilliseconds(candidate.timestamp) - sentAt);
    if (distance <= 5_000 && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
