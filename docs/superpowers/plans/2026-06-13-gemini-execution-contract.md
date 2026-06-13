# Gemini Execution Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `run_gemini_coding_task` into a backward-compatible, Git-verified execution contract that keeps verbose Gemini output out of Codex's default context.

**Architecture:** Keep the MCP tool handler as an orchestrator and move contract normalization, Gemini protocol parsing, Git evidence, and transcript persistence into focused library modules. Strict calls perform clean-workspace preflight, invoke Gemini in an explicit CLI mode, verify postflight Git facts, classify the result, persist full diagnostics, and return compact JSON.

**Tech Stack:** TypeScript 5.8, Node.js 20+, Zod 3, MCP SDK, Vitest, Gemini CLI, Git CLI.

---

## File Map

- Create `src/lib/geminiContract.ts`: input types, Zod fields, strict-mode detection, defaults, and validation.
- Create `src/lib/geminiProtocol.ts`: CLI arguments, contract prompt, Gemini JSON parsing, mode-mismatch detection, and result classification.
- Modify `src/lib/git.ts`: strict Git command helpers and before/after evidence.
- Create `src/lib/taskReport.ts`: transcript path selection, persistence, and compact MCP payload formatting.
- Modify `src/tools/runGeminiCodingTask.ts`: orchestration only.
- Modify `src/index.ts`: updated tool description only.
- Create `tests/geminiContract.test.ts`: normalization and path safety.
- Create `tests/geminiProtocol.test.ts`: prompt, parsing, mismatch, and status rules.
- Create `tests/git.test.ts`: Git evidence command and parsing behavior.
- Create `tests/taskReport.test.ts`: transcript persistence and summary/full behavior.
- Modify `tests/tools.test.ts`: end-to-end handler behavior with a sequenced fake runner.
- Modify `README.md`: strict invocation examples, statuses, and token-saving behavior.

## Task 1: Normalize the Execution Contract

**Files:**
- Create: `src/lib/geminiContract.ts`
- Create: `tests/geminiContract.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Create `tests/geminiContract.test.ts` with focused cases:

```ts
import { describe, expect, it } from "vitest";
import { normalizeGeminiContract } from "../src/lib/geminiContract.js";

describe("Gemini execution contract", () => {
  it("keeps a minimal call in legacy mode", () => {
    expect(
      normalizeGeminiContract({
        workspacePath: "C:\\repo",
        prompt: "Implement Task 2",
        allowExecution: true
      })
    ).toMatchObject({
      strict: false,
      mode: "execute",
      requireCommit: false,
      requireCleanWorkspace: false,
      responseDetail: "summary"
    });
  });

  it("enables strict execute defaults when a strict field is supplied", () => {
    expect(
      normalizeGeminiContract({
        workspacePath: "C:\\repo",
        prompt: "Implement Task 2",
        allowExecution: true,
        mode: "execute",
        planApproved: true
      })
    ).toMatchObject({
      strict: true,
      requireCommit: true,
      requireCleanWorkspace: true
    });
  });

  it("does not make response detail alone strict", () => {
    expect(
      normalizeGeminiContract({
        workspacePath: "C:\\repo",
        prompt: "Inspect output",
        allowExecution: true,
        responseDetail: "full"
      }).strict
    ).toBe(false);
  });

  it("requires an approved plan for strict execute mode", () => {
    expect(() =>
      normalizeGeminiContract({
        workspacePath: "C:\\repo",
        prompt: "Implement",
        allowExecution: true,
        mode: "execute"
      })
    ).toThrow(/planApproved/);
  });

  it("rejects commit requirements in plan mode", () => {
    expect(() =>
      normalizeGeminiContract({
        workspacePath: "C:\\repo",
        prompt: "Plan",
        allowExecution: true,
        mode: "plan",
        requireCommit: true
      })
    ).toThrow(/plan mode/i);
  });

  it.each(["..\\secret.ts", "/root.ts", "C:\\root.ts", "src/../secret.ts"])(
    "rejects unsafe allowlist path %s",
    (file) => {
      expect(() =>
        normalizeGeminiContract({
          workspacePath: "C:\\repo",
          prompt: "Implement",
          allowExecution: true,
          mode: "execute",
          planApproved: true,
          allowedFiles: [file]
        })
      ).toThrow(/repository-relative/);
    }
  );

  it("rejects duplicate acceptance criterion ids", () => {
    expect(() =>
      normalizeGeminiContract({
        workspacePath: "C:\\repo",
        prompt: "Implement",
        allowExecution: true,
        mode: "execute",
        planApproved: true,
        acceptanceCriteria: [
          { id: "AC-1", description: "First" },
          { id: "AC-1", description: "Duplicate" }
        ]
      })
    ).toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
npm.cmd test -- tests/geminiContract.test.ts
```

Expected: FAIL because `src/lib/geminiContract.ts` does not exist.

- [ ] **Step 3: Implement contract types and normalization**

Create `src/lib/geminiContract.ts` with:

```ts
import path from "node:path";
import { z } from "zod";

export const executionModeSchema = z.enum(["execute", "plan"]);
export const responseDetailSchema = z.enum(["summary", "full"]);
export const acceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1)
});

export const runGeminiCodingTaskSchema = {
  workspacePath: z.string().describe("Repository or workspace path."),
  prompt: z.string().min(1).describe("Prompt to pass to Gemini CLI."),
  allowExecution: z.boolean().default(false).describe("Must be true before invoking Gemini CLI."),
  timeoutSeconds: z.number().int().min(60).max(7200).default(1800),
  mode: executionModeSchema.optional(),
  planApproved: z.boolean().optional(),
  requireCommit: z.boolean().optional(),
  requireCleanWorkspace: z.boolean().optional(),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).optional(),
  allowedFiles: z.array(z.string()).optional(),
  responseDetail: responseDetailSchema.optional()
};

