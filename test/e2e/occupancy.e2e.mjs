// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Several agents on one canvas, driven like a user: two MCP clients (the real bin/mcp.mjs, as Claude Code and Codex) write the same
// board → a fork appears beside it with the arrow and both labels, list dots → both disconnect (done) → Use this one on the fork →
// the original has the fork's content, the fork is in trash, the toast's Undo brings both back. Then the chat's variants: Use this →
// confirm → toast → Undo, and Keep all. Last, three agents on one board: their two forks sit side by side in one row as one block with
// one arrow and a one-line caption, one-row labels at 31% and full ones at 100%, the pick from a compact label, a fork dragged away.
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
/** Ctrl+wheel over a point until the canvas shows zoom z (within 2%) */
async function zoomTo(page, z, at = { x: 800, y: 400 }) {
  const zoom = () => page.evaluate(() => +document.querySelector(".world").style.transform.match(/scale\(([\d.]+)\)/)[1]);
  for (let i = 0; i < 200; i++) {
    const now = await zoom();
    if (Math.abs(now - z) / z < 0.02) break;
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, now < z ? -4 : 4);
    await page.keyboard.up("Control");
    await wait(20);
  }
  await wait(400);
  return zoom();
}
/** Selects boards by their rows in the board list and zooms to them */
async function zoomToBoards(page, files) {
  for (const [i, f] of files.entries()) await page.locator(`.oc-left .row[title="${f}"]`).click({ modifiers: i ? ["Shift"] : [] });
  await page.keyboard.press("Shift+Digit2");
  await wait(500);
}

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
  await zoomToBoards(page, ["scr-15.html", "scr-15-codex.html"]);
  await page.keyboard.press("Escape");
  assert.ok((await zoomTo(page, 0.8)) >= 0.5, "full labels");
  const caption = page.locator('.fork-link[data-fork="scr-15-codex.html"] .fork-caption');
  await caption.waitFor();
  // One fork is a block of its own: its caption is the longest form that fits 390px at this zoom; the arrow carries the whole of it
  assert.match(await caption.textContent(), /^Fork of SCR-15 채팅 목록( · made while Claude Code was editing)?$/);
  assert.equal(await page.locator('.fork-link[data-fork="scr-15-codex.html"]').getAttribute("aria-label"), "Fork of SCR-15 채팅 목록 · made while Claude Code was editing");
  assert.match(await board(page, "scr-15-codex.html").locator(".board-label").getAttribute("title"), /\nForked \d\d:\d\d — Codex started while Claude Code was editing$/);
  assert.equal(await board(page, "scr-15.html").locator(".occ-tag").textContent(), "Claude Code is editing…");
  assert.equal(await board(page, "scr-15-codex.html").locator(".occ-tag").textContent(), "Codex is editing…");
  assert.equal(await board(page, "scr-15-codex.html").locator(".board-title").textContent(), "SCR-15 채팅 목록 · Codex");
  assert.equal(await page.locator('.oc-left .row[title="scr-15.html"] .occ-dot').getAttribute("aria-label"), "Claude Code is editing");
  assert.equal(await page.locator('.oc-left .row[title="scr-15-codex.html"] .occ-dot').getAttribute("aria-label"), "Codex is editing");
  const useFork = board(page, "scr-15-codex.html").locator(".use-btn");
  assert.equal(await useFork.getAttribute("aria-disabled"), "true", "waits while either is still editing");
  assert.equal(await useFork.getAttribute("title"), "Wait until Claude Code is done editing");
  assert.equal(await board(page, "scr-15.html").locator(".use-btn").textContent(), "Use this one");
  // Both finish (their clients disconnect): done labels, Use this one becomes available
  await claude.close();
  await codex.close();
  await board(page, "scr-15.html").locator(".occ-tag.done", { hasText: /^Claude Code · done \d\d:\d\d$/ }).waitFor({ timeout: 8000 });
  await board(page, "scr-15-codex.html").locator(".occ-tag.done", { hasText: /^Codex · done \d\d:\d\d$/ }).waitFor();
  assert.equal(await page.locator(".oc-left .occ-dot").count(), 0, "no dots once nobody is editing");
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
  await page.locator('.oc-left .row[title="scr-32.html"]').click();
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

