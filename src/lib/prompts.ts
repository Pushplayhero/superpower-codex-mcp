export type PlanPromptInput = {
  goal: string;
  constraints?: string;
  doneWhen?: string;
  repoContext?: string;
};

export type ReviewPromptInput = {
  focus?: string;
  repoContext?: string;
  diff: string;
};

export type DebugPromptInput = {
  symptom: string;
  commandOutput: string;
  recentChanges?: string;
};

export type VerificationPromptInput = {
  expectedBehavior: string;
  verificationCommands?: string[];
  commandOutput?: string;
};

export function buildPlanPrompt(input: PlanPromptInput): string {
  return [
    "Create a concrete implementation plan for this repository.",
    "Use Superpowers-style discipline: goal, context, constraints, done-when, TDD, verification, and small tasks.",
    "",
    `Goal: ${input.goal}`,
    `Constraints: ${input.constraints ?? "No extra constraints provided."}`,
    `Done when: ${input.doneWhen ?? "The change is implemented, tested, and reviewable."}`,
    "",
    "Repository context:",
    input.repoContext ?? "No repository context was provided.",
    "",
    "Return an implementation plan with ordered steps, files to touch, tests to write, commands to run, and risks."
  ].join("\n");
}

export function buildReviewPrompt(input: ReviewPromptInput): string {
  return [
    "Review the current changes. Findings first, ordered by severity.",
    "Prioritize bugs, regressions, security issues, broken tests, and missing verification.",
    `Focus: ${input.focus ?? "correctness, maintainability, and tests"}`,
    "",
    "Repository context:",
    input.repoContext ?? "No repository context was provided.",
    "",
    "Diff or file context:",
    input.diff || "No diff was available."
  ].join("\n");
}

export function buildDebugPrompt(input: DebugPromptInput): string {
  return [
    "Use systematic debugging. Do not guess. Separate evidence from hypotheses.",
    "Identify likely root causes, what evidence supports each one, and the smallest next diagnostic step.",
    "",
    `Symptom: ${input.symptom}`,
    "",
    "Command output:",
    input.commandOutput,
    "",
    "Recent changes:",
    input.recentChanges ?? "No recent changes were provided."
  ].join("\n");
}

export function buildVerificationPrompt(input: VerificationPromptInput): string {
  return [
    "Assess whether the requested work can be considered complete.",
    "Report verification evidence, commands run, pass/fail status, and residual risk.",
    "",
    `Expected behavior: ${input.expectedBehavior}`,
    "",
    "Verification commands:",
    input.verificationCommands?.length
      ? input.verificationCommands.map((command) => `- ${command}`).join("\n")
      : "No commands were provided.",
    "",
    "Command output:",
    input.commandOutput ?? "No command output was provided."
  ].join("\n");
}