export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
export type ExecutionMode = z.infer<typeof executionModeSchema>;
export type ResponseDetail = z.infer<typeof responseDetailSchema>;

export type RunGeminiCodingTaskInput = {
  workspacePath: string;
  prompt: string;
  allowExecution?: boolean;
  timeoutSeconds?: number;
  mode?: ExecutionMode;
  planApproved?: boolean;
  requireCommit?: boolean;
  requireCleanWorkspace?: boolean;
  acceptanceCriteria?: AcceptanceCriterion[];
  allowedFiles?: string[];
  responseDetail?: ResponseDetail;
};

export type NormalizedGeminiContract = Required<
  Omit<RunGeminiCodingTaskInput, "acceptanceCriteria" | "allowedFiles">
> & {
  strict: boolean;
  acceptanceCriteria: AcceptanceCriterion[];
  allowedFiles: string[];
};

function normalizeAllowedFile(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`allowedFiles entries must be safe repository-relative paths: ${file}`);
  }
  return normalized.replace(/^\.\//, "");
}

export function normalizeGeminiContract(
  input: RunGeminiCodingTaskInput
): NormalizedGeminiContract {
  const criteria = input.acceptanceCriteria ?? [];
  const files = input.allowedFiles ?? [];
  const strict =
    input.mode !== undefined ||
    input.planApproved !== undefined ||
    input.requireCommit !== undefined ||
    input.requireCleanWorkspace !== undefined ||
    criteria.length > 0 ||
    files.length > 0;
  const mode = input.mode ?? "execute";
  const planApproved = input.planApproved ?? false;
  const requireCommit = input.requireCommit ?? (strict && mode === "execute");
  const requireCleanWorkspace =
    input.requireCleanWorkspace ?? (strict && mode === "execute");

  if (strict && mode === "execute" && !planApproved) {
    throw new Error("Strict execute mode requires planApproved: true.");
  }
  if (mode === "plan" && requireCommit) {
    throw new Error("Plan mode cannot require a commit.");
  }

  const ids = criteria.map((criterion) => criterion.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Acceptance criterion ids must not contain duplicates.");
  }

  return {
    workspacePath: input.workspacePath,
    prompt: input.prompt,
    allowExecution: input.allowExecution ?? false,
    timeoutSeconds: input.timeoutSeconds ?? 1800,
    mode,
    planApproved,
    requireCommit,
    requireCleanWorkspace,
    acceptanceCriteria: criteria,
    allowedFiles: [...new Set(files.map(normalizeAllowedFile))],
    responseDetail: input.responseDetail ?? "summary",
    strict
  };
}
```

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run:

```powershell
npm.cmd test -- tests/geminiContract.test.ts
```

Expected: all contract tests PASS.

- [ ] **Step 5: Commit if the package has been placed in a Git repository**

```powershell
git add -- src/lib/geminiContract.ts tests/geminiContract.test.ts
git commit -m "feat: define Gemini execution contract"
```

If `git rev-parse --is-inside-work-tree` fails, record that commits are
unavailable and continue without initializing a repository.

## Task 2: Build and Parse the Gemini Protocol

**Files:**
- Create: `src/lib/geminiProtocol.ts`
- Create: `tests/geminiProtocol.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Cover these exported functions:

