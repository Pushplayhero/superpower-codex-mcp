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
  stdin?: string;
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

function windowsPathDirectories(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH?.split(path.win32.delimiter) ?? [])
    .map((dir) => dir.trim())
    .map((dir) =>
      dir.startsWith('"') && dir.endsWith('"') ? dir.slice(1, -1) : dir
    )
    .filter(Boolean);
}

function isCodexDesktopPackagedExecutable(candidate: string): boolean {
  const normalized = candidate.toLowerCase();
  return normalized.includes("\\windowsapps\\openai.codex_") &&
    normalized.endsWith("\\app\\resources\\codex.exe");
}

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

    for (const dir of windowsPathDirectories(env)) {
      const candidate = path.win32.join(dir, "agy.exe");
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

  if (name === "codex") {
    const searchedPaths: string[] = [];
    for (const dir of windowsPathDirectories(env)) {
      const candidate = path.win32.join(dir, "codex.exe");
      searchedPaths.push(candidate);
      if (fileExists(candidate) && !isCodexDesktopPackagedExecutable(candidate)) {
        return { command: candidate, prefixArgs: [] };
      }
    }

    const npmPrefix =
      env.npm_config_prefix?.trim() ||
      (env.APPDATA ? path.join(env.APPDATA, "npm") : "");
    if (npmPrefix) {
      const entrypoint = path.join(
        npmPrefix,
        "node_modules",
        "@openai",
        "codex",
        "bin",
        "codex.js"
      );
      searchedPaths.push(entrypoint);
      if (fileExists(entrypoint)) {
        return { command: process.execPath, prefixArgs: [entrypoint] };
      }
    }

    throw new Error(JSON.stringify({
      codexCliAvailable: false,
      searchedPaths,
      hint: `Install Codex CLI or set ${overrideName} to an executable path.`
    }, null, 2));
  }

  const npmPrefix =
    env.npm_config_prefix?.trim() ||
    (env.APPDATA ? path.join(env.APPDATA, "npm") : "");
  if (!npmPrefix) {
    throw new Error(
      `Cannot locate the Windows npm prefix for ${name}. Set ${overrideName} to an executable path.`
    );
  }
  const entrypoint = path.join(
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
    "--disable",
    "plugins",
    "--disable",
    "apps",
    "--disable",
    "multi_agent",
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    prompt
  ];
}

export function resolveExecutableInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (candidate: string) => boolean = existsSync
): { command: string; args: string[] } {
  if (
    platform === "win32" &&
    !command.includes("/") &&
    !command.includes("\\") &&
    command.toLowerCase() === "npm"
  ) {
    const candidates = [
      env.npm_execpath?.trim(),
      path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
      env.APPDATA
        ? path.join(env.APPDATA, "npm", "node_modules", "npm", "bin", "npm-cli.js")
        : undefined
    ].filter((candidate): candidate is string => Boolean(candidate));
    const npmCli = candidates.find(fileExists);
    if (!npmCli) {
      throw new Error(
        "Cannot locate npm-cli.js for shell-free execution on Windows."
      );
    }
    return {
      command: process.execPath,
      args: [npmCli, ...args]
    };
  }
  return { command, args };
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
    let invocation: { command: string; args: string[] };
    try {
      invocation = resolveExecutableInvocation(command, args);
    } catch (error) {
      resolve({
        command,
        args,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        timedOut: false
      });
      return;
    }
    const child = execFile(
      invocation.command,
      invocation.args,
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
          command: invocation.command,
          args: invocation.args,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: typeof err?.code === "number" ? err.code : err ? 1 : 0,
          timedOut: Boolean(err?.killed)
        });
      }
    );
    child.stdin?.end(options.stdin);
  });
}
