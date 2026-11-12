// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Extra APIs and the watcher added per milestone. Passed to createServer as extraRoutes. PLAN.md ch. 4.
import fs from "node:fs/promises";
import path from "node:path";

import { activityRoutes } from "./activity.mjs";
import { closeBrowser, newPage } from "./browser.mjs";
import { boardRoutes } from "./boards.mjs";
import { chatRoutes } from "./chat.mjs";
import { tokenRoutes } from "./tokens.mjs";
import { snapshotRoutes } from "./snapshot.mjs";
import { applyEdit, EditError } from "./edit.mjs";
import { exportRoutes } from "./export.mjs";
import { easelDir, rootOf, toPosix, writeAtomic } from "./fsutil.mjs";
import { inspect, outline } from "./html.mjs";
import { readBody, safeJoin, sendJson } from "./index.mjs";
import { watchDesign } from "./watch.mjs";

const OUTER_LIMIT = 4096;
let selection = null;
const chat = chatRoutes({ getSelection: () => selection });

async function writeScreen(ctx, p, html) {
  await writeAtomic(p, html);
}

async function readScreen(ctx, file) {
  const p = safeJoin(ctx.store.screensDir, file ?? "");
  if (!p || !String(file).endsWith(".html")) throw Object.assign(new Error("Invalid file"), { status: 400 });
  try {
    return { p, html: await fs.readFile(p, "utf8") };
  } catch {
    throw Object.assign(new Error("File not found"), { status: 404 });
  }
}

/* ---------- Comments (docs/design/comments.json) ---------- */
async function readComments(ctx) {
  try {
    const d = JSON.parse(await fs.readFile(path.join(ctx.dir, "comments.json"), "utf8"));
    return Array.isArray(d.comments) ? d.comments : [];
  } catch {
    return [];
  }
}
async function writeComments(ctx, comments) {
  await writeAtomic(path.join(ctx.dir, "comments.json"), JSON.stringify({ comments }, null, 1) + "\n");
  ctx.broadcast({ type: "comments-changed" });
}

/* ---------- Screenshots (when playwright is available) ---------- */
// The shared Chromium lives in browser.mjs (export uses it too); re-exported here for existing callers
export { cachedBrowser, closeBrowser, newPage } from "./browser.mjs";

/** Thumbnail sizes (long side, device px) the client may ask for; anything else snaps to the next one up. Matches THUMB_SIZES in Canvas.tsx */
const THUMB_PX = [600, 1200, 2400];
export const thumbPx = (v) => THUMB_PX.find((s) => s >= Number(v)) ?? (Number(v) > 0 ? THUMB_PX[THUMB_PX.length - 1] : THUMB_PX[0]);

/** Generate at most two thumbnails at a time */
let running = 0;
const waiting = [];
function thumbQueue(job) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      running++;
      try {
        resolve(await job());
      } catch (e) {
        reject(e);
      } finally {
        running--;
        waiting.shift()?.();
      }
    };
    if (running < 2) void run();
    else waiting.push(run);
  });
}

export async function screenshot(ctx, port, file, elPath) {
  const board = (await ctx.store.readBoard()).boards[file];
  const page = await newPage({ viewport: { width: board?.w ?? 390, height: board?.h ?? 844 }, deviceScaleFactor: 2 });
  try {
    await page.goto(`http://127.0.0.1:${port}/screens/${encodeURI(file)}`, { waitUntil: "networkidle" });
    const outDir = path.join(await easelDir(ctx.dir), "screenshots");
    await fs.mkdir(outDir, { recursive: true });
    const name = `${file.replace(/[\\/]/g, "_").replace(/\.html$/, "")}${elPath ? "--" + elPath.replace(/\//g, "-") : ""}.png`;
    const out = path.join(outDir, name);
    if (elPath) {
      const handle = await page.evaluateHandle((p) => {
        let n = document.body;
        for (const i of p.split("/")) n = n?.children[Number(i)];
        return n;
      }, elPath);
      const el = handle.asElement();
      if (!el) throw Object.assign(new Error("Element not found"), { status: 404 });
      await el.screenshot({ path: out });
    } else {
      await page.screenshot({ path: out, fullPage: true });
    }
    return out;
  } finally {
    await page.close();
  }
}

