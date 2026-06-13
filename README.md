# superpower-codex-mcp

A TypeScript MCP server that coordinates Codex and Antigravity CLI with a
Superpowers-style software development workflow.

Codex handles planning, review, debugging, and verification. Antigravity CLI
handles coding execution. The server adds workspace authorization, Git-based
change verification, acceptance criteria, compact task reports, and persisted
diagnostics.

## Requirements

- Node.js 20 or newer
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
| `run_antigravity_coding_task` | Execute a coding task through Antigravity CLI. |
| `run_gemini_coding_task` | Deprecated compatibility name; it now uses the same Antigravity-only handler. |
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

The verified baseline is 126 passing tests across 9 test files.

## License

[MIT](LICENSE)