```ts
import { describe, expect, it } from "vitest";
import {
  buildGeminiArgs,
  buildGeminiContractPrompt,
  classifyGeminiOutcome,
  parseGeminiEnvelope
} from "../src/lib/geminiProtocol.js";
import { normalizeGeminiContract } from "../src/lib/geminiContract.js";

const strictContract = normalizeGeminiContract({
  workspacePath: "C:\\repo",
  prompt: "Implement sync",
  allowExecution: true,
  mode: "execute",
  planApproved: true,
  acceptanceCriteria: [{ id: "AC-1", description: "Sync succeeds" }],
  allowedFiles: ["src/sync.ts", "tests/sync.test.ts"]
});

describe("Gemini protocol", () => {
  it("maps execute to yolo and plan to plan approval mode", () => {
    expect(buildGeminiArgs(strictContract, "PROMPT")).toEqual([
      "-p", "PROMPT", "--approval-mode", "yolo", "--output-format", "json"
    ]);
    const plan = normalizeGeminiContract({
      workspacePath: "C:\\repo",
      prompt: "Plan",
      allowExecution: true,
      mode: "plan"
    });
    expect(buildGeminiArgs(plan, "PROMPT")).toContain("plan");
  });

  it("includes execution flags, acceptance ids, and allowlisted files", () => {
    const prompt = buildGeminiContractPrompt(strictContract);
    expect(prompt).toContain("EXECUTION_PHASE=IMPLEMENT");
    expect(prompt).toContain("PLAN_APPROVED=true");
    expect(prompt).toContain("AC-1");
    expect(prompt).toContain("src/sync.ts");
    expect(prompt).toContain("Implement sync");
  });

  it("extracts a structured report from the Gemini JSON envelope", () => {
    const report = {
      status: "committed",
      summary: "Done",
      commitSha: "abc123",
      changedFiles: ["src/sync.ts"],
      acceptanceMatrix: [{
        criterionId: "AC-1",
        testNames: ["syncs data"],
        result: "PASS"
      }]
    };
    expect(
      parseGeminiEnvelope(JSON.stringify({ response: JSON.stringify(report) }))
    ).toMatchObject({ report });
  });

  it("parses a fenced JSON report", () => {
    const response = "```json\n" + JSON.stringify({
      status: "tests_passed",
      summary: "Done",
      changedFiles: [],
      acceptanceMatrix: []
    }) + "\n```";
    expect(parseGeminiEnvelope(JSON.stringify({ response })).report?.status)
      .toBe("tests_passed");
  });

  it("classifies a request for approval as mode_mismatch", () => {
    expect(
      classifyGeminiOutcome({
        contract: strictContract,
        responseText: "I have prepared the plan. Please approve it before implementation.",
        report: undefined,
        initialHead: "a",
        finalHead: "a",
        changedFiles: []
      }).status
    ).toBe("mode_mismatch");
  });

  it("downgrades incomplete acceptance evidence", () => {
    expect(
      classifyGeminiOutcome({
        contract: strictContract,
        responseText: "Done",
        report: {
          status: "committed",
          summary: "Done",
          commitSha: "b",
          changedFiles: ["src/sync.ts"],
          acceptanceMatrix: []
        },
        initialHead: "a",
        finalHead: "b",
        changedFiles: ["src/sync.ts"]
      }).status
    ).toBe("implemented_unverified");
  });
});
```

- [ ] **Step 2: Run protocol tests and confirm RED**

Run:

```powershell
npm.cmd test -- tests/geminiProtocol.test.ts
```

Expected: FAIL because `geminiProtocol.ts` does not exist.

- [ ] **Step 3: Implement protocol schemas and prompt generation**

Create `src/lib/geminiProtocol.ts`. Define:

```ts
import { z } from "zod";
import type { NormalizedGeminiContract } from "./geminiContract.js";

