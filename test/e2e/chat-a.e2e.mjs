// AI-generated with Claude Code, 2026-11-15, reviewed by Hyun Park
// Direction A, the AI chat: the inspector card is the chat when the AI tab is on. Ask AI turns grey and Send carries the one orange;
// the composer is pinned to the card's foot; running has no orange and a ring that keeps turning under Reduce motion; a permission
// request's Allow once is the one orange; not ready hangs the agent menu over the canvas and greys Send with its reason; a failed run
// says Failed in --warn, opens Details in place and puts the request back with Send ready.
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";

import { startEnv, TOOL, wait } from "./helpers.mjs";

let env;
before(async () => {
  process.env.DESIGN_CANVAS_AGENT_CMD = JSON.stringify({ claude: ["node", path.join(TOOL, "test/e2e/fake-agent.mjs")], codex: ["node", path.join(TOOL, "test/fixtures/fake-agent-fail.mjs")] });
  env = await startEnv();
});
after(async () => {
  delete process.env.DESIGN_CANVAS_AGENT_CMD;
  await env?.close();
});

const box = (page, sel) => page.locator(sel).first().boundingBox();
/** Visible elements in the app (and its menus) whose background is --accent */
const orange = (page) =>
  page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const acc = getComputedStyle(probe).color;
    probe.remove();
    return [...document.querySelectorAll(".app *, .menu *")].filter((e) => e.getClientRects().length && getComputedStyle(e).backgroundColor === acc).map((e) => e.textContent.trim() || e.className);
  });
const color = (page, name) =>
  page.evaluate((name) => {
    const probe = document.createElement("i");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);
async function openChat(agent = "claude") {
  const { page, url } = env;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate((agent) => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("easel:chat:")) localStorage.removeItem(k);
    localStorage.setItem("design-canvas:agent", agent);
  }, agent);
  await page.goto(url);
  await page.waitForSelector(".board");
  await page.keyboard.press("Meta+j");
  await page.getByRole("textbox", { name: "Message to AI" }).waitFor();
  await wait(300);
}
async function ask(text) {
  const { page } = env;
  await page.locator(".composer").getByRole("button", { name: "Send" }).waitFor({ timeout: 8000 });
  await page.getByRole("textbox", { name: "Message to AI" }).fill(text);
  await page.keyboard.press("Enter");
}

test("the chat fills the inspector card: Ask AI grey, Send the one orange, head rows, the composer pinned to the card's foot, a blue focus", async () => {
  const { page } = env;
  await openChat();
  const card = await box(page, ".oc-right");
  assert.equal(card.y + card.height, 888, "full height");
  assert.equal(await page.locator(".oc-rhead .ask-ai.on").count(), 1);
  assert.deepEqual(await page.locator(".chat-head .oc-field .pp-l").allTextContents(), ["Agent", "Model"]);
  // The action row on the card's foot, 48 high; the text box focused with the 2px --select ring, not orange
  const bar = await box(page, ".composer-bar");
  assert.equal(bar.y + bar.height, 888);
  assert.equal(bar.height, 48);
  const ring = await page.getByRole("textbox", { name: "Message to AI" }).evaluate((t) => getComputedStyle(t).boxShadow);
  assert.ok(ring.includes(await color(page, "--select")), ring);
  await page.getByRole("textbox", { name: "Message to AI" }).fill("Make it calmer");
  await wait(300); // Send turns from grey to orange in 100ms
  assert.deepEqual(await orange(page), ["Send"]);
  // A run: tool lines in one quiet list, the answer as plain text, the result under a hairline; the composer does not move
  await ask("markdown answer please");
  const row = page.locator(".msg.ai").last().locator(".run-result");
  await row.locator(".rr-line", { hasText: "Changed 1 board" }).waitFor({ timeout: 8000 });
  assert.equal(await page.locator(".msg.ai .oc-tools .ai-tool", { hasText: "Edit" }).count(), 1);
  assert.equal(await page.locator(".msg.ai .ai-text").evaluate((e) => getComputedStyle(e).backgroundColor), "rgba(0, 0, 0, 0)");
  assert.deepEqual((await row.locator(".btn-row button").allTextContents()).map((x) => x.trim()), ["Undo this run", "Compare"]);
  assert.equal(await row.locator(".oc-rr-top .chip").count(), 1, "the changed board as a chip on the result's first row");
  assert.deepEqual(await box(page, ".composer-bar"), bar);
  // The answer's link is ink, not a second orange
  assert.equal(await page.locator(".md a").evaluate((a) => getComputedStyle(a).color), await color(page, "--text"));
  assert.deepEqual(env.errors, []);
});

