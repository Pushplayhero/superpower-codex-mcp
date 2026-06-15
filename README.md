# superpower-codex-mcp

A TypeScript MCP server that coordinates Codex and Antigravity CLI with a
Superpowers-style software development workflow.

Codex handles planning, review, debugging, and verification. Antigravity CLI
is the canonical coding executor. The server adds workspace authorization,
Git-based change verification, acceptance criteria, compact task reports, and
persisted diagnostics.

## Requirements

- Node.js 20.19 or newer, or Node.js 22.12 or newer
- Codex CLI installed and authenticated
- Antigravity CLI (`agy`) installed and authenticated
- Git

## Install

```powershell
git clone https://github.com/Pushplayhero/superpower-codex-mcp.git
cd superpower-codex-mcp
npm.cmd install
npm.cmd run build
npm.cmd test
```

On macOS or Linux, use `npm` instead of `npm.cmd`.

## Codex Desktop configuration

Add the server to your Codex MCP configuration. Replace the paths with your
local clone and the workspaces the server may access.

```toml
[mcp_servers.superpower-codex]
command = "node"
args = ["C:\\path\\to\\superpower-codex-mcp\\dist\\src\\index.js"]

[mcp_servers.superpower-codex.env]
SUPERPOWER_CODEX_ALLOWED_ROOTS = "C:\\path\\to\\projects"
```

Restart Codex Desktop after changing MCP configuration.

On Windows, the server resolves Codex in this order:

1. `SUPERPOWER_CODEX_COMMAND`
2. `codex.exe` found on `PATH`
3. An existing global npm `@openai/codex` entrypoint

The packaged Codex Desktop binary under `WindowsApps\OpenAI.Codex_*` is skipped
because Windows can reject external child-process launches with `EPERM`.

If no candidate exists, Codex-backed tools return structured diagnostics with
`codexCliAvailable: false` and the paths that were searched.

## Antigravity configuration

In a project that should use this MCP server, add `.agents/mcp_config.json`:

```json
{
  "mcpServers": {
    "superpower-codex": {
      "command": "node",
      "args": [
        "C:\\path\\to\\superpower-codex-mcp\\dist\\src\\index.js"
      ],
      "env": {
        "SUPERPOWER_CODEX_ALLOWED_ROOTS": "C:\\path\\to\\projects"
      }
    }
  }
}
```

The default Antigravity executable is:

```text
%LOCALAPPDATA%\agy\bin\agy.exe
```

Set `SUPERPOWER_ANTIGRAVITY_COMMAND` when it is installed elsewhere:

```powershell
$env:SUPERPOWER_ANTIGRAVITY_COMMAND = "C:\custom\path\agy.exe"
```

## Available tools

| Tool | Purpose |
| --- | --- |
| `validate_workspace` | Validate workspace authorization and local capabilities without invoking a model. |
| `summarize_repo_context` | Read repository instructions such as `AGENTS.md` and `GEMINI.md`. |
| `plan_with_codex` | Ask Codex to create and save an implementation plan. |
| `review_with_codex` | Ask Codex to review a diff or selected files. |
| `debug_with_codex` | Ask Codex to investigate failures systematically. |
| `verify_with_codex` | Run explicitly allowed verification commands and ask Codex to assess the evidence. |
| `review_code_quality` | Run a local TypeScript structural scan without consuming model tokens. |
| `run_antigravity_coding_task` | Canonical coding execution tool backed by Antigravity CLI. |
| `run_gemini_coding_task` | Deprecated compatibility alias for `run_antigravity_coding_task`; it does not invoke Gemini CLI directly. |
| `run_development_workflow` | Coordinate plan, implement, review, fix, and verify stages. |

## Recommended workflow

1. Call `validate_workspace`.
2. Call `summarize_repo_context`.
3. Use `plan_with_codex` for broad or risky changes.
4. Execute the approved task with `run_antigravity_coding_task`.
5. Use `review_code_quality` as a token-free pre-filter.
6. Call `review_with_codex`.
7. Send review corrections back to Antigravity when required.
8. Call `verify_with_codex` before declaring completion.

For an automated version of this sequence, use `run_development_workflow`.
Its `verificationCommands` input defaults to `["npm test", "npm run typecheck"]`
and can be replaced for pnpm, Bun, Python, Go, monorepo, or other project
toolchains.

`review_with_codex` returns validated structured JSON with a `status`,
`summary`, and severity-ordered `findings` array. Malformed model output is
reported as an error instead of being interpreted as a clean review.