const matrixEntrySchema = z.object({
  criterionId: z.string(),
  testNames: z.array(z.string()),
  result: z.enum(["PASS", "FAIL", "NOT_RUN"]),
  evidence: z.string().optional()
});

export const geminiTaskReportSchema = z.object({
  status: z.enum(["implemented_unverified", "tests_passed", "committed"]),
  summary: z.string(),
  commitSha: z.string().optional(),
  changedFiles: z.array(z.string()),
  acceptanceMatrix: z.array(matrixEntrySchema),
  tddEvidence: z.object({
    redCommand: z.string().optional(),
    failingTests: z.array(z.string()).optional(),
    assertionSummary: z.string().optional(),
    greenCommand: z.string().optional(),
    passingTestCount: z.number().int().nonnegative().optional(),
    diffCheck: z.enum(["PASS", "FAIL", "NOT_RUN"]).optional()
  }).optional(),
  commandsRun: z.array(z.string()).optional()
});

export type GeminiTaskReport = z.infer<typeof geminiTaskReportSchema>;

export function buildGeminiArgs(
  contract: NormalizedGeminiContract,
  prompt: string
): string[] {
  return [
    "-p",
    prompt,
    "--approval-mode",
    contract.mode === "plan" ? "plan" : "yolo",
    "--output-format",
    "json"
  ];
}
```

`buildGeminiContractPrompt` must return the original prompt unchanged for a
legacy call. For strict calls it must serialize the criteria and allowlist,
state that network access and unnecessary subagents are prohibited, require
TDD and a commit when configured, and require one final JSON object matching
`GeminiTaskReport`.

- [ ] **Step 4: Implement envelope parsing and classification**

Implement:

```ts
export type ParsedGeminiEnvelope = {
  responseText: string;
  report?: GeminiTaskReport;
  envelope?: unknown;
};

function stripJsonFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : text.trim();
}

export function parseGeminiEnvelope(stdout: string): ParsedGeminiEnvelope {
  const envelope = JSON.parse(stdout) as { response?: unknown };
  const responseText =
    typeof envelope.response === "string" ? envelope.response : "";
  const parsed = JSON.parse(stripJsonFence(responseText));
  const result = geminiTaskReportSchema.safeParse(parsed);
  return {
    responseText,
    report: result.success ? result.data : undefined,
    envelope
  };
}
```

Make parsing tolerant: invalid outer JSON or a non-JSON response returns
`responseText` and no report instead of throwing. Add
`classifyGeminiOutcome(...)` with the precedence defined in the approved
design. Mode mismatch patterns must require an approval/request phrase, such
as `/please approve|awaiting approval|after approval|plan mode is active/i`;
do not classify the mere word "plan".

- [ ] **Step 5: Run protocol tests and confirm GREEN**

Run:

```powershell
npm.cmd test -- tests/geminiProtocol.test.ts
```

Expected: all protocol tests PASS.

- [ ] **Step 6: Commit if Git is available**

```powershell
git add -- src/lib/geminiProtocol.ts tests/geminiProtocol.test.ts
git commit -m "feat: add Gemini task protocol"
```

## Task 3: Collect Authoritative Git Evidence

**Files:**
- Modify: `src/lib/git.ts`
- Create: `tests/git.test.ts`

- [ ] **Step 1: Write failing Git evidence tests**

Use a sequenced fake runner and assert exact commands:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  collectGitPostflight,
  collectGitPreflight
} from "../src/lib/git.js";
import type { CommandRunner } from "../src/lib/command.js";

function sequencedRunner(outputs: Array<{ stdout: string; exitCode?: number }>): CommandRunner {
  return vi.fn(async (command, args) => {
    const next = outputs.shift();
    if (!next) throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    return {
      command,
      args,
      stdout: next.stdout,
      stderr: next.exitCode ? "failed" : "",
      exitCode: next.exitCode ?? 0,
      timedOut: false
    };
  });
}

describe("Git evidence", () => {
  it("collects git dir, head, and clean status", async () => {
    const runner = sequencedRunner([
      { stdout: ".git\n" },
      { stdout: "aaa111\n" },
      { stdout: "" }
    ]);
    await expect(collectGitPreflight("C:\\repo", runner)).resolves.toEqual({
      gitDir: expect.stringContaining(".git"),
      head: "aaa111",
      status: ""
    });
  });

  it("throws when a required Git command fails", async () => {
    const runner = sequencedRunner([{ stdout: "", exitCode: 128 }]);
    await expect(collectGitPreflight("C:\\repo", runner))
      .rejects.toThrow(/rev-parse --git-dir/);
  });

  it("collects final head, status, and committed files", async () => {
    const runner = sequencedRunner([
      { stdout: "bbb222\n" },
      { stdout: "" },
      { stdout: "src/a.ts\ntests/a.test.ts\n" }
    ]);
    await expect(
      collectGitPostflight("C:\\repo", "aaa111", runner)
    ).resolves.toEqual({
      head: "bbb222",
      status: "",
      changedFiles: ["src/a.ts", "tests/a.test.ts"]
    });
  });
});
```

