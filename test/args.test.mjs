// AI-generated with Claude Code, 2026-10-10, reviewed by Hyun Park
// CLI flags for easel-canvas
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_PORT, parseArgs } from "../server/args.mjs";

test("flags: dir, port, open, no-open, demo, init, help, version", () => {
  const a = parseArgs(["--dir", "./designs", "--port", "5000", "--open", "--no-open", "--demo", "--init", "-h", "-v"]);
  assert.equal(a.dir, path.resolve("./designs"));
  assert.equal(a.port, 5000);
  assert.deepEqual([a.open, a.noOpen, a.demo, a.init, a.help, a.version], [true, true, true, true, true, true]);
});

test("--dir= and --port= forms; defaults", () => {
  const a = parseArgs(["--dir=x/y", "--port=4400"]);
  assert.equal(a.dir, path.resolve("x/y"));
  assert.equal(a.port, 4400);
  const d = parseArgs([]);
  assert.equal(d.port, DEFAULT_PORT);
  assert.ok(path.isAbsolute(d.dir));
  assert.equal(d.open, false);
});

test("portGiven/dirGiven tell an explicit choice from the defaults; connect with --agents and --dry-run", () => {
  assert.deepEqual([parseArgs([]).portGiven, parseArgs([]).dirGiven], [false, false]);
  assert.equal(parseArgs(["--port=4317"]).portGiven, true);
  assert.equal(parseArgs(["--dir", "x"]).dirGiven, true);
  const c = parseArgs(["connect", "--agents", "Claude, codex", "--dry-run"]);
  assert.equal(c.command, "connect");
  assert.deepEqual(c.agents, ["claude", "codex"]);
  assert.equal(c.dryRun, true);
  assert.equal(parseArgs(["--dir", "connect"]).command, null);
});
