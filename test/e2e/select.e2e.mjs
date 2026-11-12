// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Select and edit without entering a mode, driven like a person: hover and click an element on a board → toolbar and breadcrumb →
// Fill (only Custom with no tokens; tokens first once registered, written as a CSS variable) → Undo; keyboard into the toolbar;
// double-click a text to edit it; Esc twice; a board still drags; a comment from the toolbar is pinned to the element.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { ko } from "../fixtures/ko-strings.mjs";
import { clickIn, openBoard, pointOf, startEnv, wait } from "./helpers.mjs";

let env;
before(async () => (env = await startEnv()));
after(async () => env?.close());

const F = "scr-32.html";
async function until(fn, ms = 6000) {
  for (let t = 0; t < ms; t += 100) {
    if (await fn()) return true;
    await wait(100);
  }
  return false;
}
const selection = async () => (await env.api("GET", "/api/selection")).body.selection;
/** After an undo the board redraws the restored source (the button has no inline style again) */
const redrawn = (page) => page.waitForFunction(() => !document.querySelector('.board[data-file="scr-32.html"] iframe').contentDocument?.querySelector("a.btn")?.hasAttribute("style"));

test("with no tokens registered: hover outlines, a click selects (toolbar, breadcrumb, You · editing), Fill offers only Custom, Undo restores", async () => {
  const { page, url } = env;
  const orig = await env.read(`screens/${F}`);
  await openBoard(page, url, F);
  const at = await pointOf(page, F, "a.btn");
  await page.mouse.move(at.x, at.y);
  await page.locator(`.board[data-file="${F}"] .box.hover`).waitFor();
  assert.equal(await page.locator(".etb").count(), 0, "hover alone selects nothing");
  await page.mouse.click(at.x, at.y);
  const bar = page.getByRole("toolbar", { name: "Element" });
  await bar.waitFor();
  assert.deepEqual(await bar.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent.trim())), ["Text", "Fill", "Radius", "Spacing", "Ask AI", "Comment"]);
  assert.equal((await selection()).path, "0/1/1/5");
  await page.locator(`.board[data-file="${F}"] .box.sel`).waitFor();
  assert.equal(await page.locator(".crumb").textContent(), `SCR-32 ${ko.inquiry}›…›Container›Container›Link "${ko.sendInquiry}"`);
  // A person is editing a board while an element is selected on it
  await page.locator(`.board[data-file="${F}"] .occ-tag.you`).waitFor();
  // The CSS name sits beside each design word (shown on hover and focus)
  assert.equal(await page.locator(".prow", { hasText: "Corner radius" }).getAttribute("title"), "border-radius");
  assert.match(await page.locator(".props .contrast").textContent(), /^Contrast \d+\.\d:1 with white text · AA/);
  // Fill: no palette is invented
  await bar.getByRole("button", { name: "Fill" }).click();
  const pop = page.getByRole("dialog", { name: "Fill" });
  await pop.waitFor();
  assert.equal(await pop.locator(".tok").count(), 0);
  await pop.getByText("Custom…").waitFor();
  await pop.getByRole("textbox", { name: "Hex colour" }).fill("#123456");
  await page.keyboard.press("Enter");
  assert.ok(await until(async () => (await env.read(`screens/${F}`)).includes('class="btn" style="background-color:#123456"')), "custom fill written");
  // Esc closes the popover (focus back on Fill), the selection stays; ⌘Z puts the source back
  await page.keyboard.press("Escape");
  await pop.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Fill");
  await bar.waitFor();
  await page.keyboard.press("Meta+z");
  assert.ok(await until(async () => (await env.read(`screens/${F}`)) === orig), "undo restores");
  await redrawn(page);
  assert.deepEqual(env.errors, []);
});

test("tokens first: the Fill popover lists the registered colours, choosing one writes its variable; Tab reaches the toolbar, arrows move in it", async () => {
  const { page } = env;
  const orig = await env.read(`screens/${F}`);
  const put = await env.api("PUT", "/api/tokens", { active: "Light", themes: { Light: { Blue: "#2B59C3", "Blue soft": "#DFE7FB", Ink: "#10213A" } }, fontSizes: [15, 17], fontWeights: [400, 700], radii: [8, 16], spacing: [0, 4, 8, 16] });
  assert.equal(put.status, 200);
  await page.keyboard.press("Escape"); // let go of the element (the board stays selected)
  await page.keyboard.press("Enter"); // Enter selects inside the board
  await page.getByRole("toolbar", { name: "Element" }).waitFor();
  await clickIn(page, F, "a.btn");
  await until(async () => (await selection())?.path === "0/1/1/5");
  // Keyboard: Tab from the selection lands on the toolbar, arrows move along it, Enter opens Fill
  await page.locator(".canvas").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Text");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Fill");
  await page.keyboard.press("Enter");
  const pop = page.getByRole("dialog", { name: "Fill" });
  await pop.waitFor();
  assert.deepEqual(await pop.locator(".tok").allTextContents(), ["Blue", "Blue soft", "Ink"]);
  await pop.getByRole("button", { name: "Blue soft" }).click();
  assert.ok(await until(async () => (await env.read(`screens/${F}`)).includes('style="background-color:var(--blue-soft, #DFE7FB)"')), "token reference written");
  // The panel names the token beside the value
  await page.locator(".props .fillv", { hasText: "Blue soft" }).waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+z");
  assert.ok(await until(async () => (await env.read(`screens/${F}`)) === orig), "undo restores");
  await redrawn(page);
  assert.deepEqual(env.errors, []);
});