- [ ] **Step 2: Run Git tests and confirm RED**

Run:

```powershell
npm.cmd test -- tests/git.test.ts
```

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Add strict Git command handling**

Preserve `gitStatus`, `gitDiff`, and `gitDiffForFiles` for existing tools.
Add:

```ts
import path from "node:path";

async function runGit(
  workspacePath: string,
  args: string[],
  runner: CommandRunner
): Promise<string> {
  const result = await runner("git", args, {
    cwd: workspacePath,
    timeoutMs: 30_000
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.trim() || "unknown error"}`
    );
  }
  return result.stdout.trim();
}

export async function collectGitPreflight(
  workspacePath: string,
  runner: CommandRunner = runCommand
) {
  const gitDirRaw = await runGit(workspacePath, ["rev-parse", "--git-dir"], runner);
  const head = await runGit(workspacePath, ["rev-parse", "HEAD"], runner);
  const status = await runGit(
    workspacePath,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    runner
  );
  return {
    gitDir: path.resolve(workspacePath, gitDirRaw),
    head,
    status
  };
}

export async function collectGitPostflight(
  workspacePath: string,
  initialHead: string,
  runner: CommandRunner = runCommand
) {
  const head = await runGit(workspacePath, ["rev-parse", "HEAD"], runner);
  const status = await runGit(
    workspacePath,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    runner
  );
  const names = await runGit(
    workspacePath,
    ["diff", "--name-only", "--no-renames", `${initialHead}..${head}`, "--"],
    runner
  );
  return {
    head,
    status,
    changedFiles: names ? names.split(/\r?\n/).filter(Boolean) : []
  };
}
```

- [ ] **Step 4: Run Git tests and existing review tests**

Run:

```powershell
npm.cmd test -- tests/git.test.ts tests/tools.test.ts
```

Expected: all selected tests PASS; existing review helpers remain compatible.

- [ ] **Step 5: Commit if Git is available**

```powershell
git add -- src/lib/git.ts tests/git.test.ts
git commit -m "feat: collect Git execution evidence"
```

## Task 4: Persist Full Diagnostics and Return Compact Results

**Files:**
- Create: `src/lib/taskReport.ts`
- Create: `tests/taskReport.test.ts`

- [ ] **Step 1: Write failing report tests**

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMcpTaskPayload,
  writeGeminiTaskTranscript
} from "../src/lib/taskReport.js";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((entry) =>
    rm(entry, { recursive: true, force: true })
  ));
});

describe("Gemini task reports", () => {
  it("writes full diagnostics below the Git metadata directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gemini-report-"));
    created.push(root);
    const reportPath = await writeGeminiTaskTranscript({
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
        transcriptPath: "C:\\repo\\.git\\superpower\\reports\\one.json"
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
        transcriptPath: "report.json"
      },
      stdout: "FULL OUTPUT"
    });
    expect(payload).toContain("FULL OUTPUT");
  });
});
```

- [ ] **Step 2: Run report tests and confirm RED**

Run:

```powershell
npm.cmd test -- tests/taskReport.test.ts
```

Expected: FAIL because `taskReport.ts` does not exist.

- [ ] **Step 3: Implement transcript persistence**

Create `src/lib/taskReport.ts` using `mkdir` and `writeFile` from
`node:fs/promises`. Build filenames as
`YYYY-MM-DDTHH-mm-ss-sssZ-gemini-task.json` and write beneath
`<baseDir>/superpower/reports/`.

