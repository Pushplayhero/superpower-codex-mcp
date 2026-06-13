import type { NormalizedCodingTaskContract } from "./codingTaskContract.js";

export function buildCodingTaskPrompt(contract: NormalizedCodingTaskContract): string {
  if (!contract.strict) {
    return contract.prompt;
  }

  const criteria = contract.acceptanceCriteria
    .map((c) => `- [ ] ${c.id}: ${c.description}`)
    .join("\n");
  const files = contract.allowedFiles.map((f) => `- ${f}`).join("\n");

  const isPlan = contract.mode === "plan";
  const phase = isPlan ? "PLAN" : "IMPLEMENT";
  const role = isPlan
    ? "You are the primary coding planner. Research the codebase and provide a detailed implementation plan."
    : "You are the primary coding executor. Implement the following task using strict TDD (RED then GREEN).";

  let preamble = `EXECUTION_PHASE=${phase}
PLAN_APPROVED=${!isPlan}
${isPlan ? "STAY_IN_PLAN_MODE=true" : "DO_NOT_ENTER_PLAN_MODE=true"}

${role}

# Constraints
- NO network access.
- NO unnecessary subagents or broad repository scans.
${isPlan ? "- Do NOT modify files or Git state." : "- ONLY modify files in the allowlist below."}
`;

  if (!isPlan) {
    preamble += "- Do NOT request plan approval again.\n";
  }

  if (contract.requireCommit) {
    preamble += "- YOU MUST create a Git commit with a descriptive message once implementation is complete.\n";
  }

  if (criteria) {
    preamble += `\n# Acceptance Criteria\n${criteria}\n`;
  }

  if (files) {
    preamble += `\n# Allowed Files\n${files}\n`;
  }

  if (isPlan) {
    preamble += `
# Output Requirement
Return your plan as plain text. Do NOT return a structured JSON report.
`;
  } else {
    preamble += `
# Output Requirement
You MUST return a final structured report as a single JSON object (wrapped in \`\`\`json\`\`\` fences) matching this schema:
{
  "status": "implemented_unverified" | "tests_passed" | "committed",
  "summary": "Concise summary of work done",
  "commitSha": "The SHA of the commit you created (if any)",
  "changedFiles": ["list", "of", "modified", "files"],
  "acceptanceMatrix": [
    {
      "criterionId": "ID from above",
      "testNames": ["Names of tests covering this criterion"],
      "result": "PASS" | "FAIL" | "NOT_RUN",
      "evidence": "Optional short diagnostic"
    }
  ],
  "tddEvidence": {
    "redCommand": "Command used for failing test",
    "greenCommand": "Command used for passing test",
    "passingTestCount": 5
  }
}
`;
  }

  preamble += `
User Prompt:
${contract.prompt}`;

  return preamble;
}
