**Implementation Plan**

**Goal**
Implement P2 resilience for:
- Review output-format drift: tolerate Markdown wrappers and surrounding prose while extracting the first valid JSON object.
- Workflow failure diagnostics: add top-level `failureSummary` and `failureDetails` alongside existing `failedStage` and `nextAction`.
- Verification evidence: workflow pass/fail must be based on command execution evidence, not Codex assessment prose.

**Context**
Relevant files:
- [src/lib/reviewResult.ts](C:/Users/Ryan/superpower-codex-mcp/src/lib/reviewResult.ts): review schema validation and parsing.
- [src/tools/reviewWithCodex.ts](C:/Users/Ryan/superpower-codex-mcp/src/tools/reviewWithCodex.ts): calls `parseReviewResult`.
- [src/tools/verifyWithCodex.ts](C:/Users/Ryan/superpower-codex-mcp/src/tools/verifyWithCodex.ts): runs verification commands and wraps Codex assessment.
- [src/tools/runDevelopmentWorkflow.ts](C:/Users/Ryan/superpower-codex-mcp/src/tools/runDevelopmentWorkflow.ts): workflow stages, failure diagnostics, verification stage decision.
- [tests/reviewResult.test.ts](C:/Users/Ryan/superpower-codex-mcp/tests/reviewResult.test.ts): focused review parser tests.
- [tests/tools.test.ts](C:/Users/Ryan/superpower-codex-mcp/tests/tools.test.ts): tool and workflow integration tests.

**Constraints**
- Keep scope narrow.
- Use TDD: write focused failing tests before implementation.
- Preserve existing API fields and tests.
- Do not silently accept contradictory review results such as `status: "clean"` with findings.
- Do not accept schema-invalid review JSON.
- Review parser should extract the first valid JSON object from common wrappers, including fenced JSON with text before/after.
- Workflow verification pass/fail should not search Codex prose for words like `error`, `failed`, or `findings`.

**Done When**
- Focused red-green tests cover:
  - Review output wrappers.
  - Workflow failure diagnostics.
  - Verification command evidence behavior.
- Existing tests still pass.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Final Codex `review_with_codex` and `verify_with_codex` pass during implementation verification.

**Ordered Tasks**

1. **Add review parser red tests**
   - File: [tests/reviewResult.test.ts](C:/Users/Ryan/superpower-codex-mcp/tests/reviewResult.test.ts)
   - Add tests that currently fail:
     - Parses fenced JSON with text before and after:
       ```ts
       const text = `Here is the review:\n\n\`\`\`json\n${JSON.stringify(clean)}\n\`\`\`\nDone.`;
       expect(parseReviewResult(text)).toEqual(clean);
       ```
     - Parses the first valid JSON object when prose surrounds it:
       ```ts
       const text = `Review follows:\n${JSON.stringify(clean)}\nThanks.`;
       expect(parseReviewResult(text)).toEqual(clean);
       ```
     - Rejects contradictory wrapped JSON:
       `status: "clean"` with one finding still throws `/clean review/i`.
     - Rejects schema-invalid wrapped JSON:
       missing `summary` or invalid severity still throws a schema error.
   - Red command:
     - `npx vitest run tests/reviewResult.test.ts`

2. **Implement resilient review JSON extraction**
   - File: [src/lib/reviewResult.ts](C:/Users/Ryan/superpower-codex-mcp/src/lib/reviewResult.ts)
   - Replace `stripJsonFence` with a narrow extraction helper, for example:
     - First try exact trimmed JSON parse.
     - Then scan fenced code blocks, preferring ```json but accepting plain fences, and return the first block that parses and validates against `reviewResultSchema`.
     - Then scan from each `{` and use brace-depth parsing with string/escape awareness to extract candidate objects; return the first candidate that parses and validates.
   - Keep schema validation exactly authoritative via `reviewResultSchema.safeParse`.
   - Important behavior:
     - If a candidate parses but is schema-invalid, do not skip to a later clean object. Throw the validation error for the first parseable JSON object to avoid silently accepting contradictory or invalid reviews.
     - If no parseable JSON object exists, throw `Review output must be valid JSON.`.
   - Green command:
     - `npx vitest run tests/reviewResult.test.ts`

