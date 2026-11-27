// AI-generated with Claude Code, 2026-11-27
// Live patches (server/livePatch.mjs): which edits the app may show in place without reloading the board, and that the patch is
// exactly the change between the two sources. Anything not proven is null (the board reloads as before)
import assert from "node:assert/strict";
import { test } from "node:test";

import { applyEdit } from "../server/edit.mjs";
import { inspect } from "../server/html.mjs";
import { contentHash, livePatch } from "../server/livePatch.mjs";
import { injectProbe } from "../server/index.mjs";

const page = (body, head = "") => `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">${head}\n</head>\n<body>\n<div class="x">\n  <h1 style="margin:0">Title</h1>\n  ${body}\n</div>\n</body>\n</html>\n`;
const H = page(`<a href="b.html" title="go">Link</a>\n  <pre>code</pre>\n  <ul><li>one</li></ul>`);
const edit = (html, req) => {
  const ops = req.op === "batch" ? req.ops.map((o) => ({ ...o, hash: inspect(html, o.path).hash })) : undefined;
  const r = { ...req, ...(ops ? { ops } : { hash: inspect(html, req.path)?.hash }) };
  const next = applyEdit(html, r);
  return { next, live: livePatch(html, next, r) };
};

test("setText: the new inner source of the element, escaped as in the file, line breaks as <br>", () => {
  const { live } = edit(H, { op: "setText", path: "0/0", text: "A < B & C\nnext" });
  assert.deepEqual(live, [{ path: "0/0", tag: "h1", inner: "A &lt; B &amp; C<br>next" }]);
});

test("setStyle and setAttr: the attribute as the browser will read it; a removed attribute is null", () => {
  assert.deepEqual(edit(H, { op: "setStyle", path: "0/0", prop: "color", value: "#123456" }).live, [{ path: "0/0", tag: "h1", attrs: [["style", "margin:0;color:#123456"]] }]);
  assert.deepEqual(edit(H, { op: "setAttr", path: "0/1", name: "title", value: 'say "hi"' }).live, [{ path: "0/1", tag: "a", attrs: [["title", 'say "hi"']] }]);
  assert.deepEqual(edit(H, { op: "setAttr", path: "0/1", name: "title", value: null }).live, [{ path: "0/1", tag: "a", attrs: [["title", null]] }]);
  assert.deepEqual(edit(H, { op: "setAttr", path: "0/1", name: "data-x", value: "1" }).live, [{ path: "0/1", tag: "a", attrs: [["data-x", "1"]] }]);
  assert.deepEqual(edit(H, { op: "setStyle", path: "0/0", prop: "margin", value: "" }).live, [{ path: "0/0", tag: "h1", attrs: [["style", null]] }]);
});

test("batch of style changes on one element is one patch", () => {
  const { live } = edit(H, { op: "batch", ops: [{ op: "setStyle", path: "0/0", prop: "left", value: "4px" }, { op: "setStyle", path: "0/0", prop: "top", value: "8px" }] });
  assert.deepEqual(live, [{ path: "0/0", tag: "h1", attrs: [["style", "margin:0;left:4px;top:8px"]] }]);
});

test("structural edits, tweaks and anything a reload would show differently get no patch", () => {
  for (const req of [
    { op: "delete", path: "0/1" },
    { op: "duplicate", path: "0/1" },
    { op: "move", path: "0/1", toParentPath: "0", index: 0 },
    { op: "insert", path: "0/1", position: "after", html: "<p>x</p>" },
    { op: "wrap", paths: ["0/0", "0/1"] },
    { op: "setAttr", path: "0/1", name: "onclick", value: "x()" }, // a handler
    { op: "setAttr", path: "0/1", name: "autofocus", value: "" }, // acts only on load
    { op: "setText", path: "0/2", text: "\nlead" }, // <pre> drops a leading newline when parsed, innerHTML does not
    { op: "batch", ops: [{ op: "setStyle", path: "0/0", prop: "color", value: "red" }, { op: "delete", path: "0/1" }] },
  ])
    assert.equal(edit(H, req).live, null, JSON.stringify(req));
});

test("a page that runs scripts or load handlers always reloads; data scripts (tweaks) do not count", () => {
  const scripted = page(`<a href="b.html">Link</a>`, "<script>document.title = 'x'</script>");
  assert.equal(edit(scripted, { op: "setStyle", path: "0/0", prop: "color", value: "red" }).live, null);
  const handler = page(`<img src="x.png" onerror="this.remove()">`);
  assert.equal(edit(handler, { op: "setStyle", path: "0/0", prop: "color", value: "red" }).live, null);
  const tweaks = page(`<a href="b.html">Link</a>`, `<script type="application/json" id="board-tweaks">{"a":{"type":"color","value":"#fff"}}</script>`);
  assert.ok(edit(tweaks, { op: "setStyle", path: "0/0", prop: "color", value: "red" }).live);
});

test("the replay check: a patch that would not rebuild the new source exactly is refused", () => {
  // Table rows: text inside them is moved out by the parser but would stay put with innerHTML
  const t = page(`<table><tbody><tr><td>cell</td></tr></tbody></table>`);
  assert.equal(livePatch(t, t.replace("<tr><td>", "<tr>x<td>"), { op: "setText", path: "0/1/0/0" }), null);
  // Something else in the file changed too (an edit racing another writer)
  const { next: n2 } = edit(H, { op: "setStyle", path: "0/0", prop: "color", value: "red" });
  assert.equal(livePatch(H, n2.replace("Link", "Other"), { op: "setStyle", path: "0/0", prop: "color", value: "red" }), null);
  // An element on <body> itself, or a path into <template> content, is never patched
  assert.equal(livePatch(H, H.replace("<body>", '<body style="color:red">'), { op: "setStyle", path: "", prop: "color", value: "red" }), null);
});

test("the served page carries the content hash of the file it was made from", () => {
  const served = injectProbe(H);
  assert.match(served, new RegExp(`<script data-dc-probe data-dc-src="${contentHash(H)}">`));
  assert.equal(contentHash(H).length, 40);
});
