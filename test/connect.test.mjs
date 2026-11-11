// AI-generated with Claude Code, 2026-11-10, reviewed by Hyun Park
// easel-canvas connect: merges the MCP entry into each agent's config without losing other keys, idempotent, never overwrites bad JSON
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { CODEX_BLOCK, connect, MCP_COMMAND, mergeJson, mergeToml } from "../server/connect.mjs";

const ENTRY = { type: "stdio", ...MCP_COMMAND };

test("mergeJson: new file, keeps other servers and keys, unchanged when equal, replaces an old easel entry, rejects bad JSON", () => {
  const fresh = mergeJson(null, ENTRY);
  assert.equal(fresh.status, "write");
  assert.deepEqual(JSON.parse(fresh.text), { mcpServers: { easel: ENTRY } });
  assert.ok(!JSON.stringify(ENTRY).includes("--port"));
  const other = JSON.stringify({ theme: "dark", mcpServers: { github: { command: "gh" } } }, null, 4);
  const merged = mergeJson(other, ENTRY);
  assert.deepEqual(JSON.parse(merged.text), { theme: "dark", mcpServers: { github: { command: "gh" }, easel: ENTRY } });
  assert.match(merged.text, /^ {4}"theme"/m, "keeps the file's indent");
  assert.equal(mergeJson(merged.text, ENTRY).status, "unchanged");
  const old = JSON.stringify({ mcpServers: { easel: { command: "npx", args: ["-y", "-p", "easel-canvas", "easel-mcp", "--port", "4317"] } } });
  assert.deepEqual(JSON.parse(mergeJson(old, ENTRY).text).mcpServers.easel, ENTRY);
  for (const bad of ["{ nope", "[1,2]", '{"mcpServers": []}']) assert.equal(mergeJson(bad, ENTRY).status, "invalid");
  assert.equal(mergeJson("  \n", ENTRY).status, "write");
});

test("mergeToml: appends the block once, never touches other content, notes an old --port", () => {
  const before = 'model = "o3"\n\n[mcp_servers.github]\ncommand = "gh"\n';
  const r = mergeToml(before);
  assert.equal(r.status, "write");
  assert.ok(r.text.startsWith(before));
  assert.ok(r.text.endsWith(CODEX_BLOCK));
  assert.match(CODEX_BLOCK, /^\[mcp_servers\.easel\]\ncommand = "npx"\nargs = \["-y", "-p", "easel-canvas", "easel-mcp"\]/);
  assert.equal(mergeToml(r.text).status, "unchanged");
  assert.equal(mergeToml(null).text, CODEX_BLOCK);
  const withPort = '[mcp_servers.easel]\ncommand = "npx"\nargs = ["easel-mcp", "--port", "4317"]\n\n[other]\nx = 1\n';
  assert.match(mergeToml(withPort).note, /--port/);
  assert.equal(mergeToml('[mcp_servers.easel]\ncommand = "node"\n\n[x]\nargs = ["--port"]\n').note, "", "--port in a later table is not ours");
});

async function sandbox() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "dc-connect-"));
  const project = path.join(base, "proj");
  const home = path.join(base, "home");
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  return { base, project, home, read: (p) => fs.readFile(p, "utf8").catch(() => null) };
}

test("connect: default writes Claude Code, plus Cursor/Gemini/Codex only where found; second run is unchanged; dry run writes nothing", async () => {
  const { base, project, home, read } = await sandbox();
  try {
    await fs.mkdir(path.join(project, ".cursor"));
    await fs.mkdir(path.join(home, ".codex"));
    await fs.writeFile(path.join(home, ".codex/config.toml"), 'model = "o3"\n');
    const dry = await connect({ project, home, env: {}, dryRun: true });
    assert.ok(dry.some((l) => l.startsWith("would write .mcp.json")));
    assert.ok(!existsSync(path.join(project, ".mcp.json")));
    assert.equal(await read(path.join(home, ".codex/config.toml")), 'model = "o3"\n');

    const lines = await connect({ project, home, env: {} });
    assert.deepEqual(
      lines.map((l) => l.split("(")[0].trim()),
      ["wrote    .mcp.json", "wrote    .cursor/mcp.json", "skipped  .gemini/settings.json", "wrote    ~/.codex/config.toml"].map((s) => s.trim()),
    );
    assert.deepEqual(JSON.parse(await read(path.join(project, ".mcp.json"))).mcpServers.easel, ENTRY);
    assert.deepEqual(JSON.parse(await read(path.join(project, ".cursor/mcp.json"))).mcpServers.easel, ENTRY);
    assert.ok(!existsSync(path.join(project, ".gemini")));
    assert.match(await read(path.join(home, ".codex/config.toml")), /^model = "o3"\n\n\[mcp_servers\.easel\]/);
    const again = await connect({ project, home, env: {} });
    assert.ok(again.filter((l) => !l.startsWith("skipped")).every((l) => l.startsWith("unchanged")), again.join("\n"));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("connect --agents: writes exactly those; Gemini entry has no type; bad JSON skipped; Codex needs its home (CODEX_HOME honoured)", async () => {
  const { base, project, home, read } = await sandbox();
  try {
    await fs.writeFile(path.join(project, ".mcp.json"), "{ broken");
    const lines = await connect({ project, home, env: {}, agents: ["claude", "gemini", "codex"] });
    assert.match(lines[0], /^skipped {2}\.mcp\.json \(Claude Code\): not valid JSON/);
    assert.equal(await read(path.join(project, ".mcp.json")), "{ broken");
    assert.deepEqual(JSON.parse(await read(path.join(project, ".gemini/settings.json"))), { mcpServers: { easel: MCP_COMMAND } });
    assert.match(lines[2], /skipped .*Codex.*not found/);
    const codexHome = path.join(base, "codex-home");
    await fs.mkdir(codexHome);
    const l2 = await connect({ project, home, env: { CODEX_HOME: codexHome }, agents: ["codex"] });
    assert.equal(l2.length, 1);
    assert.equal(await read(path.join(codexHome, "config.toml")), CODEX_BLOCK);
    await assert.rejects(connect({ project, home, env: {}, agents: ["vim"] }), /Unknown agent vim/);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
