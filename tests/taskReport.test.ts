import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMcpTaskPayload,
  writeCodingTaskTranscript
} from "../src/lib/taskReport.js";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((entry) =>
    rm(entry, { recursive: true, force: true })
  ));
});

describe("Coding task reports", () => {
  it("writes full diagnostics below the Git metadata directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gemini-report-"));
    created.push(root);
    const reportPath = await writeCodingTaskTranscript({
      baseDir: root,
      prompt: "SECRET-FREE PROMPT",
      stdout: "FULL STDOUT",
      stderr: "",
      diagnostics: { status: "committed" },
      now: new Date("2026-06-13T01:02:03Z")
    });
    expect(reportPath).toContain(path.join("superpower", "reports"));
    expect(await readFile(reportPath, "utf8")).toContain("FULL STDOUT");
  });

  it("omits verbose stdout in summary mode", () => {
    const payload = buildMcpTaskPayload({
      responseDetail: "summary",
      summary: {
        status: "committed",
        summary: "Done",
        changedFiles: ["src/a.ts"],
        violations: [],
        transcriptPath: "C:\\repo\\.git\\superpower\\reports\\one.json",
        acceptanceMatrix: []
      },
      stdout: "VERY LARGE OUTPUT"
    });
    expect(payload).not.toContain("VERY LARGE OUTPUT");
  });

  it("includes verbose stdout only in full mode", () => {
    const payload = buildMcpTaskPayload({
      responseDetail: "full",
      summary: {
        status: "committed",
        summary: "Done",
        changedFiles: [],
        violations: [],
        transcriptPath: "report.json",
        acceptanceMatrix: []
      },
      stdout: "FULL OUTPUT"
    });
    expect(payload).toContain("FULL OUTPUT");
  });
});
