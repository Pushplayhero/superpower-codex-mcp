import { WorkspaceValidationError } from "./workspace.js";

export type McpTextResult = {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
};

export function textResult(text: string): McpTextResult {
  return {
    content: [
      {
        type: "text",
        text
      }
    ]
  };
}

export function errorResult(text: string): McpTextResult {
  return {
    ...textResult(text),
    isError: true
  };
}

export function toolErrorResult(
  error: unknown,
  fallbackPrefix: string
): McpTextResult {
  if (error instanceof WorkspaceValidationError) {
    return errorResult(JSON.stringify(error.validation, null, 2));
  }
  const message = error instanceof Error ? error.message : String(error);
  return errorResult(`${fallbackPrefix}: ${message}`);
}