The serialized object must contain only explicitly supplied fields:

```ts
type TranscriptInput = {
  baseDir: string;
  prompt: string;
  stdout: string;
  stderr: string;
  diagnostics: unknown;
  now?: Date;
};
```

Do not serialize `process.env`, CLI authentication files, or inherited command
options.

- [ ] **Step 4: Implement compact payload formatting**

`buildMcpTaskPayload` must JSON-stringify a stable summary object. Append
`rawGeminiOutput` only when `responseDetail === "full"`.

- [ ] **Step 5: Run report tests and confirm GREEN**

Run:

```powershell
npm.cmd test -- tests/taskReport.test.ts
```

Expected: all report tests PASS.

- [ ] **Step 6: Commit if Git is available**

```powershell
git add -- src/lib/taskReport.ts tests/taskReport.test.ts
git commit -m "feat: persist Gemini task diagnostics"
```

## Task 5: Integrate Strict Orchestration

**Files:**
- Modify: `src/tools/runGeminiCodingTask.ts`
- Modify: `tests/tools.test.ts`

- [ ] **Step 1: Add a sequenced fake runner to handler tests**

In `tests/tools.test.ts`, add:

```ts
function sequencedRunner(
  outputs: Array<{
    stdout: string;
    stderr?: string;
    exitCode?: number;
    timedOut?: boolean;
  }>
): CommandRunner {
  return vi.fn(async (command, args) => {
    const next = outputs.shift();
    if (!next) throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    return {
      command,
      args,
      stdout: next.stdout,
      stderr: next.stderr ?? "",
      exitCode: next.exitCode ?? 0,
      timedOut: next.timedOut ?? false
    };
  });
}
```

- [ ] **Step 2: Write failing strict preflight tests**

Add tests proving:

- A non-Git strict workspace returns JSON state `contract_failed`.
- A dirty strict workspace returns `contract_failed`.
- Gemini is not called after either preflight failure.

Use a fake runner sequence for:

```text
git rev-parse --git-dir -> ".git"
git rev-parse HEAD -> "aaa"
git status --porcelain=v1 --untracked-files=all -> " M src/a.ts"
```

Assert no call has an argument equal to `--approval-mode`.

- [ ] **Step 3: Write failing successful strict-execution test**

Use this sequence:

```text
preflight git dir -> ".git"
preflight HEAD -> "aaa"
preflight status -> ""
Gemini stdout -> {"response":"<structured report JSON>"}
postflight HEAD -> "bbb"
postflight status -> ""
postflight changed files -> "src/a.ts\ntests/a.test.ts"
```

Call the handler with:

```ts
{
  workspacePath: workspace,
  prompt: "Implement A",
  allowExecution: true,
  mode: "execute",
  planApproved: true,
  requireCommit: true,
  acceptanceCriteria: [{ id: "AC-1", description: "A works" }],
  allowedFiles: ["src/a.ts", "tests/a.test.ts"]
}
```

Assert:

- Gemini arguments contain `--approval-mode`, `yolo`.
- Result JSON state is `committed`.
- Result includes final HEAD `bbb`.
- Result contains verified changed files.
- Result does not contain the full raw response.
- The returned transcript path exists.

- [ ] **Step 4: Write failing contract-classification tests**

Add handler tests for:

- Gemini asks for approval -> `mode_mismatch`.
- Gemini changes `src/forbidden.ts` -> `contract_failed`.
- Required commit but HEAD remains unchanged -> `contract_failed`.
- Missing acceptance entry -> `implemented_unverified`.
- Malformed strict response -> `contract_failed`.
- Timed-out Gemini -> `timed_out`.
- Failed Gemini process -> `execution_failed`.
- `responseDetail: "full"` includes raw output.

- [ ] **Step 5: Run handler tests and confirm RED**

Run:

```powershell
npm.cmd test -- tests/tools.test.ts
```

Expected: new strict tests FAIL while existing legacy tests continue to pass.

- [ ] **Step 6: Refactor the handler into orchestration**

Replace local schema and input types with imports from `geminiContract.ts`.
Implement the handler with this control flow:

```ts
import path from "node:path";
import { tmpdir } from "node:os";
import {
  normalizeGeminiContract,
  runGeminiCodingTaskSchema,
  type RunGeminiCodingTaskInput
} from "../lib/geminiContract.js";
import {
  buildGeminiArgs,
  buildGeminiContractPrompt,
  classifyGeminiOutcome,
  parseGeminiEnvelope
} from "../lib/geminiProtocol.js";
import {
  collectGitPostflight,
  collectGitPreflight
} from "../lib/git.js";
import {
  buildMcpTaskPayload,
  writeGeminiTaskTranscript
} from "../lib/taskReport.js";

export async function runGeminiCodingTaskHandler(
  input: RunGeminiCodingTaskInput,
  runner: CommandRunner = runCommand
): Promise<McpTextResult> {
  try {
    const contract = normalizeGeminiContract(input);
    if (!contract.allowExecution) {
      return errorResult(
        "Gemini execution is disabled unless allowExecution is true."
      );
    }

    const workspace = resolveWorkspace(contract.workspacePath);
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
          initialHead: preflight.head,
          changedFiles: [],
          violations: [preflight.status]
        }));
      }
    }

    const prompt = buildGeminiContractPrompt(contract);
    const gemini = resolveCliInvocation("gemini");
    const execution = await runner(
      gemini.command,
      [...gemini.prefixArgs, ...buildGeminiArgs(contract, prompt)],
      { cwd: workspace, timeoutMs: contract.timeoutSeconds * 1000 }
    );

    const parsed = parseGeminiEnvelope(execution.stdout);
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

    const outcome = classifyGeminiOutcome({
      contract,
      responseText: parsed.responseText,
      report: parsed.report,
      initialHead: preflight?.head,
      finalHead: postflight?.head,
      changedFiles: postflight?.changedFiles ?? [],
      processStatus,
      processError: execution.stderr,
      postflightError
    });

    const baseDir =
      preflight?.gitDir ?? path.join(tmpdir(), "superpower-gemini");
    const transcriptPath = await writeGeminiTaskTranscript({
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
        initialHead: preflight?.head,
        finalHead: postflight?.head,
        changedFiles: postflight?.changedFiles ?? [],
        transcriptPath
      },
      stdout: execution.stdout
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to run Gemini coding task: ${message}`);
  }
}
```

Extend the `classifyGeminiOutcome` input type in
`src/lib/geminiProtocol.ts` with:

```ts
processStatus?: "timed_out" | "execution_failed";
processError?: string;
postflightError?: string;
```

Classification precedence must be:

```ts
if (input.processStatus) {
  return {
    status: input.processStatus,
    summary: input.processStatus === "timed_out"
      ? "Gemini exceeded the configured timeout."
      : "Gemini CLI failed.",
    acceptanceMatrix: input.report?.acceptanceMatrix ?? [],
    violations: input.processError ? [input.processError] : []
  };
}
if (input.postflightError) {
  return {
    status: "execution_failed",
    summary: "Git postflight verification failed.",
    acceptanceMatrix: input.report?.acceptanceMatrix ?? [],
    violations: [input.postflightError]
  };
}
```

After these process checks, apply mode-mismatch, malformed-report,
file-allowlist, commit, and acceptance-evidence rules in that order.

The actual handler must not return between Gemini execution and transcript
persistence. Preflight failures may return immediately because no Gemini
transcript exists yet.

For legacy calls:

- Do not require Git.
- Use the original user prompt.
- Keep explicit `--approval-mode yolo` because `allowExecution: true` grants
  coding execution.
- Parse the envelope when possible.
- Return compact JSON by default.
- Store the transcript in `path.join(tmpdir(), "superpower-gemini")`.

Use `errorResult` only for invalid permission, invalid input, or an unexpected
wrapper exception. Expected execution states such as `contract_failed`,
`timed_out`, and `mode_mismatch` should be valid text results containing their
machine-readable state.

- [ ] **Step 7: Run handler tests and confirm GREEN**

Run:

```powershell
npm.cmd test -- tests/tools.test.ts
```

Expected: all handler tests PASS.

- [ ] **Step 8: Run all unit tests**

Run:

```powershell
npm.cmd test
```

Expected: all test files PASS.

- [ ] **Step 9: Commit if Git is available**

```powershell
git add -- src/tools/runGeminiCodingTask.ts tests/tools.test.ts
git commit -m "feat: enforce Gemini execution contracts"
```

## Task 6: Update MCP Description and Usage Documentation

**Files:**
- Modify: `src/index.ts`
- Modify: `README.md`

- [ ] **Step 1: Update the tool description**

Change the `run_gemini_coding_task` description to:

```ts
"Invoke Gemini CLI for coding. Supports strict execute/plan contracts, Git-verified commits and file scope, acceptance-test traceability, and compact responses with persisted diagnostics."
```

- [ ] **Step 2: Add strict usage documentation**

Add a README example:

```json
{
  "workspacePath": "C:\\path\\to\\repo",
  "prompt": "Implement Task 2 using TDD.",
  "allowExecution": true,
  "timeoutSeconds": 1800,
  "mode": "execute",
  "planApproved": true,
  "requireCommit": true,
  "requireCleanWorkspace": true,
  "acceptanceCriteria": [
    {
      "id": "AC-1",
      "description": "Every affected recursive branch defers cost updates when conversion is missing."
    }
  ],
  "allowedFiles": [
    "erp/services.py",
    "erp/recipe_sync.py",
    "tests/test_recipe_sync.py"
  ],
  "responseDetail": "summary"
}
```

Document:

- Legacy calls remain supported.
- Strict execute requires `planApproved: true`.
- Execute uses Gemini CLI `--approval-mode yolo`; callers should use an
  isolated, clean worktree and a narrow file allowlist.
- `committed` is not `review_passed`.
- Codex must inspect the diff and independently rerun tests.
- Full transcripts live under the repository Git metadata directory.
- `responseDetail: "full"` is for diagnostics and consumes more Codex tokens.

- [ ] **Step 3: Verify the MCP schema builds**

Run:

```powershell
npm.cmd run typecheck
npm.cmd run build
```

Expected: both commands exit 0.

- [ ] **Step 4: Commit if Git is available**

```powershell
git add -- src/index.ts README.md
git commit -m "docs: describe strict Gemini execution"
```

## Task 7: Final Review and Verification

**Files:**
- Review all files listed in the File Map.

- [ ] **Step 1: Run the complete test suite**

```powershell
npm.cmd test
```

Expected: all tests PASS with zero failed tests.

- [ ] **Step 2: Run static verification**

```powershell
npm.cmd run typecheck
npm.cmd run build
```

Expected: both commands exit 0 with no TypeScript errors.

- [ ] **Step 3: Inspect generated changes**

If Git is available:

```powershell
git status --short
git diff --check
git diff --stat
```

Expected:

- No whitespace errors.
- Only planned source, test, documentation, and generated `dist` files are
  changed.
- No transcript appears in the working tree.

If Git is unavailable, list the modified files with:

```powershell
Get-ChildItem src,tests,docs -Recurse -File |
  Sort-Object FullName |
  Select-Object FullName,LastWriteTime
