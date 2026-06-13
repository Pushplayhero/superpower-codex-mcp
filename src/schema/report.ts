import { z } from "zod";

const matrixEntrySchema = z.object({
  criterionId: z.string(),
  testNames: z.array(z.string()),
  result: z.enum(["PASS", "FAIL", "NOT_RUN"]),
  evidence: z.string().optional()
});

export const codingTaskReportSchema = z.object({
  status: z.enum(["implemented_unverified", "tests_passed", "committed"]),
  summary: z.string(),
  commitSha: z.string().optional(),
  changedFiles: z.array(z.string()),
  acceptanceMatrix: z.array(matrixEntrySchema),
  tddEvidence: z.object({
    redCommand: z.string().optional(),
    failingTests: z.array(z.string()).optional(),
    assertionSummary: z.string().optional(),
    greenCommand: z.string().optional(),
    passingTestCount: z.number().int().nonnegative().optional(),
    diffCheck: z.enum(["PASS", "FAIL", "NOT_RUN"]).optional()
  }).optional(),
  commandsRun: z.array(z.string()).optional()
});

export type CodingTaskReport = z.infer<typeof codingTaskReportSchema>;

export type ParsedCodingTaskEnvelope = {
  responseText: string;
  report?: CodingTaskReport;
};

function stripJsonFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : text.trim();
}

export function parseCodingTaskReport(stdout: string): ParsedCodingTaskEnvelope {
  try {
    const envelope = JSON.parse(stdout) as Record<string, unknown>;
    let responseText = typeof envelope.response === "string" ? envelope.response : "";

    // If envelope.response is present, parse it as a report
    if (responseText) {
      try {
        const parsed = JSON.parse(stripJsonFence(responseText));
        const result = codingTaskReportSchema.safeParse(parsed);
        return {
          responseText,
          report: result.success ? result.data : undefined
        };
      } catch {
        return { responseText };
      }
    }

    // If no response field, try the envelope itself as a report
    const directResult = codingTaskReportSchema.safeParse(envelope);
    if (directResult.success) {
      return {
        responseText: stdout,
        report: directResult.data
      };
    }

    // Check for pre-parsed report object (e.g. {"responseText":"done","report":{...}})
    if (typeof envelope.report === "object" && envelope.report !== null) {
      const result = codingTaskReportSchema.safeParse(envelope.report);
      if (result.success) {
        return {
          responseText: typeof envelope.responseText === "string" ? envelope.responseText : stdout,
          report: result.data
        };
      }
    }

    // Check for responseText field containing JSON report string
    if (typeof envelope.responseText === "string") {
      try {
        const parsed = JSON.parse(stripJsonFence(envelope.responseText));
        const result = codingTaskReportSchema.safeParse(parsed);
        if (result.success) {
          return {
            responseText: envelope.responseText,
            report: result.data
          };
        }
      } catch {
        // fall through
      }
    }

    return { responseText: stdout };
  } catch {
    return { responseText: stdout };
  }
}
