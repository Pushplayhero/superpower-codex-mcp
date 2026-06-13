import path from "node:path";
import { runCommand, type CommandRunner } from "./command.js";

async function runGit(
  workspacePath: string,
  args: string[],
  runner: CommandRunner
): Promise<string> {
  const result = await runner("git", args, {
    cwd: workspacePath,
    timeoutMs: 30_000
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.trim() || "unknown error"}`
    );
  }
  return result.stdout.trim();
}

export async function collectGitPreflight(
  workspacePath: string,
  runner: CommandRunner = runCommand
) {
  const gitDirRaw = await runGit(workspacePath, ["rev-parse", "--git-dir"], runner);
  const head = await runGit(workspacePath, ["rev-parse", "HEAD"], runner);
  const status = await runGit(
    workspacePath,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    runner
  );
  return {
    gitDir: path.resolve(workspacePath, gitDirRaw),
    head,
    status
  };
}

export async function collectGitPostflight(
  workspacePath: string,
  initialHead: string,
  runner: CommandRunner = runCommand
) {
  const head = await runGit(workspacePath, ["rev-parse", "HEAD"], runner);
  const status = await runGit(
    workspacePath,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    runner
  );
  const names = await runGit(
    workspacePath,
    ["diff", "--name-only", "--no-renames", `${initialHead}..${head}`, "--"],
    runner
  );
  return {
    head,
    status,
    changedFiles: names ? names.split(/\r?\n/).filter(Boolean) : []
  };
}

// Keep existing helpers for compatibility
export async function gitStatus(workspacePath: string, runner: CommandRunner = runCommand): Promise<string> {
  const result = await runner("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: workspacePath });
  return result.stdout.trim();
}

export async function gitDiff(workspacePath: string, runner: CommandRunner = runCommand): Promise<string> {
  const result = await runner("git", ["diff", "HEAD"], { cwd: workspacePath });
  return result.stdout.trim();
}

export async function gitDiffForFiles(workspacePath: string, files: string[], runner: CommandRunner = runCommand): Promise<string> {
  if (files.length === 0) return "";
  const result = await runner("git", ["diff", "HEAD", "--", ...files], { cwd: workspacePath });
  return result.stdout.trim();
}
