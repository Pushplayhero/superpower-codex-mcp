import { z } from "zod";
import {
  textResult,
  toolErrorResult,
  type McpTextResult
} from "../lib/mcp.js";
import {
  collectInstructionFiles,
  requireWorkspace
} from "../lib/workspace.js";

export const summarizeRepoContextSchema = {
  workspacePath: z.string().describe("Repository or workspace path to summarize."),
  includeFiles: z.array(z.string()).default([]).describe("Additional relative files to include."),
  maxChars: z.number().int().min(1000).max(100_000).default(40_000).describe("Maximum characters to read.")
};

export type SummarizeRepoContextInput = {
  workspacePath: string;
  includeFiles?: string[];
  maxChars?: number;
};

export async function summarizeRepoContextHandler(
  input: SummarizeRepoContextInput
): Promise<McpTextResult> {
  try {
    const workspace = await requireWorkspace(input.workspacePath);
    const files = await collectInstructionFiles(
      workspace,
      input.includeFiles ?? [],
      input.maxChars ?? 40_000
    );
    if (files.length === 0) {
      return textResult(
        `Workspace: ${workspace}\n\nNo AGENTS.md, GEMINI.md, README.md, or requested context files were found.`
      );
    }

    const sections = files.map((file) => `## ${file.relativePath}\n\n${file.text.trim()}`);
    return textResult(`Workspace: ${workspace}\n\n${sections.join("\n\n")}`);
  } catch (error: unknown) {
    return toolErrorResult(error, "Failed to summarize repository context");
  }
}
