// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// The one shared headless Chromium (playwright, an optional dependency) behind screenshots, thumbnails and PDF/PNG export.
// Launched on first use (never at server start), shared by concurrent first calls, one fresh context per render, at most
// MAX_PAGES renders at a time (the rest wait), closed after EASEL_BROWSER_IDLE_SECONDS without a render, and launched again
// after it dies or is killed (a render that hits a dead browser is tried once more on a new one). Files from other hosts
// (web fonts, CDN images) are cached across renders while the browser is up (createRemoteCache).
import { existsSync } from "node:fs";

/** Default seconds without a render before the browser is closed (EASEL_BROWSER_IDLE_SECONDS overrides; 0 closes right away) */
export const IDLE_SECONDS = 120;
/** Renders open at once across screenshots, thumbnails and export; more wait in line */
export const MAX_PAGES = 4;

export function idleMsFromEnv(env = process.env) {
  const v = Number(env.EASEL_BROWSER_IDLE_SECONDS);
  return (env.EASEL_BROWSER_IDLE_SECONDS != null && env.EASEL_BROWSER_IDLE_SECONDS !== "" && Number.isFinite(v) && v >= 0 ? v : IDLE_SECONDS) * 1000;
}

const loadPlaywright = () =>
  import("playwright").catch(() => {
    throw Object.assign(new Error("Screenshots are unavailable because playwright is not installed (npm run design:install)"), { status: 501 });
  });

