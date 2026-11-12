// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Several people and agents on one canvas: who is on which board (an in-app run, an MCP client going quiet or disconnecting, a person
// in Edit mode), one writer per board (the fork decision, a fork beside the original, later writes redirected), "Use this" for forks
// and variants as one undoable step, Keep all, origins surviving rename / duplicate / delete, and placement that keeps clear of notes
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { stepName } from "../server/activity.mjs";
import { TOOL_ROOT } from "../server/args.mjs";
import { choiceGroup, decideWrite } from "../server/forks.mjs";
import { createServer } from "../server/index.mjs";
import { createOccupancy } from "../server/occupancy.mjs";
import { besideSpot, freeRow, freeSpot, noteRect, placeNew } from "../server/place.mjs";
import { attach, extraRoutes } from "../server/routes.mjs";

const skip = !existsSync(path.join(TOOL_ROOT, "dist/index.html")) && "needs an app build (npm run build)";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });

/* ---------- The state machine ---------- */
const states = (occ, f) => (occ.snapshot()[f] ?? []).map((h) => `${h.by ?? h.person ?? h.client}:${h.state}`);

test("occupancy: a chat run holds the boards it writes until it ends, then shows done; the same agent in two runs is one holder", () => {
  const seen = [];
  const occ = createOccupancy({ onChange: (s) => seen.push(s) });
  occ.agentWrite("a.html", "Claude Code", { run: "r1", before: "A0" });
  occ.agentWrite("a.html", "Claude Code", { run: "r2" });
  assert.deepEqual(states(occ, "a.html"), ["Claude Code:editing"]);
  assert.equal(occ.base("a.html"), "A0", "the board as it was when its writer started");
  occ.runEnded("r1");
  assert.deepEqual(states(occ, "a.html"), ["Claude Code:editing"], "still in the second run");
  occ.runEnded("r2");
  assert.deepEqual(states(occ, "a.html"), ["Claude Code:done"]);
  assert.ok(occ.snapshot()["a.html"][0].doneAt > 0);
  assert.deepEqual(occ.agentsOn("a.html"), [], "a done writer does not hold the board");
  assert.equal(occ.base("a.html"), null);
  assert.equal(seen.length, 2, "only changes someone can see: started, done");
  occ.close();
});

test("occupancy: an MCP client holds a board until it goes quiet or disconnects; a write found on disk keeps it busy", async () => {
  const occ = createOccupancy({ quietMs: 120, doneMs: 150 });
  occ.agentWrite("a.html", "Codex", { client: "mcp-1" });
  occ.agentWrite("b.html", "Codex", { client: "mcp-1" });
  await wait(80);
  occ.touch("a.html"); // its own file tools after claim_board
  await wait(80);
  assert.deepEqual(states(occ, "a.html"), ["Codex:editing"]);
  assert.deepEqual(states(occ, "b.html"), ["Codex:done"], "quiet for longer than quietMs");
  await wait(220);
  assert.deepEqual(states(occ, "b.html"), [], "the done label goes after doneMs");
  occ.agentWrite("c.html", "Codex", { client: "mcp-2" });
  occ.clientGone("mcp-2");
  assert.deepEqual(states(occ, "c.html"), ["Codex:done"], "disconnecting ends it at once");
  occ.agentWrite("c.html", "Codex", { client: "mcp-3" });
  assert.deepEqual(states(occ, "c.html"), ["Codex:editing"], "writing again picks it up");
  occ.close();
});

test("occupancy: a person holds a board while a tab has it in Edit mode; leaving, switching or closing the tab releases it", () => {
  const occ = createOccupancy();
  occ.personEdit("w1", "a.html", { client: "b1", person: "Hyun" });
  occ.personEdit("w2", "a.html", { client: "b1", person: "Hyun" });
  occ.agentWrite("a.html", "Codex", { client: "m" });
  assert.deepEqual(states(occ, "a.html"), ["Hyun:editing", "Codex:editing"], "both labels; one per browser");
  assert.deepEqual(occ.agentsOn("a.html").map((h) => h.by), ["Codex"], "people never count as the writer");
  occ.personEdit("w1", null);
  assert.deepEqual(states(occ, "a.html"), ["Hyun:editing", "Codex:editing"], "the other tab is still editing");
  occ.personEdit("w2", "b.html", { client: "b1" });
  assert.deepEqual(states(occ, "a.html"), ["Codex:editing"]);
  assert.deepEqual(states(occ, "b.html"), ["b1:editing"]);
  occ.personEdit("w2", null); // the WebSocket closed
  assert.deepEqual(states(occ, "b.html"), []);
  occ.close();
});

