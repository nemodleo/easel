// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Core-flow regression tests: create a board (draw with the board tool) -> delete (confirm dialog, trash) -> undo; canvas actions and HTML edits share one history
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";

import { startEnv, wait } from "./helpers.mjs";

let env;
before(async () => (env = await startEnv()));
after(async () => env?.close());

const board = async () => (await env.api("GET", "/api/board")).body.board;
const exists = (rel) => fs.access(path.join(env.dir, rel)).then(() => true, () => false);
async function until(fn, ms = 6000) {
  for (let t = 0; t < ms; t += 100) {
    if (await fn()) return true;
    await wait(100);
  }
  return false;
}

test("draw a board with the board tool, delete it (confirm), restore with Cmd+Z, and undo the creation with another Cmd+Z", async () => {
  const { page, url } = env;
  await page.goto(url);
  await page.waitForSelector(".board");
  // Pan to an empty area (large horizontal move)
  const c = await page.locator(".canvas").boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.wheel(20000, 0);
  await wait(200);
  await page.keyboard.press("b");
  assert.equal(await page.getByRole("radio", { name: /Draw board/ }).getAttribute("aria-checked"), "true");
  // In the clear area between the cards (the canvas runs under them)
  await page.mouse.move(c.x + 400, c.y + 200);
  await page.mouse.down();
  await page.mouse.move(c.x + 500, c.y + 400, { steps: 5 });
  await page.mouse.up();
  assert.ok(await until(() => exists("screens/board.html")), "new HTML file");
  const b1 = await board();
  assert.ok(b1.boards["board.html"], "placed in board.json");
  assert.ok(b1.boards["board.html"].w > 40);
  await page.waitForSelector('.board.selected[data-file="board.html"]');
  await page.getByText("Created board board.html").waitFor();

  // Delete: confirm dialog -> Delete
  await page.keyboard.press("Delete");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  assert.ok(await until(async () => !(await exists("screens/board.html"))), "file deleted");
  assert.ok(await until(async () => (await board()).boards["board.html"] === undefined), "removed from board.json too");
  const trash = await fs.readdir(path.join(env.dir, ".trash"));
  assert.ok(trash.some((d) => d !== ".gitignore"), "copy in the trash");

  // Undo -> restored
  await page.keyboard.press("Meta+z");
  assert.ok(await until(() => exists("screens/board.html")), "restored");
  assert.ok(await until(async () => !!(await board()).boards["board.html"]));
  await page.waitForSelector('.board[data-file="board.html"]');

  // Once more -> creation undone
  await page.keyboard.press("Meta+z");
  const undone = await until(async () => !(await exists("screens/board.html")));
  assert.ok(undone, "creation undone");
  // Redo
  await page.keyboard.press("Meta+Shift+z");
  assert.ok(await until(() => exists("screens/board.html")), "redone");
  assert.deepEqual(env.errors, []);
});

test("one history: HTML edit -> move board (arrow key) -> two Cmd+Z undo in reverse order", async () => {
  const { page } = env;
  const f = "scr-02.html";
  const origHtml = await env.read(`screens/${f}`);
  const x0 = (await board()).boards[f].x;
  // HTML edit (through the server API; the edit UI is covered by the core tests)
  const el = (await env.api("GET", `/api/element?f=${f}&path=0`)).body;
  const r = await env.api("POST", "/api/edit", { file: f, op: "setAttr", path: "0", hash: el.hash, name: "data-e2e", value: "1" });
  assert.equal(r.status, 200);
  // Select the board, then move it 10 with Shift+ArrowRight
  await page.evaluate((file) => {
    document.querySelector(`.board[data-file="${file}"] .board-frame`).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
  }, f);
  await wait(150);
  await page.keyboard.press("Shift+ArrowRight");
  assert.ok(await until(async () => (await board()).boards[f].x === x0 + 10), "move saved");
  const h = (await env.api("GET", "/api/history")).body;
  assert.equal(h.undo.at(-1), "Move board");
  // Cmd+Z: the move first, then the HTML edit
  await page.keyboard.press("Meta+z");
  assert.ok(await until(async () => (await board()).boards[f].x === x0), "move undone");
  assert.notEqual(await env.read(`screens/${f}`), origHtml);
  await page.keyboard.press("Meta+z");
  assert.ok(await until(async () => (await env.read(`screens/${f}`)) === origHtml), "edit undone");
  assert.deepEqual(env.errors, []);
});
