// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// The chat's markdown parser (app/src/mdparse.ts) as a pure function: blocks, inline spans, safe links, half-streamed text
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import ts from "typescript";

import { TOOL_ROOT } from "../server/args.mjs";

// The app is TypeScript: compile the one file (it has no imports) and load it
let md, tmp;
before(async () => {
  const src = await fs.readFile(path.join(TOOL_ROOT, "app/src/mdparse.ts"), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dc-md-"));
  await fs.writeFile(path.join(tmp, "mdparse.mjs"), js);
  md = await import(path.join(tmp, "mdparse.mjs"));
});
after(() => tmp && fs.rm(tmp, { recursive: true, force: true }));

const text = (v) => ({ t: "text", v });

test("paragraphs, headings, a horizontal rule; a single newline is a line break", () => {
  assert.deepEqual(md.parseMarkdown("# Title\n\nOne\ntwo\n\n---\nThree"), [
    { t: "h", level: 1, c: [text("Title")] },
    { t: "p", c: [text("One"), { t: "br" }, text("two")] },
    { t: "hr" },
    { t: "p", c: [text("Three")] },
  ]);
  assert.deepEqual(md.parseMarkdown(""), []);
  assert.deepEqual(md.parseMarkdown("\n\n"), []);
});

test("bold, italic, inline code; snake_case and unclosed markers stay text", () => {
  assert.deepEqual(md.parseInline("a **b** *c* _d_ `e*f`"), [text("a "), { t: "b", c: [text("b")] }, text(" "), { t: "i", c: [text("c")] }, text(" "), { t: "i", c: [text("d")] }, text(" "), { t: "code", v: "e*f" }]);
  assert.deepEqual(md.parseInline("my_var_name and 2*3"), [text("my_var_name and 2*3")]);
  assert.deepEqual(md.parseInline("**half"), [text("**half")]);
  assert.deepEqual(md.parseInline("`open"), [text("`open")]);
  assert.deepEqual(md.parseInline("\\*not\\*"), [text("*not*")]);
  assert.deepEqual(md.parseInline("``a ` b``"), [{ t: "code", v: "a ` b" }]);
});

test("links: http(s) only, with label; javascript:, data: and relative stay text; bare URLs link without trailing punctuation", () => {
  assert.deepEqual(md.parseInline("[lucide](https://lucide.dev)"), [{ t: "a", href: "https://lucide.dev", c: [text("lucide")] }]);
  assert.deepEqual(md.parseInline("[x](javascript:alert(1))"), [text("x)")], "the label stays, as text");
  assert.equal(md.parseInline("[x](javascript:alert(1))").some((n) => n.t === "a"), false);
  assert.equal(md.parseInline("[x](data:text/html,hi)").some((n) => n.t === "a"), false);
  assert.equal(md.parseInline("[x](/local)").some((n) => n.t === "a"), false);
  assert.deepEqual(md.parseInline("see https://x.dev/a."), [text("see "), { t: "a", href: "https://x.dev/a", c: [text("https://x.dev/a")] }, text(".")]);
  assert.equal(md.safeHref("https://a.b"), "https://a.b");
  assert.equal(md.safeHref("JAVASCRIPT:x"), null);
});

test("lists: unordered and ordered, one nested level, continuation lines, a blank line between items", () => {
  const b = md.parseMarkdown("Plans:\n- Free\n- Team\n  - nested\n  more\n\n- Business\n\n3. three\n4. four");
  assert.deepEqual(b[0], { t: "p", c: [text("Plans:")] });
  assert.equal(b[1].t, "ul");
  assert.deepEqual(
    b[1].items.map((i) => i.c),
    [[text("Free")], [text("Team")], [text("Business")]],
  );
  assert.deepEqual(b[1].items[1].sub, { t: "ul", start: 1, items: [{ c: [text("nested"), { t: "br" }, text("more")] }] });
  assert.deepEqual(b[2], { t: "ol", start: 3, items: [{ c: [text("three")] }, { c: [text("four")] }] });
});

test("fenced code keeps its text exactly; an open fence while streaming is a code block, not an error", () => {
  assert.deepEqual(md.parseMarkdown('```html\n<div class="plan">Team</div>\n  **x**\n```\nafter'), [
    { t: "code", lang: "html", v: '<div class="plan">Team</div>\n  **x**', open: false },
    { t: "p", c: [text("after")] },
  ]);
  assert.deepEqual(md.parseMarkdown("Here:\n```js\nconst a"), [
    { t: "p", c: [text("Here:")] },
    { t: "code", lang: "js", v: "const a", open: true },
  ]);
  // Every prefix of a reply parses (what the chat sees while it streams in)
  const full = "## Done\n\n- **Free** plan\n- `Team`\n  1. nested\n\n```css\n.a{}\n```\n[link](https://a.b) _x_";
  for (let i = 0; i <= full.length; i++) assert.ok(Array.isArray(md.parseMarkdown(full.slice(0, i))));
  assert.ok(Array.isArray(md.parseMarkdown("- \n-\n1.\n```\n```\n```")));
});

test("raw HTML is text, never markup", () => {
  assert.deepEqual(md.parseMarkdown("<img src=x onerror=alert(1)>"), [{ t: "p", c: [text("<img src=x onerror=alert(1)>")] }]);
});
