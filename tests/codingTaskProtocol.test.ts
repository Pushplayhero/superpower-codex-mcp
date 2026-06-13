import { describe, expect, it } from "vitest";
import { buildCodingTaskPrompt } from "../src/lib/codingTaskPrompt.js";
import { classifyCodingTaskOutcome } from "../src/lib/codingTaskClassifier.js";
import { parseCodingTaskReport } from "../src/schema/report.js";
import { normalizeCodingTaskContract } from "../src/lib/codingTaskContract.js";

const strictContract = normalizeCodingTaskContract({
  workspacePath: "C:\\repo",
  prompt: "Implement sync",
  allowExecution: true,
  mode: "execute",
  planApproved: true,
  acceptanceCriteria: [{ id: "AC-1", description: "Sync succeeds" }],
  allowedFiles: ["src/sync.ts", "tests/sync.test.ts"]
});

describe("Coding task protocol", () => {

  it("includes execution flags, acceptance ids, and allowlisted files", () => {
    const prompt = buildCodingTaskPrompt(strictContract);
    expect(prompt).toContain("EXECUTION_PHASE=IMPLEMENT");
    expect(prompt).toContain("PLAN_APPROVED=true");
    expect(prompt).toContain("AC-1");
    expect(prompt).toContain("src/sync.ts");
    expect(prompt).toContain("Implement sync");
  });

  it("extracts a structured report from the JSON envelope", () => {
    const report = {
      status: "committed",
      summary: "Done",
      commitSha: "abc123",
      changedFiles: ["src/sync.ts"],
      acceptanceMatrix: [{
        criterionId: "AC-1",
        testNames: ["syncs data"],
        result: "PASS"
      }]
    };
    expect(
      parseCodingTaskReport(JSON.stringify({ response: JSON.stringify(report) }))
    ).toMatchObject({ report });
  });

  it("parses a fenced JSON report", () => {
    const response = "```json\n" + JSON.stringify({
      status: "tests_passed",
      summary: "Done",
      changedFiles: [],
      acceptanceMatrix: []
    }) + "\n```";
    expect(parseCodingTaskReport(JSON.stringify({ response })).report?.status)
      .toBe("tests_passed");
  });

  it("classifies a request for approval as mode_mismatch", () => {
    expect(
      classifyCodingTaskOutcome({
        contract: strictContract,
        responseText: "I have prepared the plan. Please approve it before implementation.",
        report: undefined,
        initialHead: "a",
        finalHead: "a",
        changedFiles: []
      }).status
    ).toBe("mode_mismatch");
  });

  it("downgrades incomplete acceptance evidence", () => {
    expect(
      classifyCodingTaskOutcome({
        contract: strictContract,
        responseText: "Done",
        report: {
          status: "committed",
          summary: "Done",
          commitSha: "b",
          changedFiles: ["src/sync.ts"],
          acceptanceMatrix: []
        },
        initialHead: "a",
        finalHead: "b",
        changedFiles: ["src/sync.ts"]
      }).status
    ).toBe("implemented_unverified");
  });

  it("normalizes path separators in changedFiles", () => {
    const outcome = classifyCodingTaskOutcome({
      contract: strictContract,
      responseText: "Done",
      report: {
        status: "committed",
        summary: "Done",
        commitSha: "b",
        changedFiles: ["src\\sync.ts"],
        acceptanceMatrix: [{ criterionId: "AC-1", testNames: ["test"], result: "PASS" }]
      },
      initialHead: "a",
      finalHead: "b",
      changedFiles: ["src/sync.ts"]
    });
    expect(outcome.status).toBe("committed");
  });

  it("fails if changedFiles mismatch Git authority", () => {
    const outcome = classifyCodingTaskOutcome({
      contract: strictContract,
      responseText: "Done",
      report: {
        status: "committed",
        summary: "Done",
        commitSha: "b",
        changedFiles: ["src/sync.ts"],
        acceptanceMatrix: [{ criterionId: "AC-1", testNames: ["test"], result: "PASS" }]
      },
      initialHead: "a",
      finalHead: "b",
      changedFiles: ["src/other.ts"]
    });
    expect(outcome.status).toBe("contract_failed");
    expect(outcome.violations).toContain("Reported changed files do not match Git authority.");
  });

  it("fails if commitSha mismatch Git authority", () => {
    const outcome = classifyCodingTaskOutcome({
      contract: strictContract,
      responseText: "Done",
      report: {
        status: "committed",
        summary: "Done",
        commitSha: "WRONG",
        changedFiles: ["src/sync.ts"],
        acceptanceMatrix: [{ criterionId: "AC-1", testNames: ["test"], result: "PASS" }]
      },
      initialHead: "a",
      finalHead: "b",
      changedFiles: ["src/sync.ts"]
    });
    expect(outcome.status).toBe("contract_failed");
    expect(outcome.violations).toContain("Reported commit SHA does not match Git authority.");
  });

  it("vacuously satisfies zero acceptance criteria", () => {
    const contractNoAC = normalizeCodingTaskContract({
      workspacePath: "C:\\repo",
      prompt: "Implement",
      allowExecution: true,
      mode: "execute",
      planApproved: true,
      requireCommit: false,
      allowedFiles: ["src/a.ts"]
    });
    const outcome = classifyCodingTaskOutcome({
      contract: contractNoAC,
      responseText: "Done",
      report: {
        status: "tests_passed",
        summary: "Done",
        changedFiles: ["src/a.ts"],
        acceptanceMatrix: []
      },
      initialHead: "a",
      finalHead: "a",
      changedFiles: ["src/a.ts"]
    });
    expect(outcome.status).toBe("tests_passed");
  });

  it("fails if workspace is dirty (final status dirty)", () => {
    const outcome = classifyCodingTaskOutcome({
      contract: strictContract,
      responseText: "Done",
      report: {
        status: "tests_passed",
        summary: "Done",
        changedFiles: ["src/sync.ts"],
        acceptanceMatrix: [{ criterionId: "AC-1", testNames: ["test"], result: "PASS" }]
      },
      initialHead: "a",
      finalHead: "a",
      changedFiles: ["src/sync.ts"],
      finalStatus: " M src/sync.ts"
    });
    expect(outcome.status).toBe("contract_failed");
    expect(outcome.violations).toContain("Workspace is dirty after execution.");
  });

  it("preserves raw stdout as responseText on invalid outer JSON", () => {
    const stdout = "Not JSON at all";
    const parsed = parseCodingTaskReport(stdout);
    expect(parsed.responseText).toBe(stdout);
  });

  describe("regression tests for identified gaps", () => {
    it("strict mode=plan prompt contains PLAN, not IMPLEMENT, and asks for plain text", () => {
      const planContract = normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Plan it",
        allowExecution: true,
        mode: "plan"
      });
      const prompt = buildCodingTaskPrompt(planContract);
      expect(prompt).toContain("EXECUTION_PHASE=PLAN");
      expect(prompt).not.toContain("EXECUTION_PHASE=IMPLEMENT");
      expect(prompt).not.toContain("DO_NOT_ENTER_PLAN_MODE=true");
      expect(prompt).not.toContain("You MUST return a final structured report");
      expect(prompt).toContain("Return your plan as plain text");
    });

    it("classifyCodingTaskOutcome handles mode=plan successfully with plain text (no report)", () => {
      const planContract = normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Plan it",
        allowExecution: true,
        mode: "plan"
      });
      const outcome = classifyCodingTaskOutcome({
        contract: planContract,
        responseText: "Here is the plan.",
        changedFiles: []
      });
      expect(outcome.status).toBe("planned");
    });

    it("fails a plan call that unexpectedly changes Git state", () => {
      const planContract = normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Plan it",
        allowExecution: true,
        mode: "plan"
      });
      const outcome = classifyCodingTaskOutcome({
        contract: planContract,
        responseText: "Here is the plan.",
        initialHead: "a",
        finalHead: "b",
        changedFiles: ["src/unexpected.ts"],
        finalStatus: " M src/unexpected.ts"
      });
      expect(outcome.status).toBe("contract_failed");
      expect(outcome.violations).toContain("Plan mode unexpectedly changed Git state.");
    });

    it("plan text containing 'after approval' remains planned", () => {
      const planContract = normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Plan it",
        allowExecution: true,
        mode: "plan"
      });
      const outcome = classifyCodingTaskOutcome({
        contract: planContract,
        responseText: "The next steps after approval are...",
        changedFiles: []
      });
      expect(outcome.status).toBe("planned");
    });

    it("legacy raw response (non-strict) remains implemented_unverified", () => {
      const legacyContract = normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Do it",
        allowExecution: true
        // Omitting mode, planApproved, etc. makes it non-strict
      });
      expect(legacyContract.strict).toBe(false);
      const outcome = classifyCodingTaskOutcome({
        contract: legacyContract,
        responseText: "I did it.",
        changedFiles: ["src/a.ts"]
      });
      expect(outcome.status).toBe("implemented_unverified");
    });

    it("parses {responseText, report} third JSON format", () => {
      const result = parseCodingTaskReport(JSON.stringify({
        responseText: "done",
        report: { status: "committed", summary: "ok", changedFiles: [], acceptanceMatrix: [] }
      }));
      expect(result.report?.status).toBe("committed");
      expect(result.responseText).toBe("done");
    });

    it("normalizes backslash Git paths against slash allowlist", () => {
      const contract = normalizeCodingTaskContract({
        workspacePath: "C:\\repo",
        prompt: "Fix",
        allowExecution: true,
        mode: "execute",
        planApproved: true,
        requireCommit: false,
        allowedFiles: ["src/a.ts"]
      });
      const outcome = classifyCodingTaskOutcome({
        contract,
        responseText: "Done",
        report: {
          status: "tests_passed",
          summary: "Done",
          changedFiles: ["src/a.ts"],
          acceptanceMatrix: []
        },
        changedFiles: ["src\\a.ts"]
      });
      expect(outcome.violations).not.toContain("Files changed outside allowlist: src\\a.ts");
      expect(outcome.status).not.toBe("contract_failed");
    });
  });
});
