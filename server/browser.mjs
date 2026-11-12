// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// The one shared headless Chromium (playwright, an optional dependency) behind screenshots, thumbnails and PDF/PNG export.
import { existsSync } from "node:fs";

let browserPromise = null;
/** Close the Chromium used for screenshots/thumbnails when the server stops (otherwise it becomes an orphan process) */
export async function closeBrowser() {
  const b = await browserPromise?.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}

const loadPlaywright = () =>
  import("playwright").catch(() => {
    throw Object.assign(new Error("Screenshots are unavailable because playwright is not installed (npm run design:install)"), { status: 501 });
  });

export async function getBrowser() {
  // A browser that exited behind our back (crash, killed, sleep) must not stay cached, or every thumbnail fails until a restart
  const pending = browserPromise;
  const cached = pending && (await pending.catch(() => null));
  if (cached && !cached.isConnected() && browserPromise === pending) browserPromise = null;
  if (!browserPromise) {
    const p = (browserPromise = (async () => {
      const { chromium } = await loadPlaywright();
      // Fall back to the installed Chrome if no downloaded Chromium exists
      const b = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
      b.on("disconnected", () => {
        if (browserPromise === p) browserPromise = null;
      });
      return b;
    })());
    p.catch(() => {
      if (browserPromise === p) browserPromise = null;
    });
  }
  return browserPromise;
}

/** New page on the shared browser; if the browser died since it was cached, launch a fresh one and try once more */
export async function newPage(opts) {
  const browser = await getBrowser();
  try {
    return await browser.newPage(opts);
  } catch (e) {
    if (browser.isConnected()) throw e;
    return (await getBrowser()).newPage(opts); // getBrowser drops the dead one and launches again
  }
}

/** For tests: the browser currently cached for screenshots, if any */
export const cachedBrowser = () => browserPromise?.catch(() => null) ?? Promise.resolve(null);

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
