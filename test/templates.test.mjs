// AI-generated with Claude Code, 2026-11-27
// New board templates (#3): tablet, watch and email next to the first four. Each is valid HTML at its own size, titled, and
// on the default tokens (no colour, size, radius or spacing the token check would flag). The MCP create_board enum lists them all
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { parse } from "parse5";

import { TOOL_ROOT } from "../server/args.mjs";
import { newBoardHtml, TEMPLATES } from "../server/boards.mjs";
import { htmlTitle } from "../server/fsutil.mjs";
import { DEFAULT_TOKENS, lintHtml } from "../server/tokens.mjs";

const NEW = { tablet: [834, 1194], watch: [198, 242], email: [600, 1200] };

test("tablet 834×1194, watch 198×242 and email 600×1200 are templates with a label", () => {
  for (const [id, [w, h]] of Object.entries(NEW)) {
    assert.equal(TEMPLATES[id].w, w, id);
    assert.equal(TEMPLATES[id].h, h, id);
    assert.ok(TEMPLATES[id].label, id);
  }
  assert.deepEqual(Object.keys(TEMPLATES), ["blank", "mobile", "desktop", "doc", "tablet", "watch", "email"], "the first four keep their place");
});

for (const [id, [w, h]] of Object.entries(NEW)) {
  test(`${id}: valid HTML, its size on the meta and the outer frame, the title, nothing off tokens`, () => {
    const html = newBoardHtml({ title: "Welcome", w, h, template: id, brand: "relay" });
    const errors = [];
    parse(html, { onParseError: (e) => errors.push(e.code) });
    assert.deepEqual(errors, [], "parses without errors");
    assert.match(html, new RegExp(`<meta name="board-size" content="${w}x${h}">`));
    assert.match(html, new RegExp(`<div class="x-dc">\\n<div style="width:${w}px;(min-)?height:${h}px;`), "the outer frame has the board size");
    assert.equal(htmlTitle(html), "Welcome");
    assert.match(html, /<html lang="en">/);
    assert.doesNotMatch(html, /Pretendard|Noto Sans KR|<table/i, "system fonts, no table layout");
    assert.deepEqual(lintHtml(html, DEFAULT_TOKENS), [], "token check finds nothing");
    // Every link is a touch target: 48px tall at least
    for (const m of html.matchAll(/<a [^>]*style="([^"]*)"/g)) assert.match(m[1], /(^|;)(min-)?height:(4[89]|5\d)px/, m[1]);
  });
}

test("email is one 600px column with the canvas name as sender, a button and an unsubscribe link", () => {
  const html = newBoardHtml({ title: "Your order shipped", w: 600, h: 1200, template: "email", brand: "relay" });
  assert.match(html, /<strong[^>]*>relay<\/strong>/);
  assert.match(html, /<h1[^>]*>Your order shipped<\/h1>/);
  assert.ok(html.includes(">Call to action<") && html.includes(">Unsubscribe<"));
  assert.doesNotMatch(html.replace(/width:600px/, ""), /width:\d+px/, "no other fixed width inside the column");
});

test("the title is escaped in every new template", () => {
  for (const id of Object.keys(NEW)) assert.ok(newBoardHtml({ title: "A <b> & C", w: 100, h: 100, template: id }).includes("A &lt;b> &amp; C"), id);
});

test("MCP create_board accepts every template id", async () => {
  const src = await fs.readFile(path.join(TOOL_ROOT, "bin/mcp.mjs"), "utf8");
  const ids = JSON.parse(src.match(/template: z\.enum\((\[[^\]]*\])\)/)[1]);
  assert.deepEqual([...ids].sort(), Object.keys(TEMPLATES).sort());
});
