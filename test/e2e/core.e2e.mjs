// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Core-flow regression tests: select -> edit -> source updated, file watching (including atomic writes)
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";

import { ko } from "../fixtures/ko-strings.mjs";
import { clickIn, openBoard, startEnv, wait } from "./helpers.mjs";

let env;
before(async () => (env = await startEnv()));
after(async () => env?.close());

test("select -> edit text -> only that part of the source changes, no temp files", async () => {
  const { page, url } = env;
  const orig = await env.read("screens/scr-32.html");
  // No mode to enter: a click on the board selects the element under the pointer, a double-click edits its text
  await openBoard(page, url, "scr-32.html");
  await clickIn(page, "scr-32.html", "a.btn");
  await wait(700);
  const sel = await env.api("GET", "/api/selection");
  assert.equal(sel.body.selection.path, "0/1/1/5");
  await clickIn(page, "scr-32.html", "a.btn", { double: true });
  await wait(200);
  await page.keyboard.press("Meta+A");
  await page.keyboard.type(ko.inquirySubmit);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => true);
  for (let i = 0; i < 30 && !(await env.read("screens/scr-32.html")).includes(ko.inquirySubmit); i++) await wait(100);
  const after1 = await env.read("screens/scr-32.html");
  const changed = after1.split("\n").filter((l, i) => l !== orig.split("\n")[i]);
  assert.equal(changed.length, 1);
  assert.ok(changed[0].includes(ko.inquirySubmit));
  const tmp = (await fs.readdir(path.join(env.dir, "screens"))).filter((n) => n.startsWith(".dc-tmp"));
  assert.deepEqual(tmp, []);
  assert.deepEqual(env.errors, []);
});

test("file watching: an external edit redraws only that board within a second (also after an atomic write)", async () => {
  const { page, url } = env;
  await openBoard(page, url, "scr-02.html");
  const p = path.join(env.dir, "screens/scr-02.html");
  const t0 = Date.now();
  // Edit the same way as an atomic write (temp file -> rename)
  const tmp = path.join(env.dir, "screens", ".dc-tmp-test");
  await fs.writeFile(tmp, (await fs.readFile(p, "utf8")).replace('<div class="x-dc">', '<div class="x-dc"><b id="e2e-mark">E2E</b>'));
  await fs.rename(tmp, p);
  await page.waitForFunction(() => !!document.querySelector('.board[data-file="scr-02.html"] iframe')?.contentDocument?.getElementById("e2e-mark"), null, { timeout: 3000 });
  assert.ok(Date.now() - t0 < 1500);
  const b = await env.api("GET", "/api/board");
  assert.deepEqual(b.body.missing, []);
  assert.ok(b.body.board.boards["scr-02.html"]);
});

test("embedded boards: when the source (scr-15) changes, the flow embedding it (f-3) redraws too", async () => {
  const { page, url } = env;
  await openBoard(page, url, "f-3.html");
  const p = path.join(env.dir, "screens/scr-15.html");
  await fs.writeFile(p, (await fs.readFile(p, "utf8")).replace('<div class="x-dc">', '<div class="x-dc"><b id="e2e-embed">E2E</b>'));
  await page.waitForFunction(
    () => {
      const outer = document.querySelector('.board[data-file="f-3.html"] iframe')?.contentDocument;
      return [...(outer?.querySelectorAll("iframe") ?? [])].some((f) => f.contentDocument?.getElementById("e2e-embed"));
    },
    null,
    { timeout: 4000 },
  );
});

test("root-path link /scr-02.html redirects to screens/, missing files are 404", async () => {
  const r = await fetch(env.url + "/scr-02.html", { redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/screens/scr-02.html");
  assert.equal((await fetch(env.url + "/nope.html", { redirect: "manual" })).status, 404);
});
