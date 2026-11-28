// AI-generated with Claude Code, 2026-11-27
// UI language (#1): English for en-* browsers, Korean for ko-*; the View menu switches it (remembered in localStorage as
// design-canvas:lang, so it outlives a reload), and the exported view-only copy follows the browser's language
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";

import { startEnv, wait } from "./helpers.mjs";

let env;
before(async () => (env = await startEnv()));
after(async () => env?.close());

const viewMenu = (page, name) => page.locator(`.oc-rhead [aria-label="${name}"]`);

test("en-US starts in English; Language in the View menu switches to Korean and back, across a reload", async () => {
  const { page, url } = env;
  await page.goto(url);
  await page.waitForSelector(".board");
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
  await viewMenu(page, "View").click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Language: English" }).click();
  // The page reloads in Korean
  await page.waitForFunction(() => document.documentElement.lang === "ko");
  await page.waitForSelector(".board");
  assert.equal(await page.evaluate(() => localStorage.getItem("design-canvas:lang")), "ko");
  await page.locator(".oc-dock .new-board").click();
  const nb = page.getByRole("menu").first();
  await nb.getByRole("menuitem", { name: "태블릿 화면 · 834×1194" }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.board[data-file="scr-32.html"] .board-label').click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "PNG로 내보내기" }).waitFor();
  await page.keyboard.press("Escape");
  // A reload keeps the choice
  await page.reload();
  await page.waitForSelector(".board");
  await viewMenu(page, "보기").click();
  await page.getByRole("menu").getByRole("menuitem", { name: "언어: 한국어" }).click();
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await page.waitForSelector(".board");
  await viewMenu(page, "View").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("design-canvas:lang")), "en");
  assert.deepEqual(env.errors, []);
});

test("with nothing chosen, a ko-KR browser gets Korean and an en-GB one English", async () => {
  const browser = env.page.context().browser();
  for (const [locale, view, lang] of [["ko-KR", "보기", "ko"], ["en-GB", "View", "en"]]) {
    const ctx = await browser.newContext({ locale, viewport: { width: 1600, height: 1000 } });
    try {
      const page = await ctx.newPage();
      await page.goto(env.url);
      await page.waitForSelector(".board");
      assert.equal(await page.evaluate(() => document.documentElement.lang), lang, locale);
      await viewMenu(page, view).waitFor();
    } finally {
      await ctx.close();
    }
  }
});

test("the exported view-only copy follows the browser's language", async () => {
  const { status } = await env.api("POST", "/api/export", { singleFile: true });
  assert.equal(status, 200);
  const file = (await fs.readdir(path.join(env.dir, "easel-export"))).find((f) => f.endsWith("-canvas.html"));
  const browser = env.page.context().browser();
  for (const [locale, stamp] of [["ko-KR", /^보기 전용 · /], ["en-US", /^View only · exported /]]) {
    const ctx = await browser.newContext({ locale, viewport: { width: 1440, height: 900 } });
    try {
      const page = await ctx.newPage();
      await page.goto("file://" + path.join(env.dir, "easel-export", file));
      await page.waitForSelector(".oc-stamp");
      await wait(200);
      assert.match((await page.locator(".oc-stamp").first().textContent()).trim(), stamp, locale);
    } finally {
      await ctx.close();
    }
  }
});
