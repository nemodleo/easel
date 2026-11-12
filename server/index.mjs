// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// App server: static serving of the design folder + API + WS + (dev) Vite middleware. PLAN.md ch. 4.
import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import chokidar from "chokidar";
import { WebSocketServer } from "ws";

import { cleanAgent } from "./agents.mjs";
import { TOOL_ROOT } from "./args.mjs";
import { createBoardStore } from "./board.mjs";
import { rootOf, toPosix } from "./fsutil.mjs";
import { createHistory, requestScope } from "./history.mjs";
import { writeEntry } from "./registry.mjs";

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};

export function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export async function readBody(req, limit = 4 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

/** Allow only paths inside dir (blocks ../ escapes) */
export function safeJoin(root, rel) {
  const p = path.resolve(root, "." + path.posix.normalize("/" + rel));
  if (p !== root && !p.startsWith(root + path.sep)) return null;
  return p;
}

// When serving screen HTML, inject an error-collecting script into <head> (the file is untouched). The parent window (canvas) gathers them into the errored boards list
const PROBE = `<script data-dc-probe>(function(){var f=decodeURIComponent(location.pathname.replace(/^\\/screens\\//,""));function send(m){try{if(parent!==window)parent.postMessage(Object.assign({type:"dc-error",file:f},m),"*")}catch(e){}}send({start:true});addEventListener("error",function(e){var t=e.target;if(t&&t!==window&&(t.src||t.href)){send({kind:"resource",message:"Failed to load: "+(t.getAttribute("src")||t.getAttribute("href"))})}else{send({kind:"script",message:String(e.message||e),line:e.lineno,col:e.colno})}},true);addEventListener("unhandledrejection",function(e){send({kind:"script",message:"Promise: "+String(e.reason&&e.reason.message||e.reason)})});addEventListener("load",function(){send({loaded:true})});function tw(){var el=document.getElementById("board-tweaks");if(!el)return;try{var d=JSON.parse(el.textContent);for(var k in d){var t=d[k];if(!t||typeof t!=="object")continue;var v=t.type==="boolean"?(t.value?"1":"0"):String(t.value)+(t.type==="number"&&t.unit?t.unit:"");if(t.var)document.documentElement.style.setProperty(t.var,v);document.documentElement.setAttribute("data-tweak-"+k,t.type==="boolean"?(t.value?"on":"off"):String(t.value))}}catch(e){send({kind:"script",message:"board-tweaks JSON error: "+e.message})}}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",tw);else tw()})()</script>`;
export function injectProbe(html) {
  const m = /<meta[^>]*charset[^>]*>/i.exec(html) ?? /<head[^>]*>/i.exec(html) ?? /<html[^>]*>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
  return m ? html.slice(0, m.index + m[0].length) + PROBE + html.slice(m.index + m[0].length) : PROBE + html;
}

async function serveScreen(res, file) {
  try {
    const html = injectProbe(await fs.readFile(file, "utf8"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html), "Cache-Control": "no-store" });
    res.end(html);
    return true;
  } catch {
    return false;
  }
}

async function serveFile(res, file) {
  try {
    const st = await fs.stat(file);
    if (!st.isFile()) return false;
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-store",
    });
    createReadStream(file).pipe(res);
    return true;
  } catch {
    return false;
  }
}

/** Rebuild if files under app/ are newer than dist/index.html, or the export viewer (dist/viewer) is missing */
async function appIsStale(distDir) {
  const built = await fs.stat(path.join(distDir, "index.html")).catch(() => null);
  if (!built) return true;
  if (existsSync(path.join(TOOL_ROOT, "app")) && !existsSync(path.join(distDir, "viewer", "viewer.js"))) return true;
  let newest = 0;
  const walk = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else newest = Math.max(newest, (await fs.stat(p)).mtimeMs);
    }
  };
  // Installed from npm the app sources are not shipped, only the prebuilt dist/: never rebuild then
  if (!existsSync(path.join(TOOL_ROOT, "app"))) return false;
  await walk(path.join(TOOL_ROOT, "app"));
  for (const f of ["vite.config.mjs", "package.json"]) newest = Math.max(newest, (await fs.stat(path.join(TOOL_ROOT, f))).mtimeMs);
  return newest > built.mtimeMs;
}

