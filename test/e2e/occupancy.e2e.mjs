// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Several agents on one canvas, driven like a user: two MCP clients (the real bin/mcp.mjs, as Claude Code and Codex) write the same
// board → a fork appears beside it with the arrow and both labels, list dots → both disconnect (done) → Use this one on the fork →
// the original has the fork's content, the fork is in trash, the toast's Undo brings both back. Then the chat's variants: Use this →
// confirm → toast → Undo, and Keep all.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { startEnv, TOOL, wait } from "./helpers.mjs";

let env;
before(async () => {
  process.env.DESIGN_CANVAS_AGENT_CMD = JSON.stringify({ claude: ["node", path.join(TOOL, "test/e2e/fake-agent.mjs")] });
  env = await startEnv();
});
after(async () => {
  delete process.env.DESIGN_CANVAS_AGENT_CMD;
  await env?.close();
});

/** An MCP client of the canvas, as an agent would connect (its name decides the agent label) */
async function agent(name) {
  const port = new URL(env.url).port;
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(TOOL, "bin/mcp.mjs"), "--port", port], env: { PATH: process.env.PATH, HOME: process.env.HOME, EASEL_HOME: path.join(env.dir, ".easel-home") }, stderr: "ignore" }));
  return client;
}
const reply = (r) => JSON.parse(r.content[0].text);
const board = (page, f) => page.locator(`.board[data-file="${f}"]`);

test("two agents on one board: fork beside it with the arrow and both labels → done → Use this one on the fork → Undo brings both back", async () => {
  const { page, url } = env;
  await page.goto(url);
  await page.waitForSelector(".board");
  const orig = await env.read("screens/scr-15.html");
  const claude = await agent("claude-code");
  const codex = await agent("codex-mcp-client");
  const mine = orig.replace("</body>", "<p>by Claude Code</p></body>");
  const theirs = orig.replace("</body>", "<p>by Codex</p></body>");
  assert.deepEqual(reply(await claude.callTool({ name: "write_board", arguments: { file: "scr-15.html", html: mine } })).forked, false);
  const r = reply(await codex.callTool({ name: "write_board", arguments: { file: "scr-15.html", html: theirs } }));
  assert.deepEqual([r.file, r.forked], ["scr-15-codex.html", true]);
  assert.match(r.message, /^Claude Code is editing scr-15\.html, so your change went to a fork next to it: screens\/scr-15-codex\.html/);
  // The canvas: the fork beside the original, the arrow and its caption, a label on each, a dot in the board list
  await board(page, "scr-15-codex.html").waitFor({ timeout: 8000 });
  await page.keyboard.press("Shift+Digit1");
  await wait(500);
  const caption = page.locator('.fork-link[data-fork="scr-15-codex.html"] .fork-caption');
  await caption.waitFor();
  assert.match(await caption.textContent(), /^Forked \d\d:\d\d — Codex started while Claude Code was editing$/);
  assert.equal(await board(page, "scr-15.html").locator(".occ-tag").textContent(), "Claude Code is editing…");
  assert.equal(await board(page, "scr-15-codex.html").locator(".occ-tag").textContent(), "Codex is editing…");
  assert.equal(await board(page, "scr-15-codex.html").locator(".board-title").textContent(), "SCR-15 채팅 목록 · Codex");
  assert.equal(await page.locator('.left .row[title="scr-15.html"] .occ-dot').getAttribute("aria-label"), "Claude Code is editing");
  assert.equal(await page.locator('.left .row[title="scr-15-codex.html"] .occ-dot').getAttribute("aria-label"), "Codex is editing");
  const useFork = board(page, "scr-15-codex.html").locator(".use-btn");
  assert.equal(await useFork.getAttribute("aria-disabled"), "true", "waits while either is still editing");
  assert.equal(await useFork.getAttribute("title"), "Wait until Claude Code is done editing");
  assert.equal(await board(page, "scr-15.html").locator(".use-btn").textContent(), "Use this one");
  // Both finish (their clients disconnect): done labels, Use this one becomes available
  await claude.close();
  await codex.close();
  await board(page, "scr-15.html").locator(".occ-tag.done", { hasText: /^Claude Code · done \d\d:\d\d$/ }).waitFor({ timeout: 8000 });
  await board(page, "scr-15-codex.html").locator(".occ-tag.done", { hasText: /^Codex · done \d\d:\d\d$/ }).waitFor();
  assert.equal(await page.locator(".left .occ-dot").count(), 0, "no dots once nobody is editing");
  await page.waitForFunction(() => document.querySelector('.board[data-file="scr-15-codex.html"] .use-btn')?.getAttribute("aria-disabled") == null);
  await useFork.click();
  const dlg = page.getByRole("dialog", { name: 'Use "SCR-15 채팅 목록 · Codex" for SCR-15 채팅 목록?' });
  await dlg.waitFor();
  assert.equal(await dlg.locator(".c-body").textContent(), "SCR-15 채팅 목록 is replaced by this version. The fork goes to trash.");
  assert.deepEqual(await dlg.getByRole("button").allTextContents(), ["Apply", "Keep both"]);
  await dlg.getByRole("button", { name: "Apply" }).click();
  const toast = page.locator(".toast", { hasText: "Applied SCR-15 채팅 목록 · Codex to SCR-15 채팅 목록" });
  await toast.waitFor();
  assert.equal(await env.read("screens/scr-15.html"), theirs, "the original has the fork's content");
  await assert.rejects(env.read("screens/scr-15-codex.html"));
  const trash = (await fs.readdir(path.join(env.dir, ".trash"))).filter((d) => !d.startsWith("."));
  assert.ok((await Promise.all(trash.map((d) => fs.readFile(path.join(env.dir, ".trash", d, "scr-15-codex.html"), "utf8").catch(() => null)))).includes(theirs));
  await board(page, "scr-15-codex.html").waitFor({ state: "detached" });
  assert.equal(await page.locator(".fork-link").count(), 0);
  // One Undo: both versions back, with the arrow
  await toast.getByRole("button", { name: "Undo" }).click();
  await board(page, "scr-15-codex.html").waitFor();
  await page.locator('.fork-link[data-fork="scr-15-codex.html"] .fork-caption').waitFor();
  assert.equal(await env.read("screens/scr-15.html"), mine);
  assert.equal(await env.read("screens/scr-15-codex.html"), theirs);
  assert.deepEqual(env.errors, []);
});