export const extraRoutes = [
  [
    "POST",
    "/api/edit",
    async (req, res, url, ctx) => {
      const b = await readBody(req);
      const { p, html } = await readScreen(ctx, b.file);
      let next;
      try {
        next = applyEdit(html, b);
      } catch (e) {
        if (e instanceof EditError) return sendJson(res, e.status, { error: e.message });
        throw e;
      }
      if (next === html) return sendJson(res, 200, { ok: true, changed: false });
      await writeScreen(ctx, p, next);
      ctx.history.push(`${b.file} ${b.op}`, [{ path: p, before: html, after: next }]);
      ctx.broadcast({ type: "history-changed" });
      sendJson(res, 200, { ok: true, changed: true });
    },
  ],
  // Legacy route: forwards to the chronological history
  ...["undo", "redo"].map((kind) => [
    "POST",
    `/api/${kind}`,
    async (req, res, url, ctx) => {
      const step = await ctx.history[kind]();
      ctx.broadcast({ type: "history-changed" });
      sendJson(res, 200, { ok: true, changed: !!step, label: step?.label ?? null });
    },
  ]),
  ...boardRoutes(),
  ...activityRoutes(),
  ...chat.routes,
  ...tokenRoutes(),
  // Zoomed-out thumbnails: small images shown below 25% instead of empty frames. Stored per modification time in docs/design/.thumbs/ (gitignored)
  [
    "GET",
    "/api/thumb",
    async (req, res, url, ctx) => {
      const f = url.searchParams.get("f") ?? "";
      const src = safeJoin(ctx.store.screensDir, f);
      const st = src && (await fs.stat(src).catch(() => null));
      if (!st) return sendJson(res, 404, { error: "File not found" });
      const px = thumbPx(url.searchParams.get("px"));
      const dir = path.join(ctx.dir, ".thumbs");
      const base = f.replace(/[\\/]/g, "_");
      const stamp = `${base}.${Math.round(st.mtimeMs)}.`;
      const out = path.join(dir, `${stamp}${px}.jpg`);
      let buf = await fs.readFile(out).catch(() => null);
      if (!buf) {
        buf = await thumbQueue(async () => {
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(path.join(dir, ".gitignore"), "*\n").catch(() => {});
          const board = (await ctx.store.readBoard()).boards[f];
          const w = board?.w ?? 390;
          const h = board?.h ?? 844;
          // Long side ≈ px device pixels, so large boards stay sharp when zoomed out on a 2× display
          const page = await newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Math.min(2, px / Math.max(w, h)) });
          try {
            await page.goto(`http://127.0.0.1:${req.socket.localPort}/screens/${encodeURI(f)}`, { waitUntil: "load", timeout: 15000 });
            await page.waitForTimeout(150);
            const b = await page.screenshot({ type: "jpeg", quality: 80 });
            // Remove thumbnails of older versions (other sizes of this version stay)
            for (const n of await fs.readdir(dir)) if (n.startsWith(base + ".") && !n.startsWith(stamp)) await fs.rm(path.join(dir, n), { force: true });
            await fs.writeFile(out, b);
            return b;
          } finally {
            await page.close();
          }
        });
      }
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": buf.length, "Cache-Control": "max-age=31536000, immutable" });
      res.end(buf);
    },
  ],
  ...snapshotRoutes(),
  ...exportRoutes(),
  // Assets: list and upload docs/design/assets/ (images, fonts). Screens reference them as ../assets/<name>
  [
    "GET",
    "/api/assets",
    async (req, res, url, ctx) => {
      const dir = path.join(ctx.dir, "assets");
      const names = await fs.readdir(dir).catch(() => []);
      const list = [];
      for (const n of names.filter((n) => !n.startsWith(".")).sort()) {
        const st = await fs.stat(path.join(dir, n));
        if (st.isFile()) list.push({ name: n, size: st.size, kind: /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(n) ? "image" : /\.(woff2?|ttf|otf)$/i.test(n) ? "font" : "file", url: `/assets/${encodeURIComponent(n)}`, ref: `../assets/${n}` });
      }
      sendJson(res, 200, { assets: list });
    },
  ],
  [
    "POST",
    "/api/assets",
    async (req, res, url, ctx) => {
      const b = await readBody(req, 30 * 1024 * 1024);
      const base = String(b.name ?? "").replace(/[^\w.-]+/g, "-").replace(/^-+/, "").toLowerCase();
      if (!/\.(png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf)$/i.test(base)) return sendJson(res, 400, { error: "Only images (png, jpg, gif, webp, svg, avif) or fonts (woff2, woff, ttf, otf) can be uploaded" });
      const dir = path.join(ctx.dir, "assets");
      await fs.mkdir(dir, { recursive: true });
      const stem = base.replace(/\.[^.]+$/, "");
      const ext = base.slice(stem.length);
      let name = base;
      for (let i = 2; await fs.access(path.join(dir, name)).then(() => true, () => false); i++) name = `${stem}-${i}${ext}`;
      await writeAtomic(path.join(dir, name), Buffer.from(String(b.data ?? ""), "base64"));
      ctx.broadcast({ type: "assets-changed" });
      sendJson(res, 200, { name, url: `/assets/${encodeURIComponent(name)}`, ref: `../assets/${name}` });
    },
  ],
  [
    "GET",
    "/api/element",
    async (req, res, url, ctx) => {
      const { html } = await readScreen(ctx, url.searchParams.get("f"));
      const info = inspect(html, url.searchParams.get("path") ?? "");
      if (!info) return sendJson(res, 404, { error: "Element not found (the file changed, select again)" });
      sendJson(res, 200, { hash: info.hash, tag: info.tag, text: info.text.slice(0, 200), source: url.searchParams.get("full") ? info.source : info.source.slice(0, OUTER_LIMIT) });
    },
  ],
  [
    "GET",
    "/api/outline",
    async (req, res, url, ctx) => {
      const { html } = await readScreen(ctx, url.searchParams.get("f"));
      sendJson(res, 200, { tree: outline(html) });
    },
  ],
  [
    "GET",
    "/api/selection",
    async (req, res, url, ctx) => {
      // Selection + canvas state (mode, page, visible/selected boards, pending saves, recent edits) + errored boards
      const c = chat.state.context ?? {};
      const { missing } = await ctx.store.syncBoard();
      const errored = { ...chat.state.errors };
      for (const f of missing) errored[f] = [{ kind: "missing", message: "File not found" }];
      sendJson(res, 200, {
        selection,
        mode: c.mode ?? null,
        page: c.page ?? null,
        pageName: c.pageName ?? null,
        visibleArtboards: c.visibleArtboards ?? [],
        selectedArtboards: c.selectedArtboards ?? [],
        dirty: !!c.dirty,
        edits: ctx.history.state().undo.slice(-10),
        erroredArtboards: Object.keys(errored),
        firstError: Object.entries(errored).map(([file, l]) => ({ file, ...l[0] }))[0] ?? null,
      });
    },
  ],
  [
    "PUT",
    "/api/selection",
    async (req, res, url, ctx) => {
      const body = await readBody(req);
      if (!body || !body.file) {
        selection = null;
      } else {
        const { html } = await readScreen(ctx, body.file);
        const info = inspect(html, body.path);
        if (!info) return sendJson(res, 409, { error: "The file changed, select again" });
        selection = {
          file: body.file,
          path: body.path,
          paths: Array.isArray(body.paths) && body.paths.length > 1 ? body.paths : undefined,
          tag: info.tag,
          text: info.text.slice(0, 500),
          outerHTML: info.source.length > OUTER_LIMIT ? info.source.slice(0, OUTER_LIMIT) + "…" : info.source,
          hash: info.hash,
          styles: body.styles ?? {},
          kind: body.kind ?? null,
          label: body.label ?? null,
          selectedAt: new Date().toISOString(),
        };
      }
      ctx.broadcast({ type: "selection-changed" });
      sendJson(res, 200, { selection });
    },
  ],
  [
    "GET",
    "/api/comments",
    async (req, res, url, ctx) => {
      let list = await readComments(ctx);
      const f = url.searchParams.get("file");
      if (f) list = list.filter((c) => c.file === f);
      if (url.searchParams.get("unresolved") === "1") list = list.filter((c) => !c.resolved);
      sendJson(res, 200, { comments: list });
    },
  ],
  [
    "POST",
    "/api/comments",
    async (req, res, url, ctx) => {
      const b = await readBody(req);
      const list = await readComments(ctx);
      if (b.action === "reply") {
        const c = list.find((x) => x.id === b.id);
        if (!c) return sendJson(res, 404, { error: "Comment not found" });
        if (!String(b.text ?? "").trim()) return sendJson(res, 400, { error: "text is required" });
        const r = { id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, author: b.author ?? process.env.USER ?? "unknown", text: String(b.text).trim(), createdAt: new Date().toISOString() };
        c.replies = [...(c.replies ?? []), r];
        if (b.resolve) c.resolved = true;
        await writeComments(ctx, list);
        ctx.broadcast({ type: "comments-changed" });
        return sendJson(res, 200, { comment: c, reply: r });
      }
      if (b.action === "resolve") {
        const c = list.find((x) => x.id === b.id);
        if (!c) return sendJson(res, 404, { error: "Comment not found" });
        c.resolved = b.resolved ?? true;
        await writeComments(ctx, list);
        return sendJson(res, 200, { comment: c });
      }
      if (!b.file || !String(b.text ?? "").trim()) return sendJson(res, 400, { error: "file and text are required" });
      const c = {
        id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        file: b.file,
        path: b.path ?? "",
        text: String(b.text).trim(),
        author: b.author ?? process.env.USER ?? "unknown",
        createdAt: new Date().toISOString(),
        resolved: false,
      };
      list.push(c);
      await writeComments(ctx, list);
      sendJson(res, 200, { comment: c });
    },
  ],
  [
    "POST",
    "/api/screenshot",
    async (req, res, url, ctx) => {
      const b = await readBody(req);
      await readScreen(ctx, b.file);
      const port = Number(req.socket.localPort);
      const out = await screenshot(ctx, port, b.file, b.path || "");
      sendJson(res, 200, { path: out, relPath: toPosix(path.relative(rootOf(ctx.dir), out)) });
    },
  ],
  [
    "POST",
    "/api/place",
    async (req, res, url, ctx) => {
      const b = await readBody(req);
      await readScreen(ctx, b.file);
      const { board } = await ctx.store.syncBoardNow();
      const cur = board.boards[b.file];
      board.boards[b.file] = {
        ...cur,
        ...(Number.isFinite(b.x) ? { x: b.x } : {}),
        ...(Number.isFinite(b.y) ? { y: b.y } : {}),
        ...(b.title ? { title: b.title } : {}),
        ...(b.page ? { page: b.page } : {}),
      };
      if (Number.isFinite(b.x) || Number.isFinite(b.y)) delete board.boards[b.file].autoPlaced;
      await ctx.store.writeBoard(board);
      ctx.broadcast({ type: "board-changed", source: "server:place" });
      sendJson(res, 200, { board: board.boards[b.file] });
    },
  ],
];

/** Things to attach after the server starts (file watching etc.) */
export async function attach(app) {
  const stop = watchDesign(app.ctx);
  const close = app.close;
  app.close = async () => {
    chat.close(); // open permission requests are denied, so a waiting agent does not hang
    await stop();
    await closeBrowser();
    await close();
  };
}
