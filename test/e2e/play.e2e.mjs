// AI-generated with Claude Code, 2026-11-27
// Play needs no flag: a board without is_interactive plays in place with P and from its right-click menu, plays full screen from
// the menu, and Esc stops it. Playing is viewing, so board.json stays byte-identical and the app sends no save. With no board
// selected, P is still the pen
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { openBoard, startEnv, wait } from "./helpers.mjs";

let env;
before(async () => (env = await startEnv()));
after(async () => env?.close());

const F = "scr-32.html";

test("an un-flagged board plays via P and the context menu; board.json is untouched and never saved", async () => {
  const { page, url } = env;
  const saves = [];
  page.on("request", (r) => r.method() !== "GET" && r.url().includes("/api/board") && saves.push(`${r.method()} ${r.url()}`));
  await page.goto(url);
  await page.waitForSelector(".board");
  await wait(800);
  const before = await env.read("board.json");
  assert.ok(!JSON.parse(before).boards[F].is_interactive, "the fixture board is not flagged");
  assert.equal(await page.locator(`.board[data-file="${F}"] .dot`).count(), 0, "no playable mark on an un-flagged board");

  // P with the one board selected plays it in place, and does not pick the pen
  await openBoard(page, url, F);
  await page.keyboard.press("p");
  await page.locator(`.board.playing[data-file="${F}"]`).waitFor();
  await page.locator(".playing-badge").waitFor();
  assert.equal(await page.getByRole("radio", { name: /Pen/ }).getAttribute("aria-checked"), "false", "P did not pick the pen");
  await page.keyboard.press("Escape");
  await page.locator(".board.playing").waitFor({ state: "detached" });
  // P again on the same selected board starts it again, and P stops it
  await page.keyboard.press("p");
  await page.locator(`.board.playing[data-file="${F}"]`).waitFor();
  await page.keyboard.press("p");
  await page.locator(".board.playing").waitFor({ state: "detached" });

  // The board's context menu always offers both kinds of Play
  const label = page.locator(`.board[data-file="${F}"] .board-label`);
  await label.click({ button: "right" });
  const menu = page.getByRole("menu");
  await menu.getByRole("menuitem", { name: /Play full screen/ }).waitFor();
  await menu.getByRole("menuitem", { name: /Play in place/ }).click();
  await page.locator(`.board.playing[data-file="${F}"]`).waitFor();
  await label.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: /Stop Play/ }).click();
  await page.locator(".board.playing").waitFor({ state: "detached" });
  await label.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: /Play full screen/ }).click();
  await page.locator(".play .play-frame").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".play").waitFor({ state: "detached" });

  await wait(800);
  assert.equal(await env.read("board.json"), before, "board.json is byte-identical");
  assert.deepEqual(saves, [], "no board.json save was sent");
});

test("with no board selected P is the pen", async () => {
  const { page } = env;
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".board.selected").count(), 0);
  await page.keyboard.press("p");
  assert.equal(await page.getByRole("radio", { name: /Pen/ }).getAttribute("aria-checked"), "true");
  assert.equal(await page.locator(".board.playing").count(), 0);
  await page.keyboard.press("Escape");
});
