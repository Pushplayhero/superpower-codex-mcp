import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { CommandRunner } from "../lib/command.js";
import { runCommand } from "../lib/command.js";
import {
  errorResult,
  textResult,
  type McpTextResult
} from "../lib/mcp.js";
import { planWithCodexHandler } from "./planWithCodex.js";
import { runCodingTaskHandler } from "./runCodingTask.js";
import { reviewWithCodexHandler } from "./reviewWithCodex.js";
import { verifyWithCodexHandler } from "./verifyWithCodex.js";
import { planOutputPath } from "../lib/workspace.js";
import { parseReviewResult } from "../lib/reviewResult.js";

export const runDevelopmentWorkflowSchema = {
  workspacePath: z.string().describe("Repository or workspace path."),
  goal: z.string().min(1).describe("Implementation goal."),
  constraints: z.string().default("").describe("Constraints the plan must respect."),
  doneWhen: z.string().default("").describe("Completion criteria."),
  model: z.string().default("gemini-3.5-flash").describe("Model for coding task."),
  skipPlan: z.boolean().default(false).describe("Skip planning phase if a plan already exists."),
  skipReview: z.boolean().default(false).describe("Skip code review phase."),
  skipVerify: z.boolean().default(false).describe("Skip final verification phase."),
  verificationCommands: z.array(z.string())
    .min(1)
    .default(["npm test", "npm run typecheck"])
    .describe("Commands used for final verification."),
  maxIterations: z.number().int().min(1).max(10).default(3).describe("Max code-review-fix iterations.")
};

export type RunDevelopmentWorkflowInput = {
  workspacePath: string;
  goal: string;
  constraints?: string;
  doneWhen?: string;
  model?: string;
  skipPlan?: boolean;
  skipReview?: boolean;
  skipVerify?: boolean;
  verificationCommands?: string[];
  maxIterations?: number;
};

type StageResult = {
  stage: string;
  ok: boolean;
  summary: string;
  details?: string;
};