async function launchChromium() {
  const { chromium } = await loadPlaywright();
  // Fall back to the installed Chrome if no downloaded Chromium exists
  return chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const maxAgeOf = (cc) => {
  if (/(^|,)\s*(no-store|no-cache|private)\b/i.test(cc)) return 0;
  const m = /(?:^|,)\s*(?:s-maxage|max-age)\s*=\s*(\d+)/i.exec(cc);
  return m ? Number(m[1]) : 0;
};

/**
 * HTTP cache for files boards load from other hosts (web fonts, font CSS, CDN images), shared by every render while the
 * browser is up. Each render has a fresh context, and a fresh context starts with an empty HTTP cache, so without this a
 * board using a 2 MB CDN font downloaded it again for every thumbnail. Only GETs from non-loopback hosts are routed (the
 * canvas's own files are no-store and stay direct). Kept: 200 responses with a positive max-age, no no-store/no-cache/
 * private, no Set-Cookie, no Vary beyond Accept-Encoding/Origin, at most maxEntryBytes, maxBytes in all (oldest out first),
 * keyed by URL and Origin (the CORS answer depends on it). Requests with cookies or Authorization go straight through.
 */
export const isRemoteUrl = (u) => (u.protocol === "http:" || u.protocol === "https:") && !LOOPBACK.has(u.hostname);

export function createRemoteCache({ maxBytes = 64 * 1048576, maxEntryBytes = 8 * 1048576, now = () => Date.now(), routes = isRemoteUrl } = {}) {
  const entries = new Map(); // key -> { status, headers, body, expires }; Map order = age
  const inflight = new Map();
  let bytes = 0;
  const drop = (k) => {
    const e = entries.get(k);
    if (e) (bytes -= e.body.length), entries.delete(k);
  };
  const cacheable = (res, body) => {
    if (res.status !== 200 || body.length > maxEntryBytes) return 0;
    const h = res.headers;
    if (h["set-cookie"]) return 0;
    if (h.vary && h.vary.split(",").some((v) => !/^\s*(accept-encoding|origin)\s*$/i.test(v))) return 0;
    return maxAgeOf(h["cache-control"] ?? "");
  };
  async function fetchVia(route, key) {
    const r = await route.fetch();
    const res = { status: r.status(), headers: r.headers(), body: await r.body() };
    const age = cacheable(res, res.body);
    if (age > 0) {
      const { "set-cookie": _, ...headers } = res.headers;
      drop(key);
      entries.set(key, { ...res, headers, expires: now() + age * 1000 });
      bytes += res.body.length;
      for (const k of entries.keys()) {
        if (bytes <= maxBytes) break;
        drop(k);
      }
    }
    return res;
  }
  /** The page.route handler */
  async function handle(route) {
    const req = route.request();
    const h = req.headers();
    if (req.method() !== "GET" || h.cookie || h.authorization) return route.continue().catch(() => {});
    const key = `${req.url()}\n${h.origin ?? ""}`;
    try {
      let hit = entries.get(key);
      if (hit && hit.expires <= now()) drop(key), (hit = null);
      if (hit) {
        entries.delete(key), entries.set(key, hit); // most recently used goes last
      } else {
        // Two renders asking for the same font at once share one download
        let p = inflight.get(key);
        if (!p) {
          p = fetchVia(route, key).finally(() => inflight.delete(key));
          inflight.set(key, p);
        }
        hit = await p;
      }
      await route.fulfill({ status: hit.status, headers: hit.headers, body: hit.body });
    } catch {
      await route.continue().catch(() => {}); // a failed fetch or a closed page: let the browser deal with it
    }
  }
  return {
    handle,
    /** Routed URLs: http(s) on a host other than this machine */
    routes,
    clear() {
      entries.clear();
      bytes = 0;
    },
    stats: () => ({ entries: entries.size, bytes }),
  };
}

/**
 * The pool. launch() returns a playwright-like Browser (isConnected, on("disconnected"), newPage(opts), close).
 * timers is injectable so tests drive the idle close without waiting.
 */
export function createBrowserPool({ launch = launchChromium, idleMs = idleMsFromEnv(), maxPages = MAX_PAGES, timers = globalThis, remoteCache = createRemoteCache() } = {}) {
  let browserPromise = null;
  let idleTimer = null;
  let active = 0; // pages open (each holds a slot)
  const waiting = [];

  const clearIdle = () => {
    if (idleTimer) timers.clearTimeout(idleTimer);
    idleTimer = null;
  };
  // Armed whenever nothing is rendering and a browser is up; must not keep the Node process alive
  const armIdle = () => {
    clearIdle();
    if (active > 0 || waiting.length || !browserPromise) return;
    const p = browserPromise;
    idleTimer = timers.setTimeout(() => {
      idleTimer = null;
      if (active === 0 && !waiting.length && browserPromise === p) void close();
    }, idleMs);
    idleTimer?.unref?.();
  };

  async function getBrowser() {
    clearIdle();
    // A browser that exited behind our back (crash, killed, sleep) must not stay cached, or every render fails until a restart
    const pending = browserPromise;
    const cached = pending && (await pending.catch(() => null));
    if (cached && !cached.isConnected() && browserPromise === pending) browserPromise = null;
    if (!browserPromise) {
      const p = (browserPromise = (async () => {
        const b = await launch();
        b.on("disconnected", () => {
          if (browserPromise === p) browserPromise = null;
        });
        return b;
      })());
      // A failed launch is not kept: installing a browser later works without a restart
      p.catch(() => {
        if (browserPromise === p) browserPromise = null;
      });
    }
    const b = await browserPromise;
    armIdle(); // browserStatus() launches without a render: still closed when idle
    return b;
  }

  async function close() {
    clearIdle();
    remoteCache?.clear(); // the cache lives as long as the browser
    const b = await browserPromise?.catch(() => null);
    browserPromise = null;
    await b?.close().catch(() => {});
  }

  const acquire = () =>
    new Promise((resolve) => {
      clearIdle();
      if (active < maxPages) {
        active++;
        resolve();
      } else waiting.push(resolve);
    });
  const release = () => {
    const next = waiting.shift();
    if (next) next(); // hand the slot over
    else {
      active--;
      armIdle();
    }
  };

  /** A page in its own fresh context (cookies, storage, viewport, color scheme, scale never leak between renders). Holds a slot until the page or its context closes */
  async function newPage(opts) {
    await acquire();
    let released = false;
    const free = () => {
      if (!released) (released = true), release();
    };
    try {
      let browser = await getBrowser();
      let page;
      try {
        page = await browser.newPage(opts);
      } catch (e) {
        if (browser.isConnected()) throw e;
        browser = await getBrowser(); // drops the dead one and launches again
        page = await browser.newPage(opts);
      }
      if (remoteCache && page.route) await page.route(remoteCache.routes, remoteCache.handle).catch((e) => page.close().catch(() => {}).then(() => Promise.reject(e)));
      // browser.newPage owns its context: closing the page closes it; the context also closes when the browser goes away
      const ctx = page.context?.();
      if (ctx?.once) ctx.once("close", free);
      page.once?.("close", free);
      return page;
    } catch (e) {
      free();
      throw Object.assign(e, { opening: true });
    }
  }

  /** Runs fn(page) on a fresh page and closes it. If the browser died during the render, tries once more on a new one */
  async function withPage(opts, fn) {
    for (let attempt = 0; ; attempt++) {
      const page = await newPage(opts);
      const browser = page.context?.().browser?.();
      try {
        return await fn(page);
      } catch (e) {
        if (attempt === 0 && browser && !browser.isConnected()) continue;
        throw e;
      } finally {
        await page.close().catch(() => {});
      }
    }
  }

  return {
    getBrowser,
    newPage,
    withPage,
    close,
    /** For tests: the browser currently cached, if any */
    cached: () => browserPromise?.catch(() => null) ?? Promise.resolve(null),
    stats: () => ({ active, waiting: waiting.length, idleArmed: !!idleTimer }),
  };
}

const pool = createBrowserPool();
export const getBrowser = pool.getBrowser;
export const newPage = pool.newPage;
export const withPage = pool.withPage;
/** Close the Chromium used for screenshots/thumbnails/export when the server stops (otherwise it becomes an orphan process) */
export const closeBrowser = pool.close;
/** For tests: the browser currently cached for screenshots, if any */
export const cachedBrowser = pool.cached;

/**
 * Goes to url and waits until the board has settled: the load event, web fonts, then no request in flight for quietMs.
 * Replaces waitUntil "networkidle", whose fixed 500 ms quiet window was most of every screenshot. A page that never goes
 * quiet (polling) is captured after maxWaitMs instead of failing.
 */
export async function gotoSettled(page, url, { timeout = 30000, quietMs = 100, maxWaitMs = 5000 } = {}) {
  const inflight = new Set();
  const on = (r) => inflight.add(r);
  const off = (r) => inflight.delete(r);
  page.on("request", on);
  page.on("requestfinished", off);
  page.on("requestfailed", off);
  try {
    await page.goto(url, { waitUntil: "load", timeout });
    await page.evaluate(() => document.fonts?.ready.then(() => undefined)).catch(() => {});
    const end = Date.now() + maxWaitMs;
    let quietSince = Date.now();
    while (Date.now() < end) {
      if (inflight.size) quietSince = Date.now();
      else if (Date.now() - quietSince >= quietMs) break;
      await new Promise((r) => setTimeout(r, 20));
    }
  } finally {
    page.off("request", on);
    page.off("requestfinished", off);
    page.off("requestfailed", off);
  }
}

/** Can PDF/PNG export run here? { ok } or { ok: false, reason } in one line, without launching when the downloaded Chromium is on disk */
export async function browserStatus() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { ok: false, reason: "Needs Playwright: npm i playwright" };
  }
  if (existsSync(chromium.executablePath())) return { ok: true };
  // No downloaded Chromium: the installed Chrome may still work (getBrowser falls back to it)
  return getBrowser().then(
    () => ({ ok: true }),
    () => ({ ok: false, reason: "Needs Chromium: npx playwright install chromium" }),
  );
}