/** Listens on 127.0.0.1:port; with autoPort a busy port moves on to the next ones (up to +20). Resolves to the port used */
export async function listen(server, port, autoPort = false) {
  for (let p = port; ; p++) {
    try {
      await new Promise((resolve, reject) => {
        const fail = (e) => {
          server.off("listening", ok);
          reject(e);
        };
        const ok = () => {
          server.off("error", fail);
          resolve();
        };
        server.once("error", fail);
        server.once("listening", ok);
        server.listen(p, "127.0.0.1");
      });
      return p;
    } catch (e) {
      if (e.code !== "EADDRINUSE") throw e;
      if (!autoPort) throw Object.assign(new Error(`Port ${p} is already in use. Pick another with --port <n>, or leave --port out to use the next free one.`), { code: "EADDRINUSE" });
      if (p >= port + 20) throw Object.assign(new Error(`Ports ${port}–${p} are all in use. Pick one with --port <n>.`), { code: "EADDRINUSE" });
    }
  }
}

/** Tracked for undo of outside changes: every .html under screens/ (any depth) and board.json */
function trackedFiles(store) {
  const rel = (p) => toPosix(path.relative(store.screensDir, p));
  return {
    list: async () => [...(await store.listScreenFiles()).map((f) => path.join(store.screensDir, f)), store.boardPath],
    isTracked: (p) => p === store.boardPath || (p.endsWith(".html") && !rel(p).startsWith("..") && !rel(p).split("/").some((s) => s.startsWith("."))),
    name: (p) => (p === store.boardPath ? "board.json" : rel(p)),
  };
}

/**
 * register: write the running-canvas entry (~/.easel/servers/<port>.json, or under EASEL_HOME) for MCP discovery.
 * autoPort: when the port is busy, try the next ones instead of failing (for a port the user did not choose).
 */
