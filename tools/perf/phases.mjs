#!/usr/bin/env node
// AI-generated with Claude Code, 2026-11-27
// The phases #24 measured on a real project, for any design folder: open + 4 s idle; pan (180 wheel events) from a start view;
// zoom (100 ⌘-wheel steps); select a tall board and zoom to it (Shift+2); Play a board in place, scroll and click inside it;
// 3 s idle. Every phase records a Chrome trace (main-thread busy time and its split), frames, long tasks, React commits, the
// most live iframes and memory.
//
// Usage: node tools/perf/phases.mjs --dir <design folder> [--size 1440x900,630x830] [--runs 2] [--view 0.3,-60,-1800]
//          [--tall <file>] [--play <file>] [--label after] [--tool <checkout>] [--headed] [--rate 1]
//   --view: zoom,x,y the canvas opens on (written as the saved view). --headed: a visible window with GPU compositing.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { args, cacheCdn, domState, HOOK, median, r1, record, rssMB, startServer, TOOL, TRACE_CATEGORIES, traceBreakdown, wait } from "./lib.mjs";

const a = args();
const DIR = path.resolve(a.get("dir", ""));
const SIZES = a.get("size", "1440x900,630x830").split(",").map((s) => s.split("x").map(Number));
const RUNS = Number(a.get("runs", "2"));
const [Z, X, Y] = a.get("view", "0.3,-60,-1800").split(",").map(Number);
const TALL = a.get("tall", null);
const PLAY = a.get("play", null);
const LABEL = a.get("label", "run");
const RATE = Number(a.get("rate", "1"));
const HEADED = a.has("headed");
const TOOL_UNDER_TEST = path.resolve(a.get("tool", TOOL));
const OUT = path.join(TOOL, ".out/perf", `phases-${LABEL}${HEADED ? "-headed" : ""}.json`);

const board = JSON.parse(await fs.readFile(path.join(DIR, "board.json"), "utf8"));
const select = (page, f) =>
  page.evaluate((f) => {
    const label = document.querySelector(`.board[data-file="${f}"] .board-label`);
    for (const type of ["pointerdown", "pointerup"]) label.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1 }));
  }, f);

async function runOnce(browser, url, [W, H]) {
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  await cacheCdn(context);
  await context.addInitScript(HOOK);
  await context.addInitScript(
    ({ key, v }) => {
      if (sessionStorage.getItem("perf-init")) return;
      sessionStorage.setItem("perf-init", "1");
      localStorage.setItem(key, JSON.stringify({ view: v, page: null, minimap: false }));
    },
    { key: `design-canvas:${board.title}`, v: { zoom: Z, x: X, y: Y } },
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (RATE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  const rows = {};
  const phase = async (name, fn) => {
    if (name !== "load") rows[name] = await record(page, cdp, fn, { browser });
    else {
      await browser.startTracing(page, { categories: TRACE_CATEGORIES });
      const t0 = Date.now();
      await fn();
      const ms = Date.now() - t0;
      const t = traceBreakdown((await browser.stopTracing()).toString());
      const long = await page.evaluate(() => window.__perf.longtasks.map((l) => l.d));
      rows.load = { ms, busy: t.busy, traceLong: t.long, longest: t.longest, ...Object.fromEntries(Object.entries(t.main).map(([k, v]) => [`t_${k}`, v])), raster: t.raster, gpu: t.gpu, longN: long.length, iframes: (await domState(page, cdp)).iframes };
    }
    rows[name].rss = (await rssMB(browser))?.all ?? null;
    rows[name].ifrEnd = (await domState(page, cdp)).iframes;
  };
  const cx = Math.round(W / 2), cy = Math.round(H / 2);
  await phase("load", async () => {
    await page.goto(url);
    await page.waitForSelector(".board");
    await wait(4000);
  });
  await phase("pan", async () => {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 60; i++) (await page.mouse.wheel(40, 0), await wait(16));
    for (let i = 0; i < 60; i++) (await page.mouse.wheel(0, 30), await wait(16));
    for (let i = 0; i < 60; i++) (await page.mouse.wheel(-40, -30), await wait(16));
    await wait(500);
  });
  await phase("zoom", async () => {
    await page.mouse.move(cx, cy);
    await page.keyboard.down("Control");
    for (let i = 0; i < 25; i++) (await page.mouse.wheel(0, -4), await wait(16));
    for (let i = 0; i < 50; i++) (await page.mouse.wheel(0, 4), await wait(16));
    for (let i = 0; i < 25; i++) (await page.mouse.wheel(0, -4), await wait(16));
    await page.keyboard.up("Control");
    await wait(500);
  });
  if (TALL)
    await phase("select-tall", async () => {
      await select(page, TALL);
      await wait(100);
      await page.keyboard.press("Shift+Digit2");
      await wait(2500);
    });
  if (PLAY)
    await phase("play", async () => {
      await page.keyboard.press("Escape");
      await select(page, PLAY);
      await wait(100);
      await page.keyboard.press("Shift+Digit2");
      await wait(1500);
      await page.keyboard.press("p");
      await wait(2500);
      rows.playLive = await page.locator(`.board.playing[data-file="${PLAY}"] iframe`).count();
      const b = await page.locator(`.board[data-file="${PLAY}"] .board-frame`).boundingBox();
      const px = b.x + b.width / 2;
      const py = Math.max(b.y + 40, 120);
      await page.mouse.move(px, py);
      for (let i = 0; i < 40; i++) (await page.mouse.wheel(0, 60), await wait(16));
      await page.mouse.click(px, py + 60);
      await wait(1000);
    });
  await phase("idle", () => wait(3000));
  rows.errors = errors;
  await context.close();
  return rows;
}

const browser = await chromium.launch(HEADED ? { headless: false, args: ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"] } : {});
const report = { label: LABEL, tool: TOOL_UNDER_TEST, headed: HEADED, rate: RATE, when: new Date().toISOString(), results: [] };
const original = await fs.readFile(path.join(DIR, "board.json"));
const server = await startServer(DIR, TOOL_UNDER_TEST);
try {
  // Warm-up: every thumbnail this walk asks for gets rendered once, so the server's headless Chromium does not run meanwhile
  for (const s of SIZES) await runOnce(browser, server.url, s);
  for (const s of SIZES) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const load0 = r1(os.loadavg()[0]);
      const r = await runOnce(browser, server.url, s);
      r.loadavg = [load0, r1(os.loadavg()[0])];
      runs.push(r);
      console.error(`${LABEL} ${s.join("x")} run ${i + 1}: pan busy ${r.pan.busy} script ${r.pan.t_script}, zoom busy ${r.zoom.busy}, load ${r.loadavg.join("→")}`);
      await fs.writeFile(path.join(DIR, "board.json"), original);
    }
    const phases = Object.keys(runs[0]).filter((k) => typeof runs[0][k] === "object" && !Array.isArray(runs[0][k]));
    const out = { size: s.join("x"), loadavg: runs.map((r) => r.loadavg), playLive: runs.map((r) => r.playLive), errors: [...new Set(runs.flatMap((r) => r.errors))] };
    for (const p of phases) out[p] = Object.fromEntries(Object.keys(runs[0][p]).map((m) => [m, median(runs.map((r) => r[p]?.[m]).filter((v) => typeof v === "number"))]));
    report.results.push(out);
  }
} finally {
  server.stop();
  await fs.writeFile(path.join(DIR, "board.json"), original);
  await browser.close();
}
await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(report, null, 2));
console.log(OUT);
