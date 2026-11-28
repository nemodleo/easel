// AI-generated with Claude Code, 2026-11-17, reviewed by Hyun Park
// Embedding a view-only copy (app/src/embed.ts) as pure functions: the URL options, the clear area and the opening view's corner
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import ts from "typescript";

import { TOOL_ROOT } from "../server/args.mjs";

let em, tmp;
before(async () => {
  const src = await fs.readFile(path.join(TOOL_ROOT, "app/src/embed.ts"), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dc-embed-"));
  await fs.writeFile(path.join(tmp, "embed.mjs"), js);
  em = await import(path.join(tmp, "embed.mjs"));
});
after(() => fs.rm(tmp, { recursive: true, force: true }));

test("no embed: every option is ignored, so a plain export is unchanged", () => {
  const plain = { embed: false, fit: [], inset: { top: 0, right: 0, bottom: 0, left: 0 }, dock: "center" };
  assert.deepEqual(em.parseEmbed(""), plain);
  assert.deepEqual(em.parseEmbed("?fit=a.html&inset=10&dock=left"), plain);
  assert.deepEqual(em.parseEmbed("?embed=0&fit=a.html"), plain);
  assert.deepEqual(em.parseEmbed("?embed=false"), plain);
});

test("embed: fit lists boards and note ids, dock is left, center or right", () => {
  const o = em.parseEmbed("?embed&fit=brand.html, home.html,,n4&dock=left");
  assert.equal(o.embed, true);
  assert.deepEqual(o.fit, ["brand.html", "home.html", "n4"]);
  assert.equal(o.dock, "left");
  assert.equal(em.parseEmbed("?embed=1&dock=right").dock, "right");
  assert.equal(em.parseEmbed("?embed&dock=top").dock, "center", "an unknown dock falls back to the centre");
  assert.deepEqual(em.parseEmbed("?embed").fit, []);
});

test("inset reads like CSS (1 to 4 numbers, top right bottom left), negative reaches past an edge, junk is no inset", () => {
  assert.deepEqual(em.parseInset("80,24,-40,668"), { top: 80, right: 24, bottom: -40, left: 668 });
  assert.deepEqual(em.parseInset("10"), { top: 10, right: 10, bottom: 10, left: 10 });
  assert.deepEqual(em.parseInset("10 20"), { top: 10, right: 20, bottom: 10, left: 20 });
  assert.deepEqual(em.parseInset("1,2,3"), { top: 1, right: 2, bottom: 3, left: 2 });
  assert.deepEqual(em.parseInset("12.6,0,0,0").top, 13);
  for (const bad of ["", "a", "1,2,3,4,5", "1,,x"]) assert.deepEqual(em.parseInset(bad), { top: 0, right: 0, bottom: 0, left: 0 }, bad);
  assert.equal(em.parseInset("99999").top, 4000, "clamped");
});

test("clear area: the frame less the insets, never under 100px; the opening view starts at its top-left corner", () => {
  assert.deepEqual(em.embedArea({ w: 1440, h: 804 }, { top: 80, right: 24, bottom: -40, left: 668 }), { x: 668, y: 80, w: 748, h: 764 });
  assert.deepEqual(em.embedArea({ w: 300, h: 300 }, { top: 0, right: 0, bottom: 0, left: 280 }).w, 100);
  const rects = [{ x: 0, y: 0, w: 1440, h: 900 }, { x: 0, y: 1320, w: 390, h: 844 }];
  const v = em.alignStart({ x: 999, y: 999, zoom: 0.3 }, rects, { x: 668, y: 80, w: 748, h: 764 });
  // pad = min(60, 8% of the area) = 59.84 → the first board's corner at the area's corner plus that pad
  assert.deepEqual(v, { zoom: 0.3, x: 728, y: 140 });
});
