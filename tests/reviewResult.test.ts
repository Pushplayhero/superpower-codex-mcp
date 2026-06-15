import { describe, expect, it } from "vitest";
import { parseReviewResult } from "../src/lib/reviewResult.js";

describe("review result contract", () => {
  it("parses a clean structured review", () => {
    expect(
      parseReviewResult(JSON.stringify({
        status: "clean",
        summary: "No actionable findings.",
        findings: []
      }))
    ).toEqual({
      status: "clean",
      summary: "No actionable findings.",
      findings: []
    });
  });

  it("orders findings by severity", () => {
    const result = parseReviewResult(JSON.stringify({
      status: "findings",
      summary: "Two findings.",
      findings: [
        { severity: "low", title: "Minor", body: "Low risk." },
        { severity: "high", title: "Regression", body: "Breaks callers." }
      ]
    }));

    expect(result.findings.map((finding) => finding.severity)).toEqual([
      "high",
      "low"
    ]);
  });

  it("rejects malformed or contradictory reviews", () => {
    expect(() => parseReviewResult("No findings.")).toThrow(/valid JSON/i);
    expect(() =>
      parseReviewResult(JSON.stringify({
        status: "clean",
        summary: "Contradictory.",
        findings: [
          { severity: "high", title: "Bug", body: "Still has a finding." }
        ]
      }))
    ).toThrow(/clean review/i);
  });
});
