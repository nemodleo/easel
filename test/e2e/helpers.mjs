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
  const proc = spawn(process.execPath, [path.join(TOOL, "bin/server.mjs"), "--dir", dir, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, EASEL_HOME: path.join(dir, ".easel-home") } });
  let log = "";
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(url + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
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
    async close() {
      await browser.close();
      proc.kill();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Zooms to one board and optionally enters edit mode */
export async function openBoard(page, url, file, { edit = false } = {}) {
  if (!page.url().startsWith(url)) {
    await page.goto(url);
    await page.waitForSelector(".board");
  }
  await page.evaluate((f) => {
    document.querySelector(`.board[data-file="${f}"] .board-frame`).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
  }, file);
  await wait(100);
  await page.keyboard.press("Shift+Digit2"); // Zoom to the selected board
  await page.waitForSelector(`.board[data-file="${file}"] iframe`);
  await wait(600);
  if (edit) {
    await page.dispatchEvent(`.board[data-file="${file}"] .board-frame`, "dblclick");
    await wait(800);
  }
  return page.frameLocator(`.board[data-file="${file}"] iframe`);
}
