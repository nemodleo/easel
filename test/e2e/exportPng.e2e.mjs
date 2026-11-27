// AI-generated with Claude Code, 2026-11-27
// Export PNG from the board's right-click menu (#2): the browser downloads <file>.png, a real PNG. While it renders the board shows
// it and the menu item is greyed out, so a second click starts nothing. With no headless browser the toast says what to install.
// board.json stays byte-identical and the app sends no save
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, before, test } from "node:test";

import { startEnv, wait } from "./helpers.mjs";

let env;
before(async () => (env = await startEnv()));
after(async () => env?.close());

const F = "scr-32.html";
const menuItem = (page, name) => page.getByRole("menu").getByRole("menuitem", { name });

test("Export PNG downloads scr-32.png, shows it is working meanwhile, and leaves board.json alone", async () => {
  const { page, url } = env;
  const saves = [];
  page.on("request", (r) => r.method() !== "GET" && r.url().includes("/api/board") && saves.push(`${r.method()} ${r.url()}`));
  // Hold the render a moment so the working state can be seen
  let shots = 0;
  await page.route("**/api/screenshot", async (route) => {
    shots++;
    await wait(1200);
    await route.continue();
  });
  await page.goto(url);
  await page.waitForSelector(".board");
  await wait(800);
  const before = await env.read("board.json");
  const label = page.locator(`.board[data-file="${F}"] .board-label`);
  await label.click({ button: "right" });
  const download = page.waitForEvent("download", { timeout: 60000 });
  await menuItem(page, "Export PNG").click();
  await page.locator(`.board[data-file="${F}"] .export-badge`).waitFor();
  await label.click({ button: "right" });
  const busy = menuItem(page, "Exporting PNG…");
  assert.ok(await busy.isDisabled(), "greyed out while rendering");
  await page.keyboard.press("Escape");

  const d = await download;
  assert.equal(d.suggestedFilename(), "scr-32.png");
  const bytes = await fs.readFile(await d.path());
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "PNG magic bytes");
  await page.getByText("Downloaded scr-32.png").waitFor();
  await page.locator(".export-badge").waitFor({ state: "detached" });
  assert.equal(shots, 1, "one render for one click");
  await label.click({ button: "right" });
  assert.ok(!(await menuItem(page, "Export PNG").isDisabled()), "enabled again");
  await page.keyboard.press("Escape");

  await wait(800);
  assert.equal(await env.read("board.json"), before, "board.json is byte-identical");
  assert.deepEqual(saves, [], "no board.json save was sent");
  await page.unroute("**/api/screenshot");
  assert.deepEqual(env.errors, []);
});

test("no headless browser: the toast says so and shows the install command; a render error keeps its reason", async () => {
  const { page } = env;
  await page.route("**/api/screenshot", (route) => route.fulfill({ status: 501, contentType: "application/json", body: JSON.stringify({ error: "Screenshots are unavailable because playwright is not installed (npm run design:install)" }) }));
  const label = page.locator(`.board[data-file="${F}"] .board-label`);
  await label.click({ button: "right" });
  await menuItem(page, "Export PNG").click();
  const toast = page.locator(".toast.error", { hasText: "Export PNG needs a headless browser" });
  await toast.waitFor();
  assert.equal(await toast.locator(".toast-code").textContent(), "npx playwright install chromium");
  await page.unroute("**/api/screenshot");

  await page.route("**/api/screenshot", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "page.goto: Timeout 30000ms exceeded.\nCall log: …" }) }));
  await label.click({ button: "right" });
  await menuItem(page, "Export PNG").click();
  await page.locator(".toast.error", { hasText: "Couldn't render the PNG: page.goto: Timeout 30000ms exceeded." }).waitFor();
  await page.unroute("**/api/screenshot");
  await label.click({ button: "right" });
  assert.ok(!(await menuItem(page, "Export PNG").isDisabled()), "a failure frees the item");
  await page.keyboard.press("Escape");
});
