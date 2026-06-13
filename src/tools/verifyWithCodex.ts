import { z } from "zod";
import type { CommandRunner } from "../lib/command.js";
import { commandForDisplay, runCommand } from "../lib/command.js";
import { invokeCodex } from "../lib/codexClient.js";
import {
  errorResult,
  toolErrorResult,
  textResult,
  type McpTextResult
} from "../lib/mcp.js";
import { buildVerificationPrompt } from "../lib/prompts.js";
import { requireWorkspace } from "../lib/workspace.js";

export const verifyWithCodexSchema = {
  workspacePath: z.string().describe("Repository or workspace path."),
  expectedBehavior: z.string().min(1).describe("Behavior that should now be true."),
  verificationCommands: z.array(z.string()).default([]).describe("Commands to run when command execution is allowed."),
  allowCommandExecution: z.boolean().default(false).describe("Must be true before the MCP server runs commands.")
};

export type VerifyWithCodexInput = {
  workspacePath: string;
  expectedBehavior: string;
  verificationCommands?: string[];
  allowCommandExecution?: boolean;
};

function splitCommand(commandText: string): [string, string[]] {
  if (/[|;&<>]/.test(commandText)) {
    throw new Error("Shell operators are not supported in verification commands.");
  }
  const parts =
    commandText.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
  if (parts.length === 0) {
    throw new Error("Verification command cannot be empty.");
  }
  return [parts[0], parts.slice(1)];
}

export async function verifyWithCodexHandler(
  input: VerifyWithCodexInput,
  runner: CommandRunner = runCommand
): Promise<McpTextResult> {
  try {
    const workspace = await requireWorkspace(input.workspacePath);
    if (!input.allowCommandExecution) {
      const result = await invokeCodex(
        buildVerificationPrompt({
          expectedBehavior: input.expectedBehavior,
          verificationCommands: input.verificationCommands
        }),
        workspace,
        runner
      );
      if (result.exitCode !== 0) {
        return errorResult(
          `Codex verification planning failed.\n\nstderr:\n${result.stderr}\n\nstdout:\n${result.stdout}`
        );
      }
      return textResult(result.stdout);
    }

    const outputs: string[] = [];
    let anyCommandFailed = false;
    for (const commandText of input.verificationCommands ?? []) {
      const [command, args] = splitCommand(commandText);
      const result = await runner(command, args, { cwd: workspace, timeoutMs: 120_000 });
      const failed = result.exitCode !== 0 && result.exitCode !== null;
      if (failed) anyCommandFailed = true;
      outputs.push(
        [
          `## ${commandForDisplay(command, args)}`,
          `Exit code: ${result.exitCode}`,
          result.stdout ? `stdout:\n${result.stdout}` : "",
          result.stderr ? `stderr:\n${result.stderr}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      );
      outputs.push(`Command result: ${failed ? "FAILED" : "PASSED"}`);
    }

    const assessment = await invokeCodex(
      buildVerificationPrompt({
        expectedBehavior: input.expectedBehavior,
        verificationCommands: input.verificationCommands,
        commandOutput: outputs.join("\n\n")
      }),
      workspace,
      runner
    );
    const text = [
      "# Verification Evidence",
      outputs.length ? outputs.join("\n\n") : "No verification commands were provided.",
      "# Codex Assessment",
      assessment.stdout
    ].join("\n\n");

    if (anyCommandFailed) {
      return errorResult(text);
    }
    return assessment.exitCode === 0 ? textResult(text) : errorResult(text);
  } catch (error: unknown) {
    return toolErrorResult(error, "Failed to verify with Codex");
  }
}
