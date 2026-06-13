import { execFile } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";

export type CommandResult = {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

export type CommandOptions = {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandOptions
) => Promise<CommandResult>;

export type CliInvocation = {
  command: string;
  prefixArgs: string[];
};

export function resolveCliInvocation(
  name: "codex" | "gemini" | "antigravity",
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (candidate: string) => boolean = existsSync
): CliInvocation {
  if (name === "antigravity") {
    const override = env.SUPERPOWER_ANTIGRAVITY_COMMAND?.trim();
    if (override) return { command: override, prefixArgs: [] };
    if (platform !== "win32") return { command: "agy", prefixArgs: [] };

    const pathDirs = env.PATH?.split(path.win32.delimiter) ?? [];
    for (const dir of pathDirs) {
      const trimmedDir = dir.trim();
      const normalizedDir =
        trimmedDir.startsWith('"') && trimmedDir.endsWith('"')
          ? trimmedDir.slice(1, -1)
          : trimmedDir;
      if (!normalizedDir) continue;
      const candidate = path.win32.join(normalizedDir, "agy.exe");
      if (fileExists(candidate)) {
        return { command: candidate, prefixArgs: [] };
      }
    }

    const localAppData = env.LOCALAPPDATA?.trim();
    if (localAppData) {
      const candidate = path.win32.join(localAppData, "agy", "bin", "agy.exe");
      if (fileExists(candidate)) {
        return { command: candidate, prefixArgs: [] };
      }
    }

    throw new Error(
      "Cannot locate Antigravity CLI. Set SUPERPOWER_ANTIGRAVITY_COMMAND."
    );
  }

  const overrideName =
    name === "codex" ? "SUPERPOWER_CODEX_COMMAND" : "SUPERPOWER_GEMINI_COMMAND";
  const override = env[overrideName]?.trim();
  if (override) return { command: override, prefixArgs: [] };
  if (platform !== "win32") return { command: name, prefixArgs: [] };

  const npmPrefix =
    env.npm_config_prefix?.trim() ||
    (env.APPDATA ? path.join(env.APPDATA, "npm") : "");
  if (!npmPrefix) {
    throw new Error(
      `Cannot locate the Windows npm prefix for ${name}. Set ${overrideName} to an executable path.`
    );
  }
  const entrypoint =
    name === "codex"
      ? path.join(
          npmPrefix,
          "node_modules",
          "@openai",
          "codex",
          "bin",
          "codex.js"
        )
      : path.join(
          npmPrefix,
          "node_modules",
          "@google",
          "gemini-cli",
          "bundle",
          "gemini.js"
        );
  return { command: process.execPath, prefixArgs: [entrypoint] };
}

export function buildCodexExecArgs(prompt: string): string[] {
  return [
    "--sandbox",
    "read-only",
    "--ask-for-approval",
    "never",
    "exec",
    "--skip-git-repo-check",
    prompt
  ];
}

export function commandForDisplay(command: string, args: string[]): string {
  const quoted = args.map((arg) => (/^[A-Za-z0-9_./:=\\-]+$/.test(arg) ? arg : JSON.stringify(arg)));
  return [command, ...quoted].join(" ");
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs ?? 60_000,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        resolve({
          command,
          args,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: typeof err?.code === "number" ? err.code : err ? 1 : 0,
          timedOut: Boolean(err?.killed)
        });
      }
    );
  });
}
