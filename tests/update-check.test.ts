import { describe, expect, it } from "vitest";
import { AMIROS_LATEST_RELEASE_URL, checkForAmirosUpdate, checkForManagedAmirosUpdate, compareVersions } from "../src/update-check.js";

describe("AmirOS update checks", () => {
  it("compares release versions by each numeric part", () => {
    expect(compareVersions("0.5.1", "0.5.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  });

  it("reports when a newer public release is available", async () => {
    const result = await checkForAmirosUpdate("0.5.0", {
      fetcher: async () => ({ ok: true, json: async () => ({ tag_name: "v0.5.1", draft: false, prerelease: false }) }),
    });
    expect(result).toMatchObject({ status: "available", currentVersion: "0.5.0", latestVersion: "0.5.1" });
  });

  it("checks GitHub's published-release endpoint instead of main", () => {
    expect(AMIROS_LATEST_RELEASE_URL).toBe("https://api.github.com/repos/GreenerX/AmirOS-app/releases/latest");
  });

  it("does not offer an update when the manifest is invalid", async () => {
    const result = await checkForAmirosUpdate("0.5.0", {
      fetcher: async () => ({ ok: true, json: async () => ({ tag_name: "not-a-version" }) }),
    });
    expect(result.status).toBe("unavailable");
  });

  it("does not offer an unpublished prerelease", async () => {
    const result = await checkForAmirosUpdate("0.5.0", {
      fetcher: async () => ({ ok: true, json: async () => ({ tag_name: "v0.5.1", prerelease: true }) }),
    });
    expect(result.status).toBe("unavailable");
  });

  it("does not prompt a managed Mac while its channel is held", () => {
    expect(checkForManagedAmirosUpdate("0.10.10", { action: "hold" }, 123)).toMatchObject({
      status: "held",
      currentVersion: "0.10.10",
      checkedAt: 123,
    });
  });

  it("offers only a fully specified release approved for a managed Mac", () => {
    const update = checkForManagedAmirosUpdate("0.10.10", {
      action: "available",
      version: "v0.10.11",
      downloadUrl: "https://downloads.example.com/AmirOS-v0.10.11.zip",
      sha256: "a".repeat(64),
      releaseNotesUrl: "https://github.com/GreenerX/AmirOS-app/releases/tag/v0.10.11",
    }, 456);
    expect(update).toMatchObject({
      status: "available",
      latestVersion: "0.10.11",
      downloadUrl: "https://downloads.example.com/AmirOS-v0.10.11.zip",
      sha256: "a".repeat(64),
      checkedAt: 456,
    });
  });

  it("fails closed when an approved release is incomplete", () => {
    expect(checkForManagedAmirosUpdate("0.10.10", {
      action: "available",
      version: "0.10.11",
      downloadUrl: "https://downloads.example.com/AmirOS-v0.10.11.zip",
    })).toMatchObject({ status: "unavailable" });
  });
});
