// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// The one shared headless Chromium (playwright, an optional dependency) behind screenshots, thumbnails and PDF/PNG export.
// Launched on first use (never at server start), shared by concurrent first calls, one fresh context per render, at most
// MAX_PAGES renders at a time (the rest wait), closed after EASEL_BROWSER_IDLE_SECONDS without a render, and launched again
// after it dies or is killed (a render that hits a dead browser is tried once more on a new one).
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

/**
 * The pool. launch() returns a playwright-like Browser (isConnected, on("disconnected"), newPage(opts), close).
 * timers is injectable so tests drive the idle close without waiting.
 */
export function createBrowserPool({ launch = launchChromium, idleMs = idleMsFromEnv(), maxPages = MAX_PAGES, timers = globalThis } = {}) {
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
