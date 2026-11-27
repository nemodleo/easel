// AI-generated with Claude Code, 2026-11-27
// What P does (app/src/playKey.ts): it plays the one selected board, flagged is_interactive or not, and is the pen otherwise.
// The checkbox and the menu read their words from strings.ts: the label must not say the flag is needed to play
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import ts from "typescript";

import { TOOL_ROOT } from "../server/args.mjs";

let pk, strings, tmp;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dc-pk-"));
  for (const f of ["playKey", "strings"]) {
    const src = await fs.readFile(path.join(TOOL_ROOT, `app/src/${f}.ts`), "utf8");
    await fs.writeFile(path.join(tmp, `${f}.mjs`), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  }
  pk = (await import(path.join(tmp, "playKey.mjs"))).pKey;
  strings = (await import(path.join(tmp, "strings.mjs"))).strings;
});
after(() => tmp && fs.rm(tmp, { recursive: true, force: true }));

const boards = { "a.html": { x: 0, y: 0, w: 390, h: 844 }, "b.html": { x: 470, y: 0, w: 390, h: 844, is_interactive: true } };

test("P plays the one selected board whether or not it is flagged interactive", () => {
  assert.equal(pk(["a.html"], boards), "play", "an un-flagged board");
  assert.equal(pk(["b.html"], boards), "play", "a flagged board");
});

test("P is the pen with no board, several boards, or a name that is not a board", () => {
  assert.equal(pk([], boards), "pen");
  assert.equal(pk(["a.html", "b.html"], boards), "pen");
  assert.equal(pk(["gone.html"], boards), "pen");
  assert.equal(pk(["toString"], boards), "pen", "an inherited property is not a board");
});

test("the checkbox label no longer reads as a switch for Play", () => {
  assert.equal(strings.boardOptions.interactive, "Show Play button");
  assert.match(strings.boardOptions.interactiveTitle, /always visible/);
  assert.match(strings.boardOptions.interactiveTitle, /any board plays with P or right-click/);
  assert.doesNotMatch(strings.canvas.interactive, /Interactive \(Play\)/);
});
