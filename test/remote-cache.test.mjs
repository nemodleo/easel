// AI-generated with Claude Code, 2026-11-27, reviewed by Hyun Park
// The cache of files boards load from other hosts (web fonts, CDN images), shared by renders that each have a fresh context
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";

import { createBrowserPool, createRemoteCache, isRemoteUrl } from "../server/browser.mjs";

/** Fake playwright Route: fetch() answers with res and counts calls */
function fakeRoute(url, { method = "GET", headers = {}, res, counter }) {
  const r = { fulfilled: null, continued: false };
  r.request = () => ({ url: () => url, method: () => method, headers: () => headers });
  r.fetch = async () => {
    counter.n++;
    await new Promise((x) => setImmediate(x));
    if (res instanceof Error) throw res;
    return { status: () => res.status ?? 200, headers: () => res.headers ?? {}, body: async () => Buffer.from(res.body ?? "x") };
  };
  r.fulfill = async (v) => (r.fulfilled = v);
  r.continue = async () => (r.continued = true);
  return r;
}
const FONT = { headers: { "cache-control": "public, max-age=600", "content-type": "font/woff2" }, body: "font-bytes" };

test("a cacheable response is fetched once and served to later renders", async () => {
  const c = createRemoteCache();
  const counter = { n: 0 };
  for (let i = 0; i < 3; i++) {
    const r = fakeRoute("https://cdn.example/f.woff2", { res: FONT, counter });
    await c.handle(r);
    assert.equal(r.fulfilled.body.toString(), "font-bytes");
  }
  assert.equal(counter.n, 1);
});

test("two renders asking at once share one download", async () => {
  const c = createRemoteCache();
  const counter = { n: 0 };
  const rs = [1, 2, 3].map(() => fakeRoute("https://cdn.example/f.woff2", { res: FONT, counter }));
  await Promise.all(rs.map((r) => c.handle(r)));
  assert.equal(counter.n, 1);
  assert.ok(rs.every((r) => r.fulfilled));
});

test("not kept: no-store, no-cache, private, no max-age, Set-Cookie, Vary: Cookie, non-200; cookies and POST go straight through", async () => {
  const cases = [
    { "cache-control": "no-store, max-age=600" },
    { "cache-control": "no-cache" },
    { "cache-control": "private, max-age=600" },
    {},
    { "cache-control": "max-age=600", "set-cookie": "a=1" },
    { "cache-control": "max-age=600", vary: "Cookie" },
  ];
  for (const headers of cases) {
    const c = createRemoteCache();
    const counter = { n: 0 };
    await c.handle(fakeRoute("https://cdn.example/x", { res: { headers }, counter }));
    await c.handle(fakeRoute("https://cdn.example/x", { res: { headers }, counter }));
    assert.equal(counter.n, 2, JSON.stringify(headers));
  }
  const c = createRemoteCache();
  const counter = { n: 0 };
  await c.handle(fakeRoute("https://cdn.example/x", { res: { ...FONT, status: 404 }, counter }));
  await c.handle(fakeRoute("https://cdn.example/x", { res: FONT, counter }));
  assert.equal(counter.n, 2, "a 404 is not kept");
  const withCookie = fakeRoute("https://cdn.example/y", { headers: { cookie: "s=1" }, res: FONT, counter });
  await c.handle(withCookie);
  assert.ok(withCookie.continued && !withCookie.fulfilled);
  const post = fakeRoute("https://cdn.example/y", { method: "POST", res: FONT, counter });
  await c.handle(post);
  assert.ok(post.continued);
});

