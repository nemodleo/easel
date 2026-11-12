// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Shared e2e setup: copies the design folder (default test/fixtures/design) to a temp folder and starts a separate server (the original is untouched).
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
export const TOOL = path.resolve(here, "../..");
// Design folder for tests: defaults to the small fixture in this repo. To run against a real project folder, set DESIGN_CANVAS_E2E_DIR=<docs/design>
export const REPO_DESIGN = process.env.DESIGN_CANVAS_E2E_DIR ? path.resolve(process.env.DESIGN_CANVAS_E2E_DIR) : path.resolve(TOOL, "test/fixtures/design");

const freePort = () =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });

export async function startEnv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-e2e-"));
  await fs.cp(REPO_DESIGN, dir, { recursive: true, filter: (src) => !src.endsWith("feedback.md") });
  const port = await freePort();
  // EASEL_HOME: the running-canvas registry goes to the temp folder, never to the real ~/.easel
  let log = "";
  let proc;
  const url = `http://localhost:${port}`;
  const boot = async () => {
    proc = spawn(process.execPath, [path.join(TOOL, "bin/server.mjs"), "--dir", dir, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, EASEL_HOME: path.join(dir, ".easel-home") } });
    proc.stdout.on("data", (d) => (log += d));
    proc.stderr.on("data", (d) => (log += d));
    for (let i = 0; i < 600; i++) {
      try {
        if ((await fetch(url + "/api/health")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  await boot();
  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    browser = await chromium.launch({ channel: "chrome" });
  }
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return {
    dir,
    url,
    page,
    errors,
    log: () => log,
    read: (rel) => fs.readFile(path.join(dir, rel), "utf8"),
    write: (rel, text) => fs.writeFile(path.join(dir, rel), text),
    api: async (method, p, body) => {
      const r = await fetch(url + p, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    /** Stops the server and starts it again on the same port and folder (its in-memory undo history is gone) */
    async restart() {
      const done = new Promise((r) => proc.once("exit", r));
      proc.kill();
      await done;
      await boot();
    },
    async close() {
      await browser.close();
      proc.kill();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Selects one board by its title row and zooms to it */
export async function openBoard(page, url, file) {
  if (!page.url().startsWith(url)) {
    await page.goto(url);
    await page.waitForSelector(".board");
  }
  await page.evaluate((f) => {
    const label = document.querySelector(`.board[data-file="${f}"] .board-label`);
    for (const type of ["pointerdown", "pointerup"]) label.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1 }));
  }, file);
  await wait(100);
  await page.keyboard.press("Shift+Digit2"); // Zoom to the selected board
  await page.waitForSelector(`.board[data-file="${file}"] iframe`);
  await wait(600);
  return page.frameLocator(`.board[data-file="${file}"] iframe`);
}

/** Where an element inside a board is on the page (the board's iframe never takes the pointer: clicks land on the canvas) */
export async function pointOf(page, file, selector) {
  const el = page.frameLocator(`.board[data-file="${file}"] iframe`).locator(selector).first();
  let b = await el.boundingBox();
  // A board that is being redrawn (after an undo, say) has no box for a moment
  for (let i = 0; !b && i < 50; i++) {
    await wait(100);
    b = await el.boundingBox();
  }
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Clicks (or double-clicks) an element on a board the way a person does: the canvas picks the element under the pointer */
export async function clickIn(page, file, selector, { double = false, shift = false } = {}) {
  const { x, y } = await pointOf(page, file, selector);
  if (shift) await page.keyboard.down("Shift");
  if (double) await page.mouse.dblclick(x, y);
  else await page.mouse.click(x, y);
  if (shift) await page.keyboard.up("Shift");
}
