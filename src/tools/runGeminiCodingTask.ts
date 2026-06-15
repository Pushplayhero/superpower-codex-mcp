import { runCodingTaskSchema } from "../lib/codingTaskContract.js";
import { runCodingTaskHandler } from "./runCodingTask.js";
import type { CodingTaskInput } from "../lib/codingTaskContract.js";
import type { CommandRunner } from "../lib/command.js";
import type { McpTextResult } from "../lib/mcp.js";

export { runCodingTaskSchema as runGeminiCodingTaskSchema };

const DEPRECATION_GUIDANCE = {
  message:
    "run_gemini_coding_task is deprecated. Please use run_antigravity_coding_task instead.",
  replacement: "run_antigravity_coding_task"
} as const;

export async function runGeminiCodingTaskHandler(
  input: CodingTaskInput,
  runner?: CommandRunner
): Promise<McpTextResult> {
  const result = await runCodingTaskHandler(input, runner);
  const firstContent = result.content[0];
  if (!firstContent?.text) {
    return result;
  }

  try {
    const parsed: unknown = JSON.parse(firstContent.text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return result;
    }

    return {
      ...result,
      content: [
        {
          ...firstContent,
          text: JSON.stringify({
            ...parsed,
            deprecation: DEPRECATION_GUIDANCE
          }, null, 2)
        },
        ...result.content.slice(1)
      ]
    };
  } catch {
    // Preserve legacy non-JSON errors rather than changing their response shape.
    return result;
  }
}
