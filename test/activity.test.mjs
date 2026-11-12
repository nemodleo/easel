// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Who changed what: changed-element detection on two HTML texts, step names, board tags (same author folds, your own edits left out),
// History › Go back to here in both directions, and the routes behind tags and History (activity, undo-steps, step-file, goto)
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { boardEntries, boardTags, changedElements, describeChange, MAX_OUTLINE, stepName } from "../server/activity.mjs";
import { TOOL_ROOT } from "../server/args.mjs";
import { createHistory } from "../server/history.mjs";
import { createServer, scopeOf } from "../server/index.mjs";
import { attach, extraRoutes } from "../server/routes.mjs";

const doc = (body, head = "<style>p{}</style>") => `<!doctype html><html><head><title>t</title>${head}</head><body>${body}</body></html>`;
const SCREEN = doc(`<div class="x-dc"><main><h1>Hi</h1><p>Text</p></main><footer><button class="cta">Get started</button><a href="#">Later</a></footer></div>`);

test("changed elements: a text change is one text item at the element's path (the path /api/outline uses)", () => {
  const d = describeChange(SCREEN, SCREEN.replace("Get started", "Start free"));
  assert.deepEqual(d, { kind: "text", count: 1, tag: "button", cls: "cta", from: "Get started", to: "Start free", paths: ["0/1/0"] });
});

test("changed elements: an attribute or style change names the element; style only when just the style attribute changed", () => {
  const style = describeChange(SCREEN, SCREEN.replace('class="cta"', 'class="cta" style="color:red"'));
  assert.equal(style.kind, "style");
  assert.deepEqual(style.paths, ["0/1/0"]);
  const attr = describeChange(SCREEN, SCREEN.replace('href="#"', 'href="/next"'));
  assert.deepEqual([attr.kind, attr.tag, attr.paths], ["attr", "a", ["0/1/1"]]);
  const both = describeChange(SCREEN, SCREEN.replace('<a href="#">Later</a>', '<a href="/x">Not now</a>'));
  assert.equal(both.kind, "edited", "text and attribute of one element");
});

test("changed elements: added elements are outlined where they are now, a removal outlines the parent; siblings keep their match", () => {
  const added = describeChange(SCREEN, SCREEN.replace("<p>Text</p>", "<p>Text</p><p>More</p>"));
  assert.deepEqual([added.kind, added.tag, added.paths], ["added", "p", ["0/0/2"]]);
  const front = changedElements(SCREEN, SCREEN.replace("<main><h1>", "<main><img src=x><h1>"));
  assert.deepEqual(front.items.map((i) => [i.path, i.kind]), [["0/0/0", "added"]], "the h1 and p moved down a place but did not change");
  const removed = describeChange(SCREEN, SCREEN.replace("<p>Text</p>", ""));
  assert.deepEqual([removed.kind, removed.tag, removed.paths], ["removed", "p", ["0/0"]]);
  const swapped = describeChange(SCREEN, SCREEN.replace("<h1>Hi</h1>", "<h2>Hi</h2>"));
  assert.deepEqual([swapped.kind, swapped.paths], ["replaced", ["0/0/0"]]);
});

test("changed elements: too many → no outline, only a count; head-only and source-only changes have no elements; new and deleted boards", () => {
  const list = doc(`<ul>${Array.from({ length: 10 }, (_, i) => `<li>${i}</li>`).join("")}</ul>`);
  const many = describeChange(list, list.replace(/<li>(\d)<\/li>/g, "<li>n$1</li>"));
  assert.deepEqual([many.kind, many.count, many.paths], ["many", 10, []]);
  assert.ok(MAX_OUTLINE < 10);
  const few = describeChange(list, list.replace("<li>1</li>", "<li>x</li>").replace("<li>2</li>", "<li>y</li>"));
  assert.deepEqual([few.kind, few.count, few.paths], ["many", 2, ["0/1", "0/2"]]);
  assert.equal(describeChange(SCREEN, SCREEN.replace("p{}", "p{color:red}")).kind, "page");
  assert.equal(describeChange(SCREEN, SCREEN.replace("<main>", "<main>\n  <!-- note -->")).kind, "source");
  assert.equal(describeChange(null, SCREEN).kind, "new");
  assert.equal(describeChange(SCREEN, null).kind, "deleted");
  const body = describeChange(doc("<p>a</p>"), doc('<p>a</p><script>let x = 1</script>'));
  assert.deepEqual(body.paths, [], "a script is never outlined");
});

