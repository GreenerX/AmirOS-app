export type UpdateStatus = {
  status: "available" | "current" | "unavailable";
  currentVersion: string;
  latestVersion?: string;
  checkedAt: number;
  detail?: string;
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
