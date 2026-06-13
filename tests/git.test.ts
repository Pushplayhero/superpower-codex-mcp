import { describe, expect, it, vi } from "vitest";
import {
  collectGitPostflight,
  collectGitPreflight
} from "../src/lib/git.js";
import type { CommandRunner } from "../src/lib/command.js";

function sequencedRunner(outputs: Array<{ stdout: string; exitCode?: number }>): CommandRunner {
  return vi.fn(async (command, args) => {
    const next = outputs.shift();
    if (!next) throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    return {
      command,
      args,
      stdout: next.stdout,
      stderr: next.exitCode ? "failed" : "",
      exitCode: next.exitCode ?? 0,
      timedOut: false
    };
  });
}

describe("Git evidence", () => {
  it("collects git dir, head, and clean status", async () => {
    const runner = sequencedRunner([
      { stdout: ".git\n" },
      { stdout: "aaa111\n" },
      { stdout: "" }
    ]);
    await expect(collectGitPreflight("C:\\repo", runner)).resolves.toEqual({
      gitDir: expect.stringContaining(".git"),
      head: "aaa111",
      status: ""
    });
  });

  it("throws when a required Git command fails", async () => {
    const runner = sequencedRunner([{ stdout: "", exitCode: 128 }]);
    await expect(collectGitPreflight("C:\\repo", runner))
      .rejects.toThrow(/rev-parse --git-dir/);
  });

  it("collects final head, status, and committed files", async () => {
    const runner = sequencedRunner([
      { stdout: "bbb222\n" },
      { stdout: "" },
      { stdout: "src/a.ts\ntests/a.test.ts\n" }
    ]);
    await expect(
      collectGitPostflight("C:\\repo", "aaa111", runner)
    ).resolves.toEqual({
      head: "bbb222",
      status: "",
      changedFiles: ["src/a.ts", "tests/a.test.ts"]
    });
  });
});
