// AI-generated with Claude Code, 2026-11-27
// The app's own text and style edits are shown in place: the board is not reloaded by the watcher's echo of that write (its scroll,
// focus and in-page state stay), while every other change (another tab, another client, an agent, an outside writer, undo, structural
// edits) still reloads the board exactly once, and an outside change right behind an own edit is never lost.
// Counts are of top-level board page loads, read after the echo has arrived and the board has settled; no timing is asserted.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";

import { clickIn, openBoard, startEnv, wait } from "./helpers.mjs";

let env;
const A = "scr-02.html";
const B = "scr-15.html";
before(async () => {
  env = await startEnv();
  // A board taller than its frame, so a reload would show as a lost scroll position
  const p = path.join(env.dir, "screens", A);
  await fs.writeFile(p, (await fs.readFile(p, "utf8")).replace("</div>\n</div>\n</body>", '</div>\n<div style="height:1600px"></div>\n</div>\n</body>'));
});
after(async () => env?.close());

async function until(fn, ms = 8000) {
  for (let t = 0; t < ms; t += 100) {
    if (await fn()) return true;
    await wait(100);
  }
  return false;
}

/** Board page loads per file in one tab, and the file-changed events it received */
function watch(page) {
  const loads = {};
  const echoes = {};
  page.on("request", (r) => {
    if (r.resourceType() !== "document" || r.frame()?.parentFrame() !== page.mainFrame()) return;
    const m = new URL(r.url()).pathname.match(/^\/screens\/(.+)$/);
    if (m) loads[decodeURIComponent(m[1])] = (loads[decodeURIComponent(m[1])] ?? 0) + 1;
  });
  page.on("websocket", (ws) =>
    ws.on("framereceived", (f) => {
      try {
        const e = JSON.parse(f.payload);
        if (e.type === "file-changed") echoes[e.file] = (echoes[e.file] ?? 0) + 1;
      } catch {}
    }),
  );
  const mark = () => ({ loads: { ...loads }, echoes: { ...echoes } });
  /** Waits for at least one echo of file after m, then for the board to settle; returns the loads per file since m */
  const since = async (m, file = A) => {
    assert.ok(await until(() => (echoes[file] ?? 0) > (m.echoes[file] ?? 0)), `an echo of ${file} arrived`);
    await wait(1500);
    await page.waitForFunction((f) => document.querySelector(`.board[data-file="${f}"] iframe`)?.contentDocument?.readyState === "complete", file);
    return Object.fromEntries(Object.entries(loads).map(([k, v]) => [k, v - (m.loads[k] ?? 0)]).filter(([, v]) => v));
  };
  return { mark, since };
}

const frameEval = (page, file, fn, arg) => page.evaluate(([f, src, a]) => new Function("doc", "win", "arg", `return (${src})(doc, win, arg)`)(document.querySelector(`.board[data-file="${f}"] iframe`).contentDocument, document.querySelector(`.board[data-file="${f}"] iframe`).contentWindow, a), [file, fn.toString(), arg]);
const read = () => env.read(`screens/${A}`);

async function typeText(page, file, selector, text) {
  await clickIn(page, file, selector);
  await page.getByRole("toolbar", { name: "Element" }).waitFor();
  await clickIn(page, file, selector, { double: true });
  await page.waitForFunction((f) => !!document.querySelector(`.board[data-file="${f}"] iframe`).contentDocument.querySelector("[contenteditable=true]"), file);
  await page.keyboard.press("Meta+A");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}
async function fill(page, hex) {
  const bar = page.getByRole("toolbar", { name: "Element" });
  await bar.waitFor();
  const pop = page.getByRole("dialog", { name: "Fill" });
  if (!(await pop.count())) {
    await bar.getByRole("button", { name: "Fill" }).click();
    await pop.getByText("Custom…").waitFor();
  }
  await pop.getByRole("textbox", { name: "Hex colour" }).fill(hex);
  await page.keyboard.press("Enter");
  assert.ok(await until(async () => (await read()).includes(`:${hex}`)), `${hex} written`);
}

let w;
test("a text edit is shown in place: no reload, scroll and page state kept, the next edit lands in the right source range", async () => {
  const { page, url } = env;
  w = watch(page);
  await openBoard(page, url, A);
  await frameEval(page, A, (doc, win) => {
    win.scrollTo(0, 12);
    win.__kept = true;
  });
  const orig = await read();
  const m = w.mark();
  await typeText(page, A, "h1", "Farms nearby");
  assert.ok(await until(async () => (await read()).includes(">Farms nearby<")), "text written");
  // Right away, before the echo: a second edit on another element of the same board
  await typeText(page, A, 'a[href="scr-15.html"]', "Kang farm");
  assert.ok(await until(async () => (await read()).includes(">Kang farm<")), "second text written");
  const focused = await page.evaluate(() => document.activeElement?.className ?? "");
  assert.deepEqual(await w.since(m), {}, "the editing tab did not reload the board");
  const state = await frameEval(page, A, (doc, win) => ({ kept: win.__kept === true, y: win.scrollY, h1: doc.querySelector("h1").outerHTML, editable: doc.querySelectorAll("[contenteditable]").length }));
  assert.deepEqual(state, { kept: true, y: 12, h1: '<h1 style="margin:0;font-size:34px">Farms nearby</h1>', editable: 0 });
  assert.equal(await page.evaluate(() => document.activeElement?.className ?? ""), focused, "focus stayed where it was");
  // Only the two lines changed, each in its own place
  const changed = (await read()).split("\n").filter((l, i) => l !== orig.split("\n")[i]);
  assert.deepEqual(changed, ['  <h1 style="margin:0;font-size:34px">Farms nearby</h1>', '  <a href="scr-15.html" style="color:#111111;font-size:17px">Kang farm</a>']);
  // The selection follows the new source: an edit through it still passes the conflict check
  const sel = (await env.api("GET", "/api/selection")).body.selection;
  const el = (await env.api("GET", `/api/element?f=${A}&path=${encodeURIComponent(sel.path)}`)).body;
  assert.equal(sel.hash, el.hash, "the selection carries the element's hash in the new source");
  assert.deepEqual(env.errors, []);
});

