import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { CommandRunner } from "../lib/command.js";
import { runCommand } from "../lib/command.js";
import { invokeCodex } from "../lib/codexClient.js";
import {
  errorResult,
  toolErrorResult,
  textResult,
  type McpTextResult
} from "../lib/mcp.js";
import { buildPlanPrompt } from "../lib/prompts.js";
import {
  collectInstructionFiles,
  ensureParentDir,
  planOutputPath,
  requireWorkspace
} from "../lib/workspace.js";

export const planWithCodexSchema = {
  workspacePath: z.string().describe("Repository or workspace path."),
  goal: z.string().min(1).describe("Implementation goal."),
  constraints: z.string().default("").describe("Constraints Codex must respect."),
  doneWhen: z.string().default("").describe("Completion criteria."),
  reasoningLevel: z.enum(["low", "medium", "high"]).default("medium").describe("Planning depth.")
};

export type PlanWithCodexInput = {
  workspacePath: string;
  goal: string;
  constraints?: string;
  doneWhen?: string;
  reasoningLevel?: "low" | "medium" | "high";
};

export async function planWithCodexHandler(
  input: PlanWithCodexInput,
  runner: CommandRunner = runCommand
): Promise<McpTextResult> {
  try {
    const workspace = await requireWorkspace(input.workspacePath);
    const files = await collectInstructionFiles(workspace, [], 30_000);
    const repoContext = files.map((file) => `## ${file.relativePath}\n${file.text}`).join("\n\n");
    const prompt = buildPlanPrompt({
      goal: input.goal,
      constraints: input.constraints,
      doneWhen: input.doneWhen,
      repoContext
    });
    const result = await invokeCodex(prompt, workspace, runner);
    if (result.exitCode !== 0) {
      return errorResult(
        `Codex planning failed.\n\nstderr:\n${result.stderr}\n\nstdout:\n${result.stdout}`
      );
    }

    const outputPath = planOutputPath(workspace, input.goal);
    await ensureParentDir(outputPath);
    await writeFile(outputPath, result.stdout, "utf8");
    return textResult(`Plan saved to ${outputPath}\n\n${result.stdout}`);
  } catch (error: unknown) {
    return toolErrorResult(error, "Failed to plan with Codex");
  }
}
