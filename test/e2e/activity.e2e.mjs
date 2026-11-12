// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Who changed what, driven like a user: changes by agents (X-Easel-Agent) and a file written outside Easel tag their boards with the
// author and count, the changed element is outlined, a tag opens the change with Before / After and Undo (the file comes back, the tag
// goes), your own edits tag nothing, and History under Undo lists the steps where "Go back to here" moves the canvas and Redo returns
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startEnv, wait } from "./helpers.mjs";

let env;
before(async () => (env = await startEnv()));
after(async () => env?.close());

const until = async (fn, ms = 6000) => {
  for (let t = 0; t < ms; t += 100) {
    if (await fn()) return true;
    await wait(100);
  }
  return false;
};
/** An edit through the API as an agent would make it over MCP */
async function agentText(agent, file, path, text) {
  const el = await (await fetch(`${env.url}/api/element?f=${file}&path=${path}`)).json();
  const r = await fetch(`${env.url}/api/edit`, { method: "POST", headers: { "Content-Type": "application/json", "X-Easel-Agent": agent }, body: JSON.stringify({ file, op: "setText", path, hash: el.hash, text }) });
  assert.equal(r.status, 200);
}
const tags = (page, file) => page.locator(`.board[data-file="${file}"] .act-tag`);

let orig;
test("changes by others tag their boards (author, count), the change is outlined; the popover shows it, Before / After, and Undo puts it back", async () => {
  const { page, url } = env;
  orig = { s02: await env.read("screens/scr-02.html"), s15: await env.read("screens/scr-15.html"), s32: await env.read("screens/scr-32.html") };
  await page.goto(url);
  await page.waitForSelector(".board");
  await page.keyboard.press("Shift+Digit1"); // fit all: every board on screen, labels big enough for tags
  await wait(400);
  // A file changed outside Easel (an editor, an agent's own file tools)
  await env.write("screens/scr-15.html", orig.s15.replace(">채팅<", ">Chats<"));
  await tags(page, "scr-15.html").first().waitFor({ timeout: 8000 });
  assert.equal(await tags(page, "scr-15.html").textContent(), "Outside Easel · now · 1 change");
  // Two changes by Claude Code on one board fold into one tag; one by Codex on another
  await agentText("Claude Code", "scr-02.html", "0/1/0", "Farms");
  await agentText("Claude Code", "scr-02.html", "0/1/0", "Farms nearby");
  await agentText("Codex", "scr-32.html", "0/1/1/5", "Send now");
  await page.locator('.board[data-file="scr-32.html"] .act-tag', { hasText: "Codex" }).waitFor();
  await page.locator('.board[data-file="scr-02.html"] .act-tag', { hasText: "2 changes" }).waitFor();
  assert.deepEqual(await tags(page, "scr-02.html").allTextContents(), ["Claude Code · now · 2 changes"]);
  assert.deepEqual(await tags(page, "scr-32.html").allTextContents(), ["Codex · now · 1 change"]);
  // The changed element is outlined in Codex's colour while the tag is fresh
  const outline = page.locator('.board[data-file="scr-32.html"] .change-outline');
  await outline.waitFor({ timeout: 4000 });
  assert.match(await outline.getAttribute("style"), /var\(--who-2\)/);
  // The tag's popover: who, when, the text change, Before / After, Undo
  await tags(page, "scr-32.html").click();
  const pop = page.getByRole("dialog", { name: "Change by Codex" });
  await pop.waitFor();
  assert.match(await pop.locator(".callout-top").textContent(), /Codex · just now/);
  assert.equal(await pop.locator(".callout-diff").textContent(), "“문의 보내기” → “Send now”");
  await pop.getByRole("button", { name: "Before / After" }).click();
  const cmp = page.getByRole("dialog", { name: "Compare · SCR-32 문의" });
  await cmp.waitFor();
  const beforeSrc = await cmp.locator("figure").first().locator("iframe").getAttribute("src");
  assert.match(beforeSrc, /^\/api\/history\/step-file\?id=s\d+&f=scr-32\.html$/);
  assert.match(await (await fetch(env.url + beforeSrc)).text(), /문의 보내기/);
  await cmp.getByRole("button", { name: "Close" }).click();
  await pop.getByRole("button", { name: "Undo" }).click();
  assert.ok(await until(async () => (await env.read("screens/scr-32.html")) === orig.s32), "the file is back as it was");
  assert.ok(await until(async () => (await tags(page, "scr-32.html").count()) === 0), "the tag goes");
  assert.equal(await pop.count(), 0);
  assert.equal(await tags(page, "scr-02.html").count(), 1, "other tags stay");
  assert.deepEqual(env.errors, []);
});

