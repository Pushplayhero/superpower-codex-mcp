# Gemini Execution Contract Design

Date: 2026-06-13

## Context

The existing `run_gemini_coding_task` tool validates workspace access and
execution permission, then forwards a free-form prompt to Gemini CLI. It
returns Gemini's complete stdout without checking whether Gemini entered the
requested mode, created a commit, stayed within the intended file scope, or
provided test evidence for every acceptance criterion.

The observation report from 2026-06-12 showed that the overall division of
responsibility works:

- Codex plans architecture, defines acceptance criteria, reviews changes, and
  performs independent verification.
- Gemini CLI performs most coding, TDD, focused testing, and commits.
- The MCP wrapper coordinates execution and enforces mechanical constraints.

The main design goal is to make this arrangement more reliable while reducing
the amount of Gemini output that Codex must consume.

## Goals

1. Preserve compatibility with existing minimal tool calls.
2. Prevent an approved implementation task from silently entering Plan Mode.
3. Verify commit creation and changed-file scope using Git rather than agent
   claims.
4. Require acceptance criteria to be traceable to named tests when strict
   validation is requested.
5. Keep Gemini responsible for implementation work while Codex retains
   architecture, review, and final verification authority.
6. Return concise structured summaries to Codex and store verbose Gemini
   output on disk.
7. Produce explicit, machine-readable execution states.

## Non-Goals

- Building an asynchronous job queue with start, status, and cancel tools.
- Replacing Codex review or independent verification.
- Updating Codex Desktop custom instructions in this change.
- Preventing Gemini from reading repository files needed to understand code.
- Treating a Gemini commit as final approval.

## Compatibility Model

The current input remains valid:

```json
{
  "workspacePath": "C:\\path\\to\\repo",
  "prompt": "Implement Task 2",
  "allowExecution": true,
  "timeoutSeconds": 1800
}
```

Calls that omit the new contract fields retain legacy behavior. They execute
Gemini and return a concise best-effort summary, but do not claim strict
contract validation.

Strict validation is enabled when the caller supplies `mode`, `planApproved`,
`requireCommit`, `requireCleanWorkspace`, a non-empty `acceptanceCriteria`,
or a non-empty `allowedFiles`. `timeoutSeconds` and `responseDetail` do not
enable strict validation by themselves. The wrapper applies compatible
defaults for the remaining fields.

## Input Contract

The tool adds these optional fields:

```ts
type ExecutionMode = "execute" | "plan";

type AcceptanceCriterion = {
  id: string;
  description: string;
};

type RunGeminiCodingTaskInput = {
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
  responseDetail?: "summary" | "full";
};
```

Defaults:

- `mode`: `"execute"` when `allowExecution` is true.
- `planApproved`: `false`.
- `requireCommit`: `false` for legacy calls and `true` for strict execute
  calls.
- `requireCleanWorkspace`: `false` for legacy calls and `true` for strict
  calls.
- `acceptanceCriteria`: empty.
- `allowedFiles`: empty, meaning no file allowlist validation.
- `responseDetail`: `"summary"`.

`allowedFiles` contains repository-relative paths. It limits files Gemini may
modify but does not limit files Gemini may read.

A strict execute call requires `planApproved: true`. A strict plan call must
not require a commit.

## Execution Architecture

The implementation is divided into four units.

### 1. Contract Normalization

A pure normalization function:

- Detects legacy versus strict invocation.
- Applies defaults.
- Rejects contradictory combinations, such as `mode: "plan"` with
  `requireCommit: true`.
- Normalizes and validates repository-relative allowlist paths.
- Rejects duplicate acceptance criterion IDs.

### 2. Git Evidence Collection

A Git adapter runs commands without a shell and collects:

- Whether the workspace is a Git repository.
- Initial and final HEAD SHA.
- Initial and final porcelain status.
- Commit range created during execution.
- Files changed between the initial and final HEAD.

Strict execution requires a Git repository. If
`requireCleanWorkspace: true`, any initial tracked or untracked change causes
the task to fail before Gemini starts.

Git inspection is authoritative for commit and changed-file claims. Gemini's
summary is supporting evidence only.

### 3. Gemini Invocation

The wrapper builds a contract preamble and appends the user's prompt. For a
strict execute call, the preamble includes:

```text
EXECUTION_PHASE=IMPLEMENT
PLAN_APPROVED=true
DO_NOT_ENTER_PLAN_MODE=true
```

The actual CLI invocation also selects the Gemini approval mode mechanically:

- `mode: "execute"` maps to a non-Plan CLI approval mode.
- `mode: "plan"` maps to the CLI Plan Mode.

The exact non-Plan approval mode must be confirmed against the installed
Gemini CLI help during implementation. The design must not assume an
unsupported flag.

For strict execute calls, the generated prompt also contains:

- Acceptance criteria with stable IDs.
- The modification allowlist.
- The requirement to use TDD.
- The commit requirement.
- The required structured response schema.
- An instruction not to request plan approval again.
- An instruction to avoid network access unless the task explicitly requires
  it.
- An instruction to avoid unnecessary subagents and broad repository scans.

### 4. Result Classification

The wrapper parses Gemini's JSON envelope and extracts the response payload.
For strict calls, it attempts to parse the required structured report. It then
combines that report with independently collected Git evidence.

The wrapper never returns `review_passed`. That state belongs to Codex after
independent review and verification.

## Gemini Report Contract

Strict execute calls ask Gemini to return:

```ts
type GeminiTaskReport = {
  status:
    | "implemented_unverified"
    | "tests_passed"
    | "committed";
  summary: string;
  commitSha?: string;
  changedFiles: string[];
  acceptanceMatrix: Array<{
    criterionId: string;
    testNames: string[];
    result: "PASS" | "FAIL" | "NOT_RUN";
    evidence?: string;
  }>;
  tddEvidence?: {
    redCommand?: string;
    failingTests?: string[];
    assertionSummary?: string;
    greenCommand?: string;
    passingTestCount?: number;
    diffCheck?: "PASS" | "FAIL" | "NOT_RUN";
  };
  commandsRun?: string[];
};
```

Gemini's reported commit SHA and changed files are compared with Git evidence.
The Git-derived values are returned as authoritative facts.

## Status Model

The MCP result uses one of these states:

- `planned`: Gemini completed a requested planning task.
- `implemented_unverified`: files may be implemented, but required test or
  acceptance evidence is incomplete.
- `tests_passed`: all supplied acceptance criteria map to named passing tests,
  but no commit was required or verified.
- `committed`: required commit and acceptance evidence were verified.
- `mode_mismatch`: execute mode was requested, but Gemini asked for approval,
  returned a plan-only response, or otherwise refused to implement because it
  believed it was in Plan Mode.
- `contract_failed`: preconditions or postconditions failed, including dirty
  workspace, missing commit, unparseable strict report, or files outside the
  allowlist.
- `execution_failed`: Gemini CLI or a required Git command failed.
- `timed_out`: Gemini exceeded the configured timeout.

`committed` means only that Gemini completed its implementation contract. It
does not mean the implementation passed Codex review.

## Classification Rules

1. If strict preconditions fail, Gemini is not invoked and the result is
   `contract_failed`.
2. If Gemini times out, the result is `timed_out`.
3. If Gemini exits unsuccessfully, the result is `execution_failed`.
4. If execute mode is requested and the response asks for plan approval, the
   result is `mode_mismatch`.
5. If strict structured output cannot be parsed, the result is
   `contract_failed`.
6. If any changed file is outside `allowedFiles`, the result is
   `contract_failed`.
7. If `requireCommit` is true and HEAD did not advance, the result is
   `contract_failed`.
8. If Git and Gemini disagree about the commit or changed files, Git evidence
   is used and the mismatch is reported.
9. If an acceptance criterion has no named test or is not marked `PASS`, the
   maximum successful state is `implemented_unverified`.
10. If all criteria have named passing tests, the state may be
    `tests_passed`.
11. If all criteria pass and the required commit is verified, the state is
    `committed`.

## Mode-Mismatch Detection

Mode mismatch detection uses both CLI configuration and response inspection.
The response classifier checks for plan-only behavior such as:

- Asking the user or Codex to approve a plan.
- Saying implementation will begin after approval.
- Returning only a proposed plan during an execute call.
- Reporting that editing is unavailable because Plan Mode is active.

Detection should use narrowly scoped patterns and structured-report absence
to avoid classifying ordinary mentions of planning as a mismatch.

## Token and Output Strategy

The default MCP response is compact JSON containing:

