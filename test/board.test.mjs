// AI-generated with Claude Code, 2026-11-10, reviewed by Hyun Park
// First run: canvas name from the project folder, board titles from <title>, starter templates
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createBoardStore } from "../server/board.mjs";
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