```

- [ ] **Step 4: Perform Codex findings-first review**

Review these risks explicitly:

- False positive mode-mismatch detection.
- Strict calls accidentally accepting malformed Gemini reports.
- Git command failures being mistaken for clean status.
- Allowlist comparisons across Windows and POSIX separators.
- Transcript files polluting the working tree.
- Legacy behavior accidentally requiring Git.
- Raw Gemini output leaking into summary mode.
- Gemini being allowed to claim `review_passed`.

- [ ] **Step 5: Run one controlled smoke test only after unit review**

Use a disposable clean Git repository under an allowed root. Invoke
`run_gemini_coding_task` with a harmless task that creates one allowlisted text
file and one test, requires a commit, and has a short acceptance matrix.

Expected:

- Returned state is `committed`.
- HEAD advances.
- Verified changed files remain inside the allowlist.
- Summary response is compact.
- Transcript exists below `.git/superpower/reports`.
- Codex independently verifies the resulting commit before calling the smoke
  test successful.

Do not run the smoke test against the user's active ERP repository.

## Notes for the Implementing Agent

- The package directory currently has no `.git` metadata. Do not initialize a
  repository unless the user explicitly requests it.
- Do not edit Codex Desktop custom instructions in this implementation.
- Do not add an asynchronous job manager.
- Do not let Gemini call `run_gemini_coding_task` recursively.
- Keep full implementation effort in Gemini CLI; Codex remains responsible
  for architecture, findings-first review, and independent verification.
