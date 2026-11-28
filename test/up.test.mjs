// AI-generated with Claude Code, 2026-11-27, reviewed by Hyun Park
// easel-canvas up / status: finds the canvas for this project (never another one), starts one in the background once, --init, --json
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseArgs, TOOL_ROOT } from "../server/args.mjs";
import { writeEntry } from "../server/registry.mjs";
import { describe, findCanvas, up } from "../server/up.mjs";

const health = (dir) =>
  new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.writeHead(req.url === "/api/health" ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, dir }));
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });

// --prod: the started canvas serves the existing app build instead of rebuilding dist/ under the other test files
const skip = !existsSync(path.join(TOOL_ROOT, "dist/index.html")) && "needs an app build (npm run build)";
const cli = (args, { cwd, home }) => spawnSync(process.execPath, [path.join(TOOL_ROOT, "bin/server.mjs"), ...args], { cwd, encoding: "utf8", env: { ...process.env, EASEL_HOME: home } });

test("args: up and status are commands, --json a flag", () => {
  assert.equal(parseArgs(["up", "--json"]).command, "up");
  assert.equal(parseArgs(["up", "--json"]).json, true);
  assert.equal(parseArgs(["status"]).command, "status");
  assert.equal(parseArgs(["--dir", "up"]).command, null);
});

test("findCanvas: the canvas serving this folder, or one whose project contains cwd; never another project's", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "dc-home-"));
  const a = await fs.mkdtemp(path.join(os.tmpdir(), "dc-a-"));
  const b = await fs.mkdtemp(path.join(os.tmpdir(), "dc-b-"));
  const designA = path.join(a, "docs/design");
  await fs.mkdir(path.join(a, "src"), { recursive: true });
  const sA = await health(designA);
  const sB = await health(b);
  try {
    writeEntry({ port: sA.address().port, dir: designA, root: a }, home);
    writeEntry({ port: sB.address().port, dir: b, root: b }, home);
    const r = await findCanvas({ dir: designA, cwd: a, home });
    assert.equal(r.port, sA.address().port);
    assert.equal(r.url, `http://localhost:${sA.address().port}`);
    assert.equal((await findCanvas({ dir: path.join(a, "src/docs/design"), cwd: path.join(a, "src"), home })).port, sA.address().port, "from a subfolder: the project's canvas");
    assert.equal(await findCanvas({ dir: path.join(a, "other"), dirGiven: true, cwd: a, home }), null, "an explicit --dir must match exactly");
    const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), "dc-c-"));
    assert.equal(await findCanvas({ dir: path.join(elsewhere, "docs/design"), cwd: elsewhere, home }), null, "the only canvas running is not this project's");
    await fs.rm(elsewhere, { recursive: true, force: true });
    assert.match(describe(null, "/x/docs/design"), /No Easel canvas is running for \/x\/docs\/design\. Start one with: npx easel-canvas up/);
  } finally {
    sA.close();
    sB.close();
    for (const d of [home, a, b]) await fs.rm(d, { recursive: true, force: true });
  }
});

test("up: refuses a missing folder without --init; starts once in the background; a second up and status find it", { skip, timeout: 180000 }, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "dc-home-"));
  const proj = await fs.mkdtemp(path.join(os.tmpdir(), "dc-up-"));
  const dir = path.join(proj, "docs/design");
  let pid = null;
  try {
    await assert.rejects(up({ dir, cwd: proj, home, open: false }), (e) => e.code === "NO_DESIGN_FOLDER" && /--init/.test(e.message));
    const none = cli(["status", "--json"], { cwd: proj, home });
    assert.equal(none.status, 1);
    assert.equal(JSON.parse(none.stdout).running, false);

    const first = await up({ dir, cwd: proj, home, init: true, open: false, prod: true, timeoutMs: 150000 });
    pid = first.pid;
    assert.equal(first.started, true);
    assert.ok(existsSync(path.join(dir, "screens/home.html")), "--init made the starter screen");
    assert.ok(existsSync(first.log));
    assert.equal((await (await fetch(`http://127.0.0.1:${first.port}/api/health`)).json()).pid, pid);

    const again = cli(["up", "--json"], { cwd: proj, home });
    assert.equal(again.status, 0, again.stderr);
    const j = JSON.parse(again.stdout);
    assert.deepEqual([j.started, j.port, j.pid], [false, first.port, pid], "no second server");
    const text = cli(["status"], { cwd: proj, home });
    assert.equal(text.status, 0);
    assert.match(text.stdout, new RegExp(`Easel is already running: http://localhost:${first.port}`));
  } finally {
    if (pid) {
      process.kill(pid, "SIGTERM");
      for (let i = 0; i < 50 && existsSync(path.join(home, "servers")) && (await fs.readdir(path.join(home, "servers"))).length; i++) await new Promise((r) => setTimeout(r, 100));
    }
    for (const d of [home, proj]) await fs.rm(d, { recursive: true, force: true });
  }
});
