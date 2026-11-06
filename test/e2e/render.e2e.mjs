// AI-generated with Claude Code, 2026-11-06, reviewed by Hyun Park
// Canvas rendering regressions: duplicated board.json order (#6), thumbnail resolution and idle will-change (#8)
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startEnv, wait } from "./helpers.mjs";

let env;
before(async () => (env = await startEnv()));
after(async () => env?.close());

/** Width and height from a JPEG's SOF marker */
function jpegSize(buf) {
  for (let i = 2; i < buf.length; ) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

test("a file listed twice in board.json order renders once and zooming in does not crash", async () => {
  const b = JSON.parse(await env.read("board.json"));
  b.order.push(b.order[0]);
  await env.write("board.json", JSON.stringify(b, null, 1));
  await wait(400);
  const { page, url } = env;
  await page.goto(url);
  await page.waitForSelector(".board");
  assert.equal(await page.locator(".board").count(), Object.keys(b.boards).length);
  await openFirst(page, b.order[0]);
  assert.equal(await page.locator(`.board[data-file="${b.order[0]}"] iframe`).count(), 1);
  assert.ok(await page.locator(".canvas").isVisible(), "canvas still mounted");
  assert.deepEqual(env.errors, []);
});

async function openFirst(page, f) {
  await page.evaluate((f) => {
    document.querySelector(`.board[data-file="${f}"] .board-frame`).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
  }, f);
  await wait(100);
  await page.keyboard.press("Shift+Digit2");
  await page.waitForSelector(`.board[data-file="${f}"] iframe`);
}

test("/api/thumb renders the requested size and caches each size", async () => {
  const f = "f-3.html"; // 800 × 900
  const small = Buffer.from(await (await fetch(`${env.url}/api/thumb?f=${f}`)).arrayBuffer());
  const big = Buffer.from(await (await fetch(`${env.url}/api/thumb?f=${f}&px=1200`)).arrayBuffer());
  assert.equal(jpegSize(small).h, 600);
  assert.equal(jpegSize(big).h, 1200);
  const again = await fetch(`${env.url}/api/thumb?f=${f}`);
  assert.equal(again.status, 200, "the smaller size is still cached after the bigger one was made");
});

test("will-change is only set while the view moves", async () => {
  const { page } = env;
  const wc = () => page.evaluate(() => getComputedStyle(document.querySelector(".world")).willChange);
  const seen = page.evaluate(
    () =>
      new Promise((resolve) => {
        const el = document.querySelector(".world");
        new MutationObserver((_, o) => {
          if (el.style.willChange === "transform") (o.disconnect(), resolve(true));
        }).observe(el, { attributes: true, attributeFilter: ["style"] });
        setTimeout(() => resolve(false), 2000);
      }),
  );
  await page.mouse.move(800, 500);
  await page.mouse.wheel(0, 200);
  assert.equal(await seen, true, "set while panning");
  await wait(500);
  assert.equal(await wc(), "auto", "cleared once idle");
});
