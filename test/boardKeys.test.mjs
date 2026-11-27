// AI-generated with Claude Code, 2026-11-27
// board.json keys Easel does not know (a project's or an agent's own data, top level or inside a board entry) survive every
// writer: a save from the app (PUT /api/board, also from an app that loaded before the key was added), undo and redo, and MCP
// writes (place_board, add_note). groupNames from the app is saved too
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { TOOL_ROOT } from "../server/args.mjs";
import { formatBoard } from "../server/boardFormat.mjs";
import { savedBoard } from "../server/boards.mjs";
import { createServer } from "../server/index.mjs";
import { extraRoutes } from "../server/routes.mjs";

const skip = !existsSync(path.join(TOOL_ROOT, "dist/index.html")) && "needs an app build (npm run build)";
const freePort = () =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });

const DISK = {
  version: 1,
  title: "t",
  pages: [],
  boards: { "a.html": { x: 0, y: 0, w: 390, h: 844, title: "A", x_board: { owner: "pm" } } },
  order: ["a.html"],
  notes: {},
  x_project: { a: 1 },
};

test("savedBoard: unknown top-level keys come from disk, the app's keys from the app", () => {
  const app = { ...structuredClone(DISK), title: "renamed", x_project: { stale: true }, groupNames: { SCR: "Screens" } };
  delete app.launch;
  const next = savedBoard(app, formatBoard({ ...DISK, launch: { view: "canvas" } }));
  assert.deepEqual(next.x_project, { a: 1 }, "disk wins for keys the app does not own");
  assert.equal(next.title, "renamed");
  assert.deepEqual(next.groupNames, { SCR: "Screens" }, "groupNames from the app is kept");
  assert.equal(next.launch, undefined, "a key the app owns and removed stays removed");
  assert.deepEqual(next.boards["a.html"].x_board, { owner: "pm" }, "unknown keys inside a board entry ride along");
  // An app that loaded before the key was added does not drop it
  const stale = structuredClone(DISK);
  delete stale.x_project;
  assert.deepEqual(savedBoard(stale, formatBoard(DISK)).x_project, { a: 1 });
  // A missing or broken file on disk is no error
  assert.equal(savedBoard(stale, null).x_project, undefined);
  assert.equal(savedBoard(stale, "{not json").x_project, undefined);
});

test("formatBoard keeps unknown keys: known ones first, the rest sorted, in the board entry too", () => {
  const text = formatBoard({ ...DISK, z_last: 2, groupNames: { SCR: "S" } });
  const keys = Object.keys(JSON.parse(text));
  assert.deepEqual(keys, ["version", "title", "pages", "boards", "order", "notes", "groupNames", "x_project", "z_last"]);
  assert.match(text, /"x_board":\{"owner":"pm"\}/);
  assert.equal(formatBoard(JSON.parse(text)), text, "stable on a second save");
});

let dir, home, app, base;
const prevHome = process.env.EASEL_HOME;
const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const disk = async () => JSON.parse(await fs.readFile(path.join(dir, "board.json"), "utf8"));

before(async () => {
  if (skip) return;
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "dc-keys-")));
  home = path.join(root, "easel-home");
  process.env.EASEL_HOME = home;
  dir = path.join(root, "design");
  await fs.mkdir(path.join(dir, "screens"), { recursive: true });
  await fs.writeFile(path.join(dir, "screens/a.html"), "<!doctype html><title>A</title><body>A</body>");
  await fs.writeFile(path.join(dir, "board.json"), formatBoard(DISK));
  const port = await freePort();
  app = await createServer({ dir, port, dev: false, extraRoutes, register: true });
  base = `http://127.0.0.1:${port}`;
});
after(async () => {
  await app?.close();
  if (prevHome == null) delete process.env.EASEL_HOME;
  else process.env.EASEL_HOME = prevHome;
  if (dir) await fs.rm(path.dirname(dir), { recursive: true, force: true });
});

test("a property change from the app, its undo and redo, and MCP writes keep x_project and x_board", { skip }, async () => {
  const original = await fs.readFile(path.join(dir, "board.json"), "utf8");
  // The app's save: the board it loaded, one board option changed, recorded in the undo history
  const { board } = (await api("GET", "/api/board")).body;
  board.boards["a.html"] = { ...board.boards["a.html"], radius: 24 };
  assert.equal((await api("PUT", "/api/board", { ...board, label: "Board options" })).status, 200);
  let d = await disk();
  assert.equal(d.boards["a.html"].radius, 24);
  assert.deepEqual(d.x_project, { a: 1 });
  assert.deepEqual(d.boards["a.html"].x_board, { owner: "pm" });

  // An app that loaded before x_project was there: its save still keeps it
  const stale = structuredClone(board);
  delete stale.x_project;
  stale.boards["a.html"].radius = 12;
  assert.equal((await api("PUT", "/api/board", { ...stale, label: "Board options" })).status, 200);
  d = await disk();
  assert.equal(d.boards["a.html"].radius, 12);
  assert.deepEqual(d.x_project, { a: 1 });

  // Undo both saves: the file is back to what it was, byte for byte; redo keeps the keys too
  await api("POST", "/api/history/undo");
  await api("POST", "/api/history/undo");
  assert.equal(await fs.readFile(path.join(dir, "board.json"), "utf8"), original);
  await api("POST", "/api/history/redo");
  d = await disk();
  assert.equal(d.boards["a.html"].radius, 24);
  assert.deepEqual(d.x_project, { a: 1 });

  // MCP writes through the real MCP server
  const client = new Client({ name: "claude-code", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(TOOL_ROOT, "bin/mcp.mjs")], cwd: dir, env: { PATH: process.env.PATH, HOME: process.env.HOME, EASEL_HOME: home }, stderr: "ignore" }));
  try {
    const placed = await client.callTool({ name: "place_board", arguments: { file: "a.html", x: 600, y: 0 } });
    assert.ok(!placed.isError, JSON.stringify(placed.content));
    const noted = await client.callTool({ name: "add_note", arguments: { kind: "sticky", text: "hi", x: 0, y: 1000 } });
    assert.ok(!noted.isError, JSON.stringify(noted.content));
  } finally {
    await client.close();
  }
  d = await disk();
  assert.equal(d.boards["a.html"].x, 600);
  assert.equal(Object.keys(d.notes).length, 1);
  assert.deepEqual(d.x_project, { a: 1 });
  assert.deepEqual(d.boards["a.html"].x_board, { owner: "pm" });
});
