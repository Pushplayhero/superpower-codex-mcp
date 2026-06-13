import path from "node:path";
import { z } from "zod";

export const executionModeSchema = z.enum(["execute", "plan"]);
export const responseDetailSchema = z.enum(["summary", "full"]);
export const acceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1)
});

export const runCodingTaskSchema = {
  workspacePath: z.string().describe("Repository or workspace path."),
  prompt: z.string().min(1).describe("Prompt for the coding task."),
  allowExecution: z.boolean().default(false).describe("Must be true before invoking the tool."),
  timeoutSeconds: z.number().int().min(60).max(7200).default(1800),
  mode: executionModeSchema.optional(),
  planApproved: z.boolean().optional(),
  requireCommit: z.boolean().optional(),
  requireCleanWorkspace: z.boolean().optional(),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).optional(),
  allowedFiles: z.array(z.string()).optional(),
  model: z.string().trim().min(1).optional().describe(
    "The model to use for the coding task."
  ),
  responseDetail: responseDetailSchema.optional()
};

export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
export type ExecutionMode = z.infer<typeof executionModeSchema>;
export type ResponseDetail = z.infer<typeof responseDetailSchema>;

export type CodingTaskInput = {
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
  model?: string;
  responseDetail?: ResponseDetail;
};

export type NormalizedCodingTaskContract = {
  workspacePath: string;
  prompt: string;
  allowExecution: boolean;
  timeoutSeconds: number;
  mode: ExecutionMode;
  planApproved: boolean;
  requireCommit: boolean;
  requireCleanWorkspace: boolean;
  strict: boolean;
  acceptanceCriteria: AcceptanceCriterion[];
  allowedFiles: string[];
  model: string | undefined;
  responseDetail: ResponseDetail;
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

export function normalizeCodingTaskContract(
  input: CodingTaskInput
): NormalizedCodingTaskContract {
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
    model: input.model?.trim() || undefined,
    responseDetail: input.responseDetail ?? "summary",
    strict
  };
}
