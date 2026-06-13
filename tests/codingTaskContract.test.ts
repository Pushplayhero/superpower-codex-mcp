import { describe, expect, it } from "vitest";
import { z } from "zod";
import { normalizeCodingTaskContract, runCodingTaskSchema } from "../src/lib/codingTaskContract.js";

describe("Coding task execution contract", () => {
  it("rejects a whitespace-only model", () => {
    const schema = z.object(runCodingTaskSchema);
    const result = schema.safeParse({
      workspacePath: "C:\\repo",
      prompt: "Implement",
      model: "   "
    });
    expect(result.success).toBe(false);
  });

  it("keeps a minimal call in legacy mode", () => {
    expect(
      normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Implement Task 2",
        allowExecution: true
      })
    ).toMatchObject({
      strict: false,
      mode: "execute",
      requireCommit: false,
      requireCleanWorkspace: false,
      responseDetail: "summary"
    });
  });

  it("enables strict execute defaults when a strict field is supplied", () => {
    expect(
      normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Implement Task 2",
        allowExecution: true,
        mode: "execute",
        planApproved: true
      })
    ).toMatchObject({
      strict: true,
      requireCommit: true,
      requireCleanWorkspace: true
    });
  });

  it("does not make response detail alone strict", () => {
    expect(
      normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Inspect output",
        allowExecution: true,
        responseDetail: "full"
      }).strict
    ).toBe(false);
  });

  it("leaves the model unspecified by default", () => {
    expect(
      normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Implement",
        allowExecution: true
      }).model
    ).toBeUndefined();
  });

  it("preserves an explicit model override", () => {
    expect(
      normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Fix review findings",
        allowExecution: true,
        model: "gemini-3.1-pro-preview"
      }).model
    ).toBe("gemini-3.1-pro-preview");
  });

  it("trims whitespace from model names", () => {
    expect(
      normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Fix findings",
        allowExecution: true,
        model: "  gemini-3.5-flash  "
      }).model
    ).toBe("gemini-3.5-flash");
  });

  it("does not make model alone strict", () => {
    expect(
      normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Inspect output",
        allowExecution: true,
        model: "gemini-3.1-pro-preview"
      }).strict
    ).toBe(false);
  });

  it("requires an approved plan for strict execute mode", () => {
    expect(() =>
      normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Implement",
        allowExecution: true,
        mode: "execute"
      })
    ).toThrow(/planApproved/);
  });

  it("rejects commit requirements in plan mode", () => {
    expect(() =>
      normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Plan",
        allowExecution: true,
        mode: "plan",
        requireCommit: true
      })
    ).toThrow(/plan mode/i);
  });

  it.each(["..\\secret.ts", "/root.ts", "C:\\root.ts", "src/../secret.ts"])(
    "rejects unsafe allowlist path %s",
    (file) => {
      expect(() =>
        normalizeCodingTaskContract({
          workspacePath: "C:\\repo",
          prompt: "Implement",
          allowExecution: true,
          mode: "execute",
          planApproved: true,
          allowedFiles: [file]
        })
      ).toThrow(/repository-relative/);
    }
  );

  it("rejects duplicate acceptance criterion ids", () => {
    expect(() =>
      normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Implement",
        allowExecution: true,
        mode: "execute",
        planApproved: true,
        acceptanceCriteria: [
          { id: "AC-1", description: "First" },
          { id: "AC-1", description: "Duplicate" }
        ]
      })
    ).toThrow(/duplicate/i);
  });
});
