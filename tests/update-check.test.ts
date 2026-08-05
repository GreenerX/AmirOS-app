import { describe, expect, it } from "vitest";
import { checkForAmirosUpdate, compareVersions } from "../src/update-check.js";

describe("AmirOS update checks", () => {
  it("compares release versions by each numeric part", () => {
    expect(compareVersions("0.5.1", "0.5.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  });

  it("reports when a newer public release is available", async () => {
    const result = await checkForAmirosUpdate("0.5.0", {
      fetcher: async () => ({ ok: true, json: async () => ({ version: "0.5.1" }) }),
    });
    expect(result).toMatchObject({ status: "available", currentVersion: "0.5.0", latestVersion: "0.5.1" });
  });

  it("does not offer an update when the manifest is invalid", async () => {
    const result = await checkForAmirosUpdate("0.5.0", {
      fetcher: async () => ({ ok: true, json: async () => ({ version: "not-a-version" }) }),
    });
    expect(result.status).toBe("unavailable");
  });
});
