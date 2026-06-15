import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  buildCodexExecArgs,
  commandForDisplay,
  resolveExecutableInvocation,
  resolveCliInvocation,
  runCommand
} from "../src/lib/command.js";

describe("command helpers", () => {
  it("formats commands without invoking a shell", () => {
    expect(commandForDisplay("codex", ["exec", "hello world"])).toBe('codex exec "hello world"');
  });

  it("resolves Codex from PATH on Windows", () => {
    const codexPath = "C:\\Program Files\\Codex\\codex.exe";

    expect(
      resolveCliInvocation(
        "codex",
        "win32",
        {
          APPDATA: "C:\\Users\\Test\\AppData\\Roaming",
          PATH: "C:\\missing;C:\\Program Files\\Codex"
        },
        (candidate) => candidate === codexPath
      )
    ).toEqual({
      command: codexPath,
      prefixArgs: []
    });
  });

  it("falls back to an existing npm Codex entrypoint on Windows", () => {
    const entrypoint = path.join(
      "C:\\Users\\Test\\AppData\\Roaming",
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js"
    );

    expect(
      resolveCliInvocation(
        "codex",
        "win32",
        {
          APPDATA: "C:\\Users\\Test\\AppData\\Roaming",
          PATH: ""
        },
        (candidate) => candidate === entrypoint
      )
    ).toEqual({
      command: process.execPath,
      prefixArgs: [entrypoint]
    });
  });

  it("skips the Codex Desktop packaged executable before npm fallback", () => {
    const desktopExecutable =
      "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0.0_x64__test\\app\\resources\\codex.exe";
    const entrypoint = path.join(
      "C:\\Users\\Test\\AppData\\Roaming",
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js"
    );

    expect(
      resolveCliInvocation(
        "codex",
        "win32",
        {
          APPDATA: "C:\\Users\\Test\\AppData\\Roaming",
          PATH: path.dirname(desktopExecutable)
        },
        (candidate) => candidate === desktopExecutable || candidate === entrypoint
      )
    ).toEqual({
      command: process.execPath,
      prefixArgs: [entrypoint]
    });
  });

  it("reports Codex CLI diagnostics when no Windows candidate exists", () => {
    expect(() =>
      resolveCliInvocation(
        "codex",
        "win32",
        {
          APPDATA: "C:\\Users\\Test\\AppData\\Roaming",
          PATH: "C:\\tools"
        },
        () => false
      )
    ).toThrowError(/"codexCliAvailable": false/);
    expect(() =>
      resolveCliInvocation(
        "codex",
        "win32",
        {
          APPDATA: "C:\\Users\\Test\\AppData\\Roaming",
          PATH: "C:\\tools"
        },
        () => false
      )
    ).toThrowError(/C:\\\\tools\\\\codex\.exe/);
    expect(() =>
      resolveCliInvocation(
        "codex",
        "win32",
        {
          APPDATA: "C:\\Users\\Test\\AppData\\Roaming",
          PATH: "C:\\tools"
        },
        () => false
      )
    ).toThrowError(/@openai/);

    expect(resolveCliInvocation("codex", "linux", {})).toEqual({
      command: "codex",
      prefixArgs: []
    });
  });

  it("allows an explicit CLI command override", () => {
    expect(
      resolveCliInvocation("codex", "win32", {
        SUPERPOWER_CODEX_COMMAND: "C:\\tools\\codex.exe"
      })
    ).toEqual({ command: "C:\\tools\\codex.exe", prefixArgs: [] });
  });

  it("allows an explicit Antigravity CLI command override", () => {
    expect(
      resolveCliInvocation("antigravity", "win32", {
        SUPERPOWER_ANTIGRAVITY_COMMAND: "C:\\tools\\agy.exe"
      })
    ).toEqual({ command: "C:\\tools\\agy.exe", prefixArgs: [] });
  });

  it("resolves the Antigravity CLI from LOCALAPPDATA on Windows", () => {
    const agyPath = "C:\\Users\\Test\\AppData\\Local\\agy\\bin\\agy.exe";

    expect(
      resolveCliInvocation(
        "antigravity",
        "win32",
        {
          LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local",
          PATH: ""
        },
        (candidate) => candidate === agyPath
      )
    ).toEqual({
      command: agyPath,
      prefixArgs: []
    });
  });

  it("prefers an Antigravity CLI on PATH over LOCALAPPDATA on Windows", () => {
    const pathAgyPath = "C:\\tools\\agy.exe";
    const localAgyPath =
      "C:\\Users\\Test\\AppData\\Local\\agy\\bin\\agy.exe";

    expect(
      resolveCliInvocation(
        "antigravity",
        "win32",
        {
          LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local",
          PATH: "C:\\missing;C:\\tools"
        },
        (candidate) => candidate === pathAgyPath || candidate === localAgyPath
      )
    ).toEqual({
      command: pathAgyPath,
      prefixArgs: []
    });
  });

  it("removes paired quotes from Windows PATH entries", () => {
    const pathAgyPath = "C:\\Program Files\\agy\\agy.exe";

    expect(
      resolveCliInvocation(
        "antigravity",
        "win32",
        {
          LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local",
          PATH: '"C:\\Program Files\\agy";C:\\other'
        },
        (candidate) => candidate === pathAgyPath
      )
    ).toEqual({
      command: pathAgyPath,
      prefixArgs: []
    });
  });

  it("throws an error if Antigravity CLI is not found on Windows", () => {
    expect(() =>
      resolveCliInvocation(
        "antigravity",
        "win32",
        {
          LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local",
          PATH: ""
        },
        () => false
      )
    ).toThrowError(
      new Error(
        "Cannot locate Antigravity CLI. Set SUPERPOWER_ANTIGRAVITY_COMMAND."
      )
    );
  });

  it("throws an error for blank LOCALAPPDATA if Antigravity CLI is not on PATH", () => {
    expect(() =>
      resolveCliInvocation(
        "antigravity",
        "win32",
        {
          LOCALAPPDATA: "   ",
          PATH: ""
        },
        () => false
      )
    ).toThrowError(
      new Error(
        "Cannot locate Antigravity CLI. Set SUPERPOWER_ANTIGRAVITY_COMMAND."
      )
    );
  });

  it("uses agy for the Antigravity CLI on Linux", () => {
    expect(resolveCliInvocation("antigravity", "linux", {})).toEqual({
      command: "agy",
      prefixArgs: []
    });
  });

  it("builds Codex 0.139 compatible non-interactive exec arguments", () => {
    expect(buildCodexExecArgs("Review only")).toEqual([
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
      "Review only"
    ]);
  });

  it("runs bare npm through its JavaScript CLI on Windows", () => {
    expect(
      resolveExecutableInvocation(
        "npm",
        ["test"],
        "win32",
        { npm_execpath: "C:\\tools\\npm-cli.js" },
        (candidate) => candidate === "C:\\tools\\npm-cli.js"
      )
    ).toEqual({
      command: process.execPath,
      args: ["C:\\tools\\npm-cli.js", "test"]
    });
    expect(
      resolveExecutableInvocation("npm", ["test"], "linux", {})
    ).toEqual({
      command: "npm",
      args: ["test"]
    });
  });

  it("runs a successful command", async () => {
    const result = await runCommand(process.execPath, ["--version"], { timeoutMs: 5000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^v/);
  });

  it("closes child stdin when no input is provided", async () => {
    const script = [
      "process.stdin.resume();",
      "process.stdin.on('end', () => process.stdout.write('stdin closed'));"
    ].join("");
    const result = await runCommand(
      process.execPath,
      ["-e", script],
      { timeoutMs: 1000 }
    );

    expect(result.timedOut).toBe(false);
    expect(result.stdout).toBe("stdin closed");
  });

  it("passes explicit stdin input to the child process", async () => {
    const script = [
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => input += chunk);",
      "process.stdin.on('end', () => process.stdout.write(input));"
    ].join("");
    const result = await runCommand(
      process.execPath,
      ["-e", script],
      { timeoutMs: 1000, stdin: "review evidence" }
    );

    expect(result.stdout).toBe("review evidence");
  });

  it("captures failed command output", async () => {
    const result = await runCommand(process.execPath, ["--definitely-not-a-node-flag"], { timeoutMs: 5000 });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
