import { z } from "zod";
import type { CommandRunner } from "../lib/command.js";
import { runCommand } from "../lib/command.js";
import { invokeCodex } from "../lib/codexClient.js";
import { gitDiff, gitDiffForFiles, gitStatus } from "../lib/git.js";
import {
  errorResult,
  toolErrorResult,
  textResult,
  type McpTextResult
} from "../lib/mcp.js";
import { buildReviewPrompt } from "../lib/prompts.js";
import {
  collectInstructionFiles,
  requireWorkspace
} from "../lib/workspace.js";

export const reviewWithCodexSchema = {
  workspacePath: z.string().describe("Repository or workspace path."),
  reviewScope: z.enum(["diff", "working-tree", "specific-files"]).default("diff").describe("Review context scope."),
  files: z.array(z.string()).default([]).describe("Relative files for specific-files review."),
  focus: z.string().default("").describe("Review focus.")
};

export type ReviewWithCodexInput = {
  workspacePath: string;
  reviewScope?: "diff" | "working-tree" | "specific-files";
  files?: string[];
  focus?: string;
};

export async function reviewWithCodexHandler(
  input: ReviewWithCodexInput,
  runner: CommandRunner = runCommand
): Promise<McpTextResult> {
  try {
    const workspace = await requireWorkspace(input.workspacePath);
    const instructionFiles = await collectInstructionFiles(workspace, [], 20_000);
    const repoContext = instructionFiles
      .map((file) => `## ${file.relativePath}\n${file.text}`)
      .join("\n\n");
    const diff =
      input.reviewScope === "specific-files"
        ? await gitDiffForFiles(workspace, input.files ?? [], runner)
        : await gitDiff(workspace, runner);
    const status = input.reviewScope === "working-tree" ? await gitStatus(workspace, runner) : "";
    const prompt = buildReviewPrompt({
      focus: input.focus,
      repoContext,
      diff: [status ? `Git status:\n${status}` : "", diff].filter(Boolean).join("\n\n")
    });
    const result = await invokeCodex(prompt, workspace, runner);
    if (result.exitCode !== 0) {
      return errorResult(
        `Codex review failed.\n\nstderr:\n${result.stderr}\n\nstdout:\n${result.stdout}`
      );
    }
    return textResult(result.stdout);
  } catch (error: unknown) {
    return toolErrorResult(error, "Failed to review with Codex");
  }
}
