**Goal**
Implement the P1 hardening only: expand code-quality scan coverage, add machine-readable deprecation guidance to `run_gemini_coding_task`, add workflow failure diagnostics, and document the status meanings so the runtime and docs stay aligned.

**Context**
Current entry points are [src/tools/reviewCodeQuality.ts](C:\Users\Ryan\superpower-codex-mcp\src\tools\reviewCodeQuality.ts), [src/tools/runGeminiCodingTask.ts](C:\Users\Ryan\superpower-codex-mcp\src\tools\runGeminiCodingTask.ts), [src/tools/runDevelopmentWorkflow.ts](C:\Users\Ryan\superpower-codex-mcp\src\tools\runDevelopmentWorkflow.ts), and [src/index.ts](C:\Users\Ryan\superpower-codex-mcp\src\index.ts). Most regression coverage already lives in [tests/tools.test.ts](C:\Users\Ryan\superpower-codex-mcp\tests\tools.test.ts), with the status model documented in [docs/superpowers/specs/2026-06-13-gemini-execution-contract-design.md](C:\Users\Ryan\superpower-codex-mcp\docs\superpowers\specs\2026-06-13-gemini-execution-contract-design.md).

**Constraints**
P1 only, additive changes only, no broad refactors, and do not change `run_antigravity_coding_task` behavior. Keep `workflow` and `stages` stable; only add `failedStage` and `nextAction`. Use TDD and keep the file scope tight.

1. **Lock the scan contract with failing tests first**
   Files: add [tests/reviewCodeQuality.test.ts](C:\Users\Ryan\superpower-codex-mcp\tests\reviewCodeQuality.test.ts) or extend [tests/tools.test.ts](C:\Users\Ryan\superpower-codex-mcp\tests\tools.test.ts) if you want to avoid a new file.
   Tests: verify the default scan covers both `src/**/*.ts` and `tests/**/*.ts`; verify repeated or overlapping file inputs are deduped deterministically; verify output order is stable across runs; verify `filesScanned` counts unique files only.
   Commands: `npm test -- tests/reviewCodeQuality.test.ts`
   Risks: filesystem glob order can be nondeterministic; the test should assert sorted, unique relative paths instead of raw glob output.

2. **Implement deterministic scan expansion and deduplication**
   Files: [src/tools/reviewCodeQuality.ts](C:\Users\Ryan\superpower-codex-mcp\src\tools\reviewCodeQuality.ts)
   Tests: make the tests from step 1 pass without changing the existing finding rules.
   Commands: `npm test -- tests/reviewCodeQuality.test.ts`
   Risks: expanding the default scan to `tests/` may surface extra findings in the existing suite; keep the default behavior explicit and deterministic by normalizing, deduping, and sorting before scanning.

3. **Add machine-readable deprecation guidance to the Gemini alias only**
   Files: [src/tools/runGeminiCodingTask.ts](C:\Users\Ryan\superpower-codex-mcp\src\tools\runGeminiCodingTask.ts), [src/index.ts](C:\Users\Ryan\superpower-codex-mcp\src\index.ts), and the relevant assertions in [tests/tools.test.ts](C:\Users\Ryan\superpower-codex-mcp\tests\tools.test.ts)
   Tests: assert `run_gemini_coding_task` returns the normal task payload plus a stable `deprecation` object; assert `run_antigravity_coding_task` remains unchanged; assert the alias still preserves existing task fields like `status`, `changedFiles`, and `transcriptPath`.
   Commands: `npm test -- tests/tools.test.ts -t "runGeminiCodingTaskHandler|runAntigravityCodingTaskHandler"`
   Risks: the alias response shape is already consumed by tests and possibly downstream callers, so keep the change additive. The safest shape is a top-level `deprecation` object added to the existing JSON payload, not a separate wrapper that would hide the original fields.

4. **Add workflow failure diagnostics without disturbing existing workflow/stage reporting**
   Files: [src/tools/runDevelopmentWorkflow.ts](C:\Users\Ryan\superpower-codex-mcp\src\tools\runDevelopmentWorkflow.ts), plus failure-path assertions in [tests/tools.test.ts](C:\Users\Ryan\superpower-codex-mcp\tests\tools.test.ts)
   Tests: cover at least one early failure path and one later failure path. Verify the output still contains `workflow` and `stages`, and now also includes `failedStage` and `nextAction` when the workflow is not cleanly completed.
   Commands: `npm test -- tests/tools.test.ts -t "runDevelopmentWorkflowHandler"`
   Risks: the handler has multiple early returns, so keep the diagnostics helper small and local. `failedStage` should point to the first failing stage only, not a later symptom.

5. **Document status meanings and the new diagnostic fields**
   Files: [README.md](C:\Users\Ryan\superpower-codex-mcp\README.md) and [docs/superpowers/specs/2026-06-13-gemini-execution-contract-design.md](C:\Users\Ryan\superpower-codex-mcp\docs\superpowers\specs\2026-06-13-gemini-execution-contract-design.md)
   Tests: none for prose, but the text should mirror the runtime JSON exactly.
   Commands: none beyond re-running the affected tests after the runtime changes.
   Risks: docs drift is easy here. Keep wording tied to the exact status strings and field names emitted by the handlers.

6. **Verify in the same order the repo expects**
   Files: all touched files above.
   Tests and checks: run the focused regression tests first, then the full suite, then typecheck, then build. Use the token-free `review_code_quality` scan on the touched TypeScript files before `review_with_codex`, then run `review_with_codex` on the diff, then `verify_with_codex` with the same verification commands.
   Commands: `npm test`, `npm run typecheck`, `npm run build`
   Risks: if any full-suite failure appears outside the targeted changes, treat it as a regression introduced by the scan/output contract changes and fix it before review.

**Done when**
Focused regression tests pass, full `npm test` / `npm run typecheck` / `npm run build` pass, `review_code_quality` reports no actionable issues on the touched TS files, `review_with_codex` is clean, and the docs describe the emitted runtime behavior exactly.