/* ---------- The fork decision ---------- */
test("decideWrite: people write in place; the first writer done → no fork; same agent → no fork; another agent → fork; own fork → redirect", () => {
  const board = { boards: { "a.html": {}, "a-codex.html": { origin: { kind: "fork", of: "a.html", by: "Codex" } } } };
  const cc = [{ by: "Claude Code" }];
  assert.deepEqual(decideWrite({ board, file: "a.html", by: null, holders: cc }), { action: "write", file: "a.html" }, "a person is never forked");
  assert.deepEqual(decideWrite({ board, file: "a.html", by: "Gemini CLI", holders: [] }), { action: "write", file: "a.html" }, "nobody editing: becomes the writer");
  assert.deepEqual(decideWrite({ board, file: "a.html", by: "Claude Code", holders: cc }), { action: "write", file: "a.html" }, "the holder itself (another run)");
  assert.deepEqual(decideWrite({ board, file: "a.html", by: "Gemini CLI", holders: cc }), { action: "fork", while: "Claude Code" });
  assert.deepEqual(decideWrite({ board, file: "a.html", by: "Codex", holders: [] }), { action: "redirect", file: "a-codex.html" }, "while the fork exists");
  assert.deepEqual(decideWrite({ board, file: "a.html", by: "Codex", holders: cc, exists: (f) => f !== "a-codex.html" }), { action: "fork", while: "Claude Code" }, "fork file gone: a new one");
  assert.deepEqual(decideWrite({ board, file: "a.html", by: "Codex", holders: [], exists: () => false }), { action: "write", file: "a.html" });
});

test("choiceGroup: a variant with its siblings, a fork with its original, the original with its forks; ordinary boards have none", () => {
  const v = (of) => ({ origin: { kind: "variant", of } });
  const board = { boards: { "o.html": {}, "o-v1.html": v("o.html"), "o-v2.html": v("o.html"), "o-codex.html": { origin: { kind: "fork", of: "o.html", by: "Codex" } }, "x.html": {}, "lost.html": v("gone.html") } };
  assert.deepEqual(choiceGroup(board, "o-v2.html"), { original: "o.html", kind: "variant", chosen: "o-v2.html", alts: ["o-v1.html", "o-v2.html"] });
  assert.deepEqual(choiceGroup(board, "o-codex.html"), { original: "o.html", kind: "fork", chosen: "o-codex.html", alts: ["o-codex.html"] });
  assert.deepEqual(choiceGroup(board, "o.html"), { original: "o.html", kind: "fork", chosen: "o.html", alts: ["o-codex.html"] });
  assert.equal(choiceGroup(board, "x.html"), null);
  assert.equal(choiceGroup(board, "lost.html"), null, "its original is gone");
});