export async function createServer({ dir, port, dev = true, extraRoutes = [], autoPort = false, register = false }) {
  if (!existsSync(dir)) throw new Error(`Design folder not found: ${dir}`);
  let history;
  const store = createBoardStore(dir, { onWrite: (p, text) => history.note(p, text) });
  history = createHistory(trackedFiles(store));
  const ctx = { dir, store, history, broadcast: () => {} };
  await history.seed();

  // App UI: on startup, build once if the app source is newer than dist, then serve dist statically.
  // (The Vite dev server is not used: even with HMR off it injects a websocket client that causes console errors)
  const distDir = path.join(TOOL_ROOT, "dist");
  if (dev && (await appIsStale(distDir))) {
    const { build } = await import("vite");
    await build({ root: path.join(TOOL_ROOT, "app"), configFile: path.join(TOOL_ROOT, "vite.config.mjs"), logLevel: "warn" });
    // Second entry: the view-only viewer that Share › Export copies next to the screens (the first build empties dist/)
    await build({ root: path.join(TOOL_ROOT, "app"), configFile: path.join(TOOL_ROOT, "vite.config.mjs"), logLevel: "warn", mode: "viewer" });
  }
  if (!existsSync(path.join(distDir, "index.html"))) throw new Error("No app build found (running with npm start creates it)");

  const LOCKED = /^\/api\/(board|boards\/|history\/|edit|undo|redo|place|notes|pages|comments|chat\/revert)/;
  // Screens folder as the agent sees it: relative to the project root
  const screensRel = toPosix(path.relative(rootOf(dir), store.screensDir)) || "screens";
  const routes = [
    ["GET", "/api/health", async (req, res) => sendJson(res, 200, { ok: true, dir, root: rootOf(dir), screens: screensRel, pid: process.pid })],
    [
      "GET",
      "/api/board",
      async (req, res) => {
        const { board, files, missing } = await store.syncBoard();
        sendJson(res, 200, { board, files, missing, dir, screens: screensRel });
      },
    ],
    [
      "GET",
      "/api/file",
      async (req, res, url) => {
        const f = url.searchParams.get("f") ?? "";
        const p = safeJoin(store.screensDir, f);
        if (!p || !f.endsWith(".html")) return sendJson(res, 400, { error: "Invalid file" });
        try {
          const html = await fs.readFile(p, "utf8");
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          res.end(html);
        } catch {
          sendJson(res, 404, { error: "File not found" });
        }
      },
    ],
    // Requests that change boards/files/comments run one at a time via store.exclusive (so they never overlap auto-placement or lose a read-modify-write)
    ...extraRoutes.map((r) => [r[0], r[1], (req, res, url) => (r[0] !== "GET" && LOCKED.test(r[1]) ? store.exclusive(() => r[2](req, res, url, ctx)) : r[2](req, res, url, ctx))]),
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      // Design folder: static files like /screens/*, /assets/* (same origin, so iframes can access contentDocument)
      if (req.method === "GET" && (url.pathname.startsWith("/screens/") || url.pathname.startsWith("/assets/"))) {
        const p = safeJoin(dir, decodeURIComponent(url.pathname.slice(1)));
        if (p && url.pathname.startsWith("/screens/") && p.endsWith(".html") && (await serveScreen(res, p))) return;
        if (p && (await serveFile(res, p))) return;
        res.writeHead(404);
        return res.end("not found");
      }
      for (const [m, p, h] of routes) {
        // Who sent a write (MCP clients send their agent name, in-app runs their run id): read by history.push
        if (req.method === m && url.pathname === p) return await requestScope.run({ agent: cleanAgent(req.headers["x-easel-agent"]) || undefined, run: cleanAgent(req.headers["x-easel-run"]) || undefined }, () => h(req, res, url));
      }
      if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Unknown API" });
      if (url.pathname.startsWith("/_app/")) {
        const p = safeJoin(distDir, url.pathname.slice("/_app/".length));
        if (p && (await serveFile(res, p))) return;
        res.writeHead(404);
        return res.end("not found");
      }
      // Links inside a screen starting with '/': redirect to screens/ if the same file exists there (same meaning as Claude Design's project root)
      if (req.method === "GET" && path.extname(url.pathname)) {
        const rel = decodeURIComponent(url.pathname.slice(1));
        const inScreens = safeJoin(store.screensDir, rel);
        if (inScreens && existsSync(inScreens)) {
          res.writeHead(302, { Location: `/screens/${rel.split("/").map(encodeURIComponent).join("/")}${url.search}${url.hash}` });
          return res.end();
        }
        const inDir = safeJoin(dir, rel);
        if (inDir && (await serveFile(res, inDir))) return;
        res.writeHead(404);
        return res.end("not found");
      }
      await serveFile(res, path.join(distDir, "index.html"));
    } catch (e) {
      console.error(e);
      if (!res.headersSent) sendJson(res, e.status ?? 500, { error: String(e.message ?? e) });
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("error", () => {}); // ws re-emits the http server's errors; a busy port is handled by listen()
  ctx.broadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const c of wss.clients) if (c.readyState === 1) c.send(data);
  };
  // Working from source: when a new app build lands in dist/, open tabs reload themselves
  let appWatcher = null;
  if (dev && existsSync(path.join(TOOL_ROOT, "app"))) {
    appWatcher = chokidar.watch(path.join(distDir, "index.html"), { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 300 } });
    appWatcher.on("all", () => ctx.broadcast({ type: "app-changed" }));
  }

  let used;
  try {
    used = await listen(server, port, autoPort);
  } catch (e) {
    await appWatcher?.close();
    throw e;
  }
  const unregister = register ? writeEntry({ port: used, dir, root: rootOf(dir) }) : () => {};

  return {
    ctx,
    server,
    port: used,
    url: `http://localhost:${used}`,
    unregister,
    async close() {
      unregister();
      await appWatcher?.close();
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise((r) => server.close(r));
    },
  };
}
