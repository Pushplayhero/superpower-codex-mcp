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

  it("parses fenced JSON when model prose appears before and after", () => {
    const clean = {
      status: "clean" as const,
      summary: "No actionable findings.",
      findings: []
    };

    expect(parseReviewResult([
      "Here is the review:",
      "",
      "```json",
      JSON.stringify(clean),
      "```",
      "Done."
    ].join("\n"))).toEqual(clean);
  });

  it("parses the first JSON review object surrounded by prose", () => {
    const review = {
      status: "findings" as const,
      summary: "One finding.",
      findings: [
        {
          severity: "medium" as const,
          title: "Missing test",
          body: "The behavior needs a regression test."
        }
      ]
    };

    expect(parseReviewResult([
      "Review follows:",
      JSON.stringify(review),
      "Thanks."
    ].join("\n"))).toEqual(review);
  });

  it("skips incidental JSON objects before the review payload", () => {
    const review = {
      status: "clean" as const,
      summary: "No actionable findings.",
      findings: []
    };

    expect(parseReviewResult([
      "Example command output:",
      JSON.stringify({ command: "npm test", exitCode: 0 }),
      "Review payload:",
      JSON.stringify(review)
    ].join("\n"))).toEqual(review);
  });

  it("skips incidental JSON objects that contain non-review status or summary fields", () => {
    const review = {
      status: "clean" as const,
      summary: "No actionable findings.",
      findings: []
    };

    expect(parseReviewResult([
      JSON.stringify({ status: "passed", command: "npm test" }),
      JSON.stringify({ summary: "Command completed", exitCode: 0 }),
      JSON.stringify(review)
    ].join("\n"))).toEqual(review);
  });

  it("skips incidental JSON objects with non-review status and summary together", () => {
    const review = {
      status: "clean" as const,
      summary: "No actionable findings.",
      findings: []
    };

    expect(parseReviewResult([
      JSON.stringify({ status: "passed", summary: "npm test completed" }),
      JSON.stringify(review)
    ].join("\n"))).toEqual(review);
  });

  it("rejects contradictory wrapped JSON instead of accepting later text", () => {
    expect(() =>
      parseReviewResult([
        "Review:",
        "```json",
        JSON.stringify({
          status: "clean",
          summary: "Contradictory.",
          findings: [
            { severity: "high", title: "Bug", body: "Still has a finding." }
          ]
        }),
        "```",
        JSON.stringify({
          status: "clean",
          summary: "No findings.",
          findings: []
        })
      ].join("\n"))
    ).toThrow(/clean review/i);
  });

  it("rejects schema-invalid wrapped JSON", () => {
    expect(() =>
      parseReviewResult([
        "```json",
        JSON.stringify({
          status: "findings",
          findings: [
            { severity: "severe", title: "Bad severity", body: "Invalid." }
          ]
        }),
        "```"
      ].join("\n"))
    ).toThrow();
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