test("a style edit from the toolbar is shown in place without a reload", async () => {
  const { page } = env;
  await clickIn(page, A, "h1");
  const m = w.mark();
  await fill(page, "#123456");
  assert.deepEqual(await w.since(m), {});
  assert.equal(await frameEval(page, A, (doc, win) => win.getComputedStyle(doc.querySelector("h1")).color), "rgb(18, 52, 86)");
  assert.equal(await frameEval(page, A, (doc, win) => win.__kept === true), true);
  // Two in a row: still none
  const m2 = w.mark();
  await fill(page, "#222222");
  await fill(page, "#333333");
  assert.deepEqual(await w.since(m2), {});
  assert.equal(await frameEval(page, A, (doc, win) => win.getComputedStyle(doc.querySelector("h1")).color), "rgb(51, 51, 51)");
  await page.keyboard.press("Escape");
});

test("undo of an edit shown in place reloads the board once, to the file's content", async () => {
  const { page } = env;
  const m = w.mark();
  await page.mouse.click(5, 500);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+z");
  assert.ok(await until(async () => (await read()).includes(":#222222")), "undo wrote the step before");
  assert.deepEqual(await w.since(m), { [A]: 1 });
  assert.equal(await frameEval(page, A, (doc, win) => win.getComputedStyle(doc.querySelector("h1")).color), "rgb(34, 34, 34)");
});

test("an outside change right behind an own edit is shown, never swallowed", async () => {
  const { page } = env;
  await clickIn(page, A, "h1");
  await fill(page, "#444444");
  const m = w.mark();
  const p = path.join(env.dir, "screens", A);
  await fs.writeFile(p, (await fs.readFile(p, "utf8")).replace("</h1>", '</h1><i id="outside">o</i>'));
  await w.since(m);
  assert.ok(await until(() => frameEval(page, A, (doc) => !!doc.getElementById("outside"))), "the outside change is on the board");
  assert.equal(await frameEval(page, A, (doc, win) => win.getComputedStyle(doc.querySelector("h1")).color), "rgb(68, 68, 68)");
  await page.keyboard.press("Escape");
});

test("every other write still reloads the board once: another client, an agent's write_board, an outside writer, a delete, embedding boards", async () => {
  const { page } = env;
  const hash = async (p) => (await env.api("GET", `/api/element?f=${A}&path=${encodeURIComponent(p)}`)).body.hash;
  let m = w.mark();
  await env.api("POST", "/api/edit", { file: A, op: "setStyle", path: "0/1/0", hash: await hash("0/1/0"), prop: "color", value: "#654321" });
  assert.deepEqual(await w.since(m), { [A]: 1 }, "an edit made by another client");
  m = w.mark();
  await env.api("POST", "/api/boards/write", { file: A, html: (await read()).replace("</h1>", "</h1><i>w</i>") });
  assert.deepEqual(await w.since(m), { [A]: 1 }, "MCP write_board");
  m = w.mark();
  await env.write(`screens/${A}`, (await read()).replace("</h1>", "</h1><i>x</i>"));
  assert.deepEqual(await w.since(m), { [A]: 1 }, "an outside writer");
  m = w.mark();
  await clickIn(page, A, "i");
  await page.getByRole("toolbar", { name: "Element" }).waitFor();
  await page.keyboard.press("Backspace");
  assert.deepEqual(await w.since(m), { [A]: 1 }, "a delete from the app (structural: reloads)");
  await page.keyboard.press("Escape");
  m = w.mark();
  await env.write(`screens/${B}`, (await env.read(`screens/${B}`)).replace("</body>", "<i>b</i></body>"));
  const counts = await w.since(m, B);
  assert.equal(counts[A], undefined, "a change to another board leaves this one alone");
});

test("two tabs: the tab that edits keeps its board, the other tab reloads once and shows the change", async () => {
  const { page, url } = env;
  const ctx2 = await page.context().browser().newContext({ viewport: { width: 1600, height: 1000 } });
  const tab2 = await ctx2.newPage();
  try {
    const w2 = watch(tab2);
    await openBoard(tab2, url, A);
    await wait(1000);
    const m1 = w.mark();
    const m2 = w2.mark();
    await typeText(page, A, "h1", "Both tabs");
    assert.ok(await until(async () => (await read()).includes(">Both tabs<")));
    assert.deepEqual(await w.since(m1), {}, "editing tab");
    assert.deepEqual(await w2.since(m2), { [A]: 1 }, "other tab");
    assert.equal(await frameEval(tab2, A, (doc) => doc.querySelector("h1").textContent), "Both tabs");
  } finally {
    await ctx2.close();
  }
  assert.deepEqual(env.errors, []);
});
