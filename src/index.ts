#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runCodingTaskSchema } from "./lib/codingTaskContract.js";
import { runCodingTaskHandler } from "./tools/runCodingTask.js";
import {
  runGeminiCodingTaskHandler,
  runGeminiCodingTaskSchema
} from "./tools/runGeminiCodingTask.js";
import {
  runDevelopmentWorkflowHandler,
  runDevelopmentWorkflowSchema
} from "./tools/runDevelopmentWorkflow.js";
import {
  reviewCodeQualityHandler,
  reviewCodeQualitySchema
} from "./tools/reviewCodeQuality.js";
import { debugWithCodexHandler, debugWithCodexSchema } from "./tools/debugWithCodex.js";
import { planWithCodexHandler, planWithCodexSchema } from "./tools/planWithCodex.js";
import { reviewWithCodexHandler, reviewWithCodexSchema } from "./tools/reviewWithCodex.js";
import {
  summarizeRepoContextHandler,
  summarizeRepoContextSchema
} from "./tools/summarizeRepoContext.js";
import {
  validateWorkspaceHandler,
  validateWorkspaceSchema
} from "./tools/validateWorkspace.js";
import { verifyWithCodexHandler, verifyWithCodexSchema } from "./tools/verifyWithCodex.js";

const COMMON_DESCRIPTION =
  "Supports strict execute/plan contracts, Git-verified commits and file scope, " +
  "acceptance-test traceability, and compact responses with persisted diagnostics.";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "superpower-codex-mcp",
    version: "0.1.0"
  });

  server.tool(
    "validate_workspace",
    "Validate and canonicalize a workspace before loading context or starting Gemini. Returns structured authorization and capability diagnostics without modifying files or invoking a model.",
    validateWorkspaceSchema,
    (input) => validateWorkspaceHandler(input)
  );

  server.tool(
    "summarize_repo_context",
    "Read repository instruction files such as AGENTS.md and GEMINI.md. Returns startup context for Gemini CLI before coding.",
    summarizeRepoContextSchema,
    (input) => summarizeRepoContextHandler(input)
  );

  server.tool(
    "plan_with_codex",
    "Ask Codex to create a Superpowers-style implementation plan before Gemini CLI edits code. Returns and saves the plan.",
    planWithCodexSchema,
    (input) => planWithCodexHandler(input)
  );

  server.tool(
    "review_with_codex",
    "Ask Codex to review the current diff or selected files. Returns findings first, ordered by severity.",
    reviewWithCodexSchema,
    (input) => reviewWithCodexHandler(input)
  );

  server.tool(
    "debug_with_codex",
    "Ask Codex to analyze a failure using systematic debugging without applying fixes.",
    debugWithCodexSchema,
    (input) => debugWithCodexHandler(input)
  );

  server.tool(
    "verify_with_codex",
    "Gate completion claims. Plans verification or runs explicitly allowed commands and asks Codex to assess the evidence.",
    verifyWithCodexSchema,
    (input) => verifyWithCodexHandler(input)
  );

  server.tool(
    "run_development_workflow",
    "Orchestrate plan, implement, review, fix, and verify stages. " +
      "Codex plans, reviews, and verifies; Antigravity executes coding and fix iterations.",
    runDevelopmentWorkflowSchema,
    (input) => runDevelopmentWorkflowHandler(input)
  );

  server.tool(
    "review_code_quality",
    "Static analysis pre-filter for Codex. Scans TypeScript files for `as any` casts, empty catch blocks, hardcoded secrets, console.log, TODO comments, and other structural issues — all without calling an LLM. Run before Codex review to save token costs.",
    reviewCodeQualitySchema,
    (input) => reviewCodeQualityHandler(input)
  );

  server.tool(
    "run_gemini_coding_task",
    "Deprecated compatibility alias for run_antigravity_coding_task. " +
      `Invokes Antigravity CLI for coding. ${COMMON_DESCRIPTION}`,
    runGeminiCodingTaskSchema,
    (input) => runGeminiCodingTaskHandler(input)
  );

  server.tool(
    "run_antigravity_coding_task",
    "Canonical coding execution tool. Invokes Antigravity CLI while Codex retains " +
      `planning, review, debugging, and verification responsibilities. ${COMMON_DESCRIPTION}`,
    runCodingTaskSchema,
    (input) => runCodingTaskHandler(input)
  );

  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
