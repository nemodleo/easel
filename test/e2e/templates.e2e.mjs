// AI-generated with Claude Code, 2026-11-27
// New board menu (#3): blank, then the screens from watch to desktop, then document and email, split by lines. Picking Tablet
// makes tablet.html at 834×1194, and the new templates render with every link a 48px touch target and readable text
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startEnv, wait } from "./helpers.mjs";

let env;
before(async () => (env = await startEnv()));
after(async () => env?.close());

test("New board lists the templates in groups, and Tablet makes an 834×1194 board", async () => {
  const { page, url } = env;
  await page.goto(url);
  await page.waitForSelector(".board");
  await page.locator(".oc-dock .new-board").click();
  const menu = page.getByRole("menu").first();
  await menu.waitFor();
  const rows = await menu.locator(".menu-item, .menu-sep").evaluateAll((els) => els.map((e) => (e.classList.contains("menu-sep") ? "—" : e.querySelector(".menu-label")?.textContent ?? e.textContent)));
  assert.deepEqual(rows, [
    "Blank · 390×844",
    "—",
    "Watch screen · 198×242",
    "Mobile screen · 390×844",
    "Tablet screen · 834×1194",
    "Desktop screen · 1440×900",
    "—",
    "Document · 800×1000",
    "Email · 600×1200",
  ]);
  await menu.getByRole("menuitem", { name: /Tablet screen/ }).click();
  let b;
  for (let i = 0; i < 60 && !b; i++) {
    await wait(100);
    b = (await env.api("GET", "/api/board")).body.board.boards["tablet.html"];
  }
  assert.ok(b, "tablet.html is on the canvas");
  assert.deepEqual([b.w, b.h, b.title], [834, 1194, "Tablet screen"]);
  assert.match(await env.read("screens/tablet.html"), /<meta name="board-size" content="834x1194">/);
  assert.deepEqual(env.errors, []);
});

test("tablet, watch and email render with 48px touch targets and no text below 4.5:1", async () => {
  const { page, url } = env;
  for (const template of ["tablet", "watch", "email"]) {
    const { body } = await env.api("POST", "/api/boards/create", { template, file: `t-${template}.html`, x: 0, y: 4000 });
    await page.goto(`${url}/screens/${body.file}`);
    const issues = await page.evaluate(() => {
      const out = [];
      if (!document.querySelector(".x-dc a[href]")) out.push("no link rendered");
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+/g).slice(0, 3).map((v) => {
          const s = Number(v) / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const bg = (el) => {
        for (let n = el; n; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && c !== "rgba(0, 0, 0, 0)") return c;
        }
        return "rgb(255, 255, 255)";
      };
      for (const a of document.querySelectorAll("a[href], button")) {
        const r = a.getBoundingClientRect();
        if (r.width < 48 && r.height < 48) out.push(`target ${a.textContent} ${r.width}×${r.height}`);
      }
      for (const el of document.body.querySelectorAll("*")) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const [l1, l2] = [lum(getComputedStyle(el).color), lum(bg(el))].sort((x, y) => y - x);
        const ratio = (l1 + 0.05) / (l2 + 0.05);
        if (ratio < 4.5) out.push(`contrast ${el.textContent.trim()} ${ratio.toFixed(2)}`);
      }
      const frame = document.querySelector(".x-dc > div").getBoundingClientRect();
      for (const el of document.body.querySelectorAll(".x-dc *")) {
        const r = el.getBoundingClientRect();
        if (r.right > frame.right + 0.5) out.push(`overflows ${el.tagName} ${el.textContent.trim().slice(0, 20)}`);
      }
      return out;
    });
    assert.deepEqual(issues, [], template);
  }
});
