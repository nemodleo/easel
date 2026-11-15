// AI-generated with Claude Code, 2026-11-15, reviewed by Hyun Park
// Direction A, the overlays: the first-run hints share the context line (as wide as the dock, nothing floats over a board); History
// rises 8px above the dock with its right edge on the dock's, the context line empty meanwhile, who read from a glyph and a name;
// Share drops 8px under the header's buttons with its right edge on the card's, Export grey; tags on boards carry a glyph, never an
// author colour; New board's menu rises above the dock instead of covering it. The orange stays on Ask AI throughout.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startEnv, wait } from "./helpers.mjs";

let env;
before(async () => (env = await startEnv()));
after(async () => env?.close());

const box = (page, sel) => page.locator(sel).first().boundingBox();
/** Visible elements filled or written in --accent, outside the boards' own content */
const orange = (page) =>
  page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const acc = getComputedStyle(probe).color;
    probe.remove();
    const own = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    return [...document.querySelectorAll(".app *")]
      .filter((e) => e.getClientRects().length && !e.closest(".board-frame") && getComputedStyle(e).visibility !== "hidden")
      .filter((e) => getComputedStyle(e).backgroundColor === acc || (own(e) && getComputedStyle(e).color === acc))
      .map((e) => String(e.className));
  });
async function agentText(agent, file, path, text) {
  const el = await (await fetch(`${env.url}/api/element?f=${file}&path=${path}`)).json();
  const r = await fetch(`${env.url}/api/edit`, { method: "POST", headers: { "Content-Type": "application/json", "X-Easel-Agent": agent }, body: JSON.stringify({ file, op: "setText", path, hash: el.hash, text }) });
  assert.equal(r.status, 200);
}

test("first run: both hints in the context line, as wide as the dock and 8px above it; the first key puts them away", async () => {
  const { page, url } = env;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  const hint = page.locator(".canvas-hint.oc-first");
  await hint.waitFor();
  await wait(300);
  assert.match(await hint.textContent(), /^Click anything on a board to select it · double-click text to edit it.*to ask the AI for a change$/);
  assert.equal(await hint.locator("kbd").count(), 1);
  const h = await box(page, ".canvas-hint.oc-first");
  const d = await box(page, ".oc-dock");
  assert.equal(h.x, d.x, "left edges in line");
  assert.equal(h.width, d.width, "as wide as the dock");
  assert.equal(d.y - (h.y + h.height), 8, "8px above the dock");
  assert.equal(await page.locator(".first-run").count(), 0, "nothing floats near the top");
  assert.deepEqual(await orange(page), ["ask-ai "]);
  await wait(1400);
  await page.keyboard.press("Shift");
  await hint.waitFor({ state: "detached" });
  await page.locator(".canvas-hint:not(.oc-first)").waitFor();
  assert.deepEqual(env.errors, []);
});

test("History: 8px above the dock, right edges in line; the context line is empty while it is open; who is a glyph and a name", async () => {
  const { page } = env;
  await agentText("Codex", "scr-32.html", "0/1/1/5", "Send now");
  await page.locator('.board[data-file="scr-32.html"] .act-tag').first().waitFor({ timeout: 8000 });
  await page.keyboard.press("Escape");
  await page.locator(".canvas-hint").waitFor();
  const caret = page.getByRole("button", { name: "History", exact: true });
  await caret.click();
  const menu = page.getByRole("menu", { name: "History · newest first" });
  await menu.waitFor();
  await wait(300);
  assert.equal(await caret.getAttribute("aria-expanded"), "true");
  assert.match(await caret.getAttribute("class"), /\bon\b/);
  const m = await menu.boundingBox();
  const d = await box(page, ".oc-dock");
  assert.equal(Math.round(m.x + m.width), Math.round(d.x + d.width), "right edges in line");
  assert.equal(Math.round(d.y - (m.y + m.height)), 8, "8px above the dock");
  assert.equal(await page.locator(".canvas-hint, .etb.oc-context").count(), 0, "the context line is empty");
  const now = menu.locator('[aria-current="step"]');
  assert.match(await now.textContent(), /^Codex.*Now/);
  assert.equal(await now.locator(".oc-who svg").count(), 1, "a glyph before the name");
  // The Now dot is ink, not orange; nothing in the menu is orange
  assert.notEqual(await now.locator(".oc-now-dot").evaluate((e) => getComputedStyle(e).backgroundColor), "rgba(0, 0, 0, 0)");
  assert.deepEqual(await orange(page), ["ask-ai "]);
  assert.equal(await menu.locator(".menu-foot").textContent(), "History is kept for this session.");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  await page.locator(".canvas-hint").waitFor();
  assert.deepEqual(env.errors, []);
});

test("tags on boards: a glyph and the name, no author colour; New board's menu rises above the dock and empties the context line", async () => {
  const { page } = env;
  const tag = page.locator('.board[data-file="scr-32.html"] .act-tag').first();
  assert.equal(await tag.locator("svg").count(), 1);
  assert.equal(await tag.locator("[style*=background]").count(), 0, "no colour dot");
  assert.equal(await page.locator(".change-outline[style*='--who']").count(), 0);
  await page.locator(".oc-dock .new-board").click();
  const nb = page.getByRole("menu").first();
  await nb.waitFor();
  await wait(250);
  const m = await nb.boundingBox();
  const d = await box(page, ".oc-dock");
  assert.equal(Math.round(d.y - (m.y + m.height)), 8, "8px above the dock, not over it");
  assert.equal(await page.locator(".canvas-hint").count(), 0);
  await page.keyboard.press("Escape");
  assert.deepEqual(env.errors, []);
});

test("Share: 8px under the header's buttons, right edge on the card's edge; Export is grey", async () => {
  const { page } = env;
  await page.locator(".share-btn").click();
  const pop = page.locator(".share-pop.oc-share");
  await pop.waitFor();
  await wait(250);
  const p = await pop.boundingBox();
  const card = await box(page, ".oc-right");
  const btn = await box(page, ".share-btn");
  assert.equal(p.x + p.width, card.x + card.width, "right edges in line");
  assert.equal(p.y, btn.y + btn.height + 8);
  assert.equal(p.width, 384);
  assert.equal(await pop.locator(".oc-orow > .btn", { hasText: "Export" }).count(), 3);
  assert.deepEqual(await orange(page), ["ask-ai "], "the Export buttons are grey");
  await page.keyboard.press("Escape");
  await pop.waitFor({ state: "detached" });
  assert.deepEqual(env.errors, []);
});
