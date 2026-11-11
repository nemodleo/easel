// AI-generated with Claude Code, 2026-11-10, reviewed by Hyun Park
// Undo history: outside changes as steps, grouping per run and per burst, who made a step (by), app writes not double-recorded
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createHistory, fileList, requestScope } from "../server/history.mjs";

async function setup(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-hist-"));
  for (const [f, t] of Object.entries(files)) await fs.writeFile(path.join(dir, f), t);
  const list = async () => (await fs.readdir(dir)).filter((n) => n.endsWith(".html")).map((n) => path.join(dir, n));
  const h = createHistory({ list });
  await h.seed();
  return { dir, h, p: (f) => path.join(dir, f), read: (f) => fs.readFile(path.join(dir, f), "utf8").catch(() => null) };
}

test("fileList: up to three names, then +N", () => {
  assert.equal(fileList(["a"]), "a");
  assert.equal(fileList(["a", "b", "c", "d", "e"]), "a, b, c +2");
});

test("outside edits, creations and deletions become one step that undo and redo", async () => {
  const { dir, h, p, read } = await setup({ "a.html": "A", "b.html": "B" });
  try {
    h.push("app edit", [{ path: p("a.html"), before: "A0", after: "A" }]);
    await fs.writeFile(p("a.html"), "A1");
    await fs.rm(p("b.html"));
    await fs.writeFile(p("c.html"), "C");
    await h.observe();
    const s = h.state();
    assert.deepEqual(s.undo, ["app edit", "Changed outside the app: a.html, c.html, b.html"]);
    assert.equal(await h.observe(), null, "nothing new");
    await h.undo();
    assert.deepEqual([await read("a.html"), await read("b.html"), await read("c.html")], ["A", "B", null]);
    assert.deepEqual(h.state().undo, ["app edit"]);
    await h.redo();
    assert.deepEqual([await read("a.html"), await read("b.html"), await read("c.html")], ["A1", null, "C"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("idle bursts merge within GROUP_MS only; a change back to the start drops the step; a new outside step clears redo", async () => {
  const { dir, h, p } = await setup({ "a.html": "A" });
  try {
    await fs.writeFile(p("a.html"), "A1");
    await h.observe();
    await fs.writeFile(p("a.html"), "A2");
    await h.observe();
    assert.equal(h.state().undo.length, 1);
    await fs.writeFile(p("a.html"), "A");
    await h.observe();
    assert.equal(h.state().undo.length, 0, "back to the original: nothing to undo");
    h.push("edit", [{ path: p("a.html"), before: "A", after: "A" + "x" }]);
    await fs.writeFile(p("a.html"), "Ax");
    await h.undo(); // undo writes are known: not outside changes
    assert.equal(h.state().canRedo, true);
    assert.equal(await h.observe(), null);
    await fs.writeFile(p("a.html"), "Z");
    await h.observe();
    assert.equal(h.state().canRedo, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("run: everything during a run is one step labelled for the agent, including API writes from that run; others stay separate", async () => {
  const { dir, h, p } = await setup({ "a.html": "A", "b.html": "B" });
  try {
    h.beginRun({ id: "r1", label: "Codex: tidy up", by: "Codex" });
    await fs.writeFile(p("a.html"), "A1");
    await h.observe();
    await fs.writeFile(p("c.html"), "C");
    await requestScope.run({ agent: "Codex", run: "r1" }, async () => h.push("Create board c.html", [{ path: p("c.html"), before: null, after: "C" }]));
    await fs.writeFile(p("b.html"), "B1");
    await h.observe();
    h.endRun("r1");
    assert.deepEqual(h.state().steps.map((s) => [s.label, s.by]), [["Codex: tidy up", "Codex"]]);
    assert.equal(h.runSteps("r1")[0].changes.length, 3);
    // After the run: an MCP write with an agent name is its own step, with by; an in-app edit has no by
    await requestScope.run({ agent: "Cursor" }, async () => h.push("Add note", [{ path: p("board.json"), before: null, after: "{}" }]));
    h.push("a.html setText", [{ path: p("a.html"), before: "A1", after: "A2" }]);
    assert.deepEqual(h.state().steps.slice(1).map((s) => [s.label, s.by]), [["Add note", "Cursor"], ["a.html setText", undefined]]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("overlapping runs: an API write joins its own run's step, and ending one run leaves the other going", async () => {
  const { dir, h, p } = await setup({ "a.html": "A", "b.html": "B" });
  try {
    h.beginRun({ id: "r1", label: "Claude Code: first", by: "Claude Code" });
    h.beginRun({ id: "r2", label: "Codex: second", by: "Codex" });
    await requestScope.run({ agent: "Claude Code", run: "r1" }, async () => h.push("a.html setText", [{ path: p("a.html"), before: "A", after: "A1" }]));
    await requestScope.run({ agent: "Codex", run: "r2" }, async () => h.push("b.html setText", [{ path: p("b.html"), before: "B", after: "B1" }]));
    h.endRun("r2");
    await requestScope.run({ agent: "Claude Code", run: "r1" }, async () => h.push("Create board c.html", [{ path: p("c.html"), before: null, after: "C" }]));
    h.endRun("r1");
    assert.deepEqual(h.state().steps.map((s) => [s.label, s.by]), [["Claude Code: first", "Claude Code"], ["Codex: second", "Codex"], ["Claude Code: first", "Claude Code"]]);
    assert.deepEqual(h.runSteps("r1").map((s) => s.changes.map((c) => path.basename(c.path))), [["a.html"], ["c.html"]]);
    // Both ended: a later write with a stale run id is an ordinary step
    await requestScope.run({ agent: "Codex", run: "r2" }, async () => h.push("b.html setText", [{ path: p("b.html"), before: "B1", after: "B2" }]));
    assert.deepEqual([h.state().steps.at(-1).label, h.state().steps.at(-1).by], ["b.html setText", "Codex"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("content the app wrote without a step (note) is replaced by undo instead of clearing the history", async () => {
  const { dir, h, p } = await setup({ "a.html": "A" });
  try {
    h.push("edit", [{ path: p("a.html"), before: "A0", after: "A" }]);
    // Written and then known through note(), as the board store does for its own saves: replaced by undo, not blocking it
    await fs.writeFile(p("a.html"), "A-app");
    h.note(p("a.html"), "A-app");
    await h.undo();
    assert.equal(await fs.readFile(p("a.html"), "utf8"), "A0");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
