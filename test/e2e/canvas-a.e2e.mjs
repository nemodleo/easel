// AI-generated with Claude Code, 2026-11-13, reviewed by Hyun Park
// Direction A, the frame: the canvas fills the window under two cards and a dock. The inspector rests as its header and grows in
// height only (boards never move); the context line holds the hint or the element toolbar, never both, 8px above the dock; Fit all keeps
// to the clear area between the cards; under 480 the inspector is a sheet from the foot that hides the dock and closes with × or ⌘\.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { openBoard, pointOf, startEnv, wait } from "./helpers.mjs";

let env;
before(async () => (env = await startEnv()));
after(async () => env?.close());

const F = "scr-32.html";
const box = (page, sel) => page.locator(sel).first().boundingBox();

test("at rest the inspector is its header; picking a board grows it without moving the board; Esc rests it again", async () => {
  const { page, url } = env;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.waitForSelector(".board");
  await page.keyboard.press("Escape");
  await page.locator(".oc-right.is-rest").waitFor();
  await wait(300);
  assert.equal((await box(page, ".oc-right")).height, 48, "header only");
  // Share, Ask AI and View head the card; the canvas reaches every edge
  assert.equal(await page.locator(".oc-rhead .share-btn, .oc-rhead .ask-ai, .oc-rhead [aria-label=View]").count(), 3);
  assert.deepEqual(await box(page, ".canvas"), { x: 0, y: 0, width: 1440, height: 900 });
  const before = await box(page, `.board[data-file="${F}"] .board-frame`);
  await page.evaluate((file) => {
    const label = document.querySelector(`.board[data-file="${file}"] .board-label`);
    for (const type of ["pointerdown", "pointerup"]) label.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1 }));
  }, F);
  await page.locator(".oc-right:not(.is-rest)").waitFor();
  await wait(300);
  assert.equal((await box(page, ".oc-right")).height, 900 - 24, "full height, 12 from top and bottom");
  assert.deepEqual(await box(page, `.board[data-file="${F}"] .board-frame`), before, "the board stays where it was");
  // Board properties and the board's footer of icons
  await page.getByRole("heading", { name: "Position and size" }).waitFor();
  assert.equal(await page.locator('.oc-right footer[aria-label="Board actions"] button').count(), 5);
  await page.keyboard.press("Escape");
  await page.locator(".oc-right.is-rest").waitFor();
});

test("the context line: the hint, or the element toolbar 8px above the dock on a whole pixel, never both; its popover opens above it", async () => {
  const { page, url } = env;
  // The first-run hints share this slot; they go on the first key after the page has settled
  await wait(1600);
  await page.keyboard.press("Shift");
  await page.locator(".canvas-hint.oc-first").waitFor({ state: "detached" });
  await openBoard(page, url, F);
  assert.equal(await page.locator(".canvas-hint").count(), 1, "the hint while a board is selected");
  const at = await pointOf(page, F, "a.btn");
  await page.mouse.click(at.x, at.y);
  const bar = page.getByRole("toolbar", { name: "Element" });
  await bar.waitFor();
  assert.equal(await page.locator(".canvas-hint").count(), 0, "never both");
  const b = await bar.boundingBox();
  const dock = await box(page, ".oc-dock");
  assert.equal(dock.y - (b.y + b.height), 8, "8px above the dock");
  assert.ok(Number.isInteger(b.x) && Math.abs(b.x + b.width / 2 - 720) <= 1, `centred on a whole pixel (${b.x})`);
  // The element's footer: Duplicate, Copy, Screenshot, Delete in one row
  assert.deepEqual(await page.locator('.oc-right footer[aria-label="Element actions"] button').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent.trim())), ["Duplicate", "Copy", "Screenshot", "Delete"]);
  await bar.getByRole("button", { name: "Fill" }).click();
  const pop = page.getByRole("dialog", { name: "Fill" });
  await pop.waitFor();
  const p = await pop.boundingBox();
  assert.ok(p.y + p.height <= b.y, "the popover opens above the bar");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
});

