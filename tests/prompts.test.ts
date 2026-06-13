import { describe, expect, it } from "vitest";
import {
  buildDebugPrompt,
  buildPlanPrompt,
  buildReviewPrompt,
  buildVerificationPrompt
} from "../src/lib/prompts.js";

describe("prompt builders", () => {
  it("builds a plan prompt with Superpowers gates", () => {
    const prompt = buildPlanPrompt({
      goal: "Add MCP tools",
      constraints: "TypeScript only",
      doneWhen: "Tests pass",
      repoContext: "AGENTS.md says run tests"
    });
    expect(prompt).toContain("Goal: Add MCP tools");
    expect(prompt).toContain("Constraints: TypeScript only");
    expect(prompt).toContain("Done when: Tests pass");
    expect(prompt).toContain("implementation plan");
  });

  it("builds review prompt that asks findings first", () => {
    const prompt = buildReviewPrompt({
      focus: "correctness",
      repoContext: "rules",
      diff: "diff --git"
    });
    expect(prompt).toContain("Findings first");
    expect(prompt).toContain("correctness");
    expect(prompt).toContain("diff --git");
  });

  it("builds debug prompt that asks for evidence", () => {
    const prompt = buildDebugPrompt({
      symptom: "test fails",
      commandOutput: "expected true got false",
      recentChanges: "changed parser"
    });
    expect(prompt).toContain("Do not guess");
    expect(prompt).toContain("test fails");
    expect(prompt).toContain("expected true got false");
  });

  it("builds verification prompt with commands", () => {
    const prompt = buildVerificationPrompt({
      expectedBehavior: "MCP starts",
      verificationCommands: ["npm test", "npm run build"],
      commandOutput: "PASS"
    });
    expect(prompt).toContain("MCP starts");
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("PASS");
  });
});
