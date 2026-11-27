#!/usr/bin/env node
// AI-generated with Claude Code, 2026-11-27
// Measures the canvas on generated folders of N boards (tools/perf/gen.mjs): opening, panning at fit-all, 30% and 100%, a zoom
// from fit-all to 100% and back, dragging a board and a marquee, unthrottled and with the CPU slowed down 4×. Each is run
// --runs times and the medians are reported; the first run of each also records a Chrome trace for the time split.
//
// Usage: node tools/perf/measure.mjs [--n 20,60,150] [--heavy] [--runs 3] [--rates 1,4] [--label after] [--tool <checkout>]
//   --tool: run another checkout's server and build (for example a copy of main) on the same folders, to compare.
// Needs a build (npm run build) and Playwright's Chromium. Folders and reports go to .out/perf/ (gitignored).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { generate } from "./gen.mjs";
import { args, cacheCdn, domState, HOOK, median, r1, record, rssMB, settle, startServer, TOOL, wait } from "./lib.mjs";

const a = args();
const SIZES = a.get("n", "20,60,150").split(",").map(Number);
const RUNS = Number(a.get("runs", "3"));
const RATES = a.get("rates", "1,4").split(",").map(Number);
const HEAVY = a.has("heavy");
const LABEL = a.get("label", "run");
const TOOL_UNDER_TEST = path.resolve(a.get("tool", TOOL));
const OUT = path.join(TOOL, ".out/perf", `report-${LABEL}${HEAVY ? "-heavy" : ""}.json`);
const VIEWPORT = { width: 1600, height: 1000 };
const STEP_GAP = 8; // ms between input events

const zoomOf = (page) => page.evaluate(() => Number(/scale\(([\d.e-]+)\)/.exec(document.querySelector(".world").style.transform)[1]));

/** One ⌘-wheel event that lands on exactly `z` around the window centre */
async function setZoom(page, z) {
  const cur = await zoomOf(page);
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -Math.log(z / cur) / 0.01);
  await page.keyboard.up("Control");
}

/** A point on the bare canvas (no board, note or panel under it) */
const emptyPoint = (page) =>
  page.evaluate(({ w, h }) => {
    for (let y = 60; y < h - 120; y += 20)
      for (let x = 280; x < w - 320; x += 20) if (document.elementFromPoint(x, y)?.classList.contains("canvas")) return { x, y };
    return null;
  }, { w: VIEWPORT.width, h: VIEWPORT.height });

/** The label of a board fully on screen, nearest the centre */
const boardLabelPoint = (page) =>
  page.evaluate(({ w, h }) => {
    let best = null;
    for (const el of document.querySelectorAll(".board")) {
      const l = el.querySelector(".board-label")?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (!l || r.left < 280 || r.right > w - 320 || r.top < 40 || r.bottom > h - 120) continue;
      const p = { x: l.left + Math.min(20, l.width / 2), y: l.top + l.height / 2 };
      if (!document.elementFromPoint(p.x, p.y)?.closest(".board-label")) continue;
      const d = Math.hypot(r.left + r.width / 2 - w / 2, r.top + r.height / 2 - h / 2);
      if (!best || d < best.d) best = { d, ...p };
    }
    return best;
  }, { w: VIEWPORT.width, h: VIEWPORT.height });

async function scenarios(page, cdp, browser) {
  const out = { states: {} };
  const tr = { browser }; // trace each gesture (only on the first run)
  const cx = VIEWPORT.width / 2, cy = VIEWPORT.height / 2;
  await page.keyboard.press("Shift+Digit1"); // Fit all
  await settle(page);
  out.states.fit = await domState(page, cdp);
  const fitZoom = await zoomOf(page);
  await page.mouse.move(cx, cy);

  out.panFit = await record(page, cdp, async () => {
    for (let i = 0; i < 60; i++) (await page.mouse.wheel(i < 30 ? 25 : -25, i % 2 ? 6 : -6), await wait(STEP_GAP));
  }, tr);
  await settle(page);

  const p0 = await emptyPoint(page);
  if (p0)
    out.marquee = await record(page, cdp, async () => {
      await page.mouse.move(p0.x, p0.y);
      await page.mouse.down();
      for (let i = 1; i <= 40; i++) (await page.mouse.move(p0.x + i * 14, p0.y + i * 9), await wait(STEP_GAP));
      await page.mouse.up();
    }, tr);
  await page.keyboard.press("Escape");
  await settle(page);

  const steps = 40;
  const dy = -Math.log(1 / fitZoom) / 0.01 / steps;
  out.zoom = await record(page, cdp, async () => {
    await page.mouse.move(cx, cy);
    await page.keyboard.down("Control");
    for (let i = 0; i < steps; i++) (await page.mouse.wheel(0, dy), await wait(STEP_GAP));
    for (let i = 0; i < steps; i++) (await page.mouse.wheel(0, -dy), await wait(STEP_GAP));
    await page.keyboard.up("Control");
  }, tr);
  await settle(page);

  // 30%: boards are live (from 25%) and many fit on screen, the busiest zoom
  await setZoom(page, 0.3);
  out.settle30Ms = await settle(page);
  out.states.z30 = await domState(page, cdp);
  out.pan30 = await record(page, cdp, async () => {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 80; i++) (await page.mouse.wheel(i < 40 ? 40 : -40, 0), await wait(STEP_GAP));
  }, tr);
  out.settleAfterPan30Ms = await settle(page);
  const at = await boardLabelPoint(page);
  if (at)
    out.drag = await record(page, cdp, async () => {
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      for (let i = 1; i <= 40; i++) (await page.mouse.move(at.x + i * 6, at.y + i * 3), await wait(STEP_GAP));
      await page.mouse.up();
    }, tr);
  await page.keyboard.press("Meta+z"); // put the board back
  await page.keyboard.press("Escape");
  await settle(page);

  await setZoom(page, 1);
  await settle(page);
  out.states.z100 = await domState(page, cdp);
  out.pan100 = await record(page, cdp, async () => {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 80; i++) (await page.mouse.wheel(i < 40 ? 40 : -40, i % 3 ? 10 : -10), await wait(STEP_GAP));
  }, tr);
  out.rss = await rssMB(browser);
  return out;
}

