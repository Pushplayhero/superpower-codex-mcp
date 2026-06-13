import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectInstructionFiles,
  getAllowedRoots,
  isCanonicalPathInside,
  planOutputPath,
  requireWorkspace,
  validateWorkspace,
  WorkspaceValidationError
} from "../src/lib/workspace.js";

const created: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sp-codex-mcp-"));
  created.push(dir);
  return dir;
}

import { beforeEach } from "vitest";

beforeEach(() => {
  delete process.env.SUPERPOWER_CODEX_ALLOWED_ROOTS;
});

afterEach(async () => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
  delete process.env.SUPERPOWER_CODEX_ALLOWED_ROOTS;
});

describe("workspace helpers", () => {
  it("uses cwd as the default allowed root", () => {
    const roots = getAllowedRoots("C:\\repo", undefined, ";");
    expect(roots).toEqual([path.resolve("C:\\repo")]);
  });

  it("parses env allowed roots with a supplied delimiter", () => {
    const roots = getAllowedRoots("C:\\fallback", "C:\\one;D:\\two", ";");
    expect(roots).toEqual([path.resolve("C:\\one"), path.resolve("D:\\two")]);
  });

  it("accepts a canonical descendant of an allowed root", async () => {
    const root = await tempDir();
    const child = path.join(root, "OneDrive folder", "中文專案");
    await mkdir(child, { recursive: true });

    const result = await validateWorkspace(child, [root]);

    expect(result).toMatchObject({
      status: "allowed",
      stage: "workspace_validation",
      requestedPath: path.resolve(child),
      canonicalPath: await realpath(child),
      matchedRoot: await realpath(root),
      readable: true,
      geminiStarted: false,
      modelInvoked: false,
      filesModified: false
    });
  });

  it("rejects an existing sibling outside allowed roots", async () => {
    const root = await tempDir();
    const outside = await tempDir();

    const result = await validateWorkspace(outside, [root]);

    expect(result).toMatchObject({
      status: "rejected",
      errorCode: "workspace_not_allowed",
      requestedPath: path.resolve(outside),
      geminiStarted: false,
      modelInvoked: false,
      filesModified: false
    });
  });

  it("reports a missing requested path", async () => {
    const root = await tempDir();
    const missing = path.join(root, "missing");

    await expect(requireWorkspace(missing, [root])).rejects.toMatchObject({
      name: "WorkspaceValidationError",
      validation: expect.objectContaining({
        status: "rejected",
        errorCode: "workspace_not_found"
      })
    });
  });

  it("does not let a missing configured root authorize a lexical child", async () => {
    const existing = await tempDir();
    const missingRoot = path.join(existing, "missing-root");
    const requested = path.join(missingRoot, "project");

    const result = await validateWorkspace(requested, [missingRoot]);

    expect(result.status).toBe("rejected");
    expect(result.errorCode).toBe("workspace_not_found");
    expect(result.allowedRoots).toEqual([]);
  });

  it("rejects traversal that resolves outside the approved root", async () => {
    const parent = await tempDir();
    const root = path.join(parent, "approved");
    const outside = path.join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);

    const result = await validateWorkspace(
      path.join(root, "..", "outside"),
      [root]
    );

    expect(result.errorCode).toBe("workspace_not_allowed");
  });

  it("accepts the approved root itself", async () => {
    const root = await tempDir();
    expect((await validateWorkspace(root, [root])).status).toBe("allowed");
  });

  it("rejects a junction whose canonical target escapes the root", async () => {
    const parent = await tempDir();
    const root = path.join(parent, "approved");
    const outside = await tempDir();
    const link = path.join(root, "escaped-link");
    await mkdir(root);

    try {
      await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error: unknown) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : "";
      if (code === "EPERM" || code === "EACCES") return;
      throw error;
    }

    const result = await validateWorkspace(link, [root]);
    expect(result.errorCode).toBe("workspace_not_allowed");
    expect(result.canonicalPath).toBe(await realpath(outside));
  });

  it("compares Windows canonical paths case-insensitively", () => {
    expect(
      isCanonicalPathInside(
        "C:\\Users\\COSH\\OneDrive\\桌面\\mufan",
        "c:\\users\\cosh\\onedrive\\桌面",
        "win32"
      )
    ).toBe(true);
  });

  it("collects instruction files with labels", async () => {
    const root = await tempDir();
    await writeFile(path.join(root, "AGENTS.md"), "Agent rules");
    await writeFile(path.join(root, "GEMINI.md"), "Gemini rules");
    const files = await collectInstructionFiles(root, [], 10_000);
    expect(files.map((file) => file.relativePath)).toEqual(["AGENTS.md", "GEMINI.md"]);
    expect(files[0].text).toContain("Agent rules");
  });

  it("builds a dated plan output path", () => {
    const output = planOutputPath("C:\\repo", "Add billing integration", new Date("2026-06-12T00:00:00Z"));
    expect(output).toContain(path.join("docs", "superpowers", "plans", "2026-06-12-add-billing-integration.md"));
  });
});