/* ---------- Placement ---------- */
test("placement: forks, variants and new screens never land on a note or another board", () => {
  const sticky = { kind: "sticky", x: 520, y: 0, w: 300, text: "Keep the headline. Legal approved this copy on Nov 7." };
  const r = noteRect(sticky);
  assert.equal(r.w, 300);
  assert.ok(r.h >= 22 * 1.45 * 2, "the text wraps onto at least two lines");
  assert.ok(noteRect({ kind: "title", x: 0, y: 0, text: "Onboarding" }).w > 72 * 5, "a title is as wide as its text");
  const board = { pages: [], boards: { "o.html": { x: 0, y: 0, w: 390, h: 844 } }, notes: { n1: sticky } };
  // Right of the original is a note: the fork goes past it
  const f = freeSpot(board, { x: 470, y: 0, w: 390, h: 844 });
  assert.ok(f.x >= 520 + 300 + 80, `fork at ${f.x}`);
  assert.equal(f.y, 0);
  // A fork stays near its original: right when that is free or nearly so, below when the row is full
  assert.deepEqual(besideSpot({ pages: [], boards: { "o.html": { x: 0, y: 0, w: 390, h: 844 } }, notes: {} }, { x: 0, y: 0, w: 390, h: 844 }), { x: 470, y: 0, w: 390, h: 844 });
  assert.deepEqual([besideSpot(board, board.boards["o.html"])].map((p) => [p.x >= 900, p.y]), [[true, 0]]);
  const rowFull = { pages: [], boards: { "o.html": { x: 0, y: 0, w: 390, h: 844 }, "p.html": { x: 470, y: 0, w: 390, h: 844 }, "q.html": { x: 940, y: 0, w: 390, h: 844 } }, notes: {} };
  assert.deepEqual(besideSpot(rowFull, rowFull.boards["o.html"]), { x: 0, y: 964, w: 390, h: 844 });
  // A row of 3 variants below the original; a note in that row pushes it further down
  board.notes.n2 = { kind: "sticky", x: 600, y: 1000, w: 400, h: 300, text: "In the way" };
  const row = freeRow(board, board.boards["o.html"], 3);
  assert.equal(row.length, 3);
  assert.ok(row[0].y >= 1300 + 120, `row at ${row[0].y}`);
  assert.deepEqual(row.map((p) => p.x), [0, 470, 940]);
  // A note on another page is not in the way
  const paged = { pages: [{ id: "p1" }, { id: "p2" }], boards: { "o.html": { x: 0, y: 0, w: 390, h: 844 } }, notes: { n: { ...sticky, page: "p2" } } };
  assert.equal(freeSpot(paged, { x: 470, y: 0, w: 390, h: 844 }).x, 470);
  // New screens: right of the last auto-placed one, past a note
  const auto = { pages: [], boards: { "s.html": { x: 0, y: 0, w: 390, h: 844, autoPlaced: true } }, notes: { n: { kind: "title", x: 470, y: 100, text: "Flow" } } };
  assert.ok(placeNew(auto, { w: 390, h: 844 }).x > 470 + 200);
});

