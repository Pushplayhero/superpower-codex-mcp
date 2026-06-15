import { z } from "zod";

const severitySchema = z.enum(["critical", "high", "medium", "low"]);

const reviewFindingSchema = z.object({
  severity: severitySchema,
  title: z.string().min(1),
  body: z.string().min(1),
  file: z.string().min(1).optional(),
  line: z.number().int().positive().optional()
});

const reviewResultSchema = z.object({
  status: z.enum(["clean", "findings"]),
  summary: z.string().min(1),
  findings: z.array(reviewFindingSchema)
}).superRefine((result, context) => {
  if (result.status === "clean" && result.findings.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A clean review cannot contain findings."
    });
  }
  if (result.status === "findings" && result.findings.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A findings review must contain at least one finding."
    });
  }
});

export type ReviewResult = z.infer<typeof reviewResultSchema>;

const severityRank: Record<ReviewResult["findings"][number]["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

function stripJsonFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : text.trim();
}

export function parseReviewResult(text: string): ReviewResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error("Review output must be valid JSON.");
  }

  const result = reviewResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join(" "));
  }

  return {
    ...result.data,
    findings: [...result.data.findings].sort(
      (left, right) => severityRank[left.severity] - severityRank[right.severity]
    )
  };
}
