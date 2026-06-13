import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { CommandRunner } from "../lib/command.js";
import { resolveCliInvocation, runCommand } from "../lib/command.js";
import {
  toolErrorResult,
  textResult,
  type McpTextResult
} from "../lib/mcp.js";
import { requireWorkspace } from "../lib/workspace.js";
import {
  normalizeCodingTaskContract,
  type CodingTaskInput,
  type NormalizedCodingTaskContract
} from "../lib/codingTaskContract.js";
import { buildCodingTaskPrompt } from "../lib/codingTaskPrompt.js";
import { classifyCodingTaskOutcome } from "../lib/codingTaskClassifier.js";
import { parseCodingTaskReport } from "../schema/report.js";
import {
  collectGitPostflight,
  collectGitPreflight
} from "../lib/git.js";
import {
  buildMcpTaskPayload,
  writeCodingTaskTranscript
} from "../lib/taskReport.js";
import {
  resolveAntigravityModel,
  buildAntigravityArgs,
  readAntigravityResponse,
  readLogFileForConversationId
} from "../lib/antigravity.js";

interface ProviderAdapter {
  cliCommand: string;
  buildArgs: (contract: NormalizedCodingTaskContract, prompt: string, context: { logFile: string }) => string[];
  parseResponse: (stdout: string, context: { logFile: string }) => Promise<{ responseText: string, report?: any }>;
}

function resolveAdapter(model: string | undefined): ProviderAdapter {
  resolveAntigravityModel(model);
  return {
    cliCommand: "antigravity",
    buildArgs: (contract, prompt, context) => {
      return buildAntigravityArgs(contract, prompt, context.logFile);
    },
    parseResponse: async (stdout, context) => {
      // 1. Try direct report parsing (handles test stubs & direct JSON output)
      const direct = parseCodingTaskReport(stdout);
      if (direct.report) {
        return { responseText: direct.responseText, report: direct.report };
      }

      // 2. Try reading the --log-file for conversation ID (real agy usage stdout is empty)
      try {
        const conversationId = await readLogFileForConversationId(context.logFile);
        const responseText = await readAntigravityResponse(conversationId);
        const transcriptParsed = parseCodingTaskReport(responseText);
        return { responseText, report: transcriptParsed.report };
      } catch {
        // 3. If all else fails, return stdout as-is
        return { responseText: stdout };
      }
    }
  };
}

export async function runCodingTaskHandler(
  input: CodingTaskInput,
  runner: CommandRunner = runCommand
): Promise<McpTextResult> {
  try {
    const contract = normalizeCodingTaskContract(input);
    const model = contract.model || "gemini-3.5-flash";
    if (!contract.allowExecution) {
      return toolErrorResult(
        new Error("Execution is disabled unless allowExecution is true."),
        "Failed to run coding task"
      );
    }

    const adapter = resolveAdapter(model);
    const workspace = await requireWorkspace(contract.workspacePath);
    let preflight:
      | { gitDir: string; head: string; status: string }
      | undefined;

    if (contract.strict) {
      try {
        preflight = await collectGitPreflight(workspace, runner);
      } catch (error) {
        return textResult(JSON.stringify({
          status: "contract_failed",
          summary: "Git preflight failed.",
          model,
          changedFiles: [],
          violations: [
            error instanceof Error ? error.message : String(error)
          ]
        }));
      }
      if (contract.requireCleanWorkspace && preflight.status) {
        return textResult(JSON.stringify({
          status: "contract_failed",
          summary: "Workspace must be clean before strict execution.",
          model,
          initialHead: preflight.head,
          changedFiles: [],
          violations: [preflight.status]
        }));
      }
    }

    const prompt = buildCodingTaskPrompt(contract);
    const invocation = resolveCliInvocation(adapter.cliCommand as any);
    const logFile = path.join(tmpdir(), `agy-${randomUUID()}.log`);
    const adapterContext = { logFile };
    
    const args = adapter.buildArgs(contract, prompt, adapterContext);

    const execution = await runner(
      invocation.command,
      [...invocation.prefixArgs, ...args],
      { cwd: workspace, timeoutMs: contract.timeoutSeconds * 1000 }
    );

    const parsed = await adapter.parseResponse(execution.stdout, adapterContext);
    let postflight:
      | { head: string; status: string; changedFiles: string[] }
      | undefined;
    let postflightError: string | undefined;

    if (preflight) {
      try {
        postflight = await collectGitPostflight(
          workspace,
          preflight.head,
          runner
        );
      } catch (error) {
        postflightError =
          error instanceof Error ? error.message : String(error);
      }
    }

    const processStatus =
      execution.exitCode === 0
        ? undefined
        : execution.timedOut
          ? "timed_out"
          : "execution_failed";

    const outcome = classifyCodingTaskOutcome({
      contract,
      responseText: parsed.responseText,
      report: parsed.report,
      initialHead: preflight?.head,
      finalHead: postflight?.head,
      changedFiles: postflight?.changedFiles ?? [],
      finalStatus: postflight?.status,
      processStatus,
      processError: execution.stderr,
      postflightError
    });

    const baseDir =
      preflight?.gitDir ?? path.join(tmpdir(), "superpower-coding");
    const transcriptPath = await writeCodingTaskTranscript({
      baseDir,
      prompt,
      stdout: execution.stdout,
      stderr: execution.stderr,
      diagnostics: {
        contract,
        parsedReport: parsed.report,
        preflight,
        postflight,
        outcome
      }
    });

    return textResult(buildMcpTaskPayload({
      responseDetail: contract.responseDetail,
      summary: {
        ...outcome,
        model,
        initialHead: preflight?.head,
        finalHead: postflight?.head,
        changedFiles: postflight?.changedFiles ?? [],
        transcriptPath
      },
      stdout: execution.stdout
    }));
  } catch (error: unknown) {
    return toolErrorResult(error, "Failed to run coding task");
  }
}
