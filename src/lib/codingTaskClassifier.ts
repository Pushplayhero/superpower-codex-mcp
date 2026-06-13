import type { NormalizedCodingTaskContract } from "./codingTaskContract.js";
import type { CodingTaskReport } from "../schema/report.js";

export type ClassificationInput = {
  contract: NormalizedCodingTaskContract;
  responseText: string;
  report?: CodingTaskReport;
  initialHead?: string;
  finalHead?: string;
  changedFiles: string[];
  finalStatus?: string;
  processStatus?: "timed_out" | "execution_failed";
  processError?: string;
  postflightError?: string;
};

export type TaskOutcome = {
  status: string;
  summary: string;
  acceptanceMatrix: CodingTaskReport["acceptanceMatrix"];
  violations: string[];
};

export function classifyCodingTaskOutcome(input: ClassificationInput): TaskOutcome {
  const violations: string[] = [];
  const matrix = input.report?.acceptanceMatrix ?? [];

  if (input.processStatus) {
    return {
      status: input.processStatus,
      summary: input.processStatus === "timed_out" ? "Coding agent exceeded the configured timeout." : "coding agent CLI failed.",
      acceptanceMatrix: matrix,
      violations: input.processError ? [input.processError] : []
    };
  }

  if (input.postflightError) {
    return {
      status: "execution_failed",
      summary: "Git postflight verification failed.",
      acceptanceMatrix: matrix,
      violations: [input.postflightError]
    };
  }

  if (input.contract.mode === "plan") {
    const changedGitState =
      Boolean(input.finalStatus) ||
      (input.initialHead !== undefined &&
        input.finalHead !== undefined &&
        input.initialHead !== input.finalHead) ||
      input.changedFiles.length > 0;
    if (changedGitState) {
      return {
        status: "contract_failed",
        summary: "Plan mode unexpectedly modified the workspace.",
        acceptanceMatrix: matrix,
        violations: ["Plan mode unexpectedly changed Git state."]
      };
    }
    return {
      status: "planned",
      summary: input.report?.summary || "Plan completed.",
      acceptanceMatrix: matrix,
      violations: []
    };
  }

  const approvalPatterns = [/please approve|awaiting approval|after approval|plan mode is active/i];
  if (approvalPatterns.some((p) => p.test(input.responseText)) && !input.report) {
    return {
      status: "mode_mismatch",
      summary: "Coding agent requested plan approval or remained in Plan Mode.",
      acceptanceMatrix: matrix,
      violations: ["Response contains plan-approval request patterns."]
    };
  }

  if (input.contract.strict && !input.report) {
    return {
      status: "contract_failed",
      summary: "Strict execution did not return a parseable structured report.",
      acceptanceMatrix: matrix,
      violations: ["Missing or malformed JSON report."]
    };
  }

  if (!input.report && !input.contract.strict) {
    return {
      status: "implemented_unverified",
      summary: "Task completed without a structured report.",
      acceptanceMatrix: [],
      violations: []
    };
  }

  if (input.contract.allowedFiles.length > 0) {
    const normalize = (f: string) => f.replaceAll("\\", "/");
    const allowed = input.contract.allowedFiles.map(normalize);
    const actual = input.changedFiles.map(normalize);
    const outsiders = actual.filter((f) => !allowed.includes(f));
    if (outsiders.length > 0) {
      violations.push(`Files changed outside allowlist: ${outsiders.join(", ")}`);
    }
  }

  if (input.contract.requireCommit && input.initialHead === input.finalHead) {
    violations.push("A commit was required but HEAD did not advance.");
  }

  if (input.finalStatus) {
    violations.push("Workspace is dirty after execution.");
  }

  if (input.report) {
    const normalize = (f: string) => f.replaceAll("\\", "/");
    const reportedFiles = input.report.changedFiles.map(normalize).sort();
    const actualFiles = input.changedFiles.map(normalize).sort();
    if (JSON.stringify(reportedFiles) !== JSON.stringify(actualFiles)) {
      violations.push("Reported changed files do not match Git authority.");
    }

    if (input.report.commitSha && input.finalHead && input.report.commitSha !== input.finalHead) {
      violations.push("Reported commit SHA does not match Git authority.");
    }
  }

  if (violations.length > 0) {
    return {
      status: "contract_failed",
      summary: "Execution contract violations detected.",
      acceptanceMatrix: matrix,
      violations
    };
  }

  const allCriteriaPassed =
    input.contract.acceptanceCriteria.length === 0 ||
    input.contract.acceptanceCriteria.every((c) => {
      const entry = matrix.find((m) => m.criterionId === c.id);
      return entry && entry.result === "PASS" && entry.testNames.length > 0;
    });

  let status = "implemented_unverified";
  if (allCriteriaPassed) {
    status = input.contract.requireCommit ? "committed" : "tests_passed";
  }

  return {
    status,
    summary: input.report?.summary || "Task completed.",
    acceptanceMatrix: matrix,
    violations: []
  };
}
