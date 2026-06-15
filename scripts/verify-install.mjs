import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const installPath = path.resolve(process.argv[2] ?? process.cwd());
const entrypoint = path.join(installPath, "dist", "src", "index.js");
const requiredTools = [
  "validate_workspace",
  "summarize_repo_context",
  "plan_with_codex",
  "run_antigravity_coding_task",
  "review_code_quality",
  "review_with_codex",
  "verify_with_codex",
  "run_development_workflow"
];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint],
  env: {
    ...process.env,
    SUPERPOWER_CODEX_ALLOWED_ROOTS: installPath
  }
});
const client = new Client({
  name: "superpower-codex-install-verifier",
  version: "0.1.1"
});
const timeout = AbortSignal.timeout(30_000);

try {
  await client.connect(transport, { signal: timeout });
  const { tools } = await client.listTools(undefined, { signal: timeout });
  const names = tools.map((tool) => tool.name);
  const missing = requiredTools.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new Error(`Missing MCP tools: ${missing.join(", ")}`);
  }
  console.log(`Verified ${names.length} MCP tools.`);
} finally {
  await client.close();
}
