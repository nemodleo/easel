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

// A playing board always has its live frame. Two ways it used to get a placeholder instead: a tall board fitted in a short window
// sits below 25% and under 640 px on screen (the thumbnail rule), and a canvas measured while hidden (0 × 0) counted every board
// as out of view and unloaded them all, the playing one too
test("a playing board stays live: a tall board fitted in a narrow window, and while the canvas is hidden", async () => {
  const { page, url } = env;
  const T = "scr-02.html";
  const b = JSON.parse(await env.read("board.json"));
  b.boards[T] = { ...b.boards[T], h: 9960 };
  await env.write("board.json", JSON.stringify(b, null, 2));
  await page.setViewportSize({ width: 630, height: 830 });
  try {
    await page.goto(url);
    await page.waitForSelector(".board");
    await openBoardNoWait(page, T);
    const zoom = await page.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector(".world").style.transform)[1]));
    assert.ok(zoom < 0.25 && 9960 * zoom < 640, `the fitted board is drawn as a thumbnail (zoom ${zoom})`);
    assert.equal(await page.locator(`.board[data-file="${T}"] iframe`).count(), 0, "not live before Play");
    await page.keyboard.press("p");
    await page.locator(`.board.playing[data-file="${T}"]`).waitFor();
    await page.locator(`.board.playing[data-file="${T}"] .board-frame iframe`).waitFor({ timeout: 3000 });

    // Hide the canvas (a collapsed pane): the playing board keeps the same frame, and so do the other boards
    const tag = await page.addStyleTag({ content: ".canvas { display: none !important }" });
    await page.evaluate(() => (document.querySelector(".board.playing iframe").dataset.mark = "1"));
    await wait(300);
    assert.equal(await page.locator(".board.playing iframe[data-mark]").count(), 1, "the playing board's frame survives the hidden canvas");
    assert.equal(await page.locator(".board-placeholder.far").count(), 0, "a hidden canvas does not mark boards out of view");
    await tag.evaluate((el) => el.remove());
    await wait(300);
    assert.equal(await page.locator(".board.playing iframe[data-mark]").count(), 1, "still the same frame once shown again");
    await page.keyboard.press("Escape");
  } finally {
    await page.setViewportSize({ width: 1600, height: 1000 });
  }
});

/** Selects a board by its title row and fits it (Shift+2), without waiting for a live frame the way openBoard does */
async function openBoardNoWait(page, file) {
  await page.evaluate((f) => {
    const label = document.querySelector(`.board[data-file="${f}"] .board-label`);
    for (const type of ["pointerdown", "pointerup"]) label.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1 }));
  }, file);
  await wait(100);
  await page.keyboard.press("Shift+Digit2");
  await wait(600);
}

test("the label's ▶ shows on a selected un-flagged board, plays it, turns into Stop, and never writes board.json", async () => {
  const { page, url } = env;
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(url);
  await page.waitForSelector(".board");
  await wait(800);
  const saves = [];
  const onReq = (r) => r.method() !== "GET" && r.url().includes("/api/board") && saves.push(r.url());
  page.on("request", onReq);
  const before = await env.read("board.json");
  const play = page.locator(`.board[data-file="${F}"] .board-label .board-play`);
  // Zoomed to the board, then deselected: an un-flagged board's ▶ is there but hidden; selecting the board shows it
  await openBoard(page, url, F);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.mouse.move(5, 5);
  await page.locator(`.board.selected`).waitFor({ state: "detached" });
  await wait(300); // the row fades over 80ms
  // Shown: laid out (not display: none) and its row not faded out
  const shown = () => play.evaluate((el) => getComputedStyle(el).display !== "none" && getComputedStyle(el.parentElement).opacity !== "0");
  assert.equal(await shown(), false, "hidden at rest");
  await page.evaluate((f) => {
    const label = document.querySelector(`.board[data-file="${f}"] .board-label`);
    for (const type of ["pointerdown", "pointerup"]) label.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1 }));
  }, F);
  await page.locator(`.board.selected[data-file="${F}"]`).waitFor();
  await wait(300);
  assert.equal(await shown(), true, "visible once selected");
  assert.equal(await play.getAttribute("title"), "Play (P)");
  await play.click();
  await page.locator(`.board.playing[data-file="${F}"]`).waitFor();
  assert.equal(await play.getAttribute("aria-label"), "Stop Play");
  await play.click();
  await page.locator(".board.playing").waitFor({ state: "detached" });
  await wait(800);
  page.off("request", onReq);
  assert.equal(await env.read("board.json"), before, "board.json is byte-identical");
  assert.deepEqual(saves, [], "no board.json save was sent");
});
