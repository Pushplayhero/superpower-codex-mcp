import { chmod, copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { buildCodexExecArgs, resolveCliInvocation, runCommand, type CommandRunner } from "./command.js";

export type CodexResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

async function createIsolatedCodexHome(): Promise<string> {
  const sourceHome =
    process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");
  const isolatedHome = path.join(
    path.dirname(sourceHome),
    `${path.basename(sourceHome)}-mcp-runtime`
  );
  await mkdir(isolatedHome, { recursive: true });
  const sourceAuth = path.join(sourceHome, "auth.json");
  const isolatedAuth = path.join(isolatedHome, "auth.json");

  try {
    await copyFile(sourceAuth, isolatedAuth);
    await chmod(isolatedAuth, 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  return isolatedHome;
}

export async function invokeCodex(
  prompt: string,
  cwd: string,
  runner: CommandRunner = runCommand,
  timeoutMs = 120_000
): Promise<CodexResult> {
  const { command, prefixArgs } = resolveCliInvocation("codex");
  const isolatedHome = await createIsolatedCodexHome();
  const result = await runner(
    command,
    [...prefixArgs, ...buildCodexExecArgs(prompt)],
    {
      cwd,
      timeoutMs,
      env: {
        ...process.env,
        CODEX_HOME: isolatedHome
      }
    }
  );
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}