test("three agents on one board: one block with one arrow and a one-line caption; compact labels at 31%, full at 100%; pick from a compact label; a fork dragged away", async () => {
  const { page } = env;
  const orig = await env.read("screens/f-3.html");
  const agents = [await agent("claude-code"), await agent("codex-mcp-client"), await agent("cursor-vscode")];
  const by = ["Claude Code", "Codex", "Cursor"];
  const forks = ["f-3-codex.html", "f-3-cursor.html"];
  try {
    const rs = [];
    for (const [i, a] of agents.entries()) rs.push(reply(await a.callTool({ name: "write_board", arguments: { file: "f-3.html", html: orig.replace("</body>", `<p>by ${by[i]}</p></body>`) } })));
    assert.deepEqual(rs.map((r) => [r.file, r.forked]), [["f-3.html", false], ...forks.map((f) => [f, true])]);
    const bd = JSON.parse(await env.read("board.json")).boards;
    const [a, b] = forks.map((f) => bd[f]);
    assert.equal(b.y, a.y, "one row");
    assert.equal(b.x, a.x + a.w + 80, "right beside the first fork");
    for (const f of ["f-3.html", ...forks]) await board(page, f).waitFor({ timeout: 8000 });
    // 31%: one arrow and one caption for the block, on one line; one-row labels, a fork's showing its agent
    await zoomToBoards(page, ["f-3.html", ...forks]);
    await page.keyboard.press("Escape");
    const fr = await board(page, forks[0]).locator(".board-frame").boundingBox();
    const z = await zoomTo(page, 0.31, { x: fr.x + fr.width / 2, y: fr.y + fr.height / 2 });
    assert.ok(Math.abs(z - 0.31) < 0.01, `zoom ${z}`);
    const links = page.locator('.fork-link[data-forks*="f-3-"]');
    assert.equal(await links.count(), 1, "one arrow for the block");
    assert.deepEqual((await links.getAttribute("data-forks")).split(" ").sort(), forks);
    assert.equal(await links.getAttribute("data-fork"), forks[0], "the arrow ends at the block's top-left fork");
    assert.equal(await links.locator(".fork-svg").count(), 1);
    assert.equal(await links.locator(".fork-caption").count(), 1, "one caption, none per fork");
    const cap = links.locator(".fork-caption span");
    assert.equal(await cap.textContent(), "2 forks of F-3 흐름 · made while Claude Code was editing", "the block is 1680 × 0.31 = 520px wide: the long form fits");
    const capBox = await cap.boundingBox();
    assert.ok(capBox.height <= 17, `one line (${capBox.height}px)`);
    for (const f of forks) {
      const label = board(page, f).locator(".board-label");
      assert.match(await label.getAttribute("class"), /\bcompact\b/);
      assert.equal(Math.round((await label.locator(".lab-row").boundingBox()).height), 24);
      assert.equal(await label.locator(".occ-tag.fork-who").count(), 1);
      assert.equal(await label.locator(".act-tags").count(), 0, "no tags in a compact label");
    }
    await board(page, forks[0]).locator(".fork-who", { hasText: /^Codex$/ }).waitFor();
    // Nothing of the block's labels or caption on a neighbouring board or its label
    const overlaps = await page.evaluate((forks) => {
      const R = (el) => el.getBoundingClientRect();
      const mine = [...forks.map((f) => document.querySelector(`.board[data-file="${f}"] .board-label`)), document.querySelector('.fork-link[data-forks*="f-3-"] .fork-caption span')];
      const others = [...document.querySelectorAll(".board")].flatMap((bd) => [...bd.querySelectorAll(":scope > .board-frame, :scope > .board-label")].map((el) => ({ f: bd.dataset.file, el })));
      const hits = [];
      for (const m of mine) {
        const p = R(m);
        for (const { f, el } of others) {
          if (m.closest(".board") && m.closest(".board") === el.closest(".board")) continue;
          const q = R(el);
          if (p.left < q.right - 0.5 && p.right > q.left + 0.5 && p.top < q.bottom - 0.5 && p.bottom > q.top + 0.5) hits.push(`${m.className} × ${f} ${el.className}`);
        }
      }
      return hits;
    }, forks);
    assert.deepEqual(overlaps, []);
    // 100%: full labels, the tags in one row
    await zoomTo(page, 1, { x: fr.x + fr.width / 2, y: fr.y });
    for (const f of forks) {
      const label = board(page, f).locator(".board-label");
      await label.locator(".act-tags").waitFor();
      assert.doesNotMatch(await label.getAttribute("class"), /\bcompact\b/);
      assert.equal(Math.round((await label.locator(".act-tags").boundingBox()).height), 24, "one tag row");
      assert.equal(Math.round((await label.boundingBox()).height), 56);
    }
    // Done: everyone disconnects
    for (const c of agents) await c.close();
    for (const f of ["f-3.html", ...forks]) await board(page, f).locator(".occ-tag.done").waitFor({ timeout: 8000 });
    // Cursor dragged away from the block: its own arrow and "Fork of …"
    const moved = (await env.api("POST", "/api/place", { file: forks[1], x: a.x, y: a.y + a.h + 1600 })).body.board;
    assert.deepEqual([moved.x, moved.y], [a.x, a.y + a.h + 1600]);
    await page.locator('.fork-link[data-forks="f-3-cursor.html"]').waitFor({ state: "attached", timeout: 8000 });
    assert.equal(await page.locator('.fork-link[data-forks*="f-3-"]').count(), 2);
    assert.equal(await page.locator('.fork-link[data-forks="f-3-codex.html"]').getAttribute("aria-label"), "Fork of F-3 흐름 · made while Claude Code was editing");
    await zoomTo(page, 0.31);
    // At 31% each one-fork block is 800 × 0.31 = 248px wide: too narrow for the long text, so the medium one, which names the board
    for (const f of forks) {
      const c = page.locator(`.fork-link[data-forks="${f}"] .fork-caption`);
      assert.equal(await c.textContent(), "Fork of F-3 흐름");
      assert.notEqual(await c.evaluate((e) => e.style.visibility), "hidden");
    }
    // Selecting a fork at 31% shows the pick in its compact label: the check alone, named "Use this one"; it works
    await board(page, forks[0]).locator(".board-label").click();
    const use = board(page, forks[0]).locator(".use-btn.icon-only");
    await use.waitFor();
    assert.equal(await use.getAttribute("aria-label"), "Use this one");
    assert.equal(await use.getAttribute("title"), "Use this one");
    assert.equal(await use.locator(".use-label").count(), 0);
    await page.waitForFunction(() => document.querySelector('.board[data-file="f-3-codex.html"] .use-btn')?.getAttribute("aria-disabled") == null);
    await use.click();
    const dlg = page.getByRole("dialog", { name: 'Use "F-3 흐름 · Codex" for F-3 흐름?' });
    await dlg.waitFor();
    assert.equal(await dlg.locator(".c-body").textContent(), "F-3 흐름 is replaced by this version. This fork and the other fork go to trash.");
    assert.deepEqual(await dlg.getByRole("button").allTextContents(), ["Apply", "Keep all"]);
    await dlg.getByRole("button", { name: "Apply" }).click();
    await page.locator(".toast", { hasText: "Applied F-3 흐름 · Codex to F-3 흐름" }).waitFor();
    assert.equal(await env.read("screens/f-3.html"), orig.replace("</body>", "<p>by Codex</p></body>"), "the original has the fork's content");
    for (const f of forks) await board(page, f).waitFor({ state: "detached" });
    assert.equal(await page.locator('.fork-link[data-forks*="f-3-"]').count(), 0);
    assert.deepEqual(env.errors, []);
  } finally {
    for (const c of agents) await c.close().catch(() => {});
  }
});
