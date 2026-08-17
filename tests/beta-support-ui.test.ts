import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("beta support dashboard entry", () => {
  it("keeps Help & feedback persistent and opens a private, opt-in modal", () => {
    expect(read("../ui/src/components/Sidebar.tsx")).toContain("Help &amp; feedback");
    expect(read("../ui/src/App.tsx")).toContain("BetaSupportExperience");
    const modal = read("../ui/src/components/BetaSupportExperience.tsx");
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain("Screenshots may contain private conversations");
    expect(modal).toContain("Attach the screenshot there if it would help");
    expect(modal).not.toContain('type="file"');
    expect(modal).toContain("Include basic technical details to help diagnose this");
    expect(modal).toContain("STEP {step === \"choose\" ? \"1\" : \"2\"} OF 2");
    expect(modal).toContain("Choose a different option");
    expect(modal).toContain("}, [open, currentView]);");
    expect(modal).toContain('setDraft({ category, featureArea: featureAreaForView(currentView), trying: "", happened: "", expected: "", includeDiagnostics: false });');
    expect(modal).toContain("Beta support has not yet been configured");
    expect(modal).toContain("Send to AmirOS support");
    expect(modal).toContain("result.ticket.id");
    expect(modal).toContain("await submitBetaSupportTicket");
    expect(modal).toContain("action === \"direct\"");
  });

  it("uses Control Center delivery only for a managed beta package and keeps existing fallback support intact", () => {
    const route = read("../src/dashboard/ai-usage-routes.ts");
    expect(route.indexOf("controlCenterSupportUrl")).toBeLessThan(route.indexOf("config.betaSupportEmail"));
    expect(route.indexOf("config.betaSupportEmail")).toBeLessThan(route.indexOf("config.betaSupportUrl"));
    expect(route).toContain("const betaSupport = config.requireControlCenterActivation && controlCenterSupportUrl");
    expect(route).toContain("direct: config.requireControlCenterActivation");
    expect(route).toContain("controlCenterStatus?.setupState === \"active\"");
  });
});
