// AI-generated with Claude Code, 2026-11-10, reviewed by Hyun Park
// Outside changes become undo steps: one step per in-app AI run (undo/redo), idle edits as their own step,
// revert from the pre-run disk copy
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { TOOL_ROOT } from "../server/args.mjs";
import { createServer } from "../server/index.mjs";
import { attach, extraRoutes } from "../server/routes.mjs";

const skip = !existsSync(path.join(TOOL_ROOT, "dist/index.html")) && "needs an app build (npm run build)";
const freePort = () =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let dir, app, base, ws;
const A = "<!doctype html><title>A</title>";
const B = "<!doctype html><title>B</title>";
const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const read = (f) => fs.readFile(path.join(dir, f), "utf8").catch(() => null);
const events = [];

before(async () => {
  if (skip) return;
  // A non-git temp folder (os.tmpdir is not inside a repo)
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-undo-"));
  await fs.mkdir(path.join(dir, "screens"));
  await fs.writeFile(path.join(dir, "screens/a.html"), A);
  await fs.writeFile(path.join(dir, "screens/b.html"), B);
  process.env.DESIGN_CANVAS_AGENT_CMD = JSON.stringify({ claude: ["node", path.join(TOOL_ROOT, "test/fixtures/fake-agent-edits.mjs")] });
  const port = await freePort();
  app = await createServer({ dir, port, dev: false, extraRoutes });
  await attach(app);
  base = `http://127.0.0.1:${port}`;
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.onmessage = (m) => events.push(JSON.parse(m.data));
  await new Promise((r) => (ws.onopen = r));
  await api("GET", "/api/board"); // auto-places a.html and b.html (an app write, not an undo step)
  await wait(400);
});
after(async () => {
  delete process.env.DESIGN_CANVAS_AGENT_CMD;
  ws?.close();
  await app?.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

const runEnd = async (id) => {
  for (let i = 0; i < 100; i++) {
    const e = events.find((x) => x.type === "chat" && x.id === id && x.ev.kind === "end");
    if (e) return e.ev;
    await wait(100);
  }
  throw new Error("run did not end");
};

let runId;
test("one in-app run that edits two screens, creates one and calls the API → exactly one undo step; undo and redo all of it", { skip }, async () => {
  const before0 = (await api("GET", "/api/history")).body.undo.length;
  const { body } = await api("POST", "/api/chat", { agent: "claude", text: "Make the titles numbered please, all of them" });
  runId = body.id;
  const end = await runEnd(runId);
  assert.equal(end.status, "done");
  assert.equal(end.step, true);
  assert.deepEqual([...end.changed].sort(), ["a.html", "b.html", "c.html", "d.html"]);
  // Right at `end` the step is complete, without waiting for the watcher
  const h = (await api("GET", "/api/history")).body;
  assert.equal(h.undo.length, before0 + 1);
  assert.equal(h.steps.at(-1).label, "Claude Code: Make the titles numbered please, all of …"); // first 40 chars
  assert.equal(h.steps.at(-1).by, "Claude Code");
  assert.match(await read("screens/a.html"), /A2/);
  await wait(500); // late watcher events must not add steps
  assert.equal((await api("GET", "/api/history")).body.undo.length, before0 + 1);

  const u = await api("POST", "/api/history/undo", {});
  assert.equal(u.status, 200);
  assert.equal(await read("screens/a.html"), A);
  assert.equal(await read("screens/b.html"), B);
  assert.equal(await read("screens/c.html"), null);
  assert.equal(await read("screens/d.html"), null);
  assert.ok(!JSON.parse(await read("board.json")).boards["d.html"]);
  await wait(500);
  assert.equal((await api("GET", "/api/history")).body.canRedo, true, "the undo's own writes are not outside changes");

  const r = await api("POST", "/api/history/redo", {});
  assert.equal(r.status, 200);
  assert.match(await read("screens/a.html"), /A2/);
  assert.match(await read("screens/b.html"), /B1/);
  assert.match(await read("screens/c.html"), /C/);
  assert.ok(await read("screens/d.html"));
});

test("an outside edit while idle becomes its own step and keeps the earlier ones", { skip }, async () => {
  const h0 = (await api("GET", "/api/history")).body;
  await fs.writeFile(path.join(dir, "screens/b.html"), "<!doctype html><title>B by hand</title>");
  for (let i = 0; i < 40 && (await api("GET", "/api/history")).body.undo.length === h0.undo.length; i++) await wait(100);
  const h = (await api("GET", "/api/history")).body;
  assert.equal(h.undo.length, h0.undo.length + 1);
  assert.deepEqual(h.undo.slice(0, -1), h0.undo);
  assert.equal(h.undo.at(-1), "Changed outside the app: b.html");
  assert.ok(events.some((e) => e.type === "history-changed"));
  // A second edit soon after merges into the same step
  await fs.writeFile(path.join(dir, "screens/a.html"), "<!doctype html><title>A by hand</title>");
  await wait(800);
  const h2 = (await api("GET", "/api/history")).body;
  assert.equal(h2.undo.length, h.undo.length);
  assert.equal(h2.undo.at(-1), "Changed outside the app: b.html, a.html");
  await api("POST", "/api/history/undo", {});
  assert.match(await read("screens/b.html"), /B1/);
  assert.match(await read("screens/a.html"), /A2/);
});

test("revert restores the pre-run copy as one step, even after the history is lost; 404 without a copy", { skip }, async () => {
  assert.ok(existsSync(path.join(dir, ".easel/runs", runId, "screens/a.html")));
  assert.equal(await read(".easel/.gitignore"), "*\n");
  app.ctx.history.clear();
  const r = await api("POST", "/api/chat/revert", { id: runId });
  assert.equal(r.status, 200);
  assert.equal(r.body.label, "Revert Claude Code run");
  assert.equal(await read("screens/a.html"), A);
  assert.equal(await read("screens/b.html"), B);
  assert.equal(await read("screens/c.html"), null);
  const h = (await api("GET", "/api/history")).body;
  assert.deepEqual(h.undo, ["Revert Claude Code run"]);
  await api("POST", "/api/history/undo", {});
  assert.match(await read("screens/a.html"), /A2/);
  assert.equal((await api("POST", "/api/chat/revert", { id: "r0" })).status, 404);
  assert.equal((await api("POST", "/api/chat/revert", { id: "../x" })).status, 404);
});

test("revert restores only tracked file names, whatever run.json lists", { skip }, async () => {
  const runDir = path.join(dir, ".easel/runs", runId);
  const outside = `dc-escape-${process.pid}.html`; // would land next to the design folder
  const meta = JSON.parse(await fs.readFile(path.join(runDir, "run.json"), "utf8"));
  await fs.writeFile(path.join(dir, ".easel/runs", outside), "<!doctype html>");
  await fs.writeFile(path.join(runDir, "notes.txt"), "x");
  await fs.writeFile(path.join(runDir, "run.json"), JSON.stringify({ ...meta, files: [...meta.files, `../${outside}`, "notes.txt", 7] }));
  try {
    const r = await api("POST", "/api/chat/revert", { id: runId });
    assert.equal(r.status, 200);
    assert.equal(await read("screens/a.html"), A);
    assert.ok(!existsSync(path.join(dir, "..", outside)));
    assert.equal(await read("notes.txt"), null);
  } finally {
    await fs.rm(path.join(dir, "..", outside), { force: true });
  }
  await api("POST", "/api/history/undo", {});
  assert.match(await read("screens/a.html"), /A2/);
});