test("running: Cancel stands where Send stood with no orange, Agent, Model and New chat are off, the ring turns under Reduce motion", async () => {
  const { page } = env;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ask("please go slow");
  await page.locator(".msg-head .spinner").waitFor({ timeout: 8000 });
  assert.equal(await page.locator(".chat-head-row.sub .muted").textContent(), "Running");
  for (const sel of [".agent-btn", ".model-field", ".new-chat"]) assert.equal(await page.locator(sel).isDisabled(), true, sel);
  assert.equal(await page.getByRole("textbox", { name: "Message to AI" }).getAttribute("placeholder"), "Running… (Esc to cancel)");
  const spin = await page.locator(".msg-head .spinner").evaluate((e) => ({ d: getComputedStyle(e).animationDuration, n: getComputedStyle(e).animationIterationCount, w: e.offsetWidth }));
  assert.deepEqual(spin, { d: "0.8s", n: "infinite", w: 12 });
  assert.deepEqual(await orange(page), []);
  const cancel = page.locator(".composer-bar .oc-cancel");
  assert.equal((await cancel.boundingBox()).x + (await cancel.boundingBox()).width, 1420, "Cancel's right edge where Send's was");
  await cancel.click();
  await page.locator(".msg-head", { hasText: "Cancelled" }).waitFor({ timeout: 5000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert.deepEqual(env.errors, []);
});

test("a permission request is the last thing in the thread: ink dot, Allow once the one orange across the card, Waiting for you over the chips", async () => {
  const { page } = env;
  await ask("ask permission, then stop");
  const card = page.locator(".perm");
  await card.waitFor({ timeout: 8000 });
  assert.equal(await card.locator(".perm-head .idot").evaluate((e) => getComputedStyle(e).backgroundColor), await color(page, "--text"));
  assert.deepEqual(await orange(page), ["Allow once"]);
  const allow = await box(page, ".perm .btn.primary");
  const perm = await card.boundingBox();
  assert.equal(allow.width, perm.width - 16, "full width inside the block's 8px inset");
  assert.equal(await page.locator(".composer .run-status").textContent(), "Waiting for you· answer the request above");
  await card.getByRole("button", { name: "Allow once" }).click();
  await page.locator(".perm-done").waitFor();
  await page.locator(".composer").getByRole("button", { name: "Send" }).waitFor({ timeout: 8000 });
  assert.deepEqual(env.errors, []);
});

test("not ready: the agent menu hangs from the field over the canvas, the notice pins above the composer, Send is grey with its reason", async () => {
  const { page } = env;
  await page.route("**/api/agents", (r) =>
    r.fulfill({ json: { agents: [{ id: "claude", label: "Claude Code", status: "signin", ok: true }, { id: "codex", label: "Codex", status: "ready", ok: true }], checkedAt: new Date().toISOString() } }),
  );
  await openChat();
  await page.locator(".remedy", { hasText: "claude auth login" }).waitFor({ timeout: 8000 });
  assert.deepEqual(await page.locator(".remedy").getByRole("button").allTextContents().then((t) => t.map((x) => x.trim())), ["Copy command", "Check again"]);
  await page.getByRole("textbox", { name: "Message to AI" }).fill("Now do the same on Habit detail.");
  const send = page.locator(".composer").getByRole("button", { name: "Send" });
  assert.equal(await send.isDisabled(), true);
  assert.equal(await page.locator(".send-why").textContent().then((t) => t.trim()), "Sign in to Claude Code to send");
  assert.deepEqual(await orange(page), []);
  // The menu renders on document.body, so the card's edge does not clip it; right edges flush, 4px under the field
  await page.getByRole("button", { name: /^Agent: Claude Code — sign-in needed/ }).click();
  const menu = page.getByRole("menu", { name: "Agent" });
  await menu.waitFor();
  await wait(300); // it appears with a 4px rise in 180ms
  assert.equal(await menu.evaluate((m) => m.parentElement === document.body), true);
  const field = await box(page, ".agent-btn");
  const m = await menu.boundingBox();
  assert.equal(m.x + m.width, field.x + field.width);
  assert.equal(m.y, field.y + field.height + 4);
  assert.ok(m.x < (await box(page, ".oc-right")).x, "hangs over the canvas");
  assert.equal(await menu.locator(".agent-status.signin").textContent(), "sign-in needed");
  // Keys follow it to the body: the checked agent has focus; Esc closes it and gives focus back to the field
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-checked")), "true");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("agent-btn")), true);
  await page.unroute("**/api/agents");
  assert.deepEqual(env.errors, []);
});

test("run failed: Failed in --warn next to the agent, Retry and Switch, Details opens in place with Copy, the request comes back with Send ready", async () => {
  const { page } = env;
  await openChat("codex");
  await ask("Now do the same on Habit detail.");
  const fail = page.locator(".ai-fail");
  await fail.waitFor({ timeout: 8000 });
  const failed = page.locator(".msg-head .oc-failed");
  assert.equal(await failed.textContent(), "Failed");
  assert.equal(await failed.evaluate((e) => getComputedStyle(e).color), await color(page, "--warn"));
  assert.match(await fail.locator(".ai-error").textContent(), /^Codex hit its usage limit\. Try again after Nov 26th, 2026 9:14 AM, or switch agent\.$/);
  assert.deepEqual(await fail.locator(".btn-row button").allTextContents(), ["Retry", "Switch to Claude Code"]);
  await fail.locator(".ai-details summary").click();
  await fail.locator(".ai-details pre", { hasText: "Exit code 1" }).waitFor();
  await fail.getByRole("button", { name: "Copy" }).waitFor();
  assert.equal(await fail.locator("p.muted").textContent(), "No files were changed.");
  assert.equal(await page.getByRole("textbox", { name: "Message to AI" }).inputValue(), "Now do the same on Habit detail.");
  assert.equal(await page.locator(".composer .restored").textContent(), "Restored from the failed message");
  await wait(300);
  assert.deepEqual(await orange(page), ["Send"]);
  assert.deepEqual(env.errors, []);
});

test("440 wide: the chat opens as a sheet tall enough for its head, a few lines of thread and the composer; focus does not scroll its head away", async () => {
  const { page, url } = env;
  await page.setViewportSize({ width: 440, height: 700 });
  await page.goto(url);
  await page.waitForSelector(".board");
  await page.getByRole("button", { name: "AI chat" }).click();
  await page.getByRole("textbox", { name: "Message to AI" }).focus();
  await wait(400);
  const sheet = await box(page, ".oc-right.oc-sheet");
  assert.ok(sheet.height >= 480, `sheet ${sheet.height}`);
  assert.equal(await page.locator(".oc-right").evaluate((c) => c.scrollTop), 0);
  const bar = await box(page, ".composer-bar");
  assert.equal(bar.y + bar.height, sheet.y + sheet.height, "the action row on the sheet's foot");
  assert.ok((await box(page, ".chat-head")).y >= sheet.y + 48, "the head under the card's header");
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.deepEqual(env.errors, []);
});
