// AI-generated with Claude Code, 2026-11-27, reviewed by Hyun Park
// The shared screenshot browser (server/browser.mjs) with a fake launcher and fake timers: one launch under concurrency,
// idle close, relaunch after a disconnect, one retry for a render that hit a dead browser, the page bound, shutdown
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { createBrowserPool, gotoSettled, idleMsFromEnv, IDLE_SECONDS } from "../server/browser.mjs";

/** Fake playwright Browser: newPage gives a page in its own context; kill() is the process dying */
function fakeBrowser(log) {
  const b = new EventEmitter();
  let connected = true;
  b.pages = [];
  b.isConnected = () => connected;
  b.kill = () => {
    if (!connected) return;
    connected = false;
    for (const p of b.pages) p.context().emit("close");
    b.emit("disconnected");
  };
  b.close = async () => {
    log.push("close");
    b.kill();
  };
  b.newPage = async (opts) => {
    if (!connected) throw new Error("Target page, context or browser has been closed");
    const ctx = new EventEmitter();
    ctx.browser = () => b;
    const page = new EventEmitter();
    page.opts = opts;
    page.context = () => ctx;
    page.close = async () => {
      page.emit("close");
      ctx.emit("close");
    };
    b.pages.push(page);
    return page;
  };
  return b;
}

function fakeTimers() {
  const timers = new Set();
  return {
    setTimeout(fn, ms) {
      const t = { fn, ms, unref() { this.unrefed = true; return this; } };
      timers.add(t);
      return t;
    },
    clearTimeout(t) {
      timers.delete(t);
    },
    pending: () => [...timers],
    fire() {
      const all = [...timers];
      timers.clear();
      for (const t of all) t.fn();
    },
  };
}

function setup(opts = {}) {
  const log = [];
  const browsers = [];
  let launches = 0;
  const timers = fakeTimers();
  const pool = createBrowserPool({
    idleMs: 60000,
    timers,
    ...opts,
    launch: async () => {
      launches++;
      log.push("launch");
      if (opts.launch) return opts.launch(launches);
      await new Promise((r) => setImmediate(r)); // launches take a moment, so concurrent callers overlap
      const b = fakeBrowser(log);
      browsers.push(b);
      return b;
    },
  });
  return { pool, log, browsers, timers, launches: () => launches };
}
const tick = () => new Promise((r) => setImmediate(r));

test("nothing launches until the first render, and concurrent first renders share one launch", async () => {
  const { pool, launches } = setup();
  assert.equal(launches(), 0);
  await Promise.all([1, 2, 3].map(() => pool.withPage({}, async () => {})));
  assert.equal(launches(), 1);
  await pool.close();
});

test("every render gets a fresh page with its own options, closed afterwards", async () => {
  const { pool, browsers } = setup();
  const seen = [];
  await pool.withPage({ viewport: { width: 10, height: 20 }, colorScheme: "dark" }, async (p) => seen.push(p));
  await pool.withPage({ viewport: { width: 30, height: 40 } }, async (p) => seen.push(p));
  assert.notEqual(seen[0], seen[1]);
  assert.notEqual(seen[0].context(), seen[1].context());
  assert.deepEqual(seen.map((p) => p.opts), [{ viewport: { width: 10, height: 20 }, colorScheme: "dark" }, { viewport: { width: 30, height: 40 } }]);
  assert.equal(browsers[0].pages.length, 2);
  assert.equal(pool.stats().active, 0);
  await pool.close();
});

test("closed after the idle period with an unref'd timer, and launched again on the next render", async () => {
  const { pool, log, timers, launches } = setup();
  await pool.withPage({}, async () => {});
  const [t] = timers.pending();
  assert.equal(t.ms, 60000);
  assert.ok(t.unrefed, "the idle timer must not keep Node alive");
  timers.fire();
  await tick();
  assert.deepEqual(log, ["launch", "close"]);
  assert.equal(await pool.cached(), null);
  await pool.withPage({}, async () => {});
  assert.equal(launches(), 2);
  await pool.close();
});

test("no idle close while a render is running; the timer starts again when the last one ends", async () => {
  const { pool, log, timers } = setup();
  let finish;
  const running = pool.withPage({}, () => new Promise((r) => (finish = r)));
  await tick();
  await tick();
  assert.equal(timers.pending().length, 0);
  finish();
  await running;
  assert.equal(timers.pending().length, 1);
  await pool.withPage({}, async () => {}); // a render in between restarts the wait, it does not stack timers
  assert.equal(timers.pending().length, 1);
  assert.ok(!log.includes("close"));
  await pool.close();
  assert.equal(timers.pending().length, 0, "shutdown clears the idle timer");
});

test("a browser that disconnected is dropped and the next render launches a new one", async () => {
  const { pool, browsers, launches } = setup();
  await pool.withPage({}, async () => {});
  browsers[0].kill();
  await pool.withPage({}, async () => {});
  assert.equal(launches(), 2);
  assert.equal(await pool.cached(), browsers[1]);
  await pool.close();
});

