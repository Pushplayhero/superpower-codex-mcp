import { readFileSync, existsSync, globSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import { z } from "zod";
import { textResult, toolErrorResult, type McpTextResult } from "../lib/mcp.js";
import { isPathInside, requireWorkspace } from "../lib/workspace.js";

export const reviewCodeQualitySchema = {
  workspacePath: z.string().describe("Repository or workspace path to scan."),
  files: z.array(z.string()).optional().describe("Specific file paths (relative to workspace). Default: all src/**/*.ts."),
  checks: z.array(z.string()).optional().describe("Specific checks to run. Default: all."),
  maxFindings: z.number().int().min(1).max(500).default(100).describe("Max findings to return.")
};

export type ReviewCodeQualityInput = {
  workspacePath: string;
  files?: string[];
  checks?: string[];
  maxFindings?: number;
};

type Severity = "error" | "warning" | "info";

type Finding = {
  file: string;
  line: number;
  column?: number;
  severity: Severity;
  rule: string;
  message: string;
  snippet?: string;
};

type CheckFn = (file: string, content: string) => Finding[];

const ALL_CHECKS: Record<string, { name: string; severity: Severity; description: string; fn: CheckFn }> = {
  "no-any-cast": {
    name: "no-any-cast",
    severity: "error",
    description: "Detects `as any` type casts that bypass TypeScript.",
    fn: (file, content) => {
      const findings: Finding[] = [];
      const re = /\bas\s+(any|unknown)\s*$/gm;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const line = content.slice(0, match.index).split("\n").length;
        const col = match.index - content.lastIndexOf("\n", match.index);
        findings.push({
          file, line, column: col, severity: "error", rule: "no-any-cast",
          message: `'as ${match[1]}' cast bypasses type checking.`,
          snippet: content.split("\n")[line - 1]?.trim()
        });
      }
      return findings;
    }
  },
  "no-any-type": {
    name: "no-any-type",
    severity: "warning",
    description: "Detects `: any` type annotations in function signatures.",
    fn: (file, content) => {
      const findings: Finding[] = [];
      const re = /:\s*any\b(?!\s*\/\/\s*ok)/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const line = content.slice(0, match.index).split("\n").length;
        findings.push({
          file, line, severity: "warning", rule: "no-any-type",
          message: "`any` type annotation — consider using `unknown` or a proper type.",
          snippet: content.split("\n")[line - 1]?.trim()
        });
      }
      return findings;
    }
  },
  "no-console-log": {
    name: "no-console-log",
    severity: "warning",
    description: "Detects `console.log` in non-test files.",
    fn: (file, content) => {
      if (/\.test\.|\.spec\.|tests[\\/]/.test(file)) return [];
      const findings: Finding[] = [];
      const re = /console\.(log|debug|warn|error)\(/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const line = content.slice(0, match.index).split("\n").length;
        findings.push({
          file, line, severity: "warning", rule: "no-console-log",
          message: "Console statement left in production code.",
          snippet: content.split("\n")[line - 1]?.trim()
        });
      }
      return findings;
    }
  },
  "no-todo": {
    name: "no-todo",
    severity: "info",
    description: "Detects TODO, FIXME, HACK, XXX comments.",
    fn: (file, content) => {
      const findings: Finding[] = [];
      const re = /\/\/\s*(TODO|FIXME|HACK|XXX)\b.*$/gim;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const line = content.slice(0, match.index).split("\n").length;
        findings.push({
          file, line, severity: "info", rule: "no-todo",
          message: `${match[1]} comment left in code.`,
          snippet: match[0].trim()
        });
      }
      return findings;
    }
  },
  "no-empty-catch": {
    name: "no-empty-catch",
    severity: "error",
    description: "Detects empty catch blocks that silently swallow errors.",
    fn: (file, content) => {
      const findings: Finding[] = [];
      const re = /catch\s*(\([^)]*\))?\s*\{\s*\}/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const line = content.slice(0, match.index).split("\n").length;
        findings.push({
          file, line, severity: "error", rule: "no-empty-catch",
          message: "Empty catch block silently swallows errors.",
          snippet: match[0]
        });
      }
      return findings;
    }
  },
  "no-ts-ignore": {
    name: "no-ts-ignore",
    severity: "warning",
    description: "Detects `// @ts-ignore` and `// @ts-expect-error`.",
    fn: (file, content) => {
      const findings: Finding[] = [];
      const re = /\/\/\s*@ts-(ignore|expect-error)/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const line = content.slice(0, match.index).split("\n").length;
        const snippet = content.split("\n")[line - 1]?.trim();
        const next = content.split("\n")[line];
        findings.push({
          file, line, severity: "warning", rule: "no-ts-ignore",
          message: `@ts-${match[1]} suppresses TypeScript errors.`,
          snippet: [snippet, next?.trim()].filter(Boolean).join("\n")
        });
      }
      return findings;
    }
  },
  "no-hardcoded-secrets": {
    name: "no-hardcoded-secrets",
    severity: "error",
    description: "Detects hardcoded secrets (apiKey, password, secret, token).",
    fn: (file, content) => {
      if (file.endsWith(".test.ts") || file.endsWith(".spec.ts")) return [];
      const findings: Finding[] = [];
      const re = /(apiKey|api_secret|password|secret|private_key|access_token)\s*[=:]\s*["']([^"']{8,})["']/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const line = content.slice(0, match.index).split("\n").length;
        findings.push({
          file, line, severity: "error", rule: "no-hardcoded-secrets",
          message: `Hardcoded ${match[1]} detected. Use env variable or secrets manager.`,
          snippet: `${match[1]} = "***${match[2].slice(-4)}"`
        });
      }
      return findings;
    }
  },
  "max-line-length": {
    name: "max-line-length",
    severity: "warning",
    description: "Detects lines exceeding 120 characters.",
    fn: (file, content) => {
      const findings: Finding[] = [];
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 120) {
          findings.push({
            file, line: i + 1, severity: "warning", rule: "max-line-length",
            message: `Line is ${lines[i].length} characters (max 120).`,
            snippet: lines[i].slice(0, 120) + "..."
          });
        }
      }
      return findings;
    }
  },
  "no-dead-store": {
    name: "no-dead-store",
    severity: "warning",
    description: "Detects empty `Record<string, string> = {}` patterns (likely dead code placeholder).",
    fn: (file, content) => {
      const findings: Finding[] = [];
      const re = /(?:const|let|var)\s+\w+\s*:\s*Record\s*<\s*string\s*,\s*string\s*>\s*=\s*\{\s*\}/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const line = content.slice(0, match.index).split("\n").length;
        findings.push({
          file, line, severity: "warning", rule: "no-dead-store",
          message: "Empty Record<string, string> — likely dead code or incomplete migration.",
          snippet: match[0]
        });
      }
      return findings;
    }
  }
};