test("double-click a text edits it in place; Esc lets go of the element, the next Esc of the board", async () => {
  const { page } = env;
  await clickIn(page, F, "p", { double: true });
  await page.waitForFunction(() => !!document.querySelector('.board[data-file="scr-32.html"] iframe').contentDocument.querySelector("[contenteditable=true]"));
  await page.keyboard.press("Meta+A");
  await page.keyboard.type("Edited in place");
  await page.keyboard.press("Enter");
  assert.ok(await until(async () => (await env.read(`screens/${F}`)).includes(">Edited in place</p>")), "text saved");
  await page.getByRole("toolbar", { name: "Element" }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".etb").waitFor({ state: "detached" });
  assert.equal(await page.locator(`.board.selected[data-file="${F}"]`).count(), 1, "the board stays selected");
  await page.locator(`.board[data-file="${F}"] .occ-tag.you`).waitFor({ state: "detached" }); // no longer editing
  assert.ok(await until(async () => (await selection()) === null), "the server's selection is cleared too");
  await page.keyboard.press("Escape");
  await page.locator(".board.selected").waitFor({ state: "detached" });
  await page.keyboard.press("Meta+z");
  assert.ok(await until(async () => !(await env.read(`screens/${F}`)).includes("Edited in place")));
  assert.deepEqual(env.errors, []);
});

test("dragging a board still moves it (no element gets selected); a comment from the toolbar is pinned to the element", async () => {
  const { page } = env;
  const x0 = (await env.api("GET", "/api/board")).body.board.boards[F].x;
  const zoom = Number((await page.locator(".zoom").textContent()).replace("%", "")) / 100;
  const at = await pointOf(page, F, "p");
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 60, at.y, { steps: 6 });
  await page.mouse.up();
  assert.ok(await until(async () => Math.abs((await env.api("GET", "/api/board")).body.board.boards[F].x - (x0 + 60 / zoom)) <= 1), "board moved");
  assert.equal(await page.locator(".etb").count(), 0, "a drag selects no element");
  // Comment from the toolbar: the comment box opens on this element, the pin sits on it
  await clickIn(page, F, "a.btn");
  await page.getByRole("toolbar", { name: "Element" }).getByRole("button", { name: "Comment" }).click();
  await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA" && /0\/1\/1\/5/.test(document.activeElement.getAttribute("placeholder") ?? ""));
  await page.keyboard.type("Make this bigger");
  await page.keyboard.press("Meta+Enter");
  assert.ok(await until(async () => (await env.api("GET", "/api/comments")).body.comments.some((c) => c.file === F && c.path === "0/1/1/5" && c.text === "Make this bigger")));
  await page.locator(`.board[data-file="${F}"] .pin`).waitFor();
  assert.deepEqual(env.errors, []);
});

test("the wheel pans the canvas over a board; with an element selected on it, it scrolls the board's own content first", async () => {
  const { page, url } = env;
  const T = "scr-02.html";
  const orig = await env.read(`screens/${T}`);
  await env.write(`screens/${T}`, orig.replace("</body>", '<div style="height:3000px"></div></body>'));
  await page.evaluate(() => document.activeElement?.blur()); // the comment box of the test before
  await openBoard(page, url, T);
  const scrollY = () => page.evaluate((f) => document.querySelector(`.board[data-file="${f}"] iframe`).contentWindow.scrollY, T);
  const top = async () => (await page.locator(`.board[data-file="${T}"] .board-frame`).boundingBox()).y;
  assert.ok(await until(async () => (await page.frameLocator(`.board[data-file="${T}"] iframe`).locator("body").evaluate((b) => b.scrollHeight)) > 3000));
  const at = await pointOf(page, T, "h1, h2, p, a");
  await page.mouse.move(at.x, at.y);
  const y0 = await top();
  await page.mouse.wheel(0, 40);
  assert.ok(await until(async () => Math.abs((await top()) - (y0 - 40)) <= 1), "no element selected: the canvas pans");
  assert.equal(await scrollY(), 0);
  await page.mouse.wheel(0, -40);
  assert.ok(await until(async () => Math.abs((await top()) - y0) <= 1));
  await page.mouse.click(at.x, at.y);
  await page.getByRole("toolbar", { name: "Element" }).waitFor();
  await page.mouse.wheel(0, 120);
  assert.ok(await until(async () => (await scrollY()) > 0), "the board's content scrolled");
  assert.ok(Math.abs((await top()) - y0) <= 1, "the canvas stayed where it was");
  // Back at the top there is nothing left to scroll that way, so the canvas pans again
  await page.mouse.wheel(0, -2000);
  assert.ok(await until(async () => (await scrollY()) === 0));
  await page.mouse.wheel(0, -40);
  assert.ok(await until(async () => Math.abs((await top()) - (y0 + 40)) <= 1), "at the end of the content the canvas pans");
  await page.keyboard.press("Escape");
  await env.write(`screens/${T}`, orig);
  assert.deepEqual(env.errors, []);
});