const env = { screensDir: "/d/screens", boardPath: "/d/board.json", titles: { "welcome.html": "Welcome", "inbox.html": "Inbox", "home.html": "Home" } };
const ch = (f, before, after) => ({ path: f === "board.json" ? env.boardPath : `/d/screens/${f}`, before, after });
const boardJson = (boards) => JSON.stringify({ boards });

test("step names: edits by operation, board operations by board, outside changes by board, text wording only for one text node", () => {
  const text = ch("welcome.html", SCREEN, SCREEN.replace("Get started", "Start free"));
  assert.equal(stepName({ label: "welcome.html setText", changes: [text] }, env), "Change button copy on Welcome");
  assert.equal(stepName({ label: "welcome.html setStyle", changes: [ch("welcome.html", SCREEN, SCREEN.replace("<p>", '<p style="x">'))] }, env), "Change style on Welcome");
  assert.equal(stepName({ label: "Changed outside the app: welcome.html", outside: true, changes: [text] }, env), "Change button copy on Welcome");
  const twoTexts = ch("welcome.html", SCREEN, SCREEN.replace("Get started", "Go").replace("Hi", "Hey"));
  assert.equal(stepName({ label: "Changed outside the app: welcome.html", outside: true, changes: [twoTexts] }, env), "Change Welcome");
  assert.equal(stepName({ label: "Claude Code: make it pop", outside: true, run: "r1", changes: [twoTexts, ch("home.html", "a", "b")] }, env), "Change Welcome, Home");
  assert.equal(stepName({ label: "Changed outside the app: pricing.html", outside: true, changes: [ch("pricing.html", null, SCREEN)] }, env), "Add board pricing");
  assert.equal(stepName({ label: "Create board inbox.html", changes: [] }, env), "Add board Inbox");
  assert.equal(stepName({ label: "Delete board inbox.html, home.html", changes: [] }, env), "Delete 2 boards");
  assert.equal(stepName({ label: "Rename inbox.html", changes: [] }, env), "Rename board Inbox");
  const moved = ch("board.json", boardJson({ "inbox.html": { x: 0, y: 0, w: 390, h: 844 } }), boardJson({ "inbox.html": { x: 40, y: 0, w: 390, h: 844 } }));
  assert.equal(stepName({ label: "Move board", changes: [moved] }, env), "Move board Inbox");
  const resized = ch("board.json", boardJson({ "home.html": { x: 0, y: 0, w: 390, h: 844 } }), boardJson({ "home.html": { x: 0, y: 0, w: 400, h: 844 } }));
  assert.equal(stepName({ label: "Resize board", changes: [resized] }, env), "Resize board Home");
  const both = ch("board.json", boardJson({ "home.html": { x: 0 }, "inbox.html": { x: 0 } }), boardJson({ "home.html": { x: 9 }, "inbox.html": { x: 9 } }));
  assert.equal(stepName({ label: "Move board", changes: [both] }, env), "Move 2 boards");
  assert.equal(stepName({ label: "Add note", changes: [] }, env), "Add note");
  assert.equal(stepName({ label: "Changed outside the app: board.json", outside: true, changes: [moved] }, env), "Change board Inbox");
  assert.deepEqual(boardEntries(moved.before, moved.after).moved, ["inbox.html"]);
});

const step = (id, who, boards, extra = {}) => ({ id, ...who, at: Number(id.slice(1)), boards: boards.map((f) => (typeof f === "string" ? { file: f, kind: "changed", change: { kind: "text", count: 1, paths: ["0"] }, fresh: true } : f)), ...extra });

