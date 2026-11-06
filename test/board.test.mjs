// AI-generated with Claude Code, 2026-11-06, reviewed by Hyun Park
// board.json order is normalized on read, so a duplicated or stale entry cannot render two boards with one key (#6)
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createBoardStore, normalizeOrder } from "../server/board.mjs";

const boards = { "a.html": {}, "b.html": {}, "c.html": {} };

test("normalizeOrder: drops duplicates and unknown names, appends boards missing from order", () => {
  assert.deepEqual(normalizeOrder(["b.html", "a.html", "b.html", "gone.html"], boards), ["b.html", "a.html", "c.html"]);
  assert.deepEqual(normalizeOrder(undefined, boards), ["a.html", "b.html", "c.html"]);
  assert.deepEqual(normalizeOrder(["a.html", 3, null, "a.html"], { "a.html": {} }), ["a.html"]);
  assert.deepEqual(normalizeOrder(["toString", "a.html"], { "a.html": {} }), ["a.html"]);
});

test("readBoard heals a duplicated order entry, and sync does not add it again", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "easel-board-"));
  try {
    await fs.mkdir(path.join(dir, "screens"));
    for (const f of ["a.html", "b.html"]) await fs.writeFile(path.join(dir, "screens", f), "<!doctype html><p>x</p>");
    const b = { version: 1, title: "t", pages: [], boards: { "a.html": { x: 0, y: 0, w: 10, h: 10 }, "b.html": { x: 20, y: 0, w: 10, h: 10 } }, order: ["a.html", "b.html", "b.html"], notes: {} };
    await fs.writeFile(path.join(dir, "board.json"), JSON.stringify(b));
    const store = createBoardStore(dir);
    assert.deepEqual((await store.readBoard()).order, ["a.html", "b.html"]);

    // A new screen is placed once, even if order already names it (an agent appended it by hand)
    await fs.writeFile(path.join(dir, "screens", "c.html"), "<!doctype html><p>x</p>");
    b.order.push("c.html");
    await fs.writeFile(path.join(dir, "board.json"), JSON.stringify(b));
    const { board } = await store.syncBoard();
    assert.deepEqual(board.order, ["a.html", "b.html", "c.html"]);
    const saved = JSON.parse(await fs.readFile(path.join(dir, "board.json"), "utf8"));
    assert.deepEqual(saved.order, ["a.html", "b.html", "c.html"], "the next save writes the cleaned order back");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
