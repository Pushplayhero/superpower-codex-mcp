# Changelog

## 0.1.1 - 2026-06-15

### Fixed

- Resolve the Windows Codex CLI from an explicit override, `PATH`, or an
  existing global npm installation.
- Skip the packaged Codex Desktop executable when Windows prevents external
  child-process launches.
- Close child-process stdin so non-interactive Codex commands receive EOF.
- Isolate Codex-backed MCP calls from user MCP configuration and recursive
  workflows.
- Report Python-only quality scans as unsupported instead of clean.
- Scan selected TypeScript files while reporting selected Python files
  separately.
- Exclude virtual environments and generated directories from Python
  detection.

### Distribution

- Add a Windows update package for existing installations.
- Add post-update MCP tool discovery verification.