test("board tags: one tag per author per board, steps by the same author fold with a count, newest first; your own edits do not tag", () => {
  const steps = [
    step("s1", { by: "Claude Code" }, [{ file: "pricing.html", kind: "added", change: { kind: "new", count: 1, paths: [] }, fresh: true }]),
    step("s2", { by: "Codex" }, ["welcome.html"]),
    step("s3", { person: "Ana", client: "b2" }, ["welcome.html"]),
    step("s4", { client: "me" }, ["welcome.html", "home.html"]),
    step("s5", { by: "Codex" }, ["welcome.html"]),
    step("s6", { outside: true }, ["home.html"]),
  ];
  const tags = boardTags(steps, "me");
  assert.deepEqual(Object.keys(tags).sort(), ["home.html", "pricing.html", "welcome.html"]);
  assert.deepEqual(tags["welcome.html"].map((t) => [t.key, t.count, t.steps]), [["a:Codex", 2, ["s5", "s2"]], ["p:Ana", 1, ["s3"]]]);
  assert.deepEqual(tags["home.html"].map((t) => [t.key, t.outside]), [["outside", true]], "s4 was made in this browser");
  assert.equal(tags["pricing.html"][0].newBoard, true);
  assert.deepEqual(tags["welcome.html"][0].paths, ["0"]);
  assert.equal(boardTags(steps, "")["home.html"].length, 2, "another browser sees s4 as a change too");
});

test("board tags: a step taken back by an applied undo leaves no tag; a stale change (file changed since) keeps the tag, not the outline", () => {
  const steps = [step("s1", { by: "Codex" }, ["a.html"]), step("s2", { by: "Codex" }, [{ file: "b.html", kind: "changed", change: { kind: "text", count: 1, paths: ["0"] }, fresh: false }]), step("s3", { client: "me" }, ["a.html"], { undid: ["s1"] })];
  const tags = boardTags(steps, "me");
  assert.equal(tags["a.html"], undefined);
  assert.deepEqual(tags["b.html"][0].paths, []);
  const run = [step("s1", { by: "Claude Code" }, ["c.html"], { run: "r1" }), step("s2", { client: "me" }, ["c.html"], { undoOf: "r1" })];
  assert.equal(boardTags(run, "me")["c.html"], undefined, "Undo this run takes the run's tag away");
  assert.equal(boardTags([...run, step("s3", { client: "me" }, ["c.html"], { redoOf: "r1" })], "me")["c.html"][0].by, "Claude Code", "and its Redo brings it back");
  const gone = boardTags([step("s1", { by: "Codex" }, [{ file: "x.html", kind: "removed", change: { kind: "deleted", count: 1, paths: [] } }])], "me");
  assert.equal(gone["x.html"], undefined, "a deleted board has no tag");
});

test("request scope: browser id and a URI-encoded person name from the headers, the agent from X-Easel-Agent", () => {
  assert.deepEqual(scopeOf({ "x-easel-client": "b1", "x-easel-author": encodeURIComponent("박현") }), { agent: undefined, run: undefined, client: "b1", person: "박현" });
  assert.equal(scopeOf({ "x-easel-author": "%E0%A4%A" }).person, "%E0%A4%A", "not decodable: kept as sent");
  assert.equal(scopeOf({ "x-easel-agent": "Codex" }).agent, "Codex");
});