test("keyed by Origin, expires after max-age, oldest out past maxBytes, cleared with the browser", async () => {
  let t = 0;
  const c = createRemoteCache({ now: () => t, maxBytes: 25 });
  const counter = { n: 0 };
  const get = (url, origin) => c.handle(fakeRoute(url, { headers: origin ? { origin } : {}, res: FONT, counter }));
  await get("https://cdn.example/a", "http://127.0.0.1:1");
  await get("https://cdn.example/a", "http://127.0.0.1:2");
  assert.equal(counter.n, 2, "another origin gets its own CORS answer");
  t = 601_000;
  await get("https://cdn.example/a", "http://127.0.0.1:1");
  assert.equal(counter.n, 3, "expired");
  assert.ok(c.stats().bytes <= 25);
  await get("https://cdn.example/b");
  await get("https://cdn.example/c");
  assert.ok(c.stats().bytes <= 25 && c.stats().entries <= 2);
  c.clear();
  assert.deepEqual(c.stats(), { entries: 0, bytes: 0 });
});

test("a failed fetch falls back to the browser's own request", async () => {
  const c = createRemoteCache();
  const r = fakeRoute("https://cdn.example/a", { res: new Error("ECONNRESET"), counter: { n: 0 } });
  await c.handle(r);
  assert.ok(r.continued);
  assert.equal(c.stats().entries, 0);
});

test("only other hosts are routed: the canvas's own files stay direct", () => {
  assert.ok(isRemoteUrl(new URL("https://cdn.jsdelivr.net/x.css")));
  assert.ok(!isRemoteUrl(new URL("http://127.0.0.1:4321/screens/a.html")));
  assert.ok(!isRemoteUrl(new URL("http://localhost:4321/assets/f.woff2")));
  assert.ok(!isRemoteUrl(new URL("http://[::1]:4321/x")));
  assert.ok(!isRemoteUrl(new URL("data:font/woff2;base64,AAAA")));
});

/* ---------- Real Chromium: fresh contexts, shared font ---------- */
const pool = createBrowserPool({ remoteCache: createRemoteCache({ routes: (u) => u.hostname === "localhost" && u.port === String(cdnPort) }) });
let cdnPort = 0;
after(() => pool.close());

test("renders in fresh contexts download a cross-origin font once and share no storage", async (t) => {
  let fontHits = 0;
  const cdn = http.createServer((req, res) => {
    if (req.url === "/f.css") {
      res.writeHead(200, { "content-type": "text/css", "cache-control": "public, max-age=600", "access-control-allow-origin": "*" });
      return res.end("@font-face{font-family:F;src:url(/f.woff2)}");
    }
    fontHits++;
    res.writeHead(200, { "content-type": "font/woff2", "cache-control": "public, max-age=600", "access-control-allow-origin": "*" });
    res.end(Buffer.alloc(4096));
  });
  const site = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    res.end(`<!doctype html><link rel=stylesheet href="http://localhost:${cdnPort}/f.css"><body style="font-family:F">x</body>`);
  });
  await new Promise((r) => cdn.listen(0, "127.0.0.1", r));
  await new Promise((r) => site.listen(0, "127.0.0.1", r));
  cdnPort = cdn.address().port;
  const url = `http://127.0.0.1:${site.address().port}/`;
  try {
    const seen = [];
    for (let i = 0; i < 3; i++) {
      try {
        seen.push(
          await pool.withPage({ viewport: { width: 200, height: 100 }, deviceScaleFactor: 1 + i * 0.5 }, async (page) => {
            await page.goto(url, { waitUntil: "load" });
            await page.evaluate(() => document.fonts.ready);
            const before = await page.evaluate(() => localStorage.getItem("k"));
            await page.evaluate((i) => localStorage.setItem("k", String(i)), i);
            return { before, dpr: await page.evaluate(() => devicePixelRatio) };
          }),
        );
      } catch (e) {
        if (e.opening) return t.skip("no Chromium for playwright");
        throw e;
      }
    }
    assert.equal(fontHits, 1, "the font came over the network once for three renders");
    assert.deepEqual(seen.map((s) => s.before), [null, null, null], "storage does not leak between renders");
    assert.deepEqual(seen.map((s) => s.dpr), [1, 1.5, 2], "each render keeps its own scale");
  } finally {
    cdn.close();
    site.close();
  }
});