test("your own edits do not tag; selecting a changed board marks its tag seen (faded), and seen state survives a reload", async () => {
  const { page } = env;
  await page.locator('.board[data-file="scr-15.html"] .board-title').click();
  await page.keyboard.press("Shift+ArrowRight"); // a move made in this browser
  assert.ok(await until(async () => (await env.api("GET", "/api/history")).body.undo.at(-1) === "Move board"));
  await wait(400);
  assert.deepEqual(await tags(page, "scr-15.html").allTextContents(), ["Outside Easel · now · 1 change"], "no tag for your own move");
  assert.match(await tags(page, "scr-15.html").getAttribute("class"), /\bseen\b/);
  assert.doesNotMatch(await tags(page, "scr-02.html").getAttribute("class"), /\bseen\b/, "never-seen tags stay fresh");
  await page.reload();
  await page.waitForSelector(".act-tag");
  await wait(300);
  assert.match(await tags(page, "scr-15.html").getAttribute("class"), /\bseen\b/);
  await page.keyboard.press("Meta+z"); // take the move back so the next test starts from the agents' steps
  assert.ok(await until(async () => (await env.api("GET", "/api/history")).body.undo.at(-1) !== "Move board"));
  assert.deepEqual(env.errors, []);
});

test("History under Undo: newest first with Now; Go back to here moves the canvas to that step, Redo brings the rest back", async () => {
  const { page } = env;
  await page.getByRole("button", { name: "History", exact: true }).click();
  const menu = page.getByRole("menu", { name: "History · newest first" });
  await menu.waitFor();
  const rows = menu.getByRole("menuitem");
  const names = await rows.locator(".menu-label").allTextContents();
  assert.deepEqual(names, ["Move board SCR-15 채팅 목록", "Change heading on SCR-02 농가 목록", "Change heading on SCR-02 농가 목록", "Change heading on SCR-15 채팅 목록"]);
  // The undone steps sit above Now; Now is the newest applied one (the menu follows the history as it arrives)
  const now = menu.locator('[aria-current="step"]');
  assert.ok(await until(async () => /Claude Code/.test(await now.textContent())), "Now is on the newest applied step");
  assert.match(await now.textContent(), /Claude Code.*Change heading on SCR-02 농가 목록.*Now/);
  assert.match(await rows.first().getAttribute("class"), /\bpast\b/);
  assert.equal(await menu.locator(".menu-foot").textContent(), "History is kept for this session.");
  // Keyboard: the menu opens on Now; arrows move, the focused row offers Go back to here, Enter goes there
  const target = rows.filter({ hasText: "Outside Easel" });
  const idx = (await rows.evaluateAll((els) => els.map((e) => e.textContent))).findIndex((t) => t.includes("Outside Easel"));
  const nowIdx = (await rows.evaluateAll((els) => els.map((e) => e.getAttribute("aria-current")))).indexOf("step");
  for (let i = nowIdx; i < idx; i++) await page.keyboard.press("ArrowDown");
  assert.match(await target.textContent(), /Go back to here/);
  await page.keyboard.press("Enter");
  assert.ok(await until(async () => (await env.read("screens/scr-02.html")) === orig.s02), "both Claude Code changes are undone");
  assert.notEqual(await env.read("screens/scr-15.html"), orig.s15, "the outside change it went back to is still there");
  assert.ok(await until(async () => /Now/.test(await target.textContent())), "Now moved to that entry");
  await page.keyboard.press("Escape");
  assert.equal(await menu.count(), 0);
  // Redo brings the two steps back, one at a time (Undo/Redo shortcuts work as before)
  await page.keyboard.press("Meta+Shift+z");
  await page.keyboard.press("Meta+Shift+z");
  assert.ok(await until(async () => (await env.read("screens/scr-02.html")).includes("Farms nearby")), "Redo returns");
  assert.ok(await until(async () => (await tags(page, "scr-02.html").count()) === 1), "and so does the tag");
  assert.deepEqual(env.errors, []);
});
