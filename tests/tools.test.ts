import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCliInvocation, type CommandRunner } from "../src/lib/command.js";
import { invokeCodex } from "../src/lib/codexClient.js";
import { debugWithCodexHandler } from "../src/tools/debugWithCodex.js";
import { planWithCodexHandler } from "../src/tools/planWithCodex.js";
import { reviewCodeQualityHandler } from "../src/tools/reviewCodeQuality.js";
import { reviewWithCodexHandler } from "../src/tools/reviewWithCodex.js";
import { runDevelopmentWorkflowHandler } from "../src/tools/runDevelopmentWorkflow.js";
import { runGeminiCodingTaskHandler } from "../src/tools/runGeminiCodingTask.js";
import { runCodingTaskHandler } from "../src/tools/runCodingTask.js";
import { summarizeRepoContextHandler } from "../src/tools/summarizeRepoContext.js";
import { validateWorkspaceHandler } from "../src/tools/validateWorkspace.js";
import { verifyWithCodexHandler } from "../src/tools/verifyWithCodex.js";

const created: string[] = [];

beforeEach(() => {
  process.env.SUPERPOWER_CODEX_COMMAND = process.execPath;
});

async function tempWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sp-codex-tool-"));
  created.push(dir);
  process.env.SUPERPOWER_CODEX_ALLOWED_ROOTS = dir;
  await writeFile(path.join(dir, "AGENTS.md"), "- Run npm test");
  await writeFile(path.join(dir, "GEMINI.md"), "- Call plan_with_codex before broad changes");
  return dir;
}

afterEach(async () => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
  delete process.env.SUPERPOWER_CODEX_ALLOWED_ROOTS;
  delete process.env.SUPERPOWER_CODEX_COMMAND;
});

function fakeRunner(stdout: string): CommandRunner {
  return vi.fn(async (command, args) => ({
    command,
    args,
    stdout,
    stderr: "",
    exitCode: 0,
    timedOut: false
  }));
}

function sequencedRunner(
  outputs: Array<{
    stdout: string;
    stderr?: string;
    exitCode?: number;
    timedOut?: boolean;
  }>
): CommandRunner {
  return vi.fn(async (command, args) => {
    const next = outputs.shift();
    if (!next) throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    return {
      command,
      args,
      stdout: next.stdout,
      stderr: next.stderr ?? "",
      exitCode: next.exitCode ?? 0,
      timedOut: next.timedOut ?? false
    };
  });
}

