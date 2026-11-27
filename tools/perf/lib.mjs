// AI-generated with Claude Code, 2026-11-27
// Shared parts of the performance scripts in tools/perf: start a server on a folder, count React commits, cache the CDN font,
// read a Chrome trace, read memory.
import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const r1 = (v) => Math.round(v * 10) / 10;
export const pct = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
/** Middle value (the mean of the two middle ones for an even count) */
export const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : r1((s[m - 1] + s[m]) / 2);
};

export function args(argv = process.argv) {
  const get = (k, d) => {
    const i = argv.indexOf(`--${k}`);
    return i < 0 ? d : argv[i + 1];
  };
  return { get, has: (k) => argv.includes(`--${k}`) };
}

const freePort = () =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });

/** Starts `<tool>/bin/server.mjs` on `dir` (tool: this checkout by default, or another checkout to compare against) */
export async function startServer(dir, tool = TOOL) {
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(tool, "bin/server.mjs"), "--dir", dir, "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, EASEL_HOME: path.join(dir, ".easel-home") },
  });
  let log = "";
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 1200; i++) {
    try {
      if ((await fetch(url + "/api/health")).ok) return { url, proc, log: () => log, stop: () => proc.kill() };
    } catch {}
    await wait(100);
  }
  throw new Error(`server did not start:\n${log}`);
}

/** Serves CDN files (the app's Pretendard font) from a disk cache after the first fetch, so a slow network does not skew opening */
export async function cacheCdn(context) {
  const dir = path.join(TOOL, ".out/perf/cdn-cache");
  await fs.mkdir(dir, { recursive: true });
  await context.route(/^https:\/\/(cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com)\//, async (route) => {
    const url = route.request().url();
    const key = path.join(dir, crypto.createHash("sha1").update(url).digest("hex"));
    try {
      const meta = JSON.parse(await fs.readFile(key + ".json", "utf8"));
      return route.fulfill({ status: 200, headers: meta.headers, body: await fs.readFile(key) });
    } catch {}
    try {
      const res = await route.fetch();
      const body = await res.body();
      const headers = { "content-type": res.headers()["content-type"] ?? "application/octet-stream", "access-control-allow-origin": "*" };
      if (res.ok()) await fs.writeFile(key, body).then(() => fs.writeFile(key + ".json", JSON.stringify({ headers })));
      return route.fulfill({ status: res.status(), headers, body });
    } catch {
      return route.abort();
    }
  });
}

/** Installed before the app loads (context.addInitScript). React, its production build too, calls this hook after every commit.
 * It counts commits and the components that rendered in each, told apart by the class of the first element they render
 * (component names are minified). It also collects frame times and long tasks between __perf.start() and __perf.stop() */
