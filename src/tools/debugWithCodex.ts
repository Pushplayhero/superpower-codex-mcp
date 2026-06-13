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
import { buildDebugPrompt } from "../lib/prompts.js";
import { requireWorkspace } from "../lib/workspace.js";

export const debugWithCodexSchema = {
  workspacePath: z.string().describe("Repository or workspace path."),
  symptom: z.string().min(1).describe("Observed failure or bug."),
  commandOutput: z.string().min(1).describe("Relevant command output, stack trace, or logs."),
  recentChanges: z.string().default("").describe("Recent changes that may be related.")
};

export type DebugWithCodexInput = {
  workspacePath: string;
  symptom: string;
  commandOutput: string;
  recentChanges?: string;
};

export async function debugWithCodexHandler(
  input: DebugWithCodexInput,
  runner: CommandRunner = runCommand
): Promise<McpTextResult> {
  try {
    const workspace = await requireWorkspace(input.workspacePath);
    const result = await invokeCodex(buildDebugPrompt(input), workspace, runner);
    if (result.exitCode !== 0) {
      return errorResult(
        `Codex debugging failed.\n\nstderr:\n${result.stderr}\n\nstdout:\n${result.stdout}`
      );
    }
    return textResult(result.stdout);
  } catch (error: unknown) {
    return toolErrorResult(error, "Failed to debug with Codex");
  }
}
