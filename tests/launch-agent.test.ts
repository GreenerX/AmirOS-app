import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  consumeIntentionalStopMarker,
  createLaunchAgentPlist,
  intentionalStopPath,
  launchAgentPath,
  writeIntentionalStopMarker,
} from "../scripts/launch-agent.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("macOS recovery launcher", () => {
  it("creates a user launch agent that runs the watchdog from the installed folder", () => {
    const plist = createLaunchAgentPlist({
      nodePath: "/Applications/Node & Tools/bin/node",
      projectPath: "/Applications/AmirOS <beta>",
    });

    expect(plist).toContain("<string>com.amiros.app</string>");
    expect(plist).toContain("AMIROS_LAUNCH_AGENT_MANAGED");
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    expect(plist).toContain("<key>SuccessfulExit</key><false/>");
    expect(plist).toContain("<string>/bin/sh</string>");
    expect(plist).toContain("/Applications/Node &amp; Tools/bin/node");
    expect(plist).toContain("/Applications/AmirOS &lt;beta&gt;/scripts/launch-agent-runner.sh");
    expect(plist).not.toContain("/Applications/Node & Tools/bin/node");
    expect(launchAgentPath("/Users/tester")).toBe("/Users/tester/Library/LaunchAgents/com.amiros.app.plist");
  });

  it("uses a one-time marker to distinguish an intentional stop from a crash", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "amiros-launch-agent-"));
    temporaryDirectories.push(directory);

    const marker = writeIntentionalStopMarker(directory, "user-requested stop");
    expect(marker).toBe(intentionalStopPath(directory));
    expect(existsSync(marker)).toBe(true);
    expect(consumeIntentionalStopMarker(directory)).toBe("user-requested stop");
    expect(existsSync(marker)).toBe(false);
    expect(consumeIntentionalStopMarker(directory)).toBeUndefined();
  });
});
