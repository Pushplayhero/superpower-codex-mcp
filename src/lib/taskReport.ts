import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

type TranscriptInput = {
  baseDir: string;
  prompt: string;
  stdout: string;
  stderr: string;
  diagnostics: unknown;
  now?: Date;
};

export async function writeCodingTaskTranscript(input: TranscriptInput): Promise<string> {
  const reportsDir = path.join(input.baseDir, "superpower", "reports");
  await mkdir(reportsDir, { recursive: true });

  const now = input.now ?? new Date();
  const filename = `${now.toISOString().replace(/:/g, "-")}-coding-task.json`;
  const fullPath = path.join(reportsDir, filename);

  const content = {
    timestamp: now.toISOString(),
    prompt: input.prompt,
    stdout: input.stdout,
    stderr: input.stderr,
    diagnostics: input.diagnostics
  };

  await writeFile(fullPath, JSON.stringify(content, null, 2));
  return fullPath;
}

export type SummaryPayload = Record<string, unknown>;

type PayloadInput = {
  responseDetail: "summary" | "full";
  summary: SummaryPayload;
  stdout: string;
};

export function buildMcpTaskPayload(input: PayloadInput): string {
  const payload: SummaryPayload = { ...input.summary };
  if (input.responseDetail === "full") {
    payload.rawOutput = input.stdout;
  }
  return JSON.stringify(payload, null, 2);
}