test("variants from the chat land in a free row; Use this → confirm → toast → Undo; Keep all keeps them as ordinary boards", async () => {
  const { page } = env;
  await page.locator('.left .row[title="scr-32.html"]').click();
  await page.keyboard.press("Meta+j");
  await page.getByLabel("Number of variants").selectOption("3");
  const box = page.getByRole("textbox", { name: "Message to AI" });
  await box.fill("Make 3 variants of this screen");
  await page.keyboard.press("Enter");
  const made = page.locator(".msg.ai").last().getByRole("button", { name: "Made 3 variants side by side · View" });
  await made.waitFor({ timeout: 8000 });
  await page.locator(".composer").getByRole("button", { name: "Send" }).waitFor({ timeout: 8000 }); // the run has ended
  const files = ["scr-32-v1.html", "scr-32-v2.html", "scr-32-v3.html"];
  for (const f of files) await board(page, f).waitFor();
  // "View" still focuses the row
  await page.locator(".board.selected").first().waitFor();
  await made.click();
  await wait(300);
  assert.deepEqual(await page.locator(".board.selected").evaluateAll((els) => els.map((e) => e.getAttribute("data-file"))), files);
  for (const f of files) await board(page, f).locator(".use-btn:not([aria-disabled])", { hasText: "Use this" }).waitFor({ timeout: 8000 });
  assert.equal(await board(page, "scr-32.html").locator(".use-btn").count(), 0, "the original has no Use this");
  const v2 = (await env.read("screens/scr-32-v2.html")).replace("</body>", "<p>variant two</p></body>");
  await env.write("screens/scr-32-v2.html", v2);
  await wait(500);
  const before = await env.read("screens/scr-32.html");
  await board(page, "scr-32-v2.html").locator(".use-btn").click();
  const dlg = page.getByRole("dialog", { name: 'Apply "SCR-32 문의 variant 2" to SCR-32 문의?' });
  await dlg.waitFor();
  assert.equal(await dlg.locator(".c-body").textContent(), "SCR-32 문의 is replaced. The other 2 variants go to trash.");
  await dlg.getByRole("button", { name: "Apply" }).click();
  const toast = page.locator(".toast", { hasText: "Applied SCR-32 문의 variant 2 to SCR-32 문의" });
  await toast.waitFor();
  assert.equal(await env.read("screens/scr-32.html"), v2);
  for (const f of files) await board(page, f).waitFor({ state: "detached" });
  await toast.getByRole("button", { name: "Undo" }).click();
  for (const f of files) await board(page, f).locator(".use-btn").waitFor();
  assert.equal(await env.read("screens/scr-32.html"), before);
  // Keep all: nothing deleted, the variants are ordinary boards now
  await board(page, "scr-32-v1.html").locator(".use-btn").click();
  await page.getByRole("dialog").getByRole("button", { name: "Keep all" }).click();
  await page.locator(".toast", { hasText: "Kept all 3 variants as boards" }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.board[data-file^="scr-32"] .use-btn'));
  for (const f of files) assert.equal(await board(page, f).count(), 1);
  assert.deepEqual(env.errors, []);
});
