// AI-generated with Claude Code, 2026-11-27
// What a tab does with the watcher's echo of a board file (app/src/livePatch.ts createEcho): keep a board that shows exactly that
// content because it patched its own edit in, reload it for anything else, wait for the answer of an edit still on its way, and ask
// the server for the file's hash when the echo is of an older version of its own edits. Decisions use content hashes only.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import ts from "typescript";

import { TOOL_ROOT } from "../server/args.mjs";

let createEcho, tmp;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dc-echo-"));
  for (const f of ["livePatch", "editor"]) {
    const src = await fs.readFile(path.join(TOOL_ROOT, `app/src/${f}.ts`), "utf8");
    const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    await fs.writeFile(path.join(tmp, `${f}.mjs`), out.replace('from "./editor"', 'from "./editor.mjs"'));
  }
  ({ createEcho } = await import(path.join(tmp, "livePatch.mjs")));
});
after(() => tmp && fs.rm(tmp, { recursive: true, force: true }));

const F = "a.html";
const loaded = (shown) => ({ shown, patched: false });
const patched = (shown) => ({ shown, patched: true });

test("a board that only loaded reloads on every echo, as before (other tabs, outside writers, agents)", () => {
  const e = createEcho();
  assert.equal(e.decide(F, "h1", loaded("h0")), "reload");
  assert.equal(e.decide(F, "h0", loaded("h0")), "reload", "even the same content: its page scripts may have changed it");
  assert.equal(e.decide(F, undefined, loaded("h0")), "reload", "an embedding board's redraw carries no hash");
  assert.equal(e.decide(F, "h1", loaded(null)), "reload", "unknown version (mid-reload, tweak preview)");
});

test("the echo of an own edit shown in place keeps the board; any other content reloads it", () => {
  const e = createEcho();
  e.patched(F, "h0", "h1");
  assert.equal(e.decide(F, "h1", patched("h1")), "keep");
  assert.equal(e.decide(F, "x", patched("h1")), "reload", "an outside change merged into the same burst");
  assert.equal(e.decide(F, undefined, patched("h1")), "reload");
});

test("an echo that arrives before the edit's answer waits for it, then is decided on the board as patched", () => {
  const e = createEcho();
  e.begin(F);
  assert.equal(e.decide(F, "h1", loaded("h0")), "queue");
  e.patched(F, "h0", "h1");
  assert.deepEqual(e.end(F), ["h1"]);
  assert.equal(e.decide(F, "h1", patched("h1")), "keep");
  // Two edits on the way: only the last answer releases the queue
  e.begin(F);
  e.begin(F);
  e.decide(F, "h2", patched("h1"));
  assert.deepEqual(e.end(F), []);
  assert.deepEqual(e.end(F), ["h2"]);
});

test("an echo of an older version of own edits asks the server; its answer is the file now and decides alone", () => {
  const e = createEcho();
  e.patched(F, "h0", "h1");
  e.patched(F, "h1", "h2");
  assert.equal(e.decide(F, "h1", patched("h2")), "check", "a later own write follows it");
  assert.equal(e.decide(F, "h0", patched("h2")), "check");
  assert.equal(e.decide(F, "h2", patched("h2"), true), "keep", "the file is what the board shows");
  assert.equal(e.decide(F, "h1", patched("h2"), true), "reload", "an undo took the file back to an older version: it never echoes again");
  e.reset(F);
  assert.equal(e.decide(F, "h1", patched("h2")), "reload", "after a reload the old versions mean nothing");
});

test("boards are independent", () => {
  const e = createEcho();
  e.begin("a.html");
  assert.equal(e.decide("b.html", "x", loaded("y")), "reload");
  e.patched("a.html", "h0", "h1");
  assert.equal(e.decide("b.html", "h1", patched("h1")), "keep");
  assert.equal(e.decide("b.html", "h0", patched("h1")), "reload", "a's versions are not b's");
});