3. **Add verification evidence red tests**
   - File: [tests/tools.test.ts](C:/Users/Ryan/superpower-codex-mcp/tests/tools.test.ts)
   - Add workflow test:
     - Implementation succeeds.
     - Verification command exits `0`.
     - Codex assessment stdout contains scary prose such as `error`, `failed`, or `# Findings`.
     - Expected workflow remains `completed`, verify stage `ok: true`.
   - Add complementary test:
     - Verification command exits non-zero.
     - Codex assessment says “everything passed”.
     - Expected workflow is `completed_with_issues`, verify stage `ok: false`.
   - Red command:
     - `npx vitest run tests/tools.test.ts -t "verification"`

4. **Make workflow verification command-evidence driven**
   - File: [src/tools/runDevelopmentWorkflow.ts](C:/Users/Ryan/superpower-codex-mcp/src/tools/runDevelopmentWorkflow.ts)
   - Remove `detectVerificationFailure(resultText)` from the workflow decision path.
   - Set verify stage status from `verifyResult.isError`:
     - `ok: !verifyResult.isError`
     - `summary: verifyResult.isError ? "Verification command evidence failed." : "Verification passed."`
   - Delete `detectVerificationFailure` if no longer used.
   - Preserve the current `details: resultText`.
   - Green command:
     - `npx vitest run tests/tools.test.ts -t "verification"`

5. **Add workflow diagnostics red tests**
   - File: [tests/tools.test.ts](C:/Users/Ryan/superpower-codex-mcp/tests/tools.test.ts)
   - Extend existing diagnostics tests around plan and verify failure.
   - Assert new top-level fields exist without removing old fields:
     - `failedStage`
     - `nextAction`
     - `failureSummary`
     - `failureDetails`
   - Expected values:
     - `failureSummary` equals the first failed stage summary.
     - `failureDetails` equals or contains the first failed stage details.
   - Red command:
     - `npx vitest run tests/tools.test.ts -t "diagnostics"`

6. **Implement top-level workflow failure summary/details**
   - File: [src/tools/runDevelopmentWorkflow.ts](C:/Users/Ryan/superpower-codex-mcp/src/tools/runDevelopmentWorkflow.ts)
   - Update `buildWorkflowResponse` failed path only:
     ```ts
     {
       workflow,
       stages,
       failedStage: firstFailed.stage,
       nextAction,
       failureSummary: firstFailed.summary,
       failureDetails: firstFailed.details ?? ""
     }
     ```
   - Preserve successful response shape.
   - Preserve `failedStage` and `nextAction`.
   - Green command:
     - `npx vitest run tests/tools.test.ts -t "diagnostics"`

7. **Regression pass**
   - Commands:
     - `npm run typecheck`
     - `npm test`
     - `npm run build`

8. **Repository-level acceptance verification**
   - Commands/tools during the implementation verification phase:
     - `review_with_codex` on the final diff.
     - `verify_with_codex` with:
       - `npm test`
       - `npm run typecheck`
       - `npm run build`

**Risks**
- JSON extraction can accidentally accept a later clean object after an earlier invalid object. Mitigation: stop on the first parseable JSON object and validate it.
- Brace scanning can break on braces inside strings. Mitigation: implement string and escape tracking, or keep the scanner small and covered by wrapper tests.
- Changing workflow verification could hide Codex assessment failures. Mitigation: command execution remains authoritative for pass/fail, while Codex assessment remains in `details` for debugging.
- Existing tests may assert exact workflow summaries. Mitigation: preserve existing fields and only update summaries where new tests require clearer wording.
