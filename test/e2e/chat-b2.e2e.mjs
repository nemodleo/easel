// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// AI chat, driven like a user with the fake agent: a permission card (Allow once → the run goes on), a markdown answer,
// a run that changes two boards → result row → Undo this run → Redo, the agent picker with four agents and a custom command,
// and the transcript across a reload and a restart (divider, Restore the copy from before this run)
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";

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

async function ask(text) {
  const { page } = env;
  await page.locator(".composer").getByRole("button", { name: "Send" }).waitFor({ timeout: 8000 }); // the previous run has ended
  const box = page.getByRole("textbox", { name: "Message to AI" });
  await box.fill(text);
  await page.keyboard.press("Enter");
}

test("a run asks permission: the card shows the exact command, the run waits, Allow once folds it and the run goes on", async () => {
  const { page, url } = env;
  await page.goto(url);
  await page.waitForSelector(".board");
  await page.keyboard.press("Meta+j");
  await page.getByRole("textbox", { name: "Message to AI" }).waitFor();
  await ask("ask permission, then fix the title");
  const card = page.locator(".perm");
  await card.waitFor({ timeout: 8000 });
  assert.equal(await card.locator(".perm-cmd").textContent(), "npm install lucide-static");
  assert.match(await card.locator(".perm-head").textContent(), /Claude Code asks to run a command/);
  assert.match(await card.locator(".perm-where").textContent(), /in dc-e2e-\w+\//);
  const buttons = await card.getByRole("button").allTextContents();
  assert.deepEqual(buttons, ["Allow once", "Always allow npm install", "Deny"]);
  await page.locator(".composer .run-status", { hasText: "Waiting for you" }).waitFor();
  await page.locator(".msg-head .waiting", { hasText: "Waiting for you" }).waitFor();
  await card.getByRole("button", { name: "Allow once" }).click();
  await page.locator(".perm-done", { hasText: "Allowed · Bash npm install lucide-static" }).waitFor();
  assert.equal(await page.locator(".perm").count(), 0);
  await page.getByText("Permission answer: allow.").waitFor({ timeout: 8000 });
  await page.getByText("Fixing the scr-02 title.").waitFor();
  await page.locator(".run-result", { hasText: "Changed 1 board" }).waitFor();
  assert.equal(await page.locator(".composer .run-status").count(), 0);
  assert.deepEqual(env.errors, []);
});

test("an answer in markdown: list with a nested item, bold and italic, a code block with Copy, a safe link", async () => {
  const { page } = env;
  await ask("markdown answer please");
  const md = page.locator(".msg.ai").last().locator(".md");
  await md.locator("li", { hasText: "Prices use the Blue token" }).waitFor({ timeout: 8000 });
  await md.locator(".codeblock").waitFor();
  assert.equal(await md.locator("strong").first().textContent(), "Free");
  assert.equal(await md.locator("em").first().textContent(), "Business");
  assert.equal(await md.locator("li li").textContent(), "nested detail");
  assert.equal(await md.locator(".codeblock pre").textContent(), '<div class="plan">Team</div>');
  assert.equal(await md.locator(".codeblock button").textContent(), " Copy");
  const a = md.locator("a", { hasText: "lucide-static" });
  assert.equal(await a.getAttribute("href"), "https://lucide.dev");
  assert.equal(await a.getAttribute("target"), "_blank");
  assert.equal(await a.getAttribute("rel"), "noopener noreferrer");
  assert.equal(await md.locator("p code").first().textContent(), "screens/scr-02.html");
  assert.ok(!(await md.innerHTML()).includes("**"));
});

test("a run that changes two boards: result row with chips → Undo this run puts both back → Redo", async () => {
  const { page } = env;
  const before02 = await env.read("screens/scr-02.html");
  const before15 = await env.read("screens/scr-15.html");
  await ask("change two boards");
  const row = page.locator(".msg.ai").last().locator(".run-result");
  await row.locator(".rr-line", { hasText: "Changed 2 boards" }).waitFor({ timeout: 8000 });
  assert.equal(await row.locator(".chip").count(), 2);
  const after02 = await env.read("screens/scr-02.html");
  const after15 = await env.read("screens/scr-15.html");
  assert.notEqual(after02, before02);
  assert.notEqual(after15, before15);
  await row.getByRole("button", { name: "Undo this run" }).click();
  await row.locator(".rr-line", { hasText: "Run undone · 2 boards restored" }).waitFor();
  assert.equal(await env.read("screens/scr-02.html"), before02);
  assert.equal(await env.read("screens/scr-15.html"), before15);
  await row.getByRole("button", { name: "Redo" }).click();
  await row.getByRole("button", { name: "Undo this run" }).waitFor();
  assert.equal(await env.read("screens/scr-02.html"), after02);
  assert.equal(await env.read("screens/scr-15.html"), after15);
  // Compare opens before and after side by side
  await row.getByRole("button", { name: "Compare" }).click();
  const dlg = page.getByRole("dialog", { name: /^Compare · / });
  await dlg.waitFor();
  assert.equal(await dlg.locator("figcaption").allTextContents().then((t) => t.join("|")), "Before|After");
  await page.keyboard.press("Escape");
  await dlg.waitFor({ state: "detached" });
  assert.deepEqual(env.errors, []);
});

test("the agent picker lists four agents; a custom command is saved from the form and runs, its output shown as plain text", async () => {
  const { page } = env;
  await page.getByRole("button", { name: /^Agent: / }).click();
  const menu = page.getByRole("menu", { name: "Agent" });
  await menu.waitFor();
  assert.deepEqual((await menu.getByRole("menuitemradio").allTextContents()).slice(0, 4), ["Claude Code", "Codex", "Cursor Agent", "Gemini CLI"]);
  const missing = menu.locator(".agent-item.off");
  for (let i = 0; i < (await missing.count()); i++) assert.equal(await missing.nth(i).getByRole("link", { name: "How to install" }).getAttribute("target"), "_blank");
  await menu.getByRole("button", { name: "Check again" }).click();
  await menu.getByText(/^Checked again at \d\d:\d\d$/).waitFor();
  await menu.getByRole("menuitem", { name: "Custom command…" }).click();
  const form = page.getByRole("dialog", { name: "Custom command" });
  await form.getByLabel("Name").fill("Echo");
  const script = path.join(env.dir, "echo.mjs");
  await env.write("echo.mjs", "console.log('custom said: ' + process.argv[2].split('\\n').at(-1));\n");
  await form.getByLabel("Command").fill(`node ${script}`);
  await form.getByRole("button", { name: "Save" }).click();
  await form.getByText("Put {prompt} where your request should go").waitFor();
  await form.getByLabel("Command").fill(`node ${script} {prompt}`);
  await form.getByRole("button", { name: "Save" }).click();
  await form.waitFor({ state: "detached" });
  await page.getByRole("button", { name: /^Agent: Echo/ }).waitFor();
  await ask("hello there");
  await page.locator(".ai-plain", { hasText: "custom said: hello there" }).waitFor({ timeout: 8000 });
  assert.deepEqual(env.errors, []);
});

test("the transcript survives a reload; after a restart a divider shows and an older run offers to restore its pre-run copy", async () => {
  const { page } = env;
  await page.reload();
  await page.waitForSelector(".board");
  await page.keyboard.press("Meta+j");
  const row = page.locator(".run-result", { hasText: "Changed 2 boards" });
  await row.getByRole("button", { name: "Undo this run" }).waitFor({ timeout: 8000 });
  const edited = await env.read("screens/scr-15.html");
  await env.restart();
  await page.locator(".restart", { hasText: /^Easel restarted · \d\d:\d\d$/ }).waitFor({ timeout: 15000 });
  await row.getByRole("button", { name: "Restore the copy from before this run" }).waitFor();
  assert.match(await row.locator(".sub").textContent(), /^Saved [A-Z][a-z]{2} \d{1,2}, \d\d:\d\d$/);
  assert.equal(await row.getByRole("button", { name: "Undo this run" }).count(), 0);
  await row.getByRole("button", { name: "Restore the copy from before this run" }).click();
  const dlg = page.getByRole("dialog", { name: "Restore the copy from before this run?" });
  assert.match(await dlg.textContent(), /puts the whole canvas back to/);
  await dlg.getByRole("button", { name: "Restore" }).click();
  await page.locator(".run-result.undone", { hasText: "Canvas restored to the copy from before this run" }).waitFor();
  assert.notEqual(await env.read("screens/scr-15.html"), edited);
  assert.doesNotMatch(await env.read("screens/scr-15.html"), /fake edit/);
  assert.deepEqual(env.errors, []);
});