- Final state.
- Short summary.
- Authoritative initial and final HEAD.
- Verified commit SHA when applicable.
- Verified changed files.
- Acceptance matrix.
- Condensed TDD evidence.
- Contract violations.
- Transcript path.

The complete Gemini stdout, stderr, generated contract prompt, and relevant
classification diagnostics are written inside the repository's Git metadata
directory:

```text
<git-dir>/superpower/reports/<timestamp>-gemini-task.json
```

This location prevents diagnostic output from creating an untracked working
tree file. The report path is listed in the result so Codex can inspect it
only when needed. Legacy non-Git calls use an operating-system temporary
directory instead.

When `responseDetail: "full"` is requested, the MCP response may include the
full Gemini response in addition to the structured summary. This is an
explicit diagnostic mode, not the default.

Sensitive environment variables and authentication material must not be
written to the report.

## Error Handling

- Errors must identify the failed phase: normalization, preflight, Gemini
  execution, report parsing, or postflight verification.
- Command failures include the command name and concise stderr, with complete
  output stored in the report when available.
- A failed postcondition must not discard Gemini's changes. The wrapper reports
  the violation and leaves the workspace for Codex review.
- The wrapper must never reset, clean, amend, revert, or otherwise mutate Git
  history beyond changes performed by Gemini itself.

## Testing Strategy

Tests use injected fake command runners. Unit tests must not invoke real
Gemini or modify a real repository.

Required coverage:

1. Legacy calls remain accepted.
2. Execute and plan modes generate the correct Gemini CLI arguments.
3. Strict execution rejects a non-Git workspace.
4. Strict execution rejects a dirty workspace before invoking Gemini.
5. Initial and final HEAD values are collected.
6. Required commit creation is verified.
7. Changed files are derived from Git.
8. Files outside `allowedFiles` produce `contract_failed`.
9. A response requesting approval produces `mode_mismatch`.
10. Missing acceptance mappings produce `implemented_unverified`.
11. Complete passing mappings and a verified commit produce `committed`.
12. Strict malformed output produces `contract_failed`.
13. Timeout produces `timed_out`.
14. Gemini process failure produces `execution_failed`.
15. Full output is saved to the report path.
16. Summary mode omits verbose transcript content.
17. Full response mode includes diagnostic output.
18. Contradictory input combinations are rejected.
19. Allowlist traversal and absolute paths are rejected.

Final verification commands:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

## Implementation Boundaries

The implementation should keep responsibilities separated:

- `runGeminiCodingTask.ts`: orchestration only.
- A contract module: normalization and schemas.
- A Git evidence module: Git command construction and parsing.
- A Gemini report module: prompt contract, envelope parsing, and
  classification.
- A report module: concise response and full transcript persistence.

No asynchronous job manager or custom-instruction changes are included.

## Completion Criteria

The design is implemented when:

1. Existing minimal calls still work.
2. Strict execute calls mechanically select a non-Plan Gemini mode.
3. Dirty-workspace, commit, and file-allowlist checks are enforced by Git
   evidence.
4. Acceptance criteria are traceable to named passing tests.
5. Mode mismatch is returned as an explicit state.
6. Default responses are concise and full diagnostics are saved to disk.
7. Gemini cannot claim `review_passed`.
8. All required tests, type checking, and build commands pass.

## Workflow Diagnostics and Legacy Deprecation

### Workflow Statuses

- `completed`: Every recorded stage completed successfully.
- `completed_with_issues`: Implementation ran, but one or more later stages did
  not complete successfully.
- `failed`: The workflow could not pass an early prerequisite such as planning.

### Workflow Diagnostics

When the `run_development_workflow` orchestration tool encounters a failure in
any stage, it includes the following diagnostic fields at the top level of the
JSON payload to assist with automated next steps:

- `failedStage` (string): The identifier of the first failing stage (e.g. `"plan"`, `"implement"`, `"review"`, `"verify"`).
- `nextAction` (string): A recommended action to resolve the failure associated with that specific stage.

### Legacy Deprecation

Structured JSON responses from the deprecated `run_gemini_coding_task` alias
include a top-level machine-readable `deprecation` object pointing to the
canonical replacement `run_antigravity_coding_task`:

```json
"deprecation": {
  "message": "run_gemini_coding_task is deprecated. Please use run_antigravity_coding_task instead.",
  "replacement": "run_antigravity_coding_task"
}
```
