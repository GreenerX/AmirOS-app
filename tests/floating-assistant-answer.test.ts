import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("../ui/src/components/FloatingAssistant.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../ui/src/styles.css", import.meta.url), "utf8");

describe("Ask AmirOS answer experience", () => {
  it("restores prior answer states and keeps New question as a full reset", () => {
    expect(component).toContain("const [answerStack, setAnswerStack]");
    expect(component).toContain("const goBack = () =>");
    expect(component).toContain("setAnswerOrigin(\"history\")");
    expect(component).toContain("className=\"ask-drawer-back\"");
    expect(component).toContain("const startNewQuestion = () =>");
  });

  it("uses the selected-person row as the only contact action", () => {
    expect(component).toContain("className=\"ask-drawer-person\"");
    expect(component).not.toContain("Open contact</button>");
    expect(styles).toContain("--ask-person-avatar-size: 70px");
    expect(styles).toContain("grid-template-columns: var(--ask-person-avatar-size) minmax(0, 1fr) auto");
    expect(styles).toContain("padding-block: 10px; padding-inline: 0 9px");
    expect(styles).toContain("width: var(--ask-person-avatar-size); height: var(--ask-person-avatar-size); border: 2px solid #fff");
    expect(styles).toContain(".ask-drawer-person:focus-visible");
  });

  it("uses an exact ten-pixel rhythm around the Back control and question", () => {
    expect(component).toContain("className=\"ask-drawer-question-copy\"");
    expect(component).toContain("className=\"ask-drawer-question-topline\"");
    expect(styles).toContain("--ask-answer-section-gap: 10px");
    expect(styles).toContain("gap: var(--ask-answer-section-gap); padding-block: var(--ask-answer-section-gap); padding-inline: 28px");
    expect(styles).toContain(".ask-drawer-question-copy { display: grid; gap: var(--ask-answer-section-gap)");
    expect(styles).toContain(".ask-drawer-question-topline { display: flex; align-items: center; justify-content: space-between");
    expect(styles).toContain(".ask-drawer-back { display: inline-flex; flex: 0 0 auto;");
    expect(styles).toContain(".ask-drawer-question { padding-block: 10px; padding-inline: 18px;");
  });

  it("offers explicit feedback and keeps knowledge review separate from a downvote", () => {
    expect(component).toContain("Was this useful?");
    expect(component).toContain("Outdated or incorrect");
    expect(component).toContain("Review knowledge");
    expect(component).toContain("Improve answer");
    expect(component).toContain("onAnswerFeedback(answer.answerId");
  });

  it("centers connector lines on the icon column with a five-pixel mask", () => {
    expect(styles).toContain("--answer-point-size: 28px; --answer-point-center: 14px; --answer-connector-gap: 5px;");
    expect(styles).toContain("grid-template-columns: var(--answer-point-size) minmax(0, 1fr)");
    expect(styles).toContain(".ask-drawer-answer .floating-ai-answer-content .answer-icon-item { padding-inline-start: 0; }");
    expect(styles).toContain("inset-inline-start: calc(var(--answer-point-center) - .5px)");
    expect(styles).toContain("top: calc(var(--answer-point-size) + var(--answer-connector-gap)); bottom: var(--answer-connector-gap);");
    expect(styles).toContain("width: var(--answer-point-size); height: var(--answer-point-size);");
    expect(styles).toContain("padding: 5px;");
    expect(styles).toContain(".answer-icon-item:last-child { padding-bottom: 0; }");
  });
});
