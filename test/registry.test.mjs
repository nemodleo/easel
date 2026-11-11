// AI-generated with Claude Code, 2026-11-10, reviewed by Hyun Park
// Running-canvas registry and MCP discovery (no --port), auto port, agent names
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { agentLabel, cleanAgent } from "../server/agents.mjs";
import { DEFAULT_PORT } from "../server/args.mjs";
import { listen } from "../server/index.mjs";
import { discoverPort, pickServer, readEntries, within, writeEntry } from "../server/registry.mjs";

const e = (port, root) => ({ port, root, dir: path.join(root, "docs/design") });

test("within: same folder and children, not siblings or prefixes", () => {
  assert.ok(within("/a/b", "/a/b"));
  assert.ok(within("/a/b/c", "/a/b"));
  assert.ok(!within("/a/bc", "/a/b"));
  assert.ok(!within("/a", "/a/b"));
});

test("pickServer: root containing cwd, longest wins; else the only one below cwd; else the only one; else ambiguous or none", () => {
  const list = [e(4317, "/w/app"), e(4318, "/w/app/packages/ui"), e(4319, "/w/other")];
  assert.equal(pickServer(list, "/w/app/src").entry.port, 4317);
  assert.equal(pickServer(list, "/w/app/packages/ui/src").entry.port, 4318);
  assert.equal(pickServer(list, "/w/other").entry.port, 4319);
  assert.equal(pickServer(list, "/w/app/packages").entry.port, 4317, "a root around cwd beats one below it");
  assert.deepEqual(pickServer(list, "/w").ambiguous.map((x) => x.port), [4317, 4318, 4319], "cwd above several roots: no guessing");
  assert.equal(pickServer([e(4317, "/w/app"), e(4319, "/x/other")], "/w").entry.port, 4317, "cwd above exactly one root");
  assert.deepEqual(pickServer(list, "/elsewhere").ambiguous.map((x) => x.port), [4317, 4318, 4319]);
  assert.equal(pickServer([e(5000, "/x")], "/elsewhere").entry.port, 5000);
  assert.deepEqual(pickServer([], "/x"), {});
});

const health = (dir) =>
  new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.writeHead(req.url === "/api/health" ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, dir }));
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });

test("discoverPort: explicit wins; picks the live canvas for cwd; drops dead and mismatched entries; lists ambiguous ones", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "dc-home-"));
  const rootA = await fs.mkdtemp(path.join(os.tmpdir(), "dc-a-"));
  const rootB = await fs.mkdtemp(path.join(os.tmpdir(), "dc-b-"));
  const sA = await health(rootA);
  const sB = await health(rootB);
  const pA = sA.address().port;
  const pB = sB.address().port;
  try {
    assert.equal(await discoverPort({ port: 9999, cwd: rootA, home }), 9999);
    assert.equal(await discoverPort({ cwd: rootA, home }), DEFAULT_PORT, "empty registry: the default");
    const rmA = writeEntry({ port: pA, dir: rootA, root: rootA }, home);
    writeEntry({ port: pB, dir: rootB, root: rootB }, home);
    writeEntry({ port: 1, dir: "/gone", root: "/gone", pid: 2 ** 30 }, home); // dead: removed on discovery
    assert.equal(await discoverPort({ cwd: path.join(rootA, "src"), home }), pA);
    assert.equal(await discoverPort({ cwd: rootB, home }), pB);
    assert.ok(!readEntries(home).some((x) => x.port === 1));
    await assert.rejects(discoverPort({ cwd: os.homedir(), home }), (err) => err.message.includes(`(port ${pA})`) && err.message.includes(`(port ${pB})`) && /--port/.test(err.message));
    // An entry whose server now serves another folder does not count
    await fs.writeFile(path.join(home, "servers", `${pB}.json`), JSON.stringify({ port: pB, pid: process.pid, dir: "/not/it", root: rootB }));
    assert.equal(await discoverPort({ cwd: rootB, home }), pA, "only one live canvas left: that one");
    rmA();
    assert.ok(!existsSync(path.join(home, "servers", `${pA}.json`)));
  } finally {
    sA.close();
    sB.close();
    for (const d of [home, rootA, rootB]) await fs.rm(d, { recursive: true, force: true });
  }
});

test("listen: a busy port moves on with autoPort, fails clearly without it", async () => {
  const busy = http.createServer();
  await new Promise((r) => busy.listen(0, "127.0.0.1", r));
  const port = busy.address().port;
  const s1 = http.createServer();
  const s2 = http.createServer();
  try {
    const used = await listen(s1, port, true);
    assert.ok(used > port && used <= port + 20);
    await assert.rejects(listen(s2, port, false), (err) => err.code === "EADDRINUSE" && err.message.includes(`Port ${port} is already in use`) && /--port/.test(err.message));
  } finally {
    busy.close();
    s1.close();
  }
});

test("agentLabel: known MCP clients by substring, other names as is, none → AI; header values cleaned", () => {
  assert.equal(agentLabel("claude-code"), "Claude Code");
  assert.equal(agentLabel("codex-mcp-client"), "Codex");
  assert.equal(agentLabel("Cursor-VSCode"), "Cursor");
  assert.equal(agentLabel("gemini-cli-mcp-client"), "Gemini CLI");
  assert.equal(agentLabel("Zed"), "Zed");
  assert.equal(agentLabel(""), "AI");
  assert.equal(agentLabel(undefined), "AI");
  assert.equal(cleanAgent("a\nb\u0000c"), "a b c");
  assert.equal(cleanAgent("x".repeat(100)).length, 60);
});