test("go back to here: undo step by step down to an older entry, redo forward again; Redo after it returns, nothing is lost", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-goto-"));
  try {
    const p = path.join(dir, "a.html");
    await fs.writeFile(p, "0");
    const h = createHistory({ list: async () => [p] });
    await h.seed();
    for (const v of ["1", "2", "3"]) {
      const before = await fs.readFile(p, "utf8");
      await fs.writeFile(p, v);
      h.push(`set ${v}`, [{ path: p, before, after: v }]);
    }
    const ids = h.entries().undo.map((s) => s.id);
    assert.equal(await h.goTo(ids[0]), 2);
    assert.equal(await fs.readFile(p, "utf8"), "1");
    assert.deepEqual(h.entries().redo.map((s) => s.label), ["set 3", "set 2"]);
    assert.equal(await h.goTo(ids[2]), 2, "forward along the redo stack");
    assert.equal(await fs.readFile(p, "utf8"), "3");
    assert.equal(await h.goTo(ids[2]), 0, "already there");
    await h.goTo(ids[1]);
    await h.redo();
    assert.equal(await fs.readFile(p, "utf8"), "3", "plain Redo after going back");
    await assert.rejects(h.goTo("s999"), (e) => e.status === 404);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/* ---------- Routes ---------- */
const skip = !existsSync(path.join(TOOL_ROOT, "dist/index.html")) && "needs an app build (npm run build)";
const freePort = () =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, () => {
      const port = s.address().port;
      s.close(() => r(port));
    });
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let dir, app, base;
const A = doc('<div><h1>Welcome</h1><button class="cta">Get started</button></div>').replace("<title>t</title>", "<title>Welcome</title>");
const B = doc("<div><h1>Inbox</h1></div>").replace("<title>t</title>", "<title>Inbox</title>");
const read = (f) => fs.readFile(path.join(dir, f), "utf8").catch(() => null);
const api = async (method, p, body, headers = {}) => {
  const r = await fetch(base + p, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: r.status, body: json, text };
};
const setText = async (file, path_, text, headers) => {
  const el = (await api("GET", `/api/element?f=${file}&path=${path_}`)).body;
  return api("POST", "/api/edit", { file, op: "setText", path: path_, hash: el.hash, text }, headers);
};

before(async () => {
  if (skip) return;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-activity-"));
  await fs.mkdir(path.join(dir, "screens"));
  await fs.writeFile(path.join(dir, "screens/a.html"), A);
  await fs.writeFile(path.join(dir, "screens/b.html"), B);
  const port = await freePort();
  app = await createServer({ dir, port, dev: false, extraRoutes });
  await attach(app);
  base = `http://127.0.0.1:${port}`;
  await api("GET", "/api/board");
  await wait(400);
});
after(async () => {
  await app?.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

test("activity: an agent's edit tags the board with its name and the text change; this browser's own edit does not", { skip }, async () => {
  assert.equal((await setText("a.html", "0/1", "Start free", { "X-Easel-Agent": "Codex" })).status, 200);
  assert.equal((await setText("b.html", "0/0", "Mail", { "X-Easel-Client": "me", "X-Easel-Author": encodeURIComponent("Hyun Park") })).status, 200);
  const a = (await api("GET", "/api/activity?client=me")).body;
  assert.deepEqual(Object.keys(a.tags), ["a.html"]);
  const t = a.tags["a.html"][0];
  assert.deepEqual([t.by, t.count, t.change.kind, t.change.from, t.change.to, t.paths], ["Codex", 1, "text", "Get started", "Start free", ["0/1"]]);
  assert.deepEqual(a.steps.map((s) => [s.name, s.by ?? s.person, s.mine, !!s.now]), [["Change heading on Inbox", "Hyun Park", true, true], ["Change button copy on Welcome", "Codex", false, false]]);
  const other = (await api("GET", "/api/activity?client=someone-else")).body;
  assert.deepEqual(other.tags["b.html"][0].person, "Hyun Park", "another browser sees the person's name");
});

test("step-file: a step's before for one of its screens, read-only with a <base>; anything else is 404", { skip }, async () => {
  const id = (await api("GET", "/api/activity")).body.steps.find((s) => s.by === "Codex").id;
  const r = await api("GET", `/api/history/step-file?id=${id}&f=a.html`);
  assert.equal(r.status, 200);
  assert.match(r.text, /<base href="\/screens\/a\.html">/);
  assert.match(r.text, /Get started/);
  for (const q of [`id=${id}&f=b.html`, `id=${id}&f=../board.json`, `id=${id}&f=..%2Fscreens%2Fa.html`, `id=s999&f=a.html`, `id=${id}&f=.hidden/a.html`]) assert.equal((await api("GET", `/api/history/step-file?${q}`)).status, 404, q);
});

test("undo-steps: an older step takes back only its files as a new step (the tag goes), Cmd+Z brings it back; conflicts ask first", { skip }, async () => {
  const codex = (await api("GET", "/api/activity?client=me")).body.tags["a.html"][0];
  const u = await api("POST", "/api/history/undo-steps", { ids: codex.steps }, { "X-Easel-Client": "me" });
  assert.equal(u.status, 200);
  assert.match(await read("screens/a.html"), /Get started/);
  assert.match(await read("screens/b.html"), /Mail/, "the newer step on another board stays");
  const after1 = (await api("GET", "/api/activity?client=me")).body;
  assert.equal(after1.tags["a.html"], undefined, "the tag goes with the undo");
  assert.equal(after1.steps[0].name, "Undo Change button copy on Welcome");
  await api("POST", "/api/history/undo", {});
  assert.match(await read("screens/a.html"), /Start free/);
  assert.equal((await api("GET", "/api/activity?client=me")).body.tags["a.html"][0].by, "Codex", "undoing the undo brings the tag back");
  // Changed since by someone else: the undo asks (a person in another browser: an agent would get a fork while Codex holds the board)
  assert.equal((await setText("a.html", "0/0", "Hello", { "X-Easel-Client": "another-browser", "X-Easel-Author": encodeURIComponent("Ana") })).status, 200);
  const box = await setText("b.html", "0/0", "Box", { "X-Easel-Client": "me" });
  assert.equal(box.status, 200, box.text);
  const c = await api("POST", "/api/history/undo-steps", { ids: codex.steps }, { "X-Easel-Client": "me" });
  assert.equal(c.status, 409);
  assert.deepEqual(c.body.conflicts, [{ file: "a.html" }]);
  assert.match(await read("screens/a.html"), /Start free/, "nothing written before the answer");
  assert.equal((await api("POST", "/api/history/undo-steps", { ids: ["s999"] })).status, 409);
});

test("undo-steps on the newest step is a plain undo (Redo brings it back); goto walks the stack and Redo returns", { skip }, async () => {
  const a = (await api("GET", "/api/activity?client=x")).body;
  const top = a.steps.find((s) => s.now);
  assert.equal((await api("POST", "/api/history/undo-steps", { ids: [top.id] })).status, 200);
  const h = (await api("GET", "/api/history")).body;
  assert.equal(h.canRedo, true);
  await api("POST", "/api/history/redo", {});
  assert.match(await read("screens/b.html"), /Box/);
  const steps = (await api("GET", "/api/activity")).body.steps;
  const target = steps.find((s) => s.name === "Change button copy on Welcome");
  const g = await api("POST", "/api/history/goto", { id: target.id });
  assert.equal(g.status, 200);
  assert.ok(g.body.moved >= 3);
  assert.match(await read("screens/a.html"), /Start free/);
  assert.doesNotMatch(await read("screens/a.html"), /Hello/);
  assert.match(await read("screens/b.html"), /Inbox/);
  const now = (await api("GET", "/api/activity")).body.steps.find((s) => s.now);
  assert.equal(now.id, target.id);
  for (let i = 0; i < g.body.moved; i++) await api("POST", "/api/history/redo", {});
  assert.match(await read("screens/a.html"), /Hello/);
  assert.match(await read("screens/b.html"), /Box/);
  assert.equal((await api("POST", "/api/history/goto", { id: "s999" })).status, 404);
});

test("the new write routes refuse other web pages", { skip }, async () => {
  for (const p of ["/api/history/goto", "/api/history/undo-steps"]) assert.equal((await api("POST", p, {}, { Origin: "https://evil.example" })).status, 403, p);
});