`review_code_quality` currently supports TypeScript. A Python-only workspace
returns `unsupportedLanguage: "python"` instead of presenting zero scanned
files as a clean review. Recursive Python detection ignores virtual environment
and build directories (such as `venv`, `.venv`, `__pycache__`, `.tox`, `build`,
`dist`, `node_modules`, and `.git`).

For explicit mixed selections (e.g. `app.ts` and `app.py`), the tool scans the
TypeScript files and returns `unsupportedFiles: ["app.py"]` while omitting
`unsupportedLanguage`.

## Coding task example

```json
{
  "workspacePath": "C:\\path\\to\\project",
  "prompt": "Implement the approved task using test-driven development.",
  "allowExecution": true,
  "timeoutSeconds": 1800,
  "model": "Gemini 3.5 Flash (Medium)",
  "mode": "execute",
  "planApproved": true,
  "requireCommit": true,
  "requireCleanWorkspace": true,
  "acceptanceCriteria": [
    {
      "id": "AC-1",
      "description": "The new behavior is covered by a regression test."
    }
  ],
  "allowedFiles": [
    "src/example.ts",
    "tests/example.test.ts"
  ],
  "responseDetail": "summary"
}
```

Supported model names:

- `gemini-3.5-flash`
- `Gemini 3.5 Flash (Medium)`
- `Gemini 3.1 Pro (High)`

Unsupported legacy Gemini model names are rejected. The server does not
automatically retry with a stronger model.

## Status model and diagnostics

### Coding task statuses

The coding tools (`run_antigravity_coding_task` and the legacy alias
`run_gemini_coding_task`) return a JSON payload with a `status` field:

- `planned`: A requested planning task was completed.
- `implemented_unverified`: Files may be implemented, but required test or acceptance evidence is incomplete.
- `tests_passed`: All supplied acceptance criteria map to named passing tests, but no commit was required or verified.
- `committed`: Required commit and acceptance evidence were verified successfully.
- `mode_mismatch`: Execute mode was requested, but the model asked for approval or returned a plan-only response.
- `contract_failed`: Preconditions or postconditions failed (e.g., dirty workspace before execution, missing commit, output outside `allowedFiles`).
- `execution_failed`: The tool or a required Git command failed to execute.
- `timed_out`: Execution exceeded the configured timeout.

### Workflow statuses

- `completed`: Every recorded stage completed successfully.
- `completed_with_issues`: Implementation ran, but one or more later stages did
  not complete successfully.
- `failed`: The workflow could not pass an early prerequisite such as planning.

### Deprecation guidance

Structured JSON responses from the legacy alias `run_gemini_coding_task`
include a top-level machine-readable `deprecation` object:

```json
"deprecation": {
  "message": "run_gemini_coding_task is deprecated. Please use run_antigravity_coding_task instead.",
  "replacement": "run_antigravity_coding_task"
}
```

### Workflow diagnostics

When `run_development_workflow` does not complete cleanly, it returns two
additional diagnostic fields:

- `failedStage`: The name of the first failing stage (e.g. `"plan"`, `"implement"`, `"review"`, `"verify"`).
- `nextAction`: A descriptive recommendation on what to do next to resolve the issue.

## Workspace safety

By default, only the MCP process working directory and its descendants are
allowed. Additional roots must be explicitly configured:

```powershell
$env:SUPERPOWER_CODEX_ALLOWED_ROOTS = "C:\projects;D:\work"
```

Use `;` as the delimiter on Windows and `:` on macOS or Linux.

Additional safeguards:

- Coding execution requires `allowExecution: true`.
- Verification commands require `allowCommandExecution: true`.
- Verification commands run without a shell; pipes, redirects, and command
  separators are rejected.
- Strict execution compares reported files and commits with Git metadata.
- `allowedFiles` accepts only repository-relative paths.
- Antigravity does not recursively call the coding-task MCP tool.

## Development

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

The verified baseline is updated by the verification run below.

## Updating an existing Windows installation

Download `superpower-codex-mcp-v0.1.1-windows.zip` from the GitHub release,
extract it, and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\update-installed.ps1 `
  -InstallPath "C:\path\to\superpower-codex-mcp"
```

The updater validates the installation, creates a backup under
`.update-backups`, installs production dependencies, and verifies MCP tool
discovery. Restart Codex Desktop after the update.

## License

[MIT](LICENSE)
