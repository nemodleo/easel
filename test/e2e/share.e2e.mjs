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
  const sel = await page.$$eval(".oc-left .board-list .row.on", (r) => r.length);
  assert.equal(await page.locator(".share-pop .oc-seg [aria-checked=true]").textContent(), sel ? `Selected boards (${sel})` : "Whole canvas");
  await page.click(".share-pop .oc-seg >> text=Whole canvas");
  assert.equal(await page.locator(".share-pop .oc-pfoot code").textContent(), "npx easel-canvas export");
  await page.click(".share-pop .oc-seg >> text=This page");
  assert.match(await page.locator(".share-pop .oc-pfoot code").textContent(), /^npx easel-canvas export --page Default$/);
  await page.click(".share-pop .oc-seg >> text=Whole canvas");
  await page.click(".share-pop .switch");
  assert.match(await page.locator(".share-pop .oc-pfoot code").textContent(), /--single-file$/);
  await page.waitForFunction(() => /\d+ KB/.test(document.querySelector(".share-pop .oc-orow.first .oc-otext")?.textContent ?? ""));
  await page.click(".share-pop .switch");
  // Ask AI stays the only filled button on the cards and the dock
  const filled = await page.$$eval(":is(.oc-card, .oc-dock) button:not(.share-pop *)", (bs) => bs.filter((b) => getComputedStyle(b).backgroundColor === getComputedStyle(document.querySelector(".ask-ai")).backgroundColor && b.offsetParent).map((b) => b.className));
  assert.deepEqual(filled, ["ask-ai "]);

  await page.click(".share-pop .oc-orow.first > .btn");
  await page.waitForSelector(".share-pop .oc-orow.first .oc-res");
  const line = await page.locator(".share-pop .oc-orow.first .oc-res").textContent();
  assert.match(line, /easel-export\/ exported/);
  assert.match(line, /Reveal/);
  assert.match(line, /Copy deploy command/);
  for (const f of ["index.html", "easel-viewer/viewer.js", "easel-viewer/data.js", "screens/scr-02.html"]) await fs.access(path.join(env.dir, "easel-export", f));

  await page.keyboard.press("Escape");
  await page.waitForSelector(".share-pop", { state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("share-btn")), true);
  // The result is still there when the popover opens again
  await page.click(".share-btn");
  await page.waitForSelector(".share-pop .oc-orow.first .oc-res");
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
    assert.match((await page.locator(".oc-stamp").textContent()).trim(), /^View only · exported /);
    assert.equal(await page.locator(".oc-made a").getAttribute("href"), "https://github.com/nemodleo/easel");
    // Comment: a pin on the board and the list on the right, opened as a thread
    await page.waitForSelector('.board[data-file="scr-02.html"] .pin');
    assert.match(await page.locator(".c-item").first().textContent(), /Mina.*Make the list denser/);
    await page.click(".c-item");
    await page.waitForSelector(".thread");
    assert.match(await page.locator(".thread").textContent(), /Make the list denser/);
    // Pages switch
    await page.click(".oc-left .oc-tabs >> text=Flow");
    await page.waitForFunction(() => document.querySelectorAll(".board").length === 1 && !!document.querySelector('.board[data-file="scr-32.html"] iframe'));
    // Play opens the board full screen
    await page.click(".play-btn");
    await page.waitForSelector(".play .play-frame");
    await page.waitForFunction(() => !!document.querySelector(".play-frame")?.contentDocument?.body?.children.length);
    await page.keyboard.press("Escape");
    await page.waitForSelector(".play", { state: "detached" });
    // Read-only: no tools in the dock (only the stamp and Play), no element toolbar, no inspector or chat, nothing editable
    assert.equal(await page.locator(".toolbar, .oc-dock:not(.oc-vdock), .oc-vdock .tool, .new-board, .etb, .ask-ai, .chat, .board-resize, [contenteditable=true], .share-btn").count(), 0);
    assert.equal(await page.locator(".oc-dock").count(), 1, "the viewer's dock");
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

