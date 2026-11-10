// AI-generated with Claude Code, 2026-11-06 and 2026-11-10, reviewed by Hyun Park
// board.json order is normalized on read, so a duplicated or stale entry cannot render two boards with one key (#6).
// First run: canvas name from the project folder, board titles from <title>, starter templates
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createBoardStore, normalizeOrder } from "../server/board.mjs";
import { newBoardHtml, TEMPLATES } from "../server/boards.mjs";
import { htmlTitle, projectName } from "../server/fsutil.mjs";
import { ko } from "./fixtures/ko-strings.mjs";

test("htmlTitle: trimmed, entities decoded, whitespace collapsed; null when missing or empty", () => {
  assert.equal(htmlTitle("<html><head><title>  Onboarding 1 ·\n  Welcome </title></head></html>"), "Onboarding 1 · Welcome");
  assert.equal(htmlTitle('<TITLE data-x="1">Tom &amp; Jerry &lt;3</TITLE>'), "Tom & Jerry <3");
  assert.equal(htmlTitle(`<title>${ko.title}</title>`), ko.title);
  assert.equal(htmlTitle("<title> </title>"), null);
  assert.equal(htmlTitle("<p>no title</p>"), null);
  assert.equal(htmlTitle(null), null);
});

test("projectName: the project folder for docs/design, else the folder itself", () => {
  assert.equal(projectName(path.join("/x", "relay", "docs", "design")), "relay");
  assert.equal(projectName(path.join("/x", "mockups")), "mockups");
});

async function project(files, board) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dc-board-"));
  const dir = path.join(root, "relay", "docs", "design");
  await fs.mkdir(path.join(dir, "screens"), { recursive: true });
  for (const [f, html] of Object.entries(files)) await fs.writeFile(path.join(dir, "screens", f), html);
  if (board) await fs.writeFile(path.join(dir, "board.json"), JSON.stringify(board));
  return { root, store: createBoardStore(dir) };
}

test("auto-placement names new boards from <title>, falls back to the file name, keeps existing titles", async () => {
  const { root, store } = await project(
    {
      "home.html": "<title>Home</title>",
      "onboard-1-welcome.html": "<title>Onboarding 1 · Welcome</title>",
      "inbox.html": "<p>no title</p>",
      "kept.html": "<title>From file</title>",
    },
    { version: 1, title: "design", boards: { "kept.html": { x: 0, y: 0, w: 390, h: 844, title: "Mine" } } },
  );
  try {
    const { board } = await store.syncBoard();
    assert.equal(board.boards["home.html"].title, "Home");
    assert.equal(board.boards["onboard-1-welcome.html"].title, "Onboarding 1 · Welcome");
    assert.equal(board.boards["inbox.html"].title, "inbox");
    assert.equal(board.boards["kept.html"].title, "Mine");
    // An old "design" title (the design folder's name) reads as the project name
    assert.equal(board.title, "relay");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("canvas name: project folder when board.json is new, a chosen title is kept", async () => {
  const a = await project({});
  const b = await project({}, { version: 1, title: "Relay app", boards: {} });
  try {
    assert.equal((await a.store.readBoard()).title, "relay");
    assert.equal((await b.store.readBoard()).title, "Relay app");
  } finally {
    await fs.rm(a.root, { recursive: true, force: true });
    await fs.rm(b.root, { recursive: true, force: true });
  }
});

test("starter templates: English, system fonts, no brand; desktop header uses the canvas name", () => {
  for (const template of Object.keys(TEMPLATES)) {
    const html = newBoardHtml({ title: "Home", w: 390, h: 844, template, brand: "relay" });
    assert.match(html, /<html lang="en">/);
    assert.match(html, /font-family:system-ui/);
    assert.doesNotMatch(html, /Pretendard|farmclub|Noto Sans KR|Apple SD Gothic/i);
    assert.equal(htmlTitle(html), "Home");
  }
  assert.match(newBoardHtml({ title: "Home", w: 1440, h: 900, template: "desktop", brand: "relay" }), /<strong[^>]*>relay<\/strong>/);
  assert.match(newBoardHtml({ title: "Home", w: 1440, h: 900, template: "desktop" }), /<strong[^>]*>Title<\/strong>/);
  const mobile = newBoardHtml({ title: "Home", w: 390, h: 844, template: "mobile" });
  for (const t of [">Title<", ">Description<", ">Next<"]) assert.ok(mobile.includes(t), t);
});

const boards = { "a.html": {}, "b.html": {}, "c.html": {} };

test("normalizeOrder: drops duplicates and unknown names, appends boards missing from order", () => {
  assert.deepEqual(normalizeOrder(["b.html", "a.html", "b.html", "gone.html"], boards), ["b.html", "a.html", "c.html"]);
  assert.deepEqual(normalizeOrder(undefined, boards), ["a.html", "b.html", "c.html"]);
  assert.deepEqual(normalizeOrder(["a.html", 3, null, "a.html"], { "a.html": {} }), ["a.html"]);
  assert.deepEqual(normalizeOrder(["toString", "a.html"], { "a.html": {} }), ["a.html"]);
});

test("readBoard heals a duplicated order entry, and sync does not add it again", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "easel-board-"));
  try {
    await fs.mkdir(path.join(dir, "screens"));
    for (const f of ["a.html", "b.html"]) await fs.writeFile(path.join(dir, "screens", f), "<!doctype html><p>x</p>");
    const b = { version: 1, title: "t", pages: [], boards: { "a.html": { x: 0, y: 0, w: 10, h: 10 }, "b.html": { x: 20, y: 0, w: 10, h: 10 } }, order: ["a.html", "b.html", "b.html"], notes: {} };
    await fs.writeFile(path.join(dir, "board.json"), JSON.stringify(b));
    const store = createBoardStore(dir);
    assert.deepEqual((await store.readBoard()).order, ["a.html", "b.html"]);

    // A new screen is placed once, even if order already names it (an agent appended it by hand)
    await fs.writeFile(path.join(dir, "screens", "c.html"), "<!doctype html><p>x</p>");
    b.order.push("c.html");
    await fs.writeFile(path.join(dir, "board.json"), JSON.stringify(b));
    const { board } = await store.syncBoard();
    assert.deepEqual(board.order, ["a.html", "b.html", "c.html"]);
    const saved = JSON.parse(await fs.readFile(path.join(dir, "board.json"), "utf8"));
    assert.deepEqual(saved.order, ["a.html", "b.html", "c.html"], "the next save writes the cleaned order back");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
