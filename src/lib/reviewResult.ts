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

function parseJsonObject(candidate: string): unknown | undefined {
  try {
    const parsed: unknown = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function hasReviewShape(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }
  if (!("status" in candidate)) return false;

  const status = candidate.status;
  return (status === "clean" || status === "findings") &&
    ("summary" in candidate || "findings" in candidate);
}

function findFirstReviewJson(text: string): unknown | undefined {
  const exact = parseJsonObject(text.trim());
  if (hasReviewShape(exact)) return exact;

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let j = i; j < text.length; j++) {
      const char = text[j];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          const parsed = parseJsonObject(text.substring(i, j + 1));
          if (hasReviewShape(parsed)) return parsed;
        }
      }
    }
  }
  return undefined;
}

export function parseReviewResult(text: string): ReviewResult {
  const parsed = findFirstReviewJson(text);
  if (!parsed) {
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
