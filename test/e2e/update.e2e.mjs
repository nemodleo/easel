// AI-generated with Claude Code, 2026-11-15, reviewed by Hyun Park
// New-version notice: with a newer version on the (stand-in) registry the canvas says so once at launch, as a toast with an ink
// dot and the command in mono, never the orange; Copy command or × puts it away until the next version; the terminal says it too.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

import { startEnv, wait } from "./helpers.mjs";

let env, registry, asked = 0;
before(async () => {
  // Stand-in for registry.npmjs.org/easel-canvas/latest; EASEL_UPDATE_URL also lets a source checkout ask
  registry = http.createServer((req, res) => (asked++, res.setHeader("content-type", "application/json"), res.end(JSON.stringify({ version: "9.9.0" }))));
  await new Promise((r) => registry.listen(0, "127.0.0.1", r));
  process.env.EASEL_UPDATE_URL = `http://127.0.0.1:${registry.address().port}/easel-canvas/latest`;
  try {
    env = await startEnv();
  } finally {
    delete process.env.EASEL_UPDATE_URL;
  }
});
after(async () => {
  await env?.close();
  registry?.close();
});

test("a newer version: a toast at launch with the command, until Copy command or ×; the terminal line too", async () => {
  const { page, url } = env;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const t = page.locator(".toast", { hasText: "Easel 9.9.0 is out" });
  await t.waitFor({ timeout: 8000 });
  assert.equal(await t.locator(".toast-dot").count(), 1, "news is an ink dot");
  assert.match(await t.locator(".toast-code").innerText(), /easel-canvas@latest$/);
  const dot = await t.locator(".toast-dot").evaluate((e) => getComputedStyle(e).backgroundColor);
  const accent = await page.evaluate(() => { const i = document.createElement("i"); i.style.color = "var(--accent)"; document.body.append(i); const c = getComputedStyle(i).color; i.remove(); return c; });
  assert.notEqual(dot, accent, "never the orange");
  assert.equal(await t.locator(".toast-action").innerText(), "Copy command");
  assert.equal(await t.locator(".toast-close").getAttribute("aria-label"), "Hide until the next version");
  assert.match(env.log(), /Easel 9\.9\.0 is out \(you have [\d.]+\)\. Update: .*easel-canvas@latest, then restart\./);

  // Not acted on: it comes back at the next launch
  await page.reload();
  await t.waitFor({ timeout: 8000 });
  await t.locator(".toast-action").click();
  await page.locator(".toast", { hasText: "Copied. Run it, then restart Easel" }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /easel-canvas@latest$/);

  // Copied: not again for this version
  await page.reload();
  await page.waitForSelector(".board");
  await wait(1500);
  assert.equal(await t.count(), 0);
  assert.equal(asked, 1, "the registry was asked once; the answer is kept for a day");
});

test("× hides it until the next version", async () => {
  const { page, url } = env;
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const t = page.locator(".toast", { hasText: "Easel 9.9.0 is out" });
  await t.waitFor({ timeout: 8000 });
  await t.locator(".toast-close").click();
  assert.equal(await t.count(), 0);
  await page.reload();
  await page.waitForSelector(".board");
  await wait(1500);
  assert.equal(await t.count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem("design-canvas:update-seen")), "9.9.0");
});
