// AI-generated with Claude Code, 2026-11-06, reviewed by Hyun Park
// Thumbnail sizes (#8), the shared screenshot browser coming back after it dies (#7), and the queue (newest first, a job nobody waits for is dropped)
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { formatBoard } from "../server/boardFormat.mjs";
import { createServer } from "../server/index.mjs";
import { cachedBrowser, closeBrowser, createThumbQueue, extraRoutes, newPage, thumbPx } from "../server/routes.mjs";

after(() => closeBrowser());

test("thumbPx snaps to the next size up, defaults to 600 and caps at 2400", () => {
  assert.equal(thumbPx(null), 600);
  assert.equal(thumbPx("abc"), 600);
  assert.equal(thumbPx("1"), 600);
  assert.equal(thumbPx("600"), 600);
  assert.equal(thumbPx("601"), 1200);
  assert.equal(thumbPx("2400"), 2400);
  assert.equal(thumbPx("99999"), 2400);
});

test("newPage launches a fresh browser after the cached one exits", async (t) => {
  const p1 = await newPage().catch(() => null);
  if (!p1) return t.skip("no Chromium for playwright");
  await p1.close();
  const b1 = await cachedBrowser();
  assert.ok(b1?.isConnected());
  await b1.close(); // the browser goes away behind the server's back
  const p2 = await newPage();
  try {
    assert.equal(await p2.evaluate(() => 1 + 1), 2);
    const b2 = await cachedBrowser();
    assert.notEqual(b2, b1);
    assert.ok(b2.isConnected());
  } finally {
    await p2.close();
  }
});

test("a thumbnail whose request closed before its turn is still rendered (the job keeps the server's port)", async (t) => {
  const probe = await newPage().catch(() => null);
  if (!probe) return t.skip("no Chromium for playwright");
  await probe.close();
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "dc-thumb-")));
  const prevHome = process.env.EASEL_HOME;
  process.env.EASEL_HOME = path.join(root, "easel-home");
  const dir = path.join(root, "design");
  await fs.mkdir(path.join(dir, "screens"), { recursive: true });
  await fs.writeFile(path.join(dir, "screens/a.html"), "<!doctype html><title>A</title><body style='background:#c33'>A</body>");
  await fs.writeFile(path.join(dir, "board.json"), formatBoard({ version: 1, title: "t", order: ["a.html"], boards: { "a.html": { x: 0, y: 0, w: 200, h: 300 } }, notes: {} }));
  const port = await new Promise((r) => {
    const s = net.createServer().listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
  const app = await createServer({ dir, port, dev: false, extraRoutes });
  try {
    // The browser gives up on the image (a board scrolled away, a closed tab) right after asking
    await new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/api/thumb?f=a.html&v=0&px=600`);
      req.on("error", () => {});
      req.on("socket", (s) => s.on("connect", () => setTimeout(() => (req.destroy(), resolve()), 20)));
    });
    let made = [];
    for (let i = 0; i < 150 && !made.length; i++) {
      await new Promise((r) => setTimeout(r, 100));
      made = (await fs.readdir(path.join(dir, ".thumbs")).catch(() => [])).filter((n) => n.endsWith(".jpg"));
    }
    assert.equal(made.length, 1, "the thumbnail was rendered and cached for the next request");
  } finally {
    await app.close();
    if (prevHome == null) delete process.env.EASEL_HOME;
    else process.env.EASEL_HOME = prevHome;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the thumbnail queue runs the newest waiting job first and drops ones nobody waits for", async () => {
  const q = createThumbQueue(1);
  const order = [];
  let release;
  const first = q.push(() => new Promise((r) => (release = r)).then(() => order.push("a")));
  const gone = { b: false, c: false, d: false };
  const jobs = ["b", "c", "d"].map((k) => q.push(async () => order.push(k), () => gone[k]).catch((e) => (e.dropped ? `dropped ${k}` : Promise.reject(e))));
  gone.c = true; // its board scrolled away before its turn
  assert.deepEqual(q.stats(), { running: 1, waiting: 3 });
  release();
  await first;
  assert.deepEqual(await Promise.all(jobs), [3, "dropped c", 2]);
  assert.deepEqual(order, ["a", "d", "b"]);
  assert.deepEqual(q.stats(), { running: 0, waiting: 0 });
});

test("a started thumbnail job finishes even if its request closes", async () => {
  const q = createThumbQueue(2);
  let gone = false;
  const p = q.push(async () => {
    gone = true;
    await new Promise((r) => setImmediate(r));
    return "made";
  }, () => gone);
  assert.equal(await p, "made");
});
