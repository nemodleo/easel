// AI-generated with Claude Code, 2026-11-27
// Export PNG from the board menu (#2), app/src/exportPng.ts: the download is named after the board's file, and a missing headless
// browser reads as that (so the toast can say what to install) while any other failure keeps the server's reason
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import ts from "typescript";

import { TOOL_ROOT } from "../server/args.mjs";

let x, strings, tmp;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dc-png-"));
  for (const f of ["exportPng", "strings"]) {
    const src = await fs.readFile(path.join(TOOL_ROOT, `app/src/${f}.ts`), "utf8");
    await fs.writeFile(path.join(tmp, `${f}.mjs`), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  }
  x = await import(path.join(tmp, "exportPng.mjs"));
  strings = (await import(path.join(tmp, "strings.mjs"))).strings;
});
after(() => tmp && fs.rm(tmp, { recursive: true, force: true }));

test("pngName: the board's file name with .png, without any folder", () => {
  assert.equal(x.pngName("scr-02.html"), "scr-02.png");
  assert.equal(x.pngName("Home.HTML"), "Home.png");
  assert.equal(x.pngName("flows/sign-in.html"), "sign-in.png");
  assert.equal(x.pngName("a.b.html"), "a.b.png");
});

test("pngFailure: no playwright (501) or no Chromium is the browser; anything else is the render", () => {
  assert.equal(x.pngFailure(501, "Screenshots are unavailable because playwright is not installed"), "browser");
  assert.equal(x.pngFailure(500, "browserType.launch: Executable doesn't exist at /x/chrome-mac/Chromium"), "browser");
  assert.equal(x.pngFailure(500, "Looks like Playwright was just installed. Please run: npx playwright install"), "browser");
  assert.equal(x.pngFailure(404, "File not found"), "render");
  assert.equal(x.pngFailure(500, "page.goto: Timeout 30000ms exceeded."), "render");
  assert.equal(x.pngFailure(undefined, "Failed to fetch"), "render");
});

test("shortReason keeps the first line, at most 140 characters", () => {
  assert.equal(x.shortReason("page.goto: Timeout\n  at line 2"), "page.goto: Timeout");
  assert.equal(x.shortReason("a".repeat(300)).length, 140);
});

test("the menu, the board badge and the toasts have their words", () => {
  assert.equal(strings.menu.exportPng, "Export PNG");
  assert.equal(strings.menu.exportingPng, "Exporting PNG…");
  assert.equal(strings.canvas.exportingPng, "Exporting PNG…");
  assert.equal(strings.toast.pngExported("scr-02.png"), "Downloaded scr-02.png");
  assert.match(strings.toast.pngNeedsBrowser, /headless browser/);
  assert.equal(strings.toast.pngFailed("Timeout"), "Couldn't render the PNG: Timeout");
});