async function runOnce(browser, url, rate, { trace = false, warm = false, saved = null, n }) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await cacheCdn(context);
  await context.addInitScript(HOOK);
  // Open zoomed out to fit everything, the way a project left zoomed out reopens (the app restores the saved view)
  if (saved) await context.addInitScript((s) => localStorage.setItem(s.key, s.value), saved);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (rate > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  const res = { rate };
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction((n) => document.querySelectorAll(".board").length >= n, n, { timeout: 120000, polling: 50 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  res.openBoardsMs = Date.now() - t0;
  res.openSettledMs = res.openBoardsMs + (await settle(page, { max: 60000 }));
  res.openLongMs = await page.evaluate(() => Math.round(window.__perf.longtasks.reduce((s, l) => s + l.d, 0)));
  if (warm) {
    // Warm-up: the server renders every thumbnail once; keep the fit-all view the app saves
    await page.keyboard.press("Shift+Digit1");
    await settle(page, { quiet: 3000, max: 120000 });
    await wait(500);
    const saved = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith("design-canvas:"));
      return key ? { key, value: localStorage.getItem(key) } : null;
    });
    await context.close();
    return saved;
  }
  Object.assign(res, await scenarios(page, cdp, trace ? browser : null));
  res.errors = errors;
  await context.close();
  return res;
}

const GESTURES = ["panFit", "marquee", "zoom", "pan30", "drag", "pan100"];
function combine(runs) {
  const med = (get) => median(runs.map(get).filter((v) => typeof v === "number"));
  const first = runs[0];
  const out = { rate: first.rate };
  for (const k of ["openBoardsMs", "openSettledMs", "openLongMs", "settle30Ms", "settleAfterPan30Ms"]) out[k] = med((r) => r[k]);
  out.states = Object.fromEntries(Object.keys(first.states).map((s) => [s, Object.fromEntries(Object.keys(first.states[s]).map((m) => [m, med((r) => r.states[s][m])]))]));
  out.rss = first.rss && Object.fromEntries(Object.keys(first.rss).map((m) => [m, med((r) => r.rss?.[m])]));
  for (const g of GESTURES) if (first[g]) out[g] = Object.fromEntries(Object.keys(first[g]).map((m) => [m, m.startsWith("t_") || ["busy", "traceLong", "longest", "raster", "gpu"].includes(m) ? first[g][m] : med((r) => r[g]?.[m])]));
  out.errors = [...new Set(runs.flatMap((r) => r.errors))];
  return out;
}

const browser = await chromium.launch();
const report = { label: LABEL, tool: TOOL_UNDER_TEST, heavy: HEAVY, when: new Date().toISOString(), cpus: os.cpus().length, results: [] };
for (const n of SIZES) {
  const dir = path.join(TOOL, ".out/perf", `canvas-${n}${HEAVY ? "-heavy" : ""}`);
  // Reuse the folder (its thumbnails are rendered already); board.json goes back to the generated one before each size
  if (!(await fs.stat(path.join(dir, "board.json.orig")).catch(() => null))) {
    await generate(dir, n, { heavy: HEAVY });
    await fs.copyFile(path.join(dir, "board.json"), path.join(dir, "board.json.orig"));
  } else await fs.copyFile(path.join(dir, "board.json.orig"), path.join(dir, "board.json"));
  const server = await startServer(dir, TOOL_UNDER_TEST);
  const saved = await runOnce(browser, server.url, 1, { warm: true, n });
  for (const rate of RATES) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const load0 = r1(os.loadavg()[0]);
      const r = await runOnce(browser, server.url, rate, { trace: i === 0, saved, n });
      r.load = [load0, r1(os.loadavg()[0])];
      runs.push(r);
      console.error(`${LABEL} n=${n} rate=${rate} run ${i + 1}: open ${r.openBoardsMs}ms, pan30 p95 ${r.pan30?.p95} script ${r.pan30?.scriptMs}, load ${r.load.join("→")}`);
    }
    report.results.push({ n, ...combine(runs), load: runs.map((r) => r.load) });
  }
  server.stop();
  await fs.copyFile(path.join(dir, "board.json.orig"), path.join(dir, "board.json"));
}
await browser.close();
await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(report, null, 2));
console.log(OUT);