function resolveFiles(workspacePath: string, inputFiles?: string[]): { files: string[], errors: string[] } {
  const errors: string[] = [];
  if (inputFiles && inputFiles.length > 0) {
    const files: string[] = [];
    for (const f of inputFiles) {
      if (isAbsolute(f)) {
        errors.push(`Absolute paths not allowed; use relative paths: ${f}`);
        continue;
      }
      const resolved = resolve(workspacePath, f);
      if (!isPathInside(resolved, workspacePath)) {
        errors.push(`File path outside workspace: ${f}`);
        continue;
      }
      if (existsSync(resolved)) {
        files.push(f);
      } else {
        errors.push(`File not found: ${f}`);
      }
    }
    return { files, errors };
  }
  const pattern = workspacePath.endsWith("/") || workspacePath.endsWith("\\")
    ? `${workspacePath}src/**/*.ts`
    : `${workspacePath}/src/**/*.ts`;
  return {
    files: globSync(pattern.replace(/\\/g, "/"))
      .map((f) => relative(workspacePath, f)),
    errors
  };
}

export async function reviewCodeQualityHandler(
  input: ReviewCodeQualityInput
): Promise<McpTextResult> {
  // Validate workspace access first
  let workspace: string;
  try {
    workspace = await requireWorkspace(input.workspacePath);
  } catch (error) {
    return toolErrorResult(error, "Workspace rejected");
  }

  const { files, errors: resolveErrors } = resolveFiles(workspace, input.files);
  const activeChecks = input.checks && input.checks.length > 0
    ? input.checks
    : Object.keys(ALL_CHECKS);
  const maxFindings = input.maxFindings ?? 100;

  const allFindings: Finding[] = [];
  const errors: string[] = [...resolveErrors];

  for (const file of files) {
    let content: string;
    const absolutePath = join(workspace, file);
    try {
      content = readFileSync(absolutePath, "utf8");
    } catch (e) {
      errors.push(`Cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    for (const checkName of activeChecks) {
      const check = ALL_CHECKS[checkName];
      if (!check) {
        errors.push(`Unknown check: ${checkName}`);
        continue;
      }
      try {
        const findings = check.fn(file, content);
        allFindings.push(...findings);
      } catch (e) {
        errors.push(`Check ${checkName} failed on ${file}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const bySeverity = (sev: Severity) => allFindings.filter((f) => f.severity === sev);

  return textResult(JSON.stringify({
    summary: {
      total: allFindings.length,
      errors: errors.length,
      errorCount: bySeverity("error").length,
      warningCount: bySeverity("warning").length,
      infoCount: bySeverity("info").length,
      filesScanned: files.length,
      checksRun: activeChecks.filter((c) => ALL_CHECKS[c]).length
    },
    findings: allFindings.slice(0, maxFindings),
    errors: errors.length > 0 ? errors : undefined
  }, null, 2));
}
