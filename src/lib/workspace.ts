import {
  access,
  constants,
  mkdir,
  readFile,
  realpath
} from "node:fs/promises";
import path from "node:path";

export type InstructionFile = {
  relativePath: string;
  absolutePath: string;
  text: string;
};

const DEFAULT_INSTRUCTION_FILES = ["AGENTS.md", "GEMINI.md", "README.md"];

export function getAllowedRoots(
  cwd = process.cwd(),
  envValue = process.env.SUPERPOWER_CODEX_ALLOWED_ROOTS,
  delimiter = path.delimiter
): string[] {
  if (!envValue || envValue.trim().length === 0) {
    return [path.resolve(cwd)];
  }

  return envValue
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(entry));
}

export type WorkspaceErrorCode =
  | "workspace_not_found"
  | "workspace_not_allowed"
  | "workspace_unreadable"
  | "workspace_validation_failed";

export type WorkspaceValidation = {
  status: "allowed" | "rejected";
  stage: "workspace_validation";
  requestedPath: string;
  canonicalPath?: string;
  matchedRoot?: string;
  allowedRoots: string[];
  gitRoot?: string;
  readable: boolean;
  antigravityCliAvailable: boolean;
  antigravityCliVersion?: string;
  antigravityExecutable?: string;
  /** @deprecated compatibility field */
  geminiCliAvailable: false;
  /** @deprecated compatibility field */
  geminiStarted: false;
  agentStarted: false;
  modelInvoked: false;
  filesModified: false;
  errorCode?: WorkspaceErrorCode;
  message?: string;
};

export class WorkspaceValidationError extends Error {
  readonly validation: WorkspaceValidation;

  constructor(validation: WorkspaceValidation) {
    super(validation.message ?? validation.errorCode ?? "Workspace rejected");
    this.name = "WorkspaceValidationError";
    this.validation = validation;
  }
}

function comparisonPath(value: string, platform: NodeJS.Platform): string {
  const normalized = path.normalize(value);
  return platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export function isCanonicalPathInside(
  candidate: string,
  root: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const comparedCandidate = comparisonPath(candidate, platform);
  const comparedRoot = comparisonPath(root, platform);
  const relative = path.relative(comparedRoot, comparedCandidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function canAccess(target: string, mode: number): Promise<boolean> {
  try {
    await access(target, mode);
    return true;
  } catch {
    return false;
  }
}

async function canonicalRoots(roots: string[]): Promise<string[]> {
  const results = await Promise.all(
    roots.map(async (root) => {
      try {
        return await realpath(path.resolve(root));
      } catch {
        return undefined;
      }
    })
  );
  return [...new Set(results.filter((root): root is string => Boolean(root)))];
}

function baseValidation(
  requestedPath: string,
  allowedRoots: string[]
): WorkspaceValidation {
  return {
    status: "rejected",
    stage: "workspace_validation",
    requestedPath,
    allowedRoots,
    readable: false,
    antigravityCliAvailable: false,
    geminiCliAvailable: false,
    geminiStarted: false,
    agentStarted: false,
    modelInvoked: false,
    filesModified: false
  };
}

export async function validateWorkspace(
  workspacePath: string,
  roots = getAllowedRoots()
): Promise<WorkspaceValidation> {
  const requestedPath = path.resolve(workspacePath);
  const allowedRoots = await canonicalRoots(roots);
  const base = baseValidation(requestedPath, allowedRoots);

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(requestedPath);
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";
    return {
      ...base,
      errorCode:
        code === "ENOENT"
          ? "workspace_not_found"
          : "workspace_validation_failed",
      message:
        code === "ENOENT"
          ? `Workspace does not exist: ${requestedPath}`
          : `Unable to canonicalize workspace: ${requestedPath}`
    };
  }

  const readable = await canAccess(canonicalPath, constants.R_OK);
  const matchedRoot = allowedRoots.find((root) =>
    isCanonicalPathInside(canonicalPath, root)
  );

  if (!matchedRoot) {
    return {
      ...base,
      canonicalPath,
      readable,
      errorCode: "workspace_not_allowed",
      message: `Workspace ${canonicalPath} is outside allowed roots: ${allowedRoots.join(", ")}`
    };
  }

  if (!readable) {
    return {
      ...base,
      canonicalPath,
      matchedRoot,
      readable,
      errorCode: "workspace_unreadable",
      message: `Cannot read workspace directory: ${canonicalPath}`
    };
  }

  return {
    ...base,
    status: "allowed",
    canonicalPath,
    matchedRoot,
    readable
  };
}

export async function requireWorkspace(
  workspacePath: string,
  roots = getAllowedRoots()
): Promise<string> {
  const validation = await validateWorkspace(workspacePath, roots);
  if (validation.status === "rejected" || !validation.canonicalPath) {
    throw new WorkspaceValidationError(validation);
  }
  return validation.canonicalPath;
}

export function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function collectInstructionFiles(
  workspacePath: string,
  includeFiles: string[] = [],
  maxChars = 40_000
): Promise<InstructionFile[]> {
  const names = [...new Set([...DEFAULT_INSTRUCTION_FILES, ...includeFiles])];
  const files: InstructionFile[] = [];
  let remaining = Math.max(0, maxChars);

  for (const relativePath of names) {
    const absolutePath = path.resolve(workspacePath, relativePath);
    if (!isPathInside(absolutePath, workspacePath) || remaining <= 0) {
      continue;
    }

    try {
      const raw = await readFile(absolutePath, "utf8");
      const text = raw.slice(0, remaining);
      files.push({
        relativePath: path.relative(workspacePath, absolutePath),
        absolutePath,
        text
      });
      remaining -= text.length;
    } catch (error: unknown) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code !== "ENOENT" && code !== "EISDIR") {
        throw error;
      }
    }
  }

  return files;
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug.length > 0 ? slug : "implementation-plan";
}

export function planOutputPath(workspacePath: string, goal: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return path.join(workspacePath, "docs", "superpowers", "plans", `${date}-${slugify(goal)}.md`);
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}