test("a render that hits a dead browser is tried once more on a new one", async () => {
  const { pool, browsers } = setup();
  let calls = 0;
  const r = await pool.withPage({}, async (p) => {
    calls++;
    if (calls === 1) {
      p.context().browser().kill();
      throw new Error("Target page, context or browser has been closed");
    }
    return "ok";
  });
  assert.equal(r, "ok");
  assert.equal(calls, 2);
  assert.equal(browsers.length, 2);
  assert.equal(pool.stats().active, 0);
  await pool.close();
});

test("only once: a second dead browser, or an ordinary error, is passed on", async () => {
  const { pool } = setup();
  let calls = 0;
  await assert.rejects(
    pool.withPage({}, async (p) => {
      calls++;
      p.context().browser().kill();
      throw new Error("gone");
    }),
    /gone/,
  );
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    pool.withPage({}, async () => {
      calls++;
      throw new Error("Element not found");
    }),
    /Element not found/,
  );
  assert.equal(calls, 1, "no retry when the browser is fine");
  assert.equal(pool.stats().active, 0);
  await pool.close();
});

test("at most maxPages renders at once; the rest wait in line", async () => {
  const { pool } = setup({ maxPages: 2 });
  let open = 0;
  let peak = 0;
  const gates = [];
  const jobs = Array.from({ length: 12 }, () =>
    pool.withPage({}, async () => {
      open++;
      peak = Math.max(peak, open);
      await new Promise((r) => gates.push(r));
      open--;
    }),
  );
  for (let i = 0; i < 50 && gates.length < 2; i++) await tick();
  assert.equal(pool.stats().active, 2);
  assert.equal(pool.stats().waiting, 10);
  while (gates.length || pool.stats().active) {
    gates.shift()?.();
    await tick();
  }
  await Promise.all(jobs);
  assert.equal(peak, 2);
  assert.deepEqual(pool.stats(), { active: 0, waiting: 0, idleArmed: true });
  await pool.close();
});

test("a slot held by newPage is given back when the page closes or the browser goes away", async () => {
  const { pool, browsers } = setup({ maxPages: 1 });
  const p = await pool.newPage();
  assert.equal(pool.stats().active, 1);
  await p.close();
  assert.equal(pool.stats().active, 0);
  await pool.newPage();
  browsers[0].kill();
  assert.equal(pool.stats().active, 0);
  await pool.close();
});

test("a failed launch is not kept: the next render tries again", async () => {
  let fail = true;
  const log = [];
  const { pool, launches } = setup({
    launch: async () => {
      if (fail) throw new Error("Executable doesn't exist at /nowhere/chrome");
      return fakeBrowser(log);
    },
  });
  await assert.rejects(pool.withPage({}, async () => {}), (e) => e.opening && /Executable/.test(e.message));
  assert.equal(pool.stats().active, 0, "the slot is freed");
  fail = false; // a browser got installed meanwhile
  assert.equal(await pool.withPage({}, async () => 1), 1);
  assert.equal(launches(), 2);
  await pool.close();
});

test("close() shuts the browser and open pages; the pool still works afterwards", async () => {
  const { pool, log, browsers } = setup();
  const p = await pool.newPage();
  await pool.close();
  assert.ok(!browsers[0].isConnected());
  assert.equal(pool.stats().active, 0);
  assert.ok(p);
  await pool.close(); // twice is fine
  assert.equal(log.filter((l) => l === "close").length, 1);
  await pool.withPage({}, async () => {});
  assert.equal(browsers.length, 2);
  await pool.close();
});

test("getBrowser without a render (browserStatus) still closes when idle", async () => {
  const { pool, timers, log } = setup();
  await pool.getBrowser();
  assert.equal(timers.pending().length, 1);
  timers.fire();
  await tick();
  assert.deepEqual(log, ["launch", "close"]);
});

test("EASEL_BROWSER_IDLE_SECONDS sets the idle period", () => {
  assert.equal(idleMsFromEnv({}), IDLE_SECONDS * 1000);
  assert.equal(idleMsFromEnv({ EASEL_BROWSER_IDLE_SECONDS: "5" }), 5000);
  assert.equal(idleMsFromEnv({ EASEL_BROWSER_IDLE_SECONDS: "0" }), 0);
  assert.equal(idleMsFromEnv({ EASEL_BROWSER_IDLE_SECONDS: "" }), IDLE_SECONDS * 1000);
  assert.equal(idleMsFromEnv({ EASEL_BROWSER_IDLE_SECONDS: "soon" }), IDLE_SECONDS * 1000);
  assert.equal(idleMsFromEnv({ EASEL_BROWSER_IDLE_SECONDS: "-1" }), IDLE_SECONDS * 1000);
});

test("gotoSettled waits for requests the page starts after load", async () => {
  const page = new EventEmitter();
  page.off = page.removeListener;
  const req = {};
  let finishedAt = 0;
  page.goto = async (url, o) => {
    assert.equal(o.waitUntil, "load");
    setTimeout(() => page.emit("request", req), 5); // a fetch right after load
    setTimeout(() => {
      finishedAt = Date.now();
      page.emit("requestfinished", req);
    }, 60);
  };
  page.evaluate = async () => {};
  await gotoSettled(page, "http://x/", { quietMs: 30 });
  assert.ok(finishedAt > 0, "returned only after the late request finished");
  assert.equal(page.listenerCount("request"), 0, "listeners removed");
});