export async function runDevelopmentWorkflowHandler(
  input: RunDevelopmentWorkflowInput,
  runner: CommandRunner = runCommand
): Promise<McpTextResult> {
  if (input.verificationCommands && input.verificationCommands.length === 0) {
    return errorResult("verificationCommands cannot be empty");
  }

  const stages: StageResult[] = [];
  let planText = "";

  if (!input.skipPlan) {
    const planResult = await planWithCodexHandler(
      {
        workspacePath: input.workspacePath,
        goal: input.goal,
        constraints: input.constraints ?? "",
        doneWhen: input.doneWhen ?? ""
      },
      runner
    );
    stages.push({
      stage: "plan",
      ok: !planResult.isError,
      summary: planResult.isError ? "Codex planning failed." : "Plan created.",
      details: planResult.content[0].text
    });
    if (planResult.isError) {
      return buildWorkflowResponse("failed", stages);
    }

    // Read the saved plan for passing to implementer
    try {
      const savedPath = planOutputPath(input.workspacePath, input.goal);
      planText = await readFile(savedPath, "utf8");
    } catch {
      planText = planResult.content[0].text;
    }
  }

  // Build implementer prompt with full plan, constraints, and doneWhen
  const implementPrompt = [
    input.goal,
    input.constraints ? `\nConstraints:\n${input.constraints}` : "",
    input.doneWhen ? `\nDone when:\n${input.doneWhen}` : "",
    planText ? `\nImplementation plan:\n${planText}` : ""
  ].filter(Boolean).join("\n");

  let implementResult = await runCodingTaskHandler(
    {
      workspacePath: input.workspacePath,
      prompt: implementPrompt,
      allowExecution: true,
      mode: "execute",
      planApproved: true,
      model: input.model
    },
    runner
  );

  let implementOk = !implementResult.isError;
  let implementStatus = "executed";

  if (!implementResult.isError) {
    try {
      const payload = JSON.parse(implementResult.content[0].text);
      implementStatus = payload.status ?? "unknown";
      implementOk = payload.status === "committed" || payload.status === "tests_passed";
    } catch {
      implementOk = false;
    }
  }

  stages.push({
    stage: "implement",
    ok: implementOk,
    summary: `Status: ${implementStatus}`,
    details: implementResult.content[0].text
  });

  // Stop if implementation failed
  if (!implementOk) {
    return buildWorkflowResponse("completed_with_issues", stages);
  }

  let reviewText = "";
  if (!input.skipReview) {
    for (let i = 0; i < (input.maxIterations ?? 3); i++) {
      const reviewResult = await reviewWithCodexHandler(
        {
          workspacePath: input.workspacePath,
          reviewScope: "diff",
          focus: input.goal
        },
        runner
      );
      reviewText = reviewResult.content[0].text;
      let findingCount = 0;
      let reviewFailed = reviewResult.isError === true;
      if (!reviewFailed) {
        try {
          findingCount = parseReviewResult(reviewText).findings.length;
        } catch {
          reviewFailed = true;
        }
      }
      const findings = findingCount > 0;
      stages.push({
        stage: i === 0 ? "review" : `review_round_${i + 1}`,
        ok: !reviewFailed && !findings,
        summary: reviewFailed
          ? "Codex review execution failed."
          : findings
            ? `${findingCount} issues found.`
            : "No issues found.",
        details: reviewText
      });

      if (reviewFailed || !findings) break;

      if (i < (input.maxIterations ?? 3) - 1) {
        const fixPrompt = `${input.goal}\n\nAddress these review findings:\n${reviewText}`;
        implementResult = await runCodingTaskHandler(
          {
            workspacePath: input.workspacePath,
            prompt: fixPrompt,
            allowExecution: true,
            mode: "execute",
            planApproved: true,
            model: input.model
          },
          runner
        );
        const fixOk = !implementResult.isError && parseImplementOk(implementResult.content[0].text);
        stages.push({
          stage: `fix_round_${i + 1}`,
          ok: fixOk,
          summary: fixOk ? "Fix applied." : "Fix failed.",
          details: implementResult.content[0].text
        });

        // If fix failed, stop the review loop
        if (!fixOk) {
          break;
        }
      }
    }

    // Retroactively mark all review stages as ok=true if a subsequent clean review round exists
    // Handles: review(false) → fix_round(true) → review_round_2(true)
    for (let idx = 0; idx < stages.length; idx++) {
      const s = stages[idx];
      if (!s.stage.startsWith("review") || s.ok) continue;
      // This review stage had findings. Check if a later review stage is ok=true
      const laterCleanReview = stages.slice(idx + 1).find(
        (later) => later.stage.startsWith("review") && later.ok
      );
      if (laterCleanReview) {
        s.ok = true;
        s.summary = "Issues resolved in subsequent fix round.";
      }
    }
  }

  if (!input.skipVerify) {
    // Run actual verification commands and check content
    const verifyResult = await verifyWithCodexHandler(
      {
        workspacePath: input.workspacePath,
        expectedBehavior: input.goal,
        verificationCommands: input.verificationCommands ?? ["npm test", "npm run typecheck"],
        allowCommandExecution: true
      },
      runner
    );

    stages.push({
      stage: "verify",
      ok: !verifyResult.isError,
      summary: verifyResult.isError
        ? "Verification execution error."
        : "Verification passed.",
      details: verifyResult.content[0].text
    });
  }

  const workflowOk = stages.every((s) => s.ok);
  return buildWorkflowResponse(workflowOk ? "completed" : "completed_with_issues", stages);
}

function buildWorkflowResponse(workflow: string, stages: StageResult[]): McpTextResult {
  const firstFailed = stages.find((s) => !s.ok);
  if (firstFailed) {
    let nextAction = "Review the stage details and address any issues.";
    if (firstFailed.stage === "plan") {
      nextAction = "Verify the goals and constraints or retry planning.";
    } else if (firstFailed.stage === "implement") {
      nextAction = "Revise the implementation prompt or check the model status.";
    } else if (firstFailed.stage.startsWith("review")) {
      nextAction = "Address the outstanding code quality or architectural findings.";
    } else if (firstFailed.stage.startsWith("fix_round")) {
      nextAction = "Inspect the fix round failures and resolve implementation conflicts.";
    } else if (firstFailed.stage === "verify") {
      nextAction = "Fix the failing tests or type errors reported in verification details.";
    }
    return textResult(JSON.stringify({
      workflow,
      stages,
      failedStage: firstFailed.stage,
      nextAction,
      failureSummary: firstFailed.summary,
      failureDetails: firstFailed.details ?? ""
    }, null, 2));
  }
  return textResult(JSON.stringify({
    workflow,
    stages
  }, null, 2));
}

function parseImplementOk(text: string): boolean {
  try {
    const payload = JSON.parse(text);
    const status = payload.status ?? "";
    return status === "committed" || status === "tests_passed";
  } catch {
    return false;
  }
}
