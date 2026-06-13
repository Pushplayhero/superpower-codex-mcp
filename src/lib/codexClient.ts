import { buildCodexExecArgs, resolveCliInvocation, runCommand, type CommandRunner } from "./command.js";

export type CodexResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export async function invokeCodex(
  prompt: string,
  cwd: string,
  runner: CommandRunner = runCommand,
  timeoutMs = 120_000
): Promise<CodexResult> {
  const { command, prefixArgs } = resolveCliInvocation("codex");
  const result = await runner(
    command,
    [...prefixArgs, ...buildCodexExecArgs(prompt)],
    { cwd, timeoutMs }
  );
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}
