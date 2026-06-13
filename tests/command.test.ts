import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  buildCodexExecArgs,
  commandForDisplay,
  resolveCliInvocation,
  runCommand
} from "../src/lib/command.js";

describe("command helpers", () => {
  it("formats commands without invoking a shell", () => {
    expect(commandForDisplay("codex", ["exec", "hello world"])).toBe('codex exec "hello world"');
  });

  it("runs npm CLI entrypoints through node on Windows", () => {
    expect(
      resolveCliInvocation("codex", "win32", {
        APPDATA: "C:\\Users\\Test\\AppData\\Roaming"
      })
    ).toEqual({
      command: process.execPath,
      prefixArgs: [
        path.join(
          "C:\\Users\\Test\\AppData\\Roaming",
          "npm",
          "node_modules",
          "@openai",
          "codex",
          "bin",
          "codex.js"
        )
      ]
    });
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

  it("places Codex global flags before the exec subcommand", () => {
    expect(buildCodexExecArgs("Review only")).toEqual([
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "exec",
      "--skip-git-repo-check",
      "Review only"
    ]);
  });

  it("runs a successful command", async () => {
    const result = await runCommand(process.execPath, ["--version"], { timeoutMs: 5000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^v/);
  });

  it("captures failed command output", async () => {
    const result = await runCommand(process.execPath, ["--definitely-not-a-node-flag"], { timeoutMs: 5000 });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
