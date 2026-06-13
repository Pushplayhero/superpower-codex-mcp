import type { NormalizedCodingTaskContract } from "../lib/codingTaskContract.js";

export function buildGeminiArgs(
  contract: NormalizedCodingTaskContract,
  prompt: string
): string[] {
  return [
    "-p",
    prompt,
    "--model",
    contract.model || "gemini-3.5-flash",
    "--approval-mode",
    contract.mode === "plan" ? "plan" : "yolo",
    "--output-format",
    "json"
  ];
}