export const HOOK = () => {
  const stats = { commits: 0, rendered: 0, boards: 0, notes: 0, frames: 0, canvas: 0, app: 0 };
  window.__perf = { stats, reset: () => Object.keys(stats).forEach((k) => (stats[k] = 0)) };
  let seen = new WeakSet();
  const hostOf = (f) => {
    for (let c = f.child, i = 0; c && i < 6; c = c.child, i++) if (c.tag === 5) return c.stateNode;
    return null;
  };
  const walk = (f, next) => {
    for (; f; f = f.sibling) {
      next.add(f);
      // The same fiber object as at the last commit: nothing under it rendered
      if (seen.has(f)) continue;
      const fn = f.tag === 0 || f.tag === 15 || f.tag === 11;
      const did = !f.alternate || f.memoizedProps !== f.alternate.memoizedProps || f.memoizedState !== f.alternate.memoizedState;
      if (fn && did) {
        stats.rendered++;
        const el = hostOf(f);
        const cls = el?.classList;
        if (cls?.contains("board")) stats.boards++;
        else if (cls?.contains("note")) stats.notes++;
        else if (el?.tagName === "IFRAME") stats.frames++;
        else if (cls?.contains("canvas")) stats.canvas++;
        else if (cls?.contains("app")) stats.app++;
      }
      walk(f.child, next);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(r) {
      this.renderers.set(1, r);
      return 1;
    },
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      stats.commits++;
      const next = new WeakSet();
      walk(root.current.child, next);
      seen = next;
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
  const lt = [];
  try {
    new PerformanceObserver((l) => lt.push(...l.getEntries().map((e) => ({ t: e.startTime, d: e.duration })))).observe({ type: "longtask", buffered: true });
  } catch {}
  let frames = null;
  let raf = 0;
  let ifr = [];
  let ifrTimer = 0;
  window.__perf.longtasks = lt;
  window.__perf.start = () => {
    frames = [];
    ifr = [];
    lt.length = 0;
    let last = performance.now();
    const tick = (t) => {
      frames.push(t - last);
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame((t) => {
      last = t;
      raf = requestAnimationFrame(tick);
    });
    ifrTimer = setInterval(() => ifr.push(document.querySelectorAll(".board iframe").length), 100);
  };
  window.__perf.stop = () => {
    cancelAnimationFrame(raf);
    clearInterval(ifrTimer);
    return { frames, longtasks: lt.slice(), ifrMax: Math.max(0, ...ifr) };
  };
};

export async function metrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

/** Waits until no long task for `quiet` ms, every live iframe has loaded and every thumbnail is in (or `max` ms passed) */
export async function settle(page, { quiet = 800, max = 30000 } = {}) {
  const t0 = Date.now();
  await page.evaluate(
    ({ quiet, max }) =>
      new Promise((res) => {
        const t0 = performance.now();
        let lastLong = performance.now();
        const po = new PerformanceObserver((l) => (lastLong = Math.max(lastLong, ...l.getEntries().map((e) => e.startTime + e.duration))));
        try {
          po.observe({ type: "longtask" });
        } catch {}
        const check = () => {
          const loaded = [...document.querySelectorAll(".board iframe")].every((f) => f.contentDocument?.readyState === "complete");
          const thumbs = !document.querySelector(".board-placeholder.loading");
          const now = performance.now();
          if ((loaded && thumbs && now - lastLong > quiet) || now - t0 > max) {
            po.disconnect();
            return res();
          }
          setTimeout(check, 50);
        };
        check();
      }),
    { quiet, max },
  );
  return Date.now() - t0;
}

/** Renderer, GPU and all Chromium processes' resident memory (MB) */
export async function rssMB(browser) {
  try {
    const bcdp = await browser.newBrowserCDPSession();
    const info = (await bcdp.send("SystemInfo.getProcessInfo")).processInfo;
    await bcdp.detach();
    const types = new Map(info.map((p) => [p.id, p.type]));
    const rows = execSync("ps -axo pid,rss", { encoding: "utf8" })
      .split("\n")
      .slice(1)
      .map((l) => l.trim().split(/\s+/).map(Number))
      .filter(([pid]) => types.has(pid));
    const sum = (f) => Math.round(rows.filter(([pid]) => f(types.get(pid))).reduce((a, [, rss]) => a + rss, 0) / 1024);
    return { renderer: sum((t) => t === "renderer"), gpu: sum((t) => t === "GPU"), all: sum(() => true) };
  } catch {
    return null;
  }
}

export const TRACE_CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute", "blink", "cc", "gpu", "viz", "toplevel", "disabled-by-default-v8.gc"];

const BUCKETS = {
  script: /^(FunctionCall|EvaluateScript|v8\.|V8\.|TimerFire|FireAnimationFrame|RunMicrotasks|EventDispatch|FireIdleCallback|XHR|v8\.run)/,
  gc: /(GC|BlinkGC)/,
  style: /^(UpdateLayoutTree|RecalculateStyles)$/,
  layout: /^(Layout|LocalFrameView::layout)$/,
  prepaint: /^(PrePaint|UpdateLayerTree|Layerize|LocalFrameView::RunPrePaintLifecyclePhase|IntersectionObserver)/,
  paint: /^(Paint|PaintImage|Decode Image|ImageDecodeTask|Decode LazyPixelRef)$/,
  composite: /^(CompositeLayers|Commit|ProxyMain::BeginMainFrame::commit|LayerTreeHost::UpdateLayers)$/,
  parse: /^(ParseHTML|ParseAuthorStyleSheet|HTMLDocumentParser)/,
};
const bucket = (name) => Object.entries(BUCKETS).find(([, re]) => re.test(name))?.[0] ?? null;

/** Main-thread busy time, long tasks and self time per category (the same split as #24), plus raster and GPU/viz thread time */
export function traceBreakdown(text) {
  const parsed = JSON.parse(text);
  const ev = parsed.traceEvents ?? parsed;
  const tname = new Map();
  for (const e of ev) if (e.ph === "M" && e.name === "thread_name") tname.set(`${e.pid}:${e.tid}`, e.args.name);
  const byThread = new Map();
  const open = new Map();
  const push = (k, e) => (byThread.get(k) ?? byThread.set(k, []).get(k)).push(e);
  for (const e of ev) {
    const k = `${e.pid}:${e.tid}`;
    if (e.ph === "X" && e.dur != null) push(k, { name: e.name, ts: e.ts, dur: e.dur });
    else if (e.ph === "B") (open.get(k) ?? open.set(k, []).get(k)).push(e);
    else if (e.ph === "E") {
      const b = open.get(k)?.pop();
      if (b) push(k, { name: b.name, ts: b.ts, dur: e.ts - b.ts });
    }
  }
  const out = { busy: 0, long: 0, longest: 0, main: {}, raster: 0, gpu: 0 };
  for (const [k, list] of byThread) {
    const n = tname.get(k) ?? "";
    if (/CompositorTileWorker|RasterWorker/.test(n)) {
      out.raster += list.filter((e) => /RasterTask|TaskGraphRunner/.test(e.name)).reduce((a, e) => a + e.dur, 0) / 1000;
      continue;
    }
    if (/VizCompositor|CrGpuMain/.test(n)) {
      out.gpu += list.filter((e) => e.name === "ThreadControllerImpl::RunTask").reduce((a, e) => a + e.dur, 0) / 1000;
      continue;
    }
    if (n !== "CrRendererMain") continue;
    list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    const stack = [];
    for (const e of list) {
      while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts) stack.pop();
      e.child = 0;
      e.b = bucket(e.name);
      if (stack.length) stack[stack.length - 1].child += e.dur;
      else if (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask") {
        out.busy += e.dur / 1000;
        if (e.dur > 50000) out.long++;
        out.longest = Math.max(out.longest, e.dur / 1000);
      }
      stack.push(e);
    }
    const st = [];
    for (const e of list) {
      while (st.length && st[st.length - 1].ts + st[st.length - 1].dur <= e.ts) st.pop();
      e.eff = e.b ?? (st.length ? st[st.length - 1].eff : null);
      if (e.eff) out.main[e.eff] = (out.main[e.eff] ?? 0) + (e.dur - e.child) / 1000;
      st.push(e);
    }
  }
  for (const k of Object.keys(out.main)) out.main[k] = Math.round(out.main[k]);
  for (const k of ["busy", "longest", "raster", "gpu"]) out[k] = Math.round(out[k]);
  return out;
}

/** Runs `act` while recording frames, long tasks, DevTools metrics, React commits and (optionally) a trace */
export async function record(page, cdp, act, { browser = null } = {}) {
  await page.evaluate(() => (window.__perf.reset(), window.__perf.start()));
  const m0 = await metrics(cdp);
  if (browser) await browser.startTracing(page, { categories: TRACE_CATEGORIES });
  const t0 = Date.now();
  await act();
  // The frames right after the last input still belong to the gesture
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const ms = Date.now() - t0;
  const trace = browser ? traceBreakdown((await browser.stopTracing()).toString()) : null;
  const m1 = await metrics(cdp);
  const { frames, longtasks, ifrMax } = await page.evaluate(() => window.__perf.stop());
  const react = await page.evaluate(() => ({ ...window.__perf.stats }));
  const d = (k) => r1((m1[k] - m0[k]) * 1000);
  return {
    ms,
    frames: frames.length,
    p50: r1(pct(frames, 50)),
    p95: r1(pct(frames, 95)),
    worst: r1(Math.max(0, ...frames)),
    over50: frames.filter((f) => f > 50).length,
    longN: longtasks.length,
    longMs: r1(longtasks.reduce((s, l) => s + l.d, 0)),
    scriptMs: d("ScriptDuration"),
    styleMs: d("RecalcStyleDuration"),
    layoutMs: d("LayoutDuration"),
    taskMs: d("TaskDuration"),
    commits: react.commits,
    rendered: react.rendered,
    boardRenders: react.boards,
    appRenders: react.app,
    ifrMax,
    ...(trace ? { busy: trace.busy, traceLong: trace.long, longest: trace.longest, ...Object.fromEntries(Object.entries(trace.main).map(([k, v]) => [`t_${k}`, v])), raster: trace.raster, gpu: trace.gpu } : {}),
  };
}

export async function domState(page, cdp) {
  const m = await metrics(cdp);
  const dom = await page.evaluate(() => ({
    iframes: document.querySelectorAll(".board iframe").length,
    thumbs: document.querySelectorAll(".board img.board-thumb").length,
    boards: document.querySelectorAll(".board").length,
    zoom: Number(/scale\(([\d.e-]+)\)/.exec(document.querySelector(".world")?.style.transform ?? "")?.[1] ?? 0),
  }));
  return { ...dom, nodes: m.Nodes, documents: m.Documents, heapMB: r1(m.JSHeapUsedSize / 1048576) };
}
