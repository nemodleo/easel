// AI-generated with Claude Code, 2026-11-10, reviewed by Hyun Park
// easel-mcp end to end over stdio: finds the canvas for its folder without --port, reports the package version and the real
// screens folder, uses the client's name as comment and undo-step author, returns screenshots as images
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { TOOL_ROOT } from "../server/args.mjs";
import { createServer } from "../server/index.mjs";
import { closeBrowser, extraRoutes } from "../server/routes.mjs";

const skip = !existsSync(path.join(TOOL_ROOT, "dist/index.html")) && "needs an app build (npm run build)";
const pkg = JSON.parse(readFileSync(path.join(TOOL_ROOT, "package.json"), "utf8"));
const freePort = () =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });

let base, home, rootA, rootB, appA, appB;
const prevHome = process.env.EASEL_HOME;
before(async () => {
  if (skip) return;
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "dc-mcp-")));
  home = path.join(base, "easel-home");
  process.env.EASEL_HOME = home; // the registry goes here, never to the real ~/.easel
  rootA = path.join(base, "alpha");
  rootB = path.join(base, "beta");
  await fs.mkdir(path.join(rootA, "docs/design/screens"), { recursive: true });
  await fs.mkdir(path.join(rootB, "screens"), { recursive: true });
  await fs.writeFile(path.join(rootA, "docs/design/screens/a.html"), "<!doctype html><title>A</title><body>A</body>");
  await fs.writeFile(path.join(rootB, "screens/b.html"), "<!doctype html><title>B</title><body>B</body>");
  appA = await createServer({ dir: path.join(rootA, "docs/design"), port: await freePort(), dev: false, extraRoutes, register: true });
  appB = await createServer({ dir: rootB, port: await freePort(), dev: false, extraRoutes, register: true });
});
after(async () => {
  await closeBrowser(); // the screenshot test launches Chromium in this process
  await appA?.close();
  await appB?.close();
  if (prevHome == null) delete process.env.EASEL_HOME;
  else process.env.EASEL_HOME = prevHome;
  if (base) await fs.rm(base, { recursive: true, force: true });
});

async function mcp(cwd, args = []) {
  const client = new Client({ name: "claude-code", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(TOOL_ROOT, "bin/mcp.mjs"), ...args], cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, EASEL_HOME: home }, stderr: "ignore" }));
  return client;
}
const json = (r) => JSON.parse(r.content[0].text);

test("registry entries are written for both canvases and removed on close", { skip }, async () => {
  const names = (await fs.readdir(path.join(home, "servers"))).sort();
  assert.deepEqual(names, [`${appA.port}.json`, `${appB.port}.json`].sort());
  const e = JSON.parse(await fs.readFile(path.join(home, "servers", `${appA.port}.json`), "utf8"));
  assert.equal(e.root, rootA);
  assert.equal(e.pid, process.pid);
});

test("each MCP server reaches the canvas for its own folder, without --port", { skip }, async () => {
  const a = await mcp(path.join(rootA, "docs"));
  const b = await mcp(rootB);
  try {
    assert.equal(a.getServerVersion().version, pkg.version);
    const la = json(await a.callTool({ name: "list_boards", arguments: {} }));
    assert.equal(la.dir, "docs/design/screens");
    assert.deepEqual(la.boards.map((x) => x.file), ["a.html"]);
    const lb = json(await b.callTool({ name: "list_boards", arguments: {} }));
    assert.equal(lb.dir, "screens");
    assert.deepEqual(lb.boards.map((x) => x.file), ["b.html"]);
  } finally {
    await a.close();
    await b.close();
  }
});

test("the client's name is the default comment author and the undo-step author", { skip }, async () => {
  const a = await mcp(rootA);
  try {
    const c = json(await a.callTool({ name: "add_comment", arguments: { file: "a.html", text: "Tighter spacing" } }));
    assert.equal(c.comment.author, "Claude Code");
    const c2 = json(await a.callTool({ name: "add_comment", arguments: { file: "a.html", text: "x", author: "Hyun" } }));
    assert.equal(c2.comment.author, "Hyun");
    await a.callTool({ name: "create_board", arguments: { file: "new.html", template: "mobile" } });
    const h = appA.ctx.history.state();
    assert.equal(h.steps.at(-1).label, "Create board new.html");
    assert.equal(h.steps.at(-1).by, "Claude Code");
  } finally {
    await a.close();
  }
});

test("outside every project with several canvases: the error lists them and says --port", { skip }, async () => {
  const elsewhere = path.join(base, "elsewhere");
  await fs.mkdir(elsewhere);
  const c = await mcp(elsewhere);
  try {
    const r = await c.callTool({ name: "list_boards", arguments: {} });
    assert.equal(r.isError, true);
    const text = r.content[0].text;
    assert.ok(text.includes(`${rootA}  (port ${appA.port})`) && text.includes(`${rootB}  (port ${appB.port})`), text);
    assert.match(text, /--port/);
    const pinned = await mcp(elsewhere, ["--port", String(appB.port)]);
    assert.equal(json(await pinned.callTool({ name: "list_boards", arguments: {} })).dir, "screens");
    await pinned.close();
  } finally {
    await c.close();
  }
});

test("no canvas: the error says how to start one in the project", { skip }, async () => {
  const c = await mcp(rootA, ["--port", String(await freePort())]);
  try {
    const r = await c.callTool({ name: "list_boards", arguments: {} });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Start it in the project with `npx easel-canvas` \(add --dir <design folder>/);
    assert.doesNotMatch(r.content[0].text, /npm run design/);
  } finally {
    await c.close();
  }
});

test("screenshot returns the PNG as image content plus the saved path", { skip }, async (t) => {
  const c = await mcp(rootB);
  try {
    const r = await c.callTool({ name: "screenshot", arguments: { file: "b.html" } });
    if (r.isError) return t.skip(`no screenshots here: ${r.content[0].text}`);
    assert.equal(r.content[0].type, "image");
    assert.equal(r.content[0].mimeType, "image/png");
    assert.equal(Buffer.from(r.content[0].data, "base64").subarray(1, 4).toString(), "PNG");
    assert.equal(r.content[1].text, "Saved to .easel/screenshots/b.png");
  } finally {
    await c.close();
  }
});

test("closing a canvas removes its registry entry", { skip }, async () => {
  await appB.close();
  appB = null;
  assert.deepEqual(await fs.readdir(path.join(home, "servers")), [`${appA.port}.json`]);
});
