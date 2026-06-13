import { z } from "zod";
import type { CommandRunner } from "../lib/command.js";
import {
  resolveCliInvocation,
  runCommand
} from "../lib/command.js";
import {
  errorResult,
  textResult,
  type McpTextResult
} from "../lib/mcp.js";
import { validateWorkspace } from "../lib/workspace.js";

export const validateWorkspaceSchema = {
  workspacePath: z.string().describe("Repository or workspace path to validate."),
  checkGit: z.boolean().default(true).describe("Check for Git repository root."),
  checkAntigravityCli: z.boolean().default(true).describe("Check for Antigravity CLI availability.")
};

export type ValidateWorkspaceInput = {
  workspacePath: string;
  checkGit?: boolean;
  checkAntigravityCli?: boolean;
};

export async function validateWorkspaceHandler(
  input: ValidateWorkspaceInput,
  runner: CommandRunner = runCommand
): Promise<McpTextResult> {
  const validation = await validateWorkspace(input.workspacePath);
  if (
    validation.status === "rejected" ||
    !validation.canonicalPath
  ) {
    return errorResult(JSON.stringify(validation, null, 2));
  }

  const result = { ...validation };

  if (input.checkGit ?? true) {
    const git = await runner(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: validation.canonicalPath, timeoutMs: 10_000 }
    );
    if (git.exitCode === 0 && git.stdout.trim()) {
      result.gitRoot = git.stdout.trim();
    }
  }

  if (input.checkAntigravityCli ?? true) {
    try {
      const antigravity = resolveCliInvocation("antigravity");
      const command = await runner(
        antigravity.command,
        [...antigravity.prefixArgs, "--version"],
        { cwd: validation.canonicalPath, timeoutMs: 10_000 }
      );
      result.antigravityCliAvailable = command.exitCode === 0;
      result.antigravityCliVersion = command.exitCode === 0 ? command.stdout.trim() : undefined;
      result.antigravityExecutable = antigravity.command;
    } catch {
      result.antigravityCliAvailable = false;
    }
  }

  return textResult(JSON.stringify(result, null, 2));
}
