// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Undo a whole in-app AI run: a plain undo when its step is the newest, only its own files when it is older, a question when one of
// them changed since (undo the rest / all), a run that added a board, redo; and the read-only pre-run copy behind Compare
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
import { mergeBoardJson, mergeSteps } from "../server/runs.mjs";

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

const A = "<!doctype html><title>A</title>";
const B = "<!doctype html><title>B</title>";
const E = "<!doctype html><title>E</title>";
let dir, app, base, ws;
const events = [];
const read = (f) => fs.readFile(path.join(dir, f), "utf8").catch(() => null);
const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const board = async () => JSON.parse(await read("board.json"));

before(async () => {
  if (skip) return;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-undorun-"));
  await fs.mkdir(path.join(dir, "screens"));
  await fs.writeFile(path.join(dir, "screens/a.html"), A);
  await fs.writeFile(path.join(dir, "screens/b.html"), B);
  await fs.writeFile(path.join(dir, "screens/e.html"), E);
  process.env.DESIGN_CANVAS_AGENT_CMD = JSON.stringify({ claude: ["node", path.join(TOOL_ROOT, "test/fixtures/fake-agent-run.mjs")] });
  const port = await freePort();
  app = await createServer({ dir, port, dev: false, extraRoutes });
  await attach(app);
  base = `http://127.0.0.1:${port}`;
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.onmessage = (m) => events.push(JSON.parse(m.data));
  await new Promise((r) => (ws.onopen = r));
  await api("GET", "/api/board");
  await wait(400);
});
after(async () => {
  delete process.env.DESIGN_CANVAS_AGENT_CMD;
  ws?.close();
  await app?.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

async function run(text) {
  const { body } = await api("POST", "/api/chat", { agent: "claude", text });
  for (let i = 0; i < 100; i++) {
    const e = events.find((x) => x.type === "chat" && x.id === body.id && x.ev.kind === "end");
    if (e) return { id: body.id, end: e.ev };
    await wait(100);
  }
  throw new Error("run did not end");
}

test("mergeSteps and mergeBoardJson: one change per file; board entries merge key by key, conflicts by name", () => {
  const ch = mergeSteps([{ changes: [{ path: "a", before: "1", after: "2" }] }, { changes: [{ path: "a", before: "2", after: "3" }, { path: "b", before: "x", after: "x" }] }]);
  assert.deepEqual(ch, [{ path: "a", before: "1", after: "3" }]);
  const from = JSON.stringify({ boards: { "a.html": { x: 0 } }, order: ["a.html"] });
  const to = JSON.stringify({ boards: { "a.html": { x: 0 }, "n.html": { x: 9 } }, order: ["a.html", "n.html"] });
  const cur = JSON.stringify({ boards: { "a.html": { x: 50 }, "n.html": { x: 9 } }, order: ["a.html", "n.html"] });
  const back = mergeBoardJson(cur, to, from);
  assert.deepEqual(back.conflicts, []);
  assert.deepEqual(JSON.parse(back.text).boards, { "a.html": { x: 50 } }, "the move made since stays");
  assert.deepEqual(JSON.parse(back.text).order, ["a.html"]);
  const moved = JSON.stringify({ boards: { "a.html": { x: 0 }, "n.html": { x: 99 } }, order: ["a.html", "n.html"] });
  assert.deepEqual(mergeBoardJson(moved, to, from).conflicts, ["n.html"]);
  assert.deepEqual(JSON.parse(mergeBoardJson(moved, to, from, true).text).boards, { "a.html": { x: 0 } });
});

let r1;
test("newest step, a run that added a board: Undo this run is a plain undo (screens and the new board gone), Redo brings it all back", { skip }, async () => {
  r1 = await run("edit:a.html,b.html add:n.html");
  assert.equal(r1.end.step, true);
  assert.deepEqual(
    [...r1.end.boards].sort((x, y) => x.file.localeCompare(y.file)),
    [
      { file: "a.html", kind: "changed" },
      { file: "b.html", kind: "changed" },
      { file: "n.html", kind: "added" },
    ],
  );
  for (let i = 0; i < 40 && !(await board()).boards["n.html"]; i++) await wait(50);
  assert.ok((await board()).boards["n.html"], "auto-placed");
  const u = await api("POST", "/api/chat/undo-run", { id: r1.id });
  assert.equal(u.status, 200);
  assert.equal(await read("screens/a.html"), A);
  assert.equal(await read("screens/b.html"), B);
  assert.equal(await read("screens/n.html"), null);
  assert.ok(!(await board()).boards["n.html"], "no board left behind for the removed screen");
  const h = (await api("GET", "/api/history")).body;
  assert.equal(h.canRedo, true, "a plain undo: the run's step is on the redo stack");
  assert.ok(events.some((e) => e.type === "chat" && e.id === r1.id && e.ev.kind === "run-undo" && e.ev.undone === true));
  assert.equal((await api("POST", "/api/chat/undo-run", { id: r1.id })).status, 409, "already undone");
  const r = await api("POST", "/api/chat/redo-run", { id: r1.id });
  assert.equal(r.status, 200);
  assert.match(await read("screens/a.html"), new RegExp(r1.id));
  assert.match(await read("screens/b.html"), new RegExp(r1.id));
  assert.equal(await read("screens/n.html"), "<!doctype html><title>n.html</title>");
  assert.ok((await board()).boards["n.html"], "placed again right away");
});

test("older step with untouched files: only the run's files go back, a later change stays, and the undo is one step Cmd+Z takes back", { skip }, async () => {
  await fs.writeFile(path.join(dir, "screens/e.html"), "<!doctype html><title>E by hand</title>");
  await wait(400);
  const steps0 = (await api("GET", "/api/history")).body.undo.length;
  const u = await api("POST", "/api/chat/undo-run", { id: r1.id });
  assert.equal(u.status, 200);
  assert.equal(await read("screens/a.html"), A);
  assert.equal(await read("screens/b.html"), B);
  assert.equal(await read("screens/n.html"), null);
  assert.equal(await read("screens/e.html"), "<!doctype html><title>E by hand</title>", "the later change is kept");
  const h = (await api("GET", "/api/history")).body;
  assert.equal(h.undo.length, steps0 + 1);
  assert.match(h.undo.at(-1), /^Undo Claude Code: edit:a\.html/);
  await api("POST", "/api/history/undo", {});
  assert.match(await read("screens/a.html"), new RegExp(r1.id), "Cmd+Z brings the run back");
  assert.ok(await read("screens/n.html"));
  // The row's Redo after that finds nothing left to do and still answers
  assert.equal((await api("POST", "/api/chat/redo-run", { id: r1.id })).status, 200);
});

test("older step with a conflict: nothing is written until the user picks; undo the rest keeps the later edit; redo the same way", { skip }, async () => {
  const r2 = await run("edit:a.html,b.html");
  const a2 = await read("screens/a.html");
  const handA = a2.replace("<title>A</title>", "<title>A by hand</title>");
  await fs.writeFile(path.join(dir, "screens/a.html"), handA);
  await wait(400);
  const b2 = await read("screens/b.html");
  const c = await api("POST", "/api/chat/undo-run", { id: r2.id });
  assert.equal(c.status, 409);
  assert.deepEqual(c.body.conflicts, [{ file: "a.html" }]);
  assert.equal(await read("screens/a.html"), handA, "nothing written");
  assert.equal(await read("screens/b.html"), b2);
  const rest = await api("POST", "/api/chat/undo-run", { id: r2.id, mode: "rest" });
  assert.equal(rest.status, 200);
  assert.equal(await read("screens/a.html"), handA, "the hand edit stays");
  assert.equal(await read("screens/b.html"), b2.replace(`<!-- ${r2.id} -->`, ""));
  // Redo once something newer is on top: a.html still is not what the run started from, so it asks again
  await fs.writeFile(path.join(dir, "screens/e.html"), "<!doctype html><title>E again</title>");
  await wait(400);
  const rc = await api("POST", "/api/chat/redo-run", { id: r2.id });
  assert.equal(rc.status, 409);
  assert.deepEqual(rc.body.conflicts, [{ file: "a.html" }]);
  assert.equal((await api("POST", "/api/chat/redo-run", { id: r2.id, mode: "rest" })).status, 200);
  assert.equal(await read("screens/b.html"), b2);
  assert.equal(await read("screens/a.html"), handA);
});

test("undo all anyway overwrites the later edit (as one step that Cmd+Z takes back)", { skip }, async () => {
  const r3 = await run("edit:e.html");
  const before3 = (await read("screens/e.html")).replace(`<!-- ${r3.id} -->`, "");
  await fs.writeFile(path.join(dir, "screens/e.html"), "<!doctype html><title>E later</title>");
  await wait(400);
  assert.equal((await api("POST", "/api/chat/undo-run", { id: r3.id })).status, 409);
  const all = await api("POST", "/api/chat/undo-run", { id: r3.id, mode: "all" });
  assert.equal(all.status, 200);
  assert.equal(await read("screens/e.html"), before3);
  await api("POST", "/api/history/undo", {});
  assert.equal(await read("screens/e.html"), "<!doctype html><title>E later</title>");
});

test("Compare's before: the pre-run copy of a screen, read-only and validated like the revert", { skip }, async () => {
  const r = await fetch(`${base}/api/chat/run-file?id=${r1.id}&f=screens/a.html`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  assert.equal(await r.text(), A.replace("<title>", '<base href="/screens/a.html"><title>'));
  for (const q of [`id=${r1.id}&f=screens/../board.json`, `id=${r1.id}&f=board.json`, `id=${r1.id}&f=../a.html`, `id=${r1.id}&f=screens/.x.html`, `id=${r1.id}&f=screens/zz.html`, `id=../r1&f=screens/a.html`, "id=r0&f=screens/a.html", `id=${r1.id}&f=screens/a.css`])
    assert.equal((await fetch(`${base}/api/chat/run-file?${q}`)).status, 404, q);
  const info = (await api("GET", `/api/chat/runs?ids=${r1.id},r0,bad`)).body;
  assert.equal(info.boot, app.ctx.boot);
  assert.equal(info.runs[r1.id].live, true);
  assert.match(info.runs[r1.id].copy.at, /^\d{4}-/);
  assert.deepEqual(info.runs.r0, { live: false, undone: false, status: null, copy: null }, "no copy (pruned or never made)");
  assert.equal(info.runs.bad, undefined);
});

test("after a restart (history gone) undo-run says so; the run's copy is still there to restore", { skip }, async () => {
  const r4 = await run("edit:b.html");
  app.ctx.history.clear();
  // A restarted server has no record of the run at all
  assert.equal((await api("POST", "/api/chat/undo-run", { id: "rffffff" })).status, 404);
  const rev = await api("POST", "/api/chat/revert", { id: r4.id });
  assert.equal(rev.status, 200);
  assert.doesNotMatch(await read("screens/b.html"), new RegExp(r4.id));
});
