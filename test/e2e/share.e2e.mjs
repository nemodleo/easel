// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Share › view-only copy: export from the toolbar popover, then open the copy the way a reviewer would —
// a web folder from a plain static server under a sub-path, and the single file from file://
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";

import { startEnv, wait } from "./helpers.mjs";

let env;
let pageId;
before(async () => {
  env = await startEnv();
  env.page.setDefaultTimeout(15000);
  // Two pages (scr-32 on the second) and one comment, so the copy has something to switch to and to read
  pageId = (await env.api("POST", "/api/pages", { action: "add", name: "Flow" })).body.id;
  await env.api("POST", "/api/place", { file: "scr-32.html", page: pageId });
  await env.api("POST", "/api/comments", { file: "scr-02.html", path: "0", text: "Make the list denser", author: "Mina" });
});
after(async () => env?.close());

/** A plain static file server that serves `root` under /preview/pr-7/ and nothing else */
async function staticServer(root) {
  const prefix = "/preview/pr-7/";
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
  const server = http.createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!p.startsWith(prefix)) {
      res.writeHead(404);
      return res.end();
    }
    const file = path.join(root, p.slice(prefix.length) || "index.html");
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end();
    }
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}${prefix}`, close: () => new Promise((r) => server.close(r)) };
}

test("Share: open from the toolbar with the keyboard, export a web folder, the result stays; Esc closes and focus returns", async () => {
  const { page, url } = env;
  await page.goto(url);
  await page.waitForSelector(".board");
  await page.focus(".share-btn");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".share-pop[role=dialog]");
  // Scope first, then the rows; the footer shows the matching CLI command
  // With a board selected, the scope starts at the selection
  const sel = await page.$$eval(".left .board-list .row.on", (r) => r.length);
  assert.equal(await page.locator(".share-pop .seg [aria-checked=true]").textContent(), sel ? `Selected boards (${sel})` : "Whole canvas");
  await page.click(".share-pop .seg >> text=Whole canvas");
  assert.equal(await page.locator(".share-pop .pop-foot code").textContent(), "npx easel-canvas export");
  await page.click(".share-pop .seg >> text=This page");
  assert.match(await page.locator(".share-pop .pop-foot code").textContent(), /^npx easel-canvas export --page Default$/);
  await page.click(".share-pop .seg >> text=Whole canvas");
  await page.click(".share-pop .switch");
  assert.match(await page.locator(".share-pop .pop-foot code").textContent(), /--single-file$/);
  await page.waitForFunction(() => /\d+ KB/.test(document.querySelector(".share-pop .out-row.first .out-text")?.textContent ?? ""));
  await page.click(".share-pop .switch");
  // Ask AI stays the only filled button in the toolbar
  const filled = await page.$$eval(".toolbar button:not(.share-pop *)", (bs) => bs.filter((b) => getComputedStyle(b).backgroundColor === getComputedStyle(document.querySelector(".ask-ai")).backgroundColor && b.offsetParent).map((b) => b.className));
  assert.deepEqual(filled, ["ask-ai "]);

  await page.click(".share-pop .out-row.first > button.primary");
  await page.waitForSelector(".share-pop .out-row.first .result");
  const line = await page.locator(".share-pop .out-row.first .result").textContent();
  assert.match(line, /easel-export\/ exported/);
  assert.match(line, /Reveal/);
  assert.match(line, /Copy deploy command/);
  for (const f of ["index.html", "easel-viewer/viewer.js", "easel-viewer/data.js", "screens/scr-02.html"]) await fs.access(path.join(env.dir, "easel-export", f));

  await page.keyboard.press("Escape");
  await page.waitForSelector(".share-pop", { state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("share-btn")), true);
  // The result is still there when the popover opens again
  await page.click(".share-btn");
  await page.waitForSelector(".share-pop .out-row.first .result");
  await page.keyboard.press("Escape");
  assert.deepEqual(env.errors, []);
});

test("the web folder from a static host under a sub-path: boards, pages, Play, a comment; no editing tools and no calls to the canvas", async () => {
  const srv = await staticServer(path.join(env.dir, "easel-export"));
  const viewer = await env.page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const page = await viewer.newPage();
  page.setDefaultTimeout(15000);
  const requests = [];
  const errors = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(srv.url);
    await page.waitForSelector(".viewer .board iframe");
    // First page: three boards, rendered from the copied screens
    await page.waitForFunction(() => [...document.querySelectorAll(".board iframe")].length === 3 && [...document.querySelectorAll(".board iframe")].every((f) => f.contentDocument?.body?.children.length));
    assert.match((await page.locator(".stamp").textContent()).trim(), /^View only · exported /);
    assert.equal(await page.locator(".made a").getAttribute("href"), "https://github.com/nemodleo/easel");
    // Comment: a pin on the board and the list on the right, opened as a thread
    await page.waitForSelector('.board[data-file="scr-02.html"] .pin');
    assert.match(await page.locator(".c-item").first().textContent(), /Mina.*Make the list denser/);
    await page.click(".c-item");
    await page.waitForSelector(".thread");
    assert.match(await page.locator(".thread").textContent(), /Make the list denser/);
    // Pages switch
    await page.click(".page-tabs >> text=Flow");
    await page.waitForFunction(() => document.querySelectorAll(".board").length === 1 && !!document.querySelector('.board[data-file="scr-32.html"] iframe'));
    // Play opens the board full screen
    await page.click(".play-btn");
    await page.waitForSelector(".play .play-frame");
    await page.waitForFunction(() => !!document.querySelector(".play-frame")?.contentDocument?.body?.children.length);
    await page.keyboard.press("Escape");
    await page.waitForSelector(".play", { state: "detached" });
    // Read-only: no toolbar, no element toolbar, no inspector or chat, nothing editable
    assert.equal(await page.locator(".toolbar, .etb, .ask-ai, .chat, .board-resize, [contenteditable=true], .share-btn").count(), 0);
    await page.dblclick('.board[data-file="scr-32.html"] .board-frame');
    await wait(200);
    assert.equal(await page.locator(".board.editing, [contenteditable=true]").count(), 0);
    // No element selection at all: a click or hover on a board draws no outline and no element toolbar
    const fb = await page.locator('.board[data-file="scr-32.html"] .board-frame').boundingBox();
    await page.mouse.move(fb.x + fb.width / 2, fb.y + 120);
    await page.mouse.click(fb.x + fb.width / 2, fb.y + 120);
    await wait(200);
    assert.equal(await page.locator(".box.hover, .box.sel, .etb, .el-move").count(), 0);
    // Dragging a board pans the view instead of moving it
    const before = await page.locator('.board[data-file="scr-32.html"]').getAttribute("style");
    const box = await page.locator('.board[data-file="scr-32.html"] .board-frame').boundingBox();
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 90, { steps: 4 });
    await page.mouse.up();
    assert.equal(await page.locator('.board[data-file="scr-32.html"]').getAttribute("style"), before);
    assert.ok(!requests.some((u) => /\/api\/|\/ws\b|\/_app\//.test(u)), requests.join("\n"));
    assert.ok(requests.every((u) => u.startsWith(srv.url) || u.startsWith("data:") || u.startsWith("about:")), requests.join("\n"));
    assert.deepEqual(errors, []);
  } finally {
    await viewer.close();
    await srv.close();
  }
});

test("the single file opens from file://: boards render from inline HTML, Play follows a link, nothing is fetched", async () => {
  const { page: editor } = env;
  if (!(await editor.$(".share-pop"))) await editor.click(".share-btn");
  await editor.click(".share-pop .seg >> text=Whole canvas");
  await editor.click(".share-pop .switch");
  await editor.click(".share-pop .out-row.first > button.primary");
  await editor.waitForSelector(".share-pop .out-row.first .result");
  assert.match(await editor.locator(".share-pop .out-row.first .result").textContent(), /canvas\.html saved/);
  await editor.keyboard.press("Escape");
  const file = (await fs.readdir(path.join(env.dir, "easel-export"))).find((f) => f.endsWith("-canvas.html"));
  assert.ok(file);

  const viewer = await env.page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const page = await viewer.newPage();
  page.setDefaultTimeout(15000);
  const requests = [];
  const errors = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto("file://" + path.join(env.dir, "easel-export", file));
    await page.waitForFunction(() => document.querySelectorAll(".board iframe[srcdoc]").length === 3 && [...document.querySelectorAll(".board iframe")].every((f) => f.contentDocument?.body?.children.length));
    await page.waitForSelector('.board[data-file="scr-02.html"] .pin');
    // Play from scr-02 and follow its link to scr-32 (inline screens navigate inside the viewer)
    await page.click('.board-list button[title="scr-02.html"]');
    await page.click(".play-btn");
    await page.waitForFunction(() => !!document.querySelector(".play-frame")?.contentDocument?.querySelector('a[href="scr-32.html"]'));
    await page.frameLocator(".play-frame").locator('a[href="scr-32.html"]').first().click();
    await page.waitForFunction(() => document.querySelector(".play-bar .muted")?.textContent === "scr-32.html");
    await page.keyboard.press("Escape");
    assert.ok(requests.every((u) => /^(file|data|about):/.test(u)), requests.join("\n"));
    assert.deepEqual(errors, []);
  } finally {
    await viewer.close();
  }
});