describe("tool handlers", () => {
  it("invokes Codex with a dedicated home containing auth but no global instructions", async () => {
    const workspace = await tempWorkspace();
    const sourceHome = await mkdtemp(path.join(tmpdir(), "sp-codex-home-"));
    created.push(sourceHome);
    const runtimeHome = path.join(
      path.dirname(sourceHome),
      `${path.basename(sourceHome)}-mcp-runtime`
    );
    created.push(runtimeHome);
    await writeFile(path.join(sourceHome, "auth.json"), "{\"token\":\"test\"}");
    await writeFile(path.join(sourceHome, "AGENTS.md"), "Call MCP tools recursively.");
    const previousHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = sourceHome;
    let isolatedHome = "";

    try {
      const runner: CommandRunner = vi.fn(async (command, args, options) => {
        isolatedHome = options?.env?.CODEX_HOME ?? "";
        expect(isolatedHome).not.toBe(sourceHome);
        expect(await readFile(path.join(isolatedHome, "auth.json"), "utf8"))
          .toBe("{\"token\":\"test\"}");
        await expect(readFile(path.join(isolatedHome, "AGENTS.md"), "utf8"))
          .rejects.toThrow();
        return {
          command,
          args,
          stdout: "OK",
          stderr: "",
          exitCode: 0,
          timedOut: false
        };
      });

      await invokeCodex("Review", workspace, runner);
      expect(await readFile(path.join(isolatedHome, "auth.json"), "utf8"))
        .toBe("{\"token\":\"test\"}");
    } finally {
      if (previousHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousHome;
      }
    }
  });

  it("summarizes repository instruction context", async () => {
    const workspace = await tempWorkspace();
    const result = await summarizeRepoContextHandler({
      workspacePath: workspace,
      includeFiles: [],
      maxChars: 10_000
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("AGENTS.md");
    expect(result.content[0].text).toContain("GEMINI.md");
    expect(result.content[0].text).toContain("Run npm test");
  });

  it("calls codex exec for planning and stores the plan", async () => {
    const workspace = await tempWorkspace();
    const runner = fakeRunner("# Plan\n\n- Step 1");
    const result = await planWithCodexHandler(
      {
        workspacePath: workspace,
        goal: "Add MCP server",
        constraints: "TypeScript",
        doneWhen: "Tests pass",
        reasoningLevel: "medium"
      },
      runner
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("# Plan");
    expect(runner).toHaveBeenCalledWith(
      resolveCliInvocation("codex").command,
      expect.arrayContaining([
        ...resolveCliInvocation("codex").prefixArgs,
        "exec",
        "--sandbox",
        "read-only"
      ]),
      expect.objectContaining({ cwd: workspace })
    );
    const planPath = path.join(
      workspace,
      "docs",
      "superpowers",
      "plans",
      `${new Date().toISOString().slice(0, 10)}-add-mcp-server.md`
    );
    expect(await readFile(planPath, "utf8")).toContain("# Plan");
  });

  it("calls codex exec for review", async () => {
    const workspace = await tempWorkspace();
    const runner = fakeRunner(JSON.stringify({
      status: "clean",
      summary: "No findings.",
      findings: []
    }));
    const result = await reviewWithCodexHandler(
      { workspacePath: workspace, reviewScope: "working-tree", focus: "correctness" },
      runner
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      status: "clean",
      findings: []
    });
    expect(runner).toHaveBeenCalledWith(
      resolveCliInvocation("codex").command,
      expect.any(Array),
      expect.objectContaining({ cwd: workspace, timeoutMs: 300_000 })
    );
  });

  it("rejects malformed Codex review output", async () => {
    const workspace = await tempWorkspace();
    const result = await reviewWithCodexHandler(
      { workspacePath: workspace, reviewScope: "working-tree" },
      fakeRunner("No findings.")
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("structured review");
  });

  it("calls codex exec for debugging", async () => {
    const workspace = await tempWorkspace();
    const runner = fakeRunner("Likely cause: parser changed.");
    const result = await debugWithCodexHandler(
      {
        workspacePath: workspace,
        symptom: "test failure",
        commandOutput: "expected true got false",
        recentChanges: "parser edit"
      },
      runner
    );
    expect(result.content[0].text).toContain("Likely cause");
  });

  it("does not run verification commands without explicit permission", async () => {
    const workspace = await tempWorkspace();
    const runner = fakeRunner("Verification plan");
    const result = await verifyWithCodexHandler(
      {
        workspacePath: workspace,
        expectedBehavior: "Build passes",
        verificationCommands: ["npm test"],
        allowCommandExecution: false
      },
      runner
    );
    expect(result.content[0].text).toContain("Verification plan");
    expect(runner).toHaveBeenCalledWith(
      resolveCliInvocation("codex").command,
      expect.arrayContaining([
        ...resolveCliInvocation("codex").prefixArgs,
        "exec",
        "--sandbox",
        "read-only"
      ]),
      expect.objectContaining({ cwd: workspace })
    );
  });

  it("runs verification commands when allowed", async () => {
    const workspace = await tempWorkspace();
    const runner = fakeRunner("PASS");
    const result = await verifyWithCodexHandler(
      {
        workspacePath: workspace,
        expectedBehavior: "Build passes",
        verificationCommands: ["node --version"],
        allowCommandExecution: true
      },
      runner
    );
    expect(result.content[0].text).toContain("node --version");
    expect(result.content[0].text).toContain("PASS");
  });

    it("detects command failure from non-zero exit code", async () => {
      const workspace = await tempWorkspace();
      const runner = sequencedRunner([
        { stdout: "FAIL", exitCode: 1 },
        { stdout: "Assessment: Command failed with exit code 1" }
      ]);
      const result = await verifyWithCodexHandler(
        {
          workspacePath: workspace,
          expectedBehavior: "Tests pass",
          verificationCommands: ["npm test"],
          allowCommandExecution: true
        },
        runner
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Exit code: 1");
      expect(result.content[0].text).toContain("Command result: FAILED");
    });

    it("rejects shell operators in verification commands", async () => {
    const workspace = await tempWorkspace();
    const runner = fakeRunner("unused");
    const result = await verifyWithCodexHandler(
      {
        workspacePath: workspace,
        expectedBehavior: "Command is safe",
        verificationCommands: ["echo safe & whoami"],
        allowCommandExecution: true
      },
      runner
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Shell operators are not supported");
  });

  it("rejects gemini execution without explicit permission", async () => {
    const workspace = await tempWorkspace();
    const result = await runGeminiCodingTaskHandler({
      workspacePath: workspace,
      prompt: "Edit files",
      allowExecution: false
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("allowExecution");
  });

  it("uses a configurable long timeout for Gemini coding tasks", async () => {
    const workspace = await tempWorkspace();
    const runner = fakeRunner('{"response":"implemented"}');
    const result = await runGeminiCodingTaskHandler(
      {
        workspacePath: workspace,
        prompt: "Implement Task 2",
        allowExecution: true,
        timeoutSeconds: 900
      },
      runner
    );

    expect(result.isError).toBeUndefined();
    expect(runner).toHaveBeenCalledWith(
      resolveCliInvocation("antigravity").command,
      expect.arrayContaining([
        ...resolveCliInvocation("antigravity").prefixArgs,
        "--print",
        "Implement Task 2"
      ]),
      expect.objectContaining({ cwd: workspace, timeoutMs: 900_000 })
    );
  });

  it("rejects unsupported legacy models with an error", async () => {
    const workspace = await tempWorkspace();
    const runner = fakeRunner("");
    const result = await runGeminiCodingTaskHandler(
      {
        workspacePath: workspace,
        prompt: "Fix review findings",
        allowExecution: true,
        model: "gemini-3.1-pro-preview"
      },
      runner
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Failed to run coding task");
  });

  it("returns contract_failed if strict preflight fails (non-Git)", async () => {
    const workspace = await tempWorkspace();
    const runner = sequencedRunner([
      { stdout: "", exitCode: 128 } // git rev-parse --git-dir fails
    ]);
    const result = await runGeminiCodingTaskHandler(
      {
        workspacePath: workspace,
        prompt: "Implement",
        allowExecution: true,
        mode: "execute",
        planApproved: true
      },
      runner
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe("contract_failed");
    expect(payload.model).toBe("gemini-3.5-flash");
    expect(runner).toHaveBeenCalledTimes(1); // Only git rev-parse --git-dir
  });

  it("returns contract_failed if workspace is dirty before strict execution", async () => {
    const workspace = await tempWorkspace();
    const runner = sequencedRunner([
      { stdout: ".git\n" },
      { stdout: "aaa\n" },
      { stdout: " M src/a.ts\n" }
    ]);
    const result = await runGeminiCodingTaskHandler(
      {
        workspacePath: workspace,
        prompt: "Implement",
        allowExecution: true,
        mode: "execute",
        planApproved: true,
        requireCleanWorkspace: true
      },
      runner
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe("contract_failed");
    expect(payload.summary).toContain("clean");
    expect(payload.model).toBe("gemini-3.5-flash");
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it("executes strict contract successfully and verifies evidence", async () => {
    const workspace = await tempWorkspace();
    const report = {
      status: "committed",
      summary: "Done A",
      commitSha: "bbb",
      changedFiles: ["src/a.ts", "tests/a.test.ts"],
      acceptanceMatrix: [{ criterionId: "AC-1", testNames: ["test"], result: "PASS" }]
    };
    const runner = sequencedRunner([
      { stdout: ".git\n" },
      { stdout: "aaa\n" },
      { stdout: "" }, // clean status
      { stdout: JSON.stringify({ response: JSON.stringify(report) }) },
      { stdout: "bbb\n" }, // postflight HEAD
      { stdout: "" }, // postflight status
      { stdout: "src/a.ts\ntests/a.test.ts\n" } // postflight changed files
    ]);
    const result = await runGeminiCodingTaskHandler(
      {
        workspacePath: workspace,
        prompt: "Implement A",
        allowExecution: true,
        mode: "execute",
        planApproved: true,
        requireCommit: true,
        acceptanceCriteria: [{ id: "AC-1", description: "A works" }],
        allowedFiles: ["src/a.ts", "tests/a.test.ts"]
      },
      runner
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe("committed");
    expect(payload.finalHead).toBe("bbb");
    expect(payload.changedFiles).toEqual(["src/a.ts", "tests/a.test.ts"]);
    expect(payload.transcriptPath).toBeDefined();
    expect(runner).toHaveBeenCalledWith(
      resolveCliInvocation("antigravity").command,
      expect.arrayContaining(["--dangerously-skip-permissions"]),
      expect.anything()
    );
  });

  it("returns mode_mismatch if Gemini asks for approval", async () => {
    const workspace = await tempWorkspace();
    const runner = sequencedRunner([
      { stdout: ".git\n" },
      { stdout: "aaa\n" },
      { stdout: "" },
      { stdout: JSON.stringify({ response: "Please approve the plan." }) },
      { stdout: "aaa\n" },
      { stdout: "" },
      { stdout: "" }
    ]);
    const result = await runGeminiCodingTaskHandler(
      {
        workspacePath: workspace,
        prompt: "Implement",
        allowExecution: true,
        mode: "execute",
        planApproved: true
      },
      runner
    );
    expect(JSON.parse(result.content[0].text).status).toBe("mode_mismatch");
  });

  it("returns contract_failed if forbidden files are changed", async () => {
    const workspace = await tempWorkspace();
    const report = {
      status: "tests_passed",
      summary: "Done",
      changedFiles: ["src/forbidden.ts"],
      acceptanceMatrix: []
    };
    const runner = sequencedRunner([
      { stdout: ".git\n" },
      { stdout: "aaa\n" },
      { stdout: "" },
      { stdout: JSON.stringify({ response: JSON.stringify(report) }) },
      { stdout: "aaa\n" },
      { stdout: "" },
      { stdout: "src/forbidden.ts\n" }
    ]);
    const result = await runGeminiCodingTaskHandler(
      {
        workspacePath: workspace,
        prompt: "Implement",
        allowExecution: true,
        mode: "execute",
        planApproved: true,
        allowedFiles: ["src/allowed.ts"]
      },
      runner
    );
    expect(JSON.parse(result.content[0].text).status).toBe("contract_failed");
    expect(JSON.parse(result.content[0].text).violations[0]).toContain("outside allowlist");
  });

  it("returns contract_failed if required commit is missing", async () => {
    const workspace = await tempWorkspace();
    const report = {
      status: "committed",
      summary: "Done",
      commitSha: "bbb",
      changedFiles: ["src/a.ts"],
      acceptanceMatrix: []
    };
    const runner = sequencedRunner([
      { stdout: ".git\n" },
      { stdout: "aaa\n" },
      { stdout: "" },
      { stdout: JSON.stringify({ response: JSON.stringify(report) }) },
      { stdout: "aaa\n" }, // HEAD did not advance
      { stdout: "" },
      { stdout: "src/a.ts\n" }
    ]);
    const result = await runGeminiCodingTaskHandler(
      {
        workspacePath: workspace,
        prompt: "Implement",
        allowExecution: true,
        mode: "execute",
        planApproved: true,
        requireCommit: true
      },
      runner
    );
    expect(JSON.parse(result.content[0].text).status).toBe("contract_failed");
    expect(JSON.parse(result.content[0].text).violations[0]).toContain("commit was required");
  });

  it("returns timed_out if Gemini times out", async () => {
    const workspace = await tempWorkspace();
    const runner = sequencedRunner([
      { stdout: ".git\n" },
      { stdout: "aaa\n" },
      { stdout: "" },
      { stdout: "", timedOut: true, exitCode: 1 }
    ]);
    const result = await runGeminiCodingTaskHandler(
      {
        workspacePath: workspace,
        prompt: "Implement",
        allowExecution: true,
        mode: "execute",
        planApproved: true
      },
      runner
    );
    expect(JSON.parse(result.content[0].text).status).toBe("timed_out");
  });

  it("returns the same structured workspace rejection from context and coding tools", async () => {
    const allowed = await tempWorkspace();
    const outside = await mkdtemp(path.join(tmpdir(), "sp-outside-"));
    created.push(outside);
    process.env.SUPERPOWER_CODEX_ALLOWED_ROOTS = allowed;
    const runner = fakeRunner("must not run");

    const contextResult = await summarizeRepoContextHandler({
      workspacePath: outside
    });
    const codingResult = await runGeminiCodingTaskHandler(
      {
        workspacePath: outside,
        prompt: "Do not run",
        allowExecution: true
      },
      runner
    );

    const contextPayload = JSON.parse(contextResult.content[0].text);
    const codingPayload = JSON.parse(codingResult.content[0].text);
    expect(contextResult.isError).toBe(true);
    expect(codingResult.isError).toBe(true);
    expect(contextPayload.errorCode).toBe("workspace_not_allowed");
    expect(codingPayload.errorCode).toBe("workspace_not_allowed");
      expect(codingPayload).toMatchObject({
        status: "rejected",
        stage: "workspace_validation",
        geminiStarted: false,
        modelInvoked: false,
        filesModified: false,
        deprecation: {
          replacement: "run_antigravity_coding_task"
        }
      });
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns structured workspace rejection from other repository tools", async () => {
    const allowed = await tempWorkspace();
    const outside = await mkdtemp(path.join(tmpdir(), "sp-outside-other-"));
    created.push(outside);
    process.env.SUPERPOWER_CODEX_ALLOWED_ROOTS = allowed;
    const runner = fakeRunner("must not run");

    const tools = [
      () => planWithCodexHandler({
        workspacePath: outside,
        goal: "Plan",
        constraints: "",
        doneWhen: "Done"
      }, runner),
      () => reviewWithCodexHandler({
        workspacePath: outside,
        reviewScope: "working-tree"
      }, runner),
      () => debugWithCodexHandler({
        workspacePath: outside,
        symptom: "Failure",
        commandOutput: "Output"
      }, runner),
      () => verifyWithCodexHandler({
        workspacePath: outside,
        expectedBehavior: "Pass",
        verificationCommands: [],
        allowCommandExecution: false
      }, runner)
    ];

    for (const call of tools) {
      const result = await call();
      expect(result.isError).toBe(true);
      const payload = JSON.parse(result.content[0].text);
      expect(payload).toMatchObject({
        status: "rejected",
        stage: "workspace_validation",
        errorCode: "workspace_not_allowed",
        geminiStarted: false,
        modelInvoked: false,
        filesModified: false
      });
    }
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns workspace, Git, and Gemini capability preflight", async () => {
    const workspace = await tempWorkspace();
      const runner = sequencedRunner([
        { stdout: `${workspace}\n` },
        { stdout: "1.0.8\n" }
      ]);

      const result = await validateWorkspaceHandler(
        {
          workspacePath: workspace,
          checkGit: true,
          checkAntigravityCli: true
        },
        runner
      );

      const payload = JSON.parse(result.content[0].text);
      expect(result.isError).toBeUndefined();
      expect(payload).toMatchObject({
        status: "allowed",
        stage: "workspace_validation",
        gitRoot: workspace,
        antigravityCliAvailable: true,
        antigravityCliVersion: "1.0.8",
        antigravityExecutable: expect.stringContaining("agy"),
        geminiCliAvailable: false,
        agentStarted: false,
        modelInvoked: false,
        filesModified: false
      });
      expect(runner).toHaveBeenCalledTimes(2);
  });

  it("keeps an allowed workspace allowed when optional capabilities are unavailable", async () => {
    const workspace = await tempWorkspace();
      const runner = sequencedRunner([
        { stdout: "", stderr: "not a git repository", exitCode: 128 },
        { stdout: "", stderr: "antigravity missing", exitCode: 1 }
      ]);

      const result = await validateWorkspaceHandler(
        { workspacePath: workspace },
        runner
      );
      const payload = JSON.parse(result.content[0].text);

      expect(payload.status).toBe("allowed");
      expect(payload.gitRoot).toBeUndefined();
      expect(payload.antigravityCliAvailable).toBe(false);
      expect(payload.geminiCliAvailable).toBe(false);
  });

  it("returns structured workspace rejection from validateWorkspaceHandler", async () => {
    const allowed = await tempWorkspace();
    const outside = await mkdtemp(path.join(tmpdir(), "sp-outside-validate-"));
    created.push(outside);
    process.env.SUPERPOWER_CODEX_ALLOWED_ROOTS = allowed;
    const runner = fakeRunner("must not run");

    const result = await validateWorkspaceHandler(
      { workspacePath: outside },
      runner
    );

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload).toMatchObject({
      status: "rejected",
      stage: "workspace_validation",
      errorCode: "workspace_not_allowed",
      geminiStarted: false,
      modelInvoked: false,
      filesModified: false
    });
    expect(runner).not.toHaveBeenCalled();
  });

  describe("runCodingTaskHandler", () => {
    it("resolves the model through the Antigravity adapter for native models", async () => {
      const workspace = await tempWorkspace();
      const runner = sequencedRunner([
        { stdout: ".git\n" },
        { stdout: "aaa\n" },
        { stdout: "" },
        { stdout: `Created conversation 12345678-1234-1234-1234-123456789012` },
        { stdout: "aaa\n" },
        { stdout: "" },
        { stdout: "" }
      ]);
      await runCodingTaskHandler(
        {
          workspacePath: workspace,
          prompt: "Fix it",
          allowExecution: true,
          model: "Gemini 3.5 Flash (Medium)"
        },
        runner
      );
      
      expect(runner).toHaveBeenCalledWith(
        resolveCliInvocation("antigravity").command,
        expect.arrayContaining(["--model", "Gemini 3.5 Flash (Medium)"]),
        expect.anything()
      );
    });

    it("rejects unsupported legacy models with an error", async () => {
      const workspace = await tempWorkspace();
      const runner = fakeRunner("");
      const result = await runCodingTaskHandler(
        {
          workspacePath: workspace,
          prompt: "Fix it",
          allowExecution: true,
          model: "gemini-3.1-pro-preview"
        },
        runner
      );
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to run coding task");
    });
  });

  describe("runGeminiCodingTaskHandler deprecation and compatibility", () => {
    it("adds deprecation metadata only to the legacy alias payload", async () => {
      const workspace = await tempWorkspace();
      const report = {
        status: "committed",
        summary: "Done A",
        commitSha: "bbb",
        changedFiles: ["src/a.ts"],
        acceptanceMatrix: []
      };
      const runner = sequencedRunner([
        { stdout: ".git\n" },
        { stdout: "aaa\n" },
        { stdout: "" }, // clean status
        { stdout: JSON.stringify({ response: JSON.stringify(report) }) },
        { stdout: "bbb\n" }, // postflight HEAD
        { stdout: "" }, // postflight status
        { stdout: "src/a.ts\n" } // postflight changed files
      ]);

      const resultGemini = await runGeminiCodingTaskHandler(
        {
          workspacePath: workspace,
          prompt: "Implement A",
          allowExecution: true,
          mode: "execute",
          planApproved: true,
          requireCommit: true,
          allowedFiles: ["src/a.ts"]
        },
        runner
      );

      const payloadGemini = JSON.parse(resultGemini.content[0].text);
      expect(payloadGemini.status).toBe("committed");
      expect(payloadGemini.changedFiles).toEqual(["src/a.ts"]);
      expect(payloadGemini.transcriptPath).toBeDefined();
      expect(payloadGemini.deprecation).toEqual({
        message: "run_gemini_coding_task is deprecated. Please use run_antigravity_coding_task instead.",
        replacement: "run_antigravity_coding_task"
      });

      // Reset runner for canonical runCodingTaskHandler
      const runner2 = sequencedRunner([
        { stdout: ".git\n" },
        { stdout: "aaa\n" },
        { stdout: "" },
        { stdout: JSON.stringify({ response: JSON.stringify(report) }) },
        { stdout: "bbb\n" },
        { stdout: "" },
        { stdout: "src/a.ts\n" }
      ]);

      const resultCanonical = await runCodingTaskHandler(
        {
          workspacePath: workspace,
          prompt: "Implement A",
          allowExecution: true,
          mode: "execute",
          planApproved: true,
          requireCommit: true,
          allowedFiles: ["src/a.ts"]
        },
        runner2
      );

      const payloadCanonical = JSON.parse(resultCanonical.content[0].text);
      expect(payloadCanonical.status).toBe("committed");
      expect(payloadCanonical.changedFiles).toEqual(["src/a.ts"]);
      expect(payloadCanonical.deprecation).toBeUndefined();
    });
  });

  describe("reviewCodeQualityHandler", () => {
    it("scans workspace TypeScript files for structural issues", async () => {
      const workspace = await tempWorkspace();
      const srcDir = path.join(workspace, "src");
      await mkdir(srcDir, { recursive: true });
      await writeFile(path.join(srcDir, "test.ts"), [
        'const x: any = "hello";',
        "console.log(x);",
        "// TODO: refactor this"
      ].join("\n"));

      const result = await reviewCodeQualityHandler({
        workspacePath: workspace
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0].text);
      expect(payload.summary.filesScanned).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(payload.findings)).toBe(true);
    });

    it("reports Python-only workspaces as unsupported instead of clean", async () => {
      const workspace = await tempWorkspace();
      await writeFile(path.join(workspace, "pyproject.toml"), "[project]\nname = \"example\"");
      await writeFile(path.join(workspace, "app.py"), "print('hello')\n");

      const result = await reviewCodeQualityHandler({
        workspacePath: workspace
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0].text);
      expect(payload.summary.filesScanned).toBe(0);
      expect(payload.unsupportedLanguage).toBe("python");
      expect(payload.findings).toEqual([]);
    });

    it("reports explicitly selected Python files as unsupported", async () => {
      const workspace = await tempWorkspace();
      await writeFile(path.join(workspace, "app.py"), "print('hello')\n");

      const result = await reviewCodeQualityHandler({
        workspacePath: workspace,
        files: ["app.py"]
      });

      const payload = JSON.parse(result.content[0].text);
      expect(payload.summary.filesScanned).toBe(0);
      expect(payload.unsupportedLanguage).toBe("python");
      expect(payload.findings).toEqual([]);
    });

    it("detects Python source in arbitrary nested directories", async () => {
      const workspace = await tempWorkspace();
      const packageDir = path.join(workspace, "package", "nested");
      await mkdir(packageDir, { recursive: true });
      await writeFile(path.join(packageDir, "module.py"), "VALUE = 1\n");

      const result = await reviewCodeQualityHandler({
        workspacePath: workspace
      });

      const payload = JSON.parse(result.content[0].text);
      expect(payload.summary.filesScanned).toBe(0);
      expect(payload.unsupportedLanguage).toBe("python");
    });

    it("ignores Python files inside virtual environments", async () => {
      const workspace = await tempWorkspace();
      const packageDir = path.join(workspace, "venv", "Lib", "site-packages");
      await mkdir(packageDir, { recursive: true });
      await writeFile(path.join(packageDir, "dependency.py"), "VALUE = 1\n");

      const result = await reviewCodeQualityHandler({
        workspacePath: workspace
      });

      const payload = JSON.parse(result.content[0].text);
      expect(payload.unsupportedLanguage).toBeUndefined();
    });

    it("scans selected TypeScript and reports selected Python as unsupported files", async () => {
      const workspace = await tempWorkspace();
      await writeFile(path.join(workspace, "app.ts"), "export const value = 1;\n");
      await writeFile(path.join(workspace, "app.py"), "VALUE = 1\n");

      const result = await reviewCodeQualityHandler({
        workspacePath: workspace,
        files: ["app.ts", "app.py"]
      });

      const payload = JSON.parse(result.content[0].text);
      expect(payload.summary.filesScanned).toBe(1);
      expect(payload.unsupportedLanguage).toBeUndefined();
      expect(payload.unsupportedFiles).toEqual(["app.py"]);
    });

    it("rejects workspace outside allowed roots", async () => {
      const allowed = await tempWorkspace();
      const outside = await mkdtemp(path.join(tmpdir(), "sp-rq-outside-"));
      created.push(outside);
      process.env.SUPERPOWER_CODEX_ALLOWED_ROOTS = allowed;

      const result = await reviewCodeQualityHandler({
        workspacePath: outside
      });

      expect(result.isError).toBe(true);
      const payload = JSON.parse(result.content[0].text);
      expect(payload.errorCode).toBe("workspace_not_allowed");
    });

    it("rejects files with absolute paths outside workspace", async () => {
      const workspace = await tempWorkspace();
      const result = await reviewCodeQualityHandler({
        workspacePath: workspace,
        files: ["C:\\Windows\\System32\\evil.ts"]
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0].text);
      expect(payload.errors).toBeDefined();
      expect(payload.errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("runDevelopmentWorkflowHandler", () => {
    it("retries review after fix and marks all stages as ok when clean", async () => {
      const workspace = await tempWorkspace();
      await writeFile(path.join(workspace, "AGENTS.md"), "- Run npm test");
      // Each round needs a report whose commitSha matches its postflight HEAD
      const runner = sequencedRunner([
        // implement round: preflight 3 + antigravity 1 + postflight 3 = 7
        { stdout: ".git\n" },
        { stdout: "aaaa\n" },
        { stdout: "" },
        { stdout: JSON.stringify({ response: JSON.stringify({ status: "committed", summary: "done", commitSha: "bbbb", changedFiles: [], acceptanceMatrix: [] }) }) },
        { stdout: "bbbb\n" },
        { stdout: "" },
        { stdout: "" },
        // review round 1: git diff 1 + codex exec 1 = 2 (has findings)
        { stdout: "" },
        { stdout: JSON.stringify({
          status: "findings",
          summary: "One issue found.",
          findings: [
            {
              severity: "high",
              title: "Issue 1",
              body: "test"
            }
          ]
        }) },
        // fix round: preflight 3 + antigravity 1 + postflight 3 = 7
        { stdout: ".git\n" },
        { stdout: "bbbb\n" },
        { stdout: "" },
        { stdout: JSON.stringify({ response: JSON.stringify({ status: "committed", summary: "fixed", commitSha: "cccc", changedFiles: [], acceptanceMatrix: [] }) }) },
        { stdout: "cccc\n" },
        { stdout: "" },
        { stdout: "" },
        // review round 2: git diff 1 + codex exec 1 = 2 (no findings)
        { stdout: "" },
        { stdout: JSON.stringify({
          status: "clean",
          summary: "No issues found.",
          findings: []
        }) }
      ]);
      const result = await runDevelopmentWorkflowHandler(
        {
          workspacePath: workspace,
          goal: "Fix issues",
          skipPlan: true,
          skipReview: false,
          skipVerify: true
        },
        runner
      );
      const payload = JSON.parse(result.content[0].text);
      expect(payload.workflow).toBe("completed");
      expect(payload.stages).toHaveLength(4);
      expect(payload.stages[0].stage).toBe("implement");
      expect(payload.stages[0].ok).toBe(true);
      expect(payload.stages[1].stage).toBe("review");
      expect(payload.stages[1].ok).toBe(true); // retroactively marked ok
      expect(payload.stages[1].summary).toBe("Issues resolved in subsequent fix round.");
      expect(payload.stages[2].stage).toBe("fix_round_1");
      expect(payload.stages[2].ok).toBe(true);
      expect(payload.stages[3].stage).toBe("review_round_2");
      expect(payload.stages[3].ok).toBe(true);
    });

    it("marks review as failed when Codex review execution errors", async () => {
      const workspace = await tempWorkspace();
      await writeFile(path.join(workspace, "AGENTS.md"), "- Run npm test");
      const report = {
        status: "committed",
        summary: "done",
        commitSha: "bbbb",
        changedFiles: [],
        acceptanceMatrix: []
      };
      const runner = sequencedRunner([
        // implement round: preflight 3 + antigravity 1 + postflight 3 = 7
        { stdout: ".git\n" },
        { stdout: "aaaa\n" },
        { stdout: "" },
        { stdout: JSON.stringify({ response: JSON.stringify(report) }) },
        { stdout: "bbbb\n" },
        { stdout: "" },
        { stdout: "" },
        // review: git diff 1 + codex exec 1 with exitCode 1 = 2
        { stdout: "" },
        { stdout: "Codex review failed", exitCode: 1 }
      ]);
      const result = await runDevelopmentWorkflowHandler(
        {
          workspacePath: workspace,
          goal: "Fix things",
          skipPlan: true,
          skipReview: false,
          skipVerify: true
        },
        runner
      );
      const payload = JSON.parse(result.content[0].text);
      expect(payload.workflow).toBe("completed_with_issues");
      expect(payload.stages).toHaveLength(2);
      expect(payload.stages[0].stage).toBe("implement");
      expect(payload.stages[0].ok).toBe(true);
      expect(payload.stages[1].stage).toBe("review");
      expect(payload.stages[1].ok).toBe(false);
      expect(payload.stages[1].summary).toBe("Codex review execution failed.");
    });

    it("passes custom verification commands to verification", async () => {
      const workspace = await tempWorkspace();
      const runner = sequencedRunner([
        { stdout: ".git\n" },
        { stdout: "aaaa\n" },
        { stdout: "" },
        { stdout: JSON.stringify({ response: JSON.stringify({
          status: "committed",
          summary: "done",
          commitSha: "bbbb",
          changedFiles: [],
          acceptanceMatrix: []
        }) }) },
        { stdout: "bbbb\n" },
        { stdout: "" },
        { stdout: "" },
        { stdout: "lint passed" },
        { stdout: "Verification passed." }
      ]);

      const result = await runDevelopmentWorkflowHandler(
        {
          workspacePath: workspace,
          goal: "Use custom verification",
          skipPlan: true,
          skipReview: true,
          verificationCommands: ["npm run lint"]
        },
        runner
      );

      expect(JSON.parse(result.content[0].text).workflow).toBe("completed");
      expect(runner).toHaveBeenCalledWith(
        "npm",
        ["run", "lint"],
        expect.objectContaining({ cwd: workspace })
      );
    });

    it("keeps verification passed when commands pass even if assessment prose is scary", async () => {
      const workspace = await tempWorkspace();
      const runner = sequencedRunner([
        { stdout: ".git\n" },
        { stdout: "aaaa\n" },
        { stdout: "" },
        { stdout: JSON.stringify({ response: JSON.stringify({
          status: "committed",
          summary: "done",
          commitSha: "bbbb",
          changedFiles: [],
          acceptanceMatrix: []
        }) }) },
        { stdout: "bbbb\n" },
        { stdout: "" },
        { stdout: "" },
        { stdout: "tests passed" },
        { stdout: "# Findings\nNo command failed, but mention error handling." }
      ]);

      const result = await runDevelopmentWorkflowHandler(
        {
          workspacePath: workspace,
          goal: "Keep command evidence authoritative",
          skipPlan: true,
          skipReview: true,
          verificationCommands: ["npm test"]
        },
        runner
      );

      const payload = JSON.parse(result.content[0].text);
      expect(payload.workflow).toBe("completed");
      expect(payload.stages.at(-1)).toMatchObject({
        stage: "verify",
        ok: true,
        summary: "Verification passed."
      });
    });

    it("keeps verification failed when commands fail even if assessment prose is positive", async () => {
      const workspace = await tempWorkspace();
      const runner = sequencedRunner([
        { stdout: ".git\n" },
        { stdout: "aaaa\n" },
        { stdout: "" },
        { stdout: JSON.stringify({ response: JSON.stringify({
          status: "committed",
          summary: "done",
          commitSha: "bbbb",
          changedFiles: [],
          acceptanceMatrix: []
        }) }) },
        { stdout: "bbbb\n" },
        { stdout: "" },
        { stdout: "" },
        { stdout: "tests failed", exitCode: 1 },
        { stdout: "Everything passed from the assessment perspective." }
      ]);

      const result = await runDevelopmentWorkflowHandler(
        {
          workspacePath: workspace,
          goal: "Keep command failures authoritative",
          skipPlan: true,
          skipReview: true,
          verificationCommands: ["npm test"]
        },
        runner
      );

      const payload = JSON.parse(result.content[0].text);
      expect(payload.workflow).toBe("completed_with_issues");
      expect(payload.failedStage).toBe("verify");
      expect(payload.stages.at(-1)).toMatchObject({
        stage: "verify",
        ok: false
      });
    });

    it("preserves the default verification commands", async () => {
      const workspace = await tempWorkspace();
      const runner = sequencedRunner([
        { stdout: ".git\n" },
        { stdout: "aaaa\n" },
        { stdout: "" },
        { stdout: JSON.stringify({ response: JSON.stringify({
          status: "committed",
          summary: "done",
          commitSha: "bbbb",
          changedFiles: [],
          acceptanceMatrix: []
        }) }) },
        { stdout: "bbbb\n" },
        { stdout: "" },
        { stdout: "" },
        { stdout: "tests passed" },
        { stdout: "types passed" },
        { stdout: "Verification passed." }
      ]);

      await runDevelopmentWorkflowHandler(
        {
          workspacePath: workspace,
          goal: "Use default verification",
          skipPlan: true,
          skipReview: true
        },
        runner
      );

      expect(runner).toHaveBeenCalledWith(
        "npm",
        ["test"],
        expect.objectContaining({ cwd: workspace })
      );
      expect(runner).toHaveBeenCalledWith(
        "npm",
        ["run", "typecheck"],
        expect.objectContaining({ cwd: workspace })
      );
    });

    it("returns completed_with_issues when workspace is outside allowed roots", async () => {
      const allowed = await tempWorkspace();
      const outside = await mkdtemp(path.join(tmpdir(), "sp-devflow-outside-"));
      created.push(outside);
      process.env.SUPERPOWER_CODEX_ALLOWED_ROOTS = allowed;
      const runner = fakeRunner("must not run");

      const result = await runDevelopmentWorkflowHandler(
        {
          workspacePath: outside,
          goal: "Do not run",
          skipPlan: true,
          skipReview: true,
          skipVerify: true
        },
        runner
      );

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0].text);
      // With skipPlan, the implement stage runs and fails with workspace rejection
      expect(payload.workflow).toBe("completed_with_issues");
      expect(payload.stages[0].stage).toBe("implement");
      expect(payload.stages[0].ok).toBe(false);
    });

    it("rejects an explicitly empty verificationCommands array", async () => {
      const workspace = await tempWorkspace();
      const runner = fakeRunner("must not run");

      const result = await runDevelopmentWorkflowHandler(
        {
          workspacePath: workspace,
          goal: "Do not run",
          skipPlan: true,
          skipReview: true,
          verificationCommands: []
        },
        runner
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("verificationCommands cannot be empty");
    });

    it("rejects an empty verificationCommands array via Zod schema", async () => {
      const { z } = await import("zod");
      const { runDevelopmentWorkflowSchema } = await import("../src/tools/runDevelopmentWorkflow.js");
      const schema = z.object(runDevelopmentWorkflowSchema);
      const parsed = schema.safeParse({
        workspacePath: "/some/path",
        goal: "Goal",
        verificationCommands: []
      });
      expect(parsed.success).toBe(false);
    });

    it("adds failedStage and nextAction diagnostics on plan failure (early failure path)", async () => {
      const workspace = await tempWorkspace();
      const runner = sequencedRunner([
        { stdout: "Plan failed", exitCode: 1 } // planning command fails
      ]);
      const result = await runDevelopmentWorkflowHandler(
        {
          workspacePath: workspace,
          goal: "Do planning",
          skipPlan: false,
          skipReview: true,
          skipVerify: true
        },
        runner
      );
      const payload = JSON.parse(result.content[0].text);
      expect(payload.workflow).toBe("failed");
      expect(payload.stages[0].stage).toBe("plan");
      expect(payload.stages[0].ok).toBe(false);
      expect(payload.failedStage).toBe("plan");
      expect(payload.nextAction).toBe("Verify the goals and constraints or retry planning.");
      expect(payload.failureSummary).toBe("Codex planning failed.");
      expect(payload.failureDetails).toContain("Plan failed");
    });

    it("adds failedStage and nextAction diagnostics on verification failure (later failure path)", async () => {
      const workspace = await tempWorkspace();
      const report = {
        status: "committed",
        summary: "done",
        commitSha: "bbbb",
        changedFiles: [],
        acceptanceMatrix: []
      };
      const runner = sequencedRunner([
        // implement
        { stdout: ".git\n" },
        { stdout: "aaaa\n" },
        { stdout: "" },
        { stdout: JSON.stringify({ response: JSON.stringify(report) }) },
        { stdout: "bbbb\n" },
        { stdout: "" },
        { stdout: "" },
        // verify command exit code non-zero
        { stdout: "tests failed", exitCode: 1 },
        { stdout: "Codex assessment text" }
      ]);
      const result = await runDevelopmentWorkflowHandler(
        {
          workspacePath: workspace,
          goal: "Implement goal",
          skipPlan: true,
          skipReview: true,
          skipVerify: false,
          verificationCommands: ["npm test"]
        },
        runner
      );
      const payload = JSON.parse(result.content[0].text);
      expect(payload.workflow).toBe("completed_with_issues");
      expect(payload.stages).toHaveLength(2);
      expect(payload.stages[0].stage).toBe("implement");
      expect(payload.stages[0].ok).toBe(true);
      expect(payload.stages[1].stage).toBe("verify");
      expect(payload.stages[1].ok).toBe(false);
      expect(payload.failedStage).toBe("verify");
      expect(payload.nextAction).toBe(
        "Fix the failing tests or type errors reported in verification details."
      );
      expect(payload.failureSummary).toBe("Verification execution error.");
      expect(payload.failureDetails).toContain("Command result: FAILED");
    });
  });

  describe("server registration", () => {
    it("exposes both legacy and canonical coding task tools", async () => {
      const { createServer } = await import("../src/index.js");
      const server = createServer();
      
      // Use internal _registeredTools property or similar
      const tools = (server as any)._registeredTools;
      const names = tools ? Object.keys(tools) : [];

      expect(names).toContain("run_antigravity_coding_task");
      expect(names).toContain("run_gemini_coding_task");
    });
  });
});
