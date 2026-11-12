// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Requests from other web pages in the user's browser: non-GET /api calls and the WebSocket need no Origin (CLI, MCP) or the page's
// own origin, and a local Host name (DNS rebinding); GET stays open. Covers Share's export routes too
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { WebSocket as WS } from "ws";

import { TOOL_ROOT } from "../server/args.mjs";
import { createServer, originAllowed } from "../server/index.mjs";
import { attach, extraRoutes } from "../server/routes.mjs";

test("originAllowed: no Origin or the same origin, on a local Host name", () => {
  assert.ok(originAllowed({ host: "localhost:4317" }));
  assert.ok(originAllowed({ host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" }));
  assert.ok(originAllowed({ host: "localhost:4317", origin: "http://localhost:4317" }));
  assert.ok(originAllowed({ host: "[::1]:4317", origin: "http://[::1]:4317" }));
  assert.ok(originAllowed({ host: "design.localhost:4317", origin: "http://design.localhost:4317" }));
  assert.ok(!originAllowed({ host: "localhost:4317", origin: "http://localhost:4318" }), "another local port is another site");
  assert.ok(!originAllowed({ host: "localhost:4317", origin: "https://evil.example" }));
  assert.ok(!originAllowed({ host: "localhost:4317", origin: "null" }));
  assert.ok(!originAllowed({ host: "evil.example:4317" }), "DNS rebinding: a foreign Host name");
  assert.ok(!originAllowed({ host: "evil.example:4317", origin: "http://evil.example:4317" }));
  assert.ok(!originAllowed({}));
});

const skip = !existsSync(path.join(TOOL_ROOT, "dist/index.html")) && "needs an app build (npm run build)";
const freePort = () =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
let dir, app, port, base;
before(async () => {
  if (skip) return;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-origin-"));
  await fs.mkdir(path.join(dir, "screens"));
  await fs.writeFile(path.join(dir, "screens/a.html"), "<!doctype html><title>A</title>");
  port = await freePort();
  app = await createServer({ dir, port, dev: false, extraRoutes });
  await attach(app);
  base = `http://127.0.0.1:${port}`;
});
after(async () => {
  await app?.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

/** Raw request (fetch cannot set Host) */
const raw = (method, p, headers, body = "{}") =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { "Content-Type": "application/json", ...headers } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end(method === "GET" ? undefined : body);
  });

test("state-changing routes refuse other origins and foreign Host names; no Origin and same origin pass; GET is open", { skip }, async () => {
  const note = JSON.stringify({ action: "add", kind: "sticky", text: "x", x: 0, y: 0 });
  assert.equal(await raw("POST", "/api/notes", { Origin: "https://evil.example" }, note), 403);
  assert.equal(await raw("POST", "/api/notes", { Host: "evil.example:80" }, note), 403);
  assert.equal(await raw("PUT", "/api/context", { Origin: "https://evil.example" }), 403);
  assert.equal(await raw("POST", "/api/notes", {}, note), 200, "CLI and MCP send no Origin");
  assert.equal(await raw("POST", "/api/notes", { Origin: base }, note), 200);
  assert.equal(await raw("GET", "/api/board", { Origin: "https://evil.example" }), 200);
  // Share's export routes (Batch 1) are covered too
  for (const p of ["/api/export", "/api/export/estimate", "/api/export/reveal"]) assert.equal(await raw("POST", p, { Origin: "https://evil.example" }), 403, p);
  assert.notEqual(await raw("POST", "/api/export/estimate", { Origin: base }, JSON.stringify({ scope: "all" })), 403);
  // Undo and the AI chat too
  assert.equal(await raw("POST", "/api/history/undo", { Origin: "https://evil.example" }), 403);
  assert.equal(await raw("POST", "/api/chat", { Origin: "https://evil.example" }, JSON.stringify({ text: "x" })), 403);
});

test("the WebSocket refuses other origins and says hello (the server's start time) to the page", { skip }, async () => {
  const bad = new WS(`ws://127.0.0.1:${port}/ws`, { origin: "https://evil.example" });
  const badResult = await new Promise((r) => {
    bad.on("open", () => r("open"));
    bad.on("error", () => r("refused"));
  });
  assert.equal(badResult, "refused");
  const ok = new WS(`ws://127.0.0.1:${port}/ws`, { origin: base });
  const hello = await new Promise((r) => ok.once("message", (m) => r(JSON.parse(String(m)))));
  assert.deepEqual(hello, { type: "hello", boot: app.ctx.boot });
  ok.close();
});
