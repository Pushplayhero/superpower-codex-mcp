import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reviewCodeQualityHandler } from "../src/tools/reviewCodeQuality.js";

const createdDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sp-review-test-"));
  createdDirs.push(dir);
  process.env.SUPERPOWER_CODEX_ALLOWED_ROOTS = dir;
  return dir;
}

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
  delete process.env.SUPERPOWER_CODEX_ALLOWED_ROOTS;
});

describe("reviewCodeQuality default scanning and coverage", () => {
  it("scans both src/**/*.ts and tests/**/*.ts by default with stable, deterministic sorted order", async () => {
    const workspace = await createTempWorkspace();
    const srcDir = path.join(workspace, "src");
    const testsDir = path.join(workspace, "tests");
    await mkdir(srcDir, { recursive: true });
    await mkdir(testsDir, { recursive: true });

    // Create a few TS files with findings to verify they are scanned in deterministic order
    // "no-todo" check triggers on TODO, which returns severity info
    await writeFile(path.join(srcDir, "b.ts"), "// TODO: in src/b.ts");
    await writeFile(path.join(srcDir, "a.ts"), "// TODO: in src/a.ts");
    await writeFile(path.join(testsDir, "z.test.ts"), "// TODO: in tests/z.test.ts");
    await writeFile(path.join(testsDir, "y.test.ts"), "// TODO: in tests/y.test.ts");

    const result = await reviewCodeQualityHandler({
      workspacePath: workspace
    });

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);

    // Check that filesScanned is 4
    expect(payload.summary.filesScanned).toBe(4);

    // Verify findings are in deterministic sorted order of files:
    // 1. src/a.ts
    // 2. src/b.ts
    // 3. tests/y.test.ts
    // 4. tests/z.test.ts
    expect(payload.findings).toHaveLength(4);
    expect(payload.findings[0].file).toBe("src/a.ts");
    expect(payload.findings[1].file).toBe("src/b.ts");
    expect(payload.findings[2].file).toBe("tests/y.test.ts");
    expect(payload.findings[3].file).toBe("tests/z.test.ts");
  });

  it("deduplicates repeated or overlapping file inputs deterministically", async () => {
    const workspace = await createTempWorkspace();
    const srcDir = path.join(workspace, "src");
    await mkdir(srcDir, { recursive: true });

    await writeFile(path.join(srcDir, "a.ts"), "// TODO: in src/a.ts");
    await writeFile(path.join(srcDir, "b.ts"), "// TODO: in src/b.ts");

    // Pass duplicate and overlapping/out-of-order files
    const result = await reviewCodeQualityHandler({
      workspacePath: workspace,
      files: ["src/b.ts", "src/a.ts", "src/b.ts", "./src/a.ts"]
    });

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);

    // filesScanned counts unique files only
    expect(payload.summary.filesScanned).toBe(2);

    // findings should be in deterministic sorted order
    expect(payload.findings).toHaveLength(2);
    expect(payload.findings[0].file).toBe("src/a.ts");
    expect(payload.findings[1].file).toBe("src/b.ts");
  });
});
