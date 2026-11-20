// AI-generated with Claude Code, 2026-11-20, reviewed by Hyun Park
// Forks as blocks on the canvas (app/src/forkBlocks.ts): the client's near is the server's (placement and the canvas must agree on
// what one block is), blocks and their first fork, the caption's text by the block's width and what is in its way for 1, 2 and 3
// forks, and placement keeping 120px above and below a board, 80px beside it
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import ts from "typescript";

import { TOOL_ROOT } from "../server/args.mjs";
import { freeSpot, near as serverNear } from "../server/place.mjs";

// The app is TypeScript: compile the two files (neither has imports) and load them
let fb, strings, tmp;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dc-fb-"));
  for (const f of ["forkBlocks", "strings"]) {
    const src = await fs.readFile(path.join(TOOL_ROOT, `app/src/${f}.ts`), "utf8");
    await fs.writeFile(path.join(tmp, `${f}.mjs`), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  }
  fb = await import(path.join(tmp, "forkBlocks.mjs"));
  strings = (await import(path.join(tmp, "strings.mjs"))).strings;
});
after(() => tmp && fs.rm(tmp, { recursive: true, force: true }));

const B = (x, y, f = "", w = 390, h = 844) => ({ x, y, w, h, f });

test("the canvas's near is the server's: the same answer for boxes side by side, in rows, overlapping and far apart", () => {
  // A fixed pseudo-random walk over sizes and gaps around the edges where the rule switches
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
  let yes = 0;
  for (let i = 0; i < 5000; i++) {
    const a = { x: rnd(3000) - 1500, y: rnd(3000) - 1500, w: 50 + rnd(1400), h: 50 + rnd(1400) };
    const b = { x: rnd(3000) - 1500, y: rnd(3000) - 1500, w: 50 + rnd(1400), h: 50 + rnd(1400) };
    assert.equal(fb.near(a, b), serverNear(a, b), `${JSON.stringify(a)} ${JSON.stringify(b)}`);
    if (serverNear(a, b)) yes++;
  }
  assert.ok(yes > 500 && yes < 4500, `both answers covered (${yes} near)`);
  // The edges themselves: a gap of exactly half the two sizes is not near; one px less is
  for (const gap of [389, 390, 391]) assert.equal(fb.near(B(0, 0), B(390 + gap, 0)), serverNear(B(0, 0), B(390 + gap, 0)));
  assert.equal(fb.near(B(0, 0), B(470, 0)), true);
  assert.equal(fb.near(B(0, 0), B(0, 964)), true);
});

test("blocks: the demo's three forks are one block, its first fork top-left; a fork dragged away is a block of its own", () => {
  const demo = [B(2430, 2935, "codex"), B(2900, 2935, "cursor"), B(2430, 3899, "gemini")];
  const one = fb.blocks(demo);
  assert.deepEqual(one.map((b) => b.map((x) => x.f)), [["codex", "cursor", "gemini"]]);
  assert.equal(fb.firstOf(one[0]).f, "codex");
  assert.deepEqual(fb.bounds(one[0]), { x: 2430, y: 2935, w: 860, h: 1808 });
  // Listed in another order: same block, same first fork
  assert.equal(fb.firstOf(fb.blocks([demo[2], demo[1], demo[0]])[0]).f, "codex");
  // Cursor dragged 470px past the block's right edge: more than half a board away
  const out = [B(470, 0, "codex"), B(940, 0, "gemini"), B(1800, 1000, "cursor")];
  assert.deepEqual(fb.blocks(out).map((b) => b.map((x) => x.f)), [["codex", "gemini"], ["cursor"]]);
  // Connected through a middle one: a chain is one block
  assert.equal(fb.blocks([B(0, 0, "a"), B(470, 0, "b"), B(940, 0, "c"), B(1410, 0, "d")]).length, 1);
});

test("caption: the long text when it fits the block; else the medium one, past the block's edge when nothing is there; else the short one", () => {
  const s = strings.occupancy;
  const width = (t) => t.length * 6 + 8; // 6px a character, 4px padding each side
  const free = () => false;
  const pick = (n, whiles, avail, hits = free) => fb.chooseCaption(fb.captionTexts(n, "Empty day", whiles, s), avail, width, hits);
  const cc = ["Claude Code", "Claude Code", "Claude Code"];
  // Three forks: the long text needs the block's width (60% of 860 = 516px fits it, 31% = 267px does not)
  assert.equal(pick(3, cc, 860 * 0.6), "3 forks of Empty day · made while Claude Code was editing");
  assert.equal(pick(3, cc, 860 * 0.31), "3 forks of Empty day");
  // A one-column block (390 × 0.28 = 109px) still names its board: the medium text runs past the edge when nothing is there
  assert.equal(pick(2, ["Codex", "Codex"], 390 * 0.28), "2 forks of Empty day");
  assert.equal(pick(1, ["Claude Code"], 40), "Fork of Empty day");
  // Something to the right: the medium text would reach it (its width is over 70px), the short one does not
  const wall = (w) => w > 70;
  assert.equal(pick(2, ["Codex", "Codex"], 109, wall), "2 forks");
  assert.equal(pick(1, ["Claude Code"], 109, wall), "Fork");
  // The long text fits the block but something is under it: the medium one, if that is clear
  assert.equal(pick(3, cc, 2000, (w) => w > 200), "3 forks of Empty day");
  // Covered even for the short text: no caption
  assert.equal(pick(3, cc, 2000, () => true), null);
  // Made while different agents were editing (or unknown): no long text
  assert.deepEqual(fb.captionTexts(2, "Empty day", ["Claude Code", "Codex"], s), { long: null, medium: "2 forks of Empty day", short: "2 forks" });
  assert.deepEqual(fb.captionTexts(2, "Empty day", [undefined, undefined], s), { long: null, medium: "2 forks of Empty day", short: "2 forks" });
  assert.equal(pick(2, ["Claude Code", "Codex"], 2000), "2 forks of Empty day");
  assert.equal(fb.captionTexts(1, "Empty day", ["Claude Code"], s).long, "Fork of Empty day · made while Claude Code was editing");
  // The pick's confirm says what happens to every fork
  assert.equal(s.confirmForkBody("Empty day", 0), "Empty day is replaced by this version. The fork goes to trash.");
  assert.equal(s.confirmForkBody("Empty day", 1), "Empty day is replaced by this version. This fork and the other fork go to trash.");
  assert.equal(s.confirmForkBody("Empty day", 2), "Empty day is replaced by this version. This fork and the other 2 forks go to trash.");
});

test("placement keeps 120px above and below boards and notes, 80px beside them", () => {
  const board = { pages: [], boards: { "o.html": { x: 0, y: 0, w: 390, h: 844 } }, notes: {} };
  // Below: 100px under the board is too close, the spot moves to 120 under it
  assert.equal(freeSpot(board, { x: 0, y: 944, w: 390, h: 844 }, { dir: "down" }).y, 964);
  assert.equal(freeSpot(board, { x: 0, y: 964, w: 390, h: 844 }, { dir: "down" }).y, 964);
  // Above: a spot whose bottom is 100px over the board is in the way too
  assert.notEqual(freeSpot(board, { x: 0, y: -944, w: 390, h: 844 }, { dir: "right" }).x, 0);
  assert.equal(freeSpot(board, { x: 0, y: -964, w: 390, h: 844 }).x, 0);
  // Beside: 80px is enough
  assert.equal(freeSpot(board, { x: 470, y: 0, w: 390, h: 844 }).x, 470);
  assert.equal(freeSpot(board, { x: 460, y: 0, w: 390, h: 844 }).x, 470);
});
