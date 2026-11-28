// AI-generated with Claude Code, 2026-11-27
// Many boards: what a pan, a drag and a resting view render. Counts React renders per board with the stand-in DevTools hook from
// tools/perf (no timing is asserted), and the live iframes a view holds.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";

import { HOOK } from "../../tools/perf/lib.mjs";
import { startEnv, wait } from "./helpers.mjs";

const COLS = 6;
const ROWS = 4;
const PITCH = { x: 470, y: 950 };
let env;
let layout;

before(async () => {
  env = await startEnv();
  const b = JSON.parse(await env.read("board.json"));
  // The fixture's own boards go far above, out of every view these tests use
  for (const f of Object.keys(b.boards)) b.boards[f].y -= 4000;
  const src = await env.read("screens/scr-02.html");
  for (let i = 0; i < COLS * ROWS; i++) {
    const f = `many-${i}.html`;
    await fs.writeFile(path.join(env.dir, "screens", f), src);
    b.boards[f] = { x: (i % COLS) * PITCH.x, y: 1200 + Math.floor(i / COLS) * PITCH.y, w: 390, h: 844, title: `Many ${i}` };
    b.order.push(f);
  }
  await env.write("board.json", JSON.stringify(b, null, 1));
  layout = b;
  await env.page.addInitScript(HOOK);
  await wait(400);
});
after(async () => env?.close());

/** Opens the canvas on a given view (the saved view the app restores) and waits for the boards */
async function openAt(view) {
  const { page, url } = env;
  await page.goto(url);
  await page.evaluate((v) => {
    sessionStorage.setItem("design-canvas:fixture", JSON.stringify({ view: v, page: null, minimap: false }));
  }, view);
  await page.reload();
  await page.waitForSelector(".board");
  await page.waitForFunction((n) => document.querySelectorAll(".board").length === n, layout.order.length);
  await rest();
}

/** Until the canvas is at rest */
async function rest() {
  const { page } = env;
  // Until the canvas is at rest: frames loaded, activity tags and errors in, no commit for two half-seconds in a row
  for (let i = 0, still = 0; i < 40 && still < 2; i++) {
    await page.evaluate(() => window.__perf.reset());
    await wait(500);
    const busy = await page.evaluate(() => window.__perf.stats.commits > 0 || [...document.querySelectorAll(".board iframe")].some((f) => f.contentDocument?.readyState !== "complete"));
    still = busy ? 0 : still + 1;
  }
}

const counts = () => env.page.evaluate(() => ({ ...window.__perf.stats, byFile: { ...window.__perf.byFile } }));
const reset = () => env.page.evaluate(() => window.__perf.reset());
/** A point on the bare canvas */
const emptyPoint = () =>
  env.page.evaluate(() => {
    for (let y = 80; y < innerHeight - 120; y += 10)
      for (let x = 300; x < innerWidth - 320; x += 10) if (document.elementFromPoint(x, y)?.classList.contains("canvas")) return { x, y };
    return null;
  });

test("panning renders the canvas but no board and not the app", async () => {
  await openAt({ zoom: 0.5, x: 300, y: -500 });
  const at = await emptyPoint();
  assert.ok(at, "an empty spot to wheel over");
  await env.page.mouse.move(at.x, at.y);
  await reset();
  for (let i = 0; i < 10; i++) {
    await env.page.mouse.wheel(4, 3);
    await wait(30);
  }
  await wait(300);
  const c = await counts();
  assert.ok(c.canvas >= 5, `the canvas follows the view (${c.canvas} renders)`);
  assert.equal(c.boards, 0, `boards rendered: ${JSON.stringify(c)}`);
  assert.equal(c.app, 0, "the app did not render");
  assert.deepEqual(env.errors, []);
});

/** Drags a board by its title and waits until the canvas is at rest again */
async function drag(f) {
  const label = await env.page.locator(`.board[data-file="${f}"] .board-label .board-title`).boundingBox();
  await env.page.mouse.move(label.x + 4, label.y + label.height / 2);
  await env.page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await env.page.mouse.move(label.x + 4 + i * 7, label.y + label.height / 2 + i * 3);
    await wait(20);
  }
  await env.page.mouse.up();
}

test("dragging a board renders that board only", async () => {
  await openAt({ zoom: 0.5, x: 300, y: -500 });
  // A first move and its undo: the first saved step brings in the activity tags, which draws every board once
  await drag("many-8.html");
  await env.page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await env.page.keyboard.press("Escape"); // and nothing selected
  await rest();
  const f = "many-7.html";
  await reset();
  await drag(f);
  await wait(400);
  const c = await counts();
  assert.ok(c.byFile[f] >= 3, `the dragged board follows the pointer (${c.byFile[f]} renders)`);
  assert.deepEqual(Object.keys(c.byFile), [f], `boards rendered: ${JSON.stringify(c.byFile)}`);
  const left = await env.page.locator(`.board[data-file="${f}"]`).evaluate((el) => parseFloat(el.style.left));
  assert.notEqual(left, layout.boards[f].x, "the board moved");
  await env.page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await wait(400);
  assert.deepEqual(env.errors, []);
});

test("a resting view holds a live iframe for every board in view (plus the margin), and none for the rest", async () => {
  const view = { zoom: 0.5, x: 40, y: -560 };
  await openAt(view);
  const size = await env.page.evaluate(() => {
    const c = document.querySelector(".canvas");
    return { w: c.clientWidth, h: c.clientHeight };
  });
  const vx = -view.x / view.zoom, vy = -view.y / view.zoom, vw = size.w / view.zoom, vh = size.h / view.zoom;
  const want = layout.order
    .filter((f) => {
      const b = layout.boards[f];
      return b.x + b.w > vx - 200 && b.x < vx + vw + 200 && b.y + b.h > vy - 200 && b.y < vy + vh + 200;
    })
    .sort();
  assert.ok(want.length > 4 && want.length < layout.order.length, `a view with some boards in it and some out (${want.length})`);
  let live = [];
  for (let i = 0; i < 100; i++) {
    live = await env.page.evaluate(() => [...document.querySelectorAll(".board")].filter((b) => b.querySelector("iframe")).map((b) => b.dataset.file).sort());
    if (live.length === want.length) break;
    await wait(100);
  }
  assert.deepEqual(live, want);
  assert.deepEqual(env.errors, []);
});