/* ---------- Through the server ---------- */
let dir, app, base, ws;
const events = [];
const read = (f) => fs.readFile(path.join(dir, f), "utf8").catch(() => null);
const board = async () => JSON.parse(await read("board.json"));
const api = async (method, p, body, headers = {}) => {
  const r = await fetch(base + p, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const as = (agent, client) => ({ "X-Easel-Agent": agent, ...(client ? { "X-Easel-Client": client } : {}) });
const occ = async () => (await api("GET", "/api/boards/occupancy")).body.boards;
const W = (t) => `<!doctype html><title>${t}</title><body><h1>${t}</h1></body>`;

before(async () => {
  if (skip) return;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-occ-"));
  await fs.mkdir(path.join(dir, "screens"));
  for (const f of ["a", "b", "c", "v"]) await fs.writeFile(path.join(dir, `screens/${f}.html`), W(f.toUpperCase()));
  await fs.writeFile(path.join(dir, "screens/c-codex.html"), W("taken")); // a fork name already in use
  await fs.writeFile(
    path.join(dir, "board.json"),
    JSON.stringify({
      version: 1,
      title: "t",
      pages: [],
      boards: { "a.html": { x: 0, y: 0, w: 390, h: 844, title: "Alpha" }, "b.html": { x: 3000, y: 0, w: 390, h: 844, title: "Beta" }, "c.html": { x: 6000, y: 0, w: 390, h: 844, title: "Gamma" }, "c-codex.html": { x: 9000, y: 0, w: 390, h: 844 }, "v.html": { x: 0, y: 3000, w: 390, h: 844, title: "Welcome" } },
      order: ["a.html", "b.html", "c.html", "c-codex.html", "v.html"],
      notes: { n1: { kind: "sticky", x: 470, y: 0, w: 300, text: "A note right of Alpha" } },
    }),
  );
  process.env.DESIGN_CANVAS_AGENT_CMD = JSON.stringify({ claude: ["node", path.join(TOOL_ROOT, "test/fixtures/fake-agent-run.mjs")] });
  const port = await freePort();
  app = await createServer({ dir, port, dev: false, extraRoutes });
  await attach(app);
  base = `http://127.0.0.1:${port}`;
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.onmessage = (m) => events.push(JSON.parse(m.data));
  await new Promise((r) => (ws.onopen = r));
  await wait(300);
});
after(async () => {
  delete process.env.DESIGN_CANVAS_AGENT_CMD;
  ws?.close();
  await app?.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

test("a browser that connects gets the occupancy right away; Edit mode reported over the WebSocket shows, and closing the tab releases it", { skip }, async () => {
  assert.ok(events.some((e) => e.type === "occupancy"), "sent on connect");
  ws.send(JSON.stringify({ type: "editing", file: "b.html", client: "browser-1", person: "Hyun" }));
  ws.send(JSON.stringify({ type: "editing", file: "../board.json", client: "browser-1" })); // ignored
  await wait(100);
  assert.deepEqual((await occ())["b.html"].map((h) => [h.kind, h.person, h.client, h.state]), [["person", "Hyun", "browser-1", "editing"]]);
  const other = new WebSocket(base.replace("http", "ws") + "/ws");
  await new Promise((r) => (other.onopen = r));
  other.send(JSON.stringify({ type: "editing", file: "c.html", client: "browser-2" }));
  await wait(100);
  assert.ok((await occ())["c.html"]);
  other.close();
  await wait(150);
  assert.equal((await occ())["c.html"], undefined, "the closed tab let go");
  ws.send(JSON.stringify({ type: "editing", file: null }));
  await wait(100);
  assert.equal((await occ())["b.html"], undefined);
});

test("two agents on one board: the second gets a fork beside it (clear of the note), its later writes go there, the first keeps the board", { skip }, async () => {
  const a1 = await api("POST", "/api/boards/write", { file: "a.html", html: W("Alpha by Claude") }, as("Claude Code", "mcp-cc"));
  assert.equal(a1.status, 200);
  assert.deepEqual([a1.body.file, a1.body.forked], ["a.html", false]);
  const b1 = await api("POST", "/api/boards/write", { file: "a.html", html: W("Alpha by Codex") }, as("Codex", "mcp-cx"));
  assert.equal(b1.status, 200);
  assert.deepEqual([b1.body.file, b1.body.forked, b1.body.original], ["a-codex.html", true, "a.html"]);
  assert.match(b1.body.message, /Claude Code is editing a\.html, so your change went to a fork next to it: screens\/a-codex\.html/);
  assert.equal(await read("screens/a.html"), W("Alpha by Claude"), "the original keeps the first writer's work");
  assert.equal(await read("screens/a-codex.html"), W("Alpha by Codex"));
  const f = (await board()).boards["a-codex.html"];
  assert.equal(f.title, "Alpha · Codex");
  assert.deepEqual({ ...f.origin, at: typeof f.origin.at }, { kind: "fork", of: "a.html", by: "Codex", while: "Claude Code", at: "string" });
  assert.ok(f.x >= 470 + 300 + 80 && f.y === 0, `placed right of Alpha and past the note: ${f.x}`);
  assert.deepEqual((await board()).order.slice(0, 2), ["a.html", "a-codex.html"]);
  // Later writes by Codex to the original are redirected; Claude Code's are not
  const b2 = await api("POST", "/api/boards/write", { file: "a.html", html: W("Alpha by Codex 2") }, as("Codex", "mcp-cx"));
  assert.deepEqual([b2.body.file, b2.body.forked], ["a-codex.html", true]);
  assert.match(b2.body.message, /you are working on your fork/);
  assert.equal(await read("screens/a-codex.html"), W("Alpha by Codex 2"));
  // An edit that fails on the fork still says which file the agent is on
  const e1 = await api("POST", "/api/edit", { file: "a.html", op: "setText", path: "0/9/9", hash: "stale", text: "x" }, as("Codex", "mcp-cx"));
  assert.equal(e1.status, 409);
  assert.deepEqual([e1.body.file, e1.body.forked, e1.body.original], ["a-codex.html", true, "a.html"]);
  assert.match(e1.body.error, /you are working on your fork screens\/a-codex\.html/);
  await api("POST", "/api/boards/write", { file: "a.html", html: W("Alpha by Claude 2") }, as("Claude Code", "mcp-cc"));
  assert.equal(await read("screens/a.html"), W("Alpha by Claude 2"));
  // Reads are never redirected
  assert.equal(await (await fetch(`${base}/api/file?f=a.html`, { headers: as("Codex") })).text(), W("Alpha by Claude 2"));
  const o = await occ();
  assert.deepEqual(o["a.html"].map((h) => `${h.by}:${h.state}`), ["Claude Code:editing"]);
  assert.deepEqual(o["a-codex.html"].map((h) => `${h.by}:${h.state}`), ["Codex:editing"]);
  // History names the fork step
  const steps = (await api("GET", "/api/activity")).body.steps;
  assert.ok(steps.some((s) => s.name === "Fork Alpha for Codex" && s.by === "Codex"), JSON.stringify(steps.map((s) => s.name)));
  // Use this one waits for both writers
  const busy = await api("POST", "/api/boards/use", { file: "a-codex.html" });
  assert.equal(busy.status, 409);
  assert.match(busy.body.error, /still editing/);
});

test("Use this one on the fork: its content becomes the original (name, title, position, comments stay), the fork goes to trash; one Undo brings both back", { skip }, async () => {
  await api("POST", "/api/comments", { file: "a.html", text: "Keep the logo" });
  await api("POST", "/api/boards/release", { client: "mcp-cc" });
  await api("POST", "/api/boards/release", { client: "mcp-cx" });
  const o = await occ();
  assert.deepEqual([o["a.html"][0].state, o["a-codex.html"][0].state], ["done", "done"], "disconnecting ends both holds");
  const before = await board();
  const r = await api("POST", "/api/boards/use", { file: "a-codex.html" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.original, r.body.chosen, r.body.trashed], ["a.html", "a-codex.html", ["a-codex.html"]]);
  assert.equal(await read("screens/a.html"), W("Alpha by Codex 2"));
  assert.equal(await read("screens/a-codex.html"), null);
  const trashed = await fs.readdir(path.join(dir, ".trash"));
  assert.ok((await Promise.all(trashed.filter((d) => !d.startsWith(".")).map((d) => read(`.trash/${d}/a-codex.html`)))).includes(W("Alpha by Codex 2")), "a copy in the trash");
  const after = await board();
  assert.equal(after.boards["a-codex.html"], undefined);
  assert.deepEqual(after.boards["a.html"], before.boards["a.html"], "title and position stay");
  assert.deepEqual((await api("GET", "/api/comments?file=a.html")).body.comments.map((c) => c.text), ["Keep the logo"]);
  assert.equal((await occ())["a-codex.html"], undefined, "nobody is on a trashed board");
  const steps = (await api("GET", "/api/activity")).body.steps;
  assert.equal(steps[0].name, "Use Alpha · Codex for Alpha");
  assert.equal(steps[0].id, r.body.step);
  // One step back: both versions and the fork's origin
  const u = await api("POST", "/api/history/undo-steps", { ids: [r.body.step] });
  assert.equal(u.status, 200);
  assert.equal(await read("screens/a.html"), W("Alpha by Claude 2"));
  assert.equal(await read("screens/a-codex.html"), W("Alpha by Codex 2"));
  assert.deepEqual((await board()).boards["a-codex.html"], before.boards["a-codex.html"]);
});

test("Use this one on the original keeps it and trashes the fork; Keep both drops only the link", { skip }, async () => {
  const r = await api("POST", "/api/boards/use", { file: "a.html" });
  assert.equal(r.status, 200);
  assert.equal(await read("screens/a.html"), W("Alpha by Claude 2"));
  assert.equal(await read("screens/a-codex.html"), null);
  assert.equal((await api("GET", "/api/activity")).body.steps[0].name, "Keep Alpha, trash Alpha · Codex");
  await api("POST", "/api/history/undo", {});
  assert.ok((await board()).boards["a-codex.html"].origin);
  const k = await api("POST", "/api/boards/keep", { file: "a-codex.html" });
  assert.equal(k.status, 200);
  assert.equal((await board()).boards["a-codex.html"].origin, undefined);
  assert.equal((await api("POST", "/api/boards/use", { file: "a-codex.html" })).status, 400, "an ordinary board now");
  assert.equal((await api("GET", "/api/activity")).body.steps[0].name, "Keep all versions of Alpha");
  await api("POST", "/api/history/undo", {});
  assert.ok((await board()).boards["a-codex.html"].origin, "Undo brings the link back");
});

test("edge cases: the first writer finished before the second wrote (no fork); a taken fork name; the original deleted while a fork exists", { skip }, async () => {
  await api("POST", "/api/boards/write", { file: "b.html", html: W("Beta 1") }, as("Claude Code", "m1"));
  await api("POST", "/api/boards/release", { client: "m1" });
  const s = await api("POST", "/api/boards/write", { file: "b.html", html: W("Beta 2") }, as("Codex", "m2"));
  assert.deepEqual([s.body.file, s.body.forked], ["b.html", false], "the second simply becomes the writer");
  assert.deepEqual((await occ())["b.html"].map((h) => `${h.by}:${h.state}`), ["Claude Code:done", "Codex:editing"]);
  await api("POST", "/api/boards/release", { client: "m2" });
  // c-codex.html exists already: the fork takes the next free name, from the board as it was when the first writer started
  await api("POST", "/api/boards/claim", { file: "c.html" }, as("Claude Code", "m3"));
  const c = await api("POST", "/api/boards/claim", { file: "c.html" }, as("Codex", "m4"));
  assert.deepEqual([c.body.file, c.body.forked], ["c-codex-2.html", true]);
  assert.match(c.body.message, /a fork was made for you: screens\/c-codex-2\.html/);
  assert.equal(await read("screens/c-codex-2.html"), W("C"));
  assert.equal(await read("screens/c-codex.html"), W("taken"), "the file already there is untouched");
  // A person is never forked or blocked
  const p = await api("POST", "/api/boards/write", { file: "c.html", html: W("C by a person") }, { "X-Easel-Client": "browser-9" });
  assert.deepEqual([p.body.file, p.body.forked], ["c.html", false]);
  // The original deleted: the fork stays as an ordinary board
  await api("POST", "/api/boards/release", { client: "m3" });
  await api("POST", "/api/boards/release", { client: "m4" });
  assert.equal((await api("POST", "/api/boards/delete", { files: ["c.html"] })).status, 200);
  assert.ok((await board()).boards["c-codex-2.html"]);
  assert.equal((await board()).boards["c-codex-2.html"].origin, undefined);
  await api("POST", "/api/history/undo", {});
  assert.equal((await board()).boards["c-codex-2.html"].origin.of, "c.html", "Undo of the delete restores the link");
});

test("variants from the chat: placed in a free row with their origin; Use this applies one and trashes the others; origin survives rename, not duplicate", { skip }, async () => {
  ws.send(JSON.stringify({ type: "editing", file: null }));
  const { body } = await api("POST", "/api/chat", { agent: "claude", text: "variants please", variants: 3, attach: { boards: ["v.html"] } });
  assert.deepEqual(body.variants, ["v-v1.html", "v-v2.html", "v-v3.html"]);
  let o = await occ();
  assert.equal(o["v-v1.html"]?.[0]?.by, "Claude Code", "the run holds its variants");
  for (let i = 0; i < 100 && !events.some((e) => e.type === "chat" && e.id === body.id && e.ev.kind === "end"); i++) await wait(50);
  o = await occ();
  assert.deepEqual(o["v-v2.html"].map((h) => h.state), ["done"], "done when the run ends");
  const b = await board();
  for (const f of body.variants) assert.equal(b.boards[f].origin.kind, "variant");
  assert.equal(b.boards["v-v1.html"].origin.of, "v.html");
  assert.deepEqual(body.variants.map((f) => [b.boards[f].x, b.boards[f].y]), [[0, 3964], [470, 3964], [940, 3964]], "the first free row below the original");
  await fs.writeFile(path.join(dir, "screens/v-v2.html"), W("Variant two"));
  await wait(400);
  // Rename the original: its variants follow; duplicate a variant: the copy is an ordinary board
  assert.equal((await api("POST", "/api/boards/rename", { file: "v.html", newFile: "welcome.html" })).status, 200);
  assert.equal((await board()).boards["v-v3.html"].origin.of, "welcome.html");
  const d = await api("POST", "/api/boards/duplicate", { file: "v-v1.html" });
  assert.equal((await board()).boards[d.body.file].origin, undefined);
  await api("POST", "/api/boards/rename", { file: "v-v2.html", title: "Variant 2: bold CTA" });
  const r = await api("POST", "/api/boards/use", { file: "v-v2.html" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.trashed, ["v-v1.html", "v-v2.html", "v-v3.html"]);
  assert.equal(await read("screens/welcome.html"), W("Variant two"));
  for (const f of r.body.trashed) assert.equal(await read(`screens/${f}`), null);
  assert.equal((await api("GET", "/api/activity")).body.steps[0].name, "Use Variant 2 for Welcome");
  await api("POST", "/api/history/undo", {});
  assert.equal(await read("screens/welcome.html"), W("V"));
  for (const f of r.body.trashed) assert.ok(await read(`screens/${f}`), `${f} is back`);
  assert.equal((await board()).boards["v-v1.html"].origin.of, "welcome.html");
});

test("a chat run sent to a board another agent is editing works on a fork, and its prompt says so", { skip }, async () => {
  await api("POST", "/api/boards/claim", { file: "b.html" }, as("Codex", "m5"));
  const { body } = await api("POST", "/api/chat", { agent: "claude", text: "edit:b-claude-code.html", attach: { boards: ["b.html"] } });
  for (let i = 0; i < 100 && !events.some((e) => e.type === "chat" && e.id === body.id && e.ev.kind === "end"); i++) await wait(50);
  const start = events.find((e) => e.type === "chat" && e.id === body.id && e.ev.kind === "start").ev;
  assert.match(start.prompt, /Codex is editing screens\/b\.html right now, so a fork was made for you: screens\/b-claude-code\.html/);
  assert.match(start.prompt, /Target boards: screens\/b-claude-code\.html/);
  const f = (await board()).boards["b-claude-code.html"];
  assert.deepEqual([f.origin.by, f.origin.while], ["Claude Code", "Codex"]);
  assert.match(await read("screens/b-claude-code.html"), new RegExp(body.id), "the run's write landed on its fork");
  assert.equal(await read("screens/b.html"), W("Beta 2"));
  await api("POST", "/api/boards/release", { client: "m5" });
  // A later run on the same board goes to the fork it already has, and is not told the other agent is still there
  const again = await api("POST", "/api/chat", { agent: "claude", text: "edit:b-claude-code.html", attach: { boards: ["b.html"] } });
  for (let i = 0; i < 100 && !events.some((e) => e.type === "chat" && e.id === again.body.id && e.ev.kind === "end"); i++) await wait(50);
  const p2 = events.find((e) => e.type === "chat" && e.id === again.body.id && e.ev.kind === "start").ev.prompt;
  assert.match(p2, /screens\/b\.html already has a fork of yours from an earlier run: screens\/b-claude-code\.html/);
  assert.doesNotMatch(p2, /is editing/);
});

test("the new write routes refuse other web pages and names outside the screens folder", { skip }, async () => {
  for (const p of ["/api/boards/write", "/api/boards/claim", "/api/boards/release", "/api/boards/use", "/api/boards/keep"]) assert.equal((await api("POST", p, { file: "b.html", html: "x", client: "m" }, { Origin: "https://evil.example" })).status, 403, p);
  for (const file of ["../board.json", ".hidden/a.html", "a.txt", "/etc/x.html"]) {
    assert.equal((await api("POST", "/api/boards/write", { file, html: "x" }, as("Codex"))).status, 400, file);
    assert.equal((await api("POST", "/api/boards/claim", { file }, as("Codex"))).status, 400, file);
    assert.equal((await api("POST", "/api/boards/use", { file })).status, 400, file);
  }
  assert.equal(await read("board.txt"), null);
});

test("step names for forks and picks", () => {
  const env = { screensDir: "/d/screens", boardPath: "/d/board.json", titles: { "o.html": "Onboarding 1 · Welcome" } };
  const bj = { path: "/d/board.json", before: JSON.stringify({ boards: { "o-v2.html": { title: "Variant 2: bold CTA" }, "o-codex.html": { title: "Onboarding 1 · Welcome · Codex" } } }), after: "{}" };
  assert.equal(stepName({ label: "Use o-v2.html for o.html", changes: [bj] }, env), "Use Variant 2 for Onboarding 1 · Welcome");
  assert.equal(stepName({ label: "Fork o.html for Codex", changes: [] }, env), "Fork Onboarding 1 · Welcome for Codex");
  assert.equal(stepName({ label: "Keep o.html, trash o-codex.html", changes: [bj] }, env), "Keep Onboarding 1 · Welcome, trash Onboarding 1 · Welcome · Codex");
  assert.equal(stepName({ label: "Keep all variants of o.html", changes: [] }, env), "Keep all variants of Onboarding 1 · Welcome");
});