test("embedded (?embed&fit&inset&dock): no list or comments, the fit inside the clear area, the wheel stays with the host until a click", async () => {
  const srv = await staticServer(path.join(env.dir, "easel-export"));
  const host = await env.page.context().browser().newContext({ viewport: { width: 1200, height: 900 } });
  const page = await host.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    // A host page on the same server: a tall document with the copy in a 1000×600 frame, a card over its left 400px
    const src = `${srv.url}index.html?embed&fit=scr-02.html&inset=20,20,20,420&dock=left`;
    await page.route(`${srv.url}host.html`, (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><body style="margin:0;height:3000px"><iframe id="f" src="${src}" style="position:absolute;left:100px;top:100px;width:1000px;height:600px;border:0"></iframe></body>` }));
    await page.goto(`${srv.url}host.html`);
    const frame = page.frameLocator("#f");
    await frame.locator('.board[data-file="scr-02.html"] iframe').waitFor();
    await wait(400);
    // What the option takes away and keeps: no board list, comments or navigation card; the dock with the stamp, zoom and Play, at the left
    assert.equal(await frame.locator(".oc-left, .oc-right, .oc-nav").count(), 0);
    assert.equal(await frame.locator(".oc-vdock .oc-stamp, .oc-vdock .oc-vzoom, .oc-vdock .play-btn").count(), 3);
    const dock = await frame.locator(".oc-vdock").boundingBox();
    assert.equal(Math.round(dock.x), 100 + 12);
    assert.match(await frame.locator(".embed-hint").textContent(), /Click the canvas/);
    // Before a click the boards are out of the tab order: Tab goes from the host page to the frame's way in, then the dock
    assert.equal(await frame.locator(".canvas-wrap[inert]").count(), 1);
    // The opening view frames scr-02 inside the clear area (frame x 420…980, y 20…580), against its top-left corner
    const b = await frame.locator('.board[data-file="scr-02.html"] .board-frame').boundingBox();
    assert.ok(b.x >= 100 + 420 && b.x + b.width <= 100 + 980 + 1 && b.y >= 100 + 20 && b.y + b.height <= 100 + 580 + 1, JSON.stringify(b));
    assert.ok(b.x - (100 + 420) < 70, "starts at the clear area's left edge");
    // The wheel scrolls the host page before a click, and the canvas stays put
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 300);
    await wait(300);
    assert.equal(await page.evaluate(() => scrollY), 300);
    assert.deepEqual(await frame.locator('.board[data-file="scr-02.html"] .board-frame').boundingBox(), { ...b, y: b.y - 300 });
    await page.evaluate(() => scrollTo(0, 0));
    await wait(200);
    // A click takes it: now the wheel pans the canvas and the page stays
    await page.mouse.click(700, 400);
    await frame.locator(".viewer.embed-live").waitFor();
    assert.match(await frame.locator(".embed-hint").textContent(), /Esc/);
    assert.equal(await frame.locator(".canvas-wrap[inert]").count(), 0);
    await page.mouse.wheel(0, 200);
    await wait(300);
    assert.equal(await page.evaluate(() => scrollY), 0);
    const moved = await frame.locator('.board[data-file="scr-02.html"] .board-frame').boundingBox();
    assert.ok(Math.abs(moved.y - (b.y - 200)) < 2, `panned: ${moved.y} vs ${b.y - 200}`);
    // Esc gives it back, with focus on the frame's own way back in
    await page.keyboard.press("Escape");
    await frame.locator(".viewer.embed-live").waitFor({ state: "detached" });
    assert.equal(await frame.locator(".embed-gate:focus").count(), 1);
    // So does a click outside the frame
    await page.mouse.click(700, 400);
    await frame.locator(".viewer.embed-live").waitFor();
    await page.mouse.click(50, 800);
    await frame.locator(".viewer.embed-live").waitFor({ state: "detached" });
    // Play keeps to the clear area
    await frame.locator(".play-btn").click();
    const pl = await frame.locator(".play").boundingBox();
    assert.equal(Math.round(pl.x), 100 + 420);
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
  } finally {
    await host.close();
    await srv.close();
  }
});

test("the single file opens from file://: boards render from inline HTML, Play follows a link, nothing is fetched", async () => {
  const { page: editor } = env;
  if (!(await editor.$(".share-pop"))) await editor.click(".share-btn");
  await editor.click(".share-pop .oc-seg >> text=Whole canvas");
  await editor.click(".share-pop .switch");
  await editor.click(".share-pop .oc-orow.first > .btn");
  await editor.waitForSelector(".share-pop .oc-orow.first .oc-res");
  assert.match(await editor.locator(".share-pop .oc-orow.first .oc-res").textContent(), /canvas\.html saved/);
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
    // A with the editing taken out: a card for boards, one for comments, the navigation card, a dock with the stamp and Play.
    // Play is the one orange; the pins are ink
    assert.equal(await page.locator(".oc-left .oc-made, .oc-nav .oc-zoom, .oc-right.oc-cards .oc-clist, .oc-vdock .oc-stamp, .oc-vdock .play-btn").count(), 5);
    const filled = await page.evaluate(() => {
      const acc = getComputedStyle(document.querySelector(".play-btn")).backgroundColor;
      return [...document.querySelectorAll(".app *")].filter((e) => e.getClientRects().length && getComputedStyle(e).backgroundColor === acc).map((e) => String(e.className));
    });
    assert.deepEqual(filled, ["play-btn"]);
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