test("Fit all keeps the boards inside the clear area between the cards", async () => {
  const { page } = env;
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Digit1");
  await wait(300);
  const frames = await page.locator(".board .board-frame").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right, b: r.bottom })));
  const left = Math.min(...frames.map((f) => f.l));
  const right = Math.max(...frames.map((f) => f.r));
  const bottom = Math.max(...frames.map((f) => f.b));
  assert.ok(left >= 264, `clear of the left card (${left})`);
  assert.ok(right <= 1440 - 12 - 288, `clear of the inspector (${right})`);
  assert.ok(bottom <= 900 - 68 - 36, `above the context line (${bottom})`);
});

test("440 wide: tools and shapes fold (Shapes stays), the inspector opens as a sheet that hides the dock; × and ⌘\\ close it", async () => {
  const { page, url } = env;
  await page.setViewportSize({ width: 440, height: 700 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator(".oc-dock").waitFor();
  assert.equal(await page.getByRole("button", { name: "Canvas tools" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Shapes" }).count(), 1, "Shapes stays reachable");
  await openBoard(page, url, F);
  const at = await pointOf(page, F, "a.btn");
  await page.mouse.click(at.x, at.y);
  const sheet = page.locator(".oc-right.oc-sheet");
  await sheet.waitFor();
  await wait(300); // it grows in height, 180ms
  const s = await sheet.boundingBox();
  assert.deepEqual([s.x, s.x + s.width, s.y + s.height], [8, 432, 692], "8px from left, right and bottom");
  assert.equal(await page.locator(".oc-dock, .etb").count(), 0, "the dock and the context line step aside");
  await sheet.getByRole("button", { name: "Close panel" }).click();
  await page.locator(".oc-right.is-rest").waitFor();
  await page.locator(".oc-dock").waitFor();
  // Pick again, then ⌘\ closes it too
  await page.mouse.click(at.x, at.y + 1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.evaluate((file) => {
    const label = document.querySelector(`.board[data-file="${file}"] .board-label`);
    for (const type of ["pointerdown", "pointerup"]) label.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1 }));
  }, F);
  await sheet.waitFor();
  await page.keyboard.press("Meta+Backslash");
  await page.locator(".oc-right.is-rest").waitFor();
  assert.deepEqual(env.errors, []);
});

test("a reload keeps this tab's own view, not the one another tab saved last", async () => {
  const { url } = env;
  // Two tabs of one browser profile: they share localStorage, each has its own sessionStorage
  const ctx = await env.page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForSelector(".board");
  await wait(800);
  const transform = () => page.evaluate(() => document.querySelector(".world").style.transform);
  const mine = await transform();
  // A second tab on the same canvas pans far away; its view is the last one written to the shared storage
  const other = await ctx.newPage();
  await other.setViewportSize({ width: 800, height: 600 });
  await other.goto(url);
  await other.waitForSelector(".board");
  await other.mouse.move(400, 300);
  for (let i = 0; i < 10; i++) await other.mouse.wheel(0, 2000);
  await wait(800);
  const theirs = await other.evaluate(() => document.querySelector(".world").style.transform);
  assert.notEqual(theirs, mine);
  await other.close();
  // A new tab still opens where the canvas was left last
  const fresh = await ctx.newPage();
  await fresh.setViewportSize({ width: 800, height: 600 });
  await fresh.goto(url);
  await fresh.waitForSelector(".board");
  await wait(500);
  assert.equal(await fresh.evaluate(() => document.querySelector(".world").style.transform), theirs, "a new tab opens on the last saved view");
  await fresh.close();
  await page.reload();
  await page.waitForSelector(".board");
  await wait(500);
  assert.equal(await transform(), mine, "the reloaded tab is where it was");
  await ctx.close();
});
