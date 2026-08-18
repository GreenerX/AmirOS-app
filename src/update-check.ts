export type UpdateStatus = {
  status: "available" | "current" | "held" | "unavailable";
  currentVersion: string;
  latestVersion?: string;
  /** Present only for an explicitly approved Control Center release. */
  downloadUrl?: string;
  /** SHA-256 for the exact approved archive, in lower-case hexadecimal. */
  sha256?: string;
  releaseNotesUrl?: string;
  checkedAt: number;
  detail?: string;
};

export type ManagedReleaseDecision = {
  action: "available" | "hold" | "none";
  version?: string;
  downloadUrl?: string;
  sha256?: string;
  releaseNotesUrl?: string;
};

/**
 * GitHub's published-release endpoint deliberately ignores ordinary pushes to
 * main. That means testers are only prompted after a release is published.
 */
export const AMIROS_LATEST_RELEASE_URL = "https://api.github.com/repos/GreenerX/AmirOS-app/releases/latest";

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length, 3); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function validApprovedUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * Converts the Control Center's additive release decision into the same shape
 * used by the dashboard update prompt. This has no GitHub fallback: a managed
 * Mac may update only when its administrator made a fully specified release
 * available for its channel.
 */
export function checkForManagedAmirosUpdate(
  currentVersion: string,
  release: ManagedReleaseDecision | undefined,
  checkedAt = Date.now(),
): UpdateStatus {
  if (!release || release.action === "none") {
    return { status: "held", currentVersion, checkedAt, detail: "No update is available for this Mac right now." };
  }
  if (release.action === "hold") {
    return { status: "held", currentVersion, checkedAt, detail: "Updates for this AmirOS channel are currently on hold." };
  }
  const latestVersion = typeof release.version === "string" ? release.version.trim().replace(/^v/i, "") : "";
  const downloadUrl = validApprovedUrl(release.downloadUrl);
  const sha256 = typeof release.sha256 === "string" ? release.sha256.trim() : "";
  if (!/^\d+\.\d+\.\d+$/u.test(latestVersion) || !downloadUrl || !/^[a-f0-9]{64}$/u.test(sha256)) {
    return { status: "unavailable", currentVersion, checkedAt, detail: "AmirOS could not confirm an approved update right now." };
  }
  const releaseNotesUrl = validApprovedUrl(release.releaseNotesUrl);
  return {
    status: compareVersions(latestVersion, currentVersion) > 0 ? "available" : "current",
    currentVersion,
    latestVersion,
    downloadUrl,
    sha256,
    ...(releaseNotesUrl ? { releaseNotesUrl } : {}),
    checkedAt,
  };
}

export async function checkForAmirosUpdate(
  currentVersion: string,
  options: {
    fetcher?: FetchLike;
    releaseUrl?: string;
    timeoutMs?: number;
  } = {},
): Promise<UpdateStatus> {
  const checkedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const response = await (options.fetcher || fetch)(options.releaseUrl || AMIROS_LATEST_RELEASE_URL, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return { status: "unavailable", currentVersion, checkedAt, detail: "AmirOS could not check for updates right now." };
    }
    const release = await response.json() as { tag_name?: unknown; draft?: unknown; prerelease?: unknown };
    const tagName = typeof release.tag_name === "string" ? release.tag_name.trim() : "";
    const latestVersion = tagName.replace(/^v/i, "");
    if (release.draft === true || release.prerelease === true) {
      return { status: "unavailable", currentVersion, checkedAt, detail: "The latest AmirOS version could not be read." };
    }
    if (!/^\d+\.\d+\.\d+$/.test(latestVersion)) {
      return { status: "unavailable", currentVersion, checkedAt, detail: "The latest AmirOS version could not be read." };
    }
    return {
      status: compareVersions(latestVersion, currentVersion) > 0 ? "available" : "current",
      currentVersion,
      latestVersion,
      checkedAt,
    };
  } catch {
    return { status: "unavailable", currentVersion, checkedAt, detail: "AmirOS could not check for updates right now." };
  } finally {
    clearTimeout(timeout);
  }
}
