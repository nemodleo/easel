// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Share a view-only copy: a static viewer of the design folder (web folder, or one self-contained .html), or PDF / PNG of the boards.
// Writes only inside the chosen folder; a re-export removes only the files its own manifest lists.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { TOOL_ROOT } from "./args.mjs";
import { createBoardStore } from "./board.mjs";
import { browserStatus, newPage as sharedNewPage } from "./browser.mjs";
import { projectName, rootOf, toPosix } from "./fsutil.mjs";
import { MIME, readBody, safeJoin, sendJson } from "./index.mjs";
import { git } from "./snapshot.mjs";

export const MANIFEST = ".easel-export.json";
/** Viewer code and data sit in their own folder so they never collide with the design folder's files (screens/, assets/) */
const VIEWER = "easel-viewer";
export const EASEL_URL = "https://github.com/nemodleo/easel";
const DATA_MIME = { ...MIME, ".avif": "image/avif", ".ttf": "font/ttf", ".otf": "font/otf", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".txt": "text/plain", ".map": "application/json" };
const fail = (status, message) => Object.assign(new Error(message), { status });

/** <project root>/easel-export: the folder the canvas exports to (the CLI can pick another with --out) */
export const defaultOut = (dir) => path.join(rootOf(dir), "easel-export");
const slug = (dir) => projectName(dir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "easel";
export const singleName = (dir) => `${slug(dir)}-canvas.html`;

/* ---------- Scope ---------- */

/** Boards, notes, shapes and pages a scope covers. scope: { page: id or name } or { boards: [file] }; neither = the whole canvas */
export function pickScope(board, files, { page, boards } = {}) {
  const have = new Set(files);
  const first = board.pages[0]?.id;
  const pageOf = (item) => item.page ?? first;
  let keep;
  let onPage = () => true;
  if (boards?.length) {
    for (const f of boards) if (typeof f !== "string" || !Object.hasOwn(board.boards, f) || !have.has(f)) throw fail(400, `Unknown board: ${String(f).slice(0, 120)}`);
    keep = board.order.filter((f) => boards.includes(f));
    // Notes and shapes come along when they sit next to the chosen boards
    const r = bbox(keep.map((f) => board.boards[f]), 240);
    const pages = new Set(keep.map((f) => pageOf(board.boards[f])));
    onPage = (item) => pages.has(pageOf(item)) && item.x >= r.x && item.x <= r.x + r.w && item.y >= r.y && item.y <= r.y + r.h;
  } else if (page) {
    const pg = board.pages.find((p) => p.id === page) ?? board.pages.find((p) => p.name === page);
    if (!pg) throw fail(400, board.pages.length ? `Unknown page: ${String(page).slice(0, 120)}` : "This canvas has no pages; leave the page out to export everything");
    onPage = (item) => pageOf(item) === pg.id;
    keep = board.order.filter((f) => have.has(f) && onPage(board.boards[f]));
  } else keep = board.order.filter((f) => have.has(f) && board.boards[f]);
  const notes = Object.keys(board.notes ?? {}).filter((id) => onPage(board.notes[id]));
  const shapes = Object.keys(board.shapes ?? {}).filter((id) => onPage(board.shapes[id]));
  const used = new Set(keep.map((f) => pageOf(board.boards[f])));
  return { boards: keep, notes, shapes, pages: board.pages.filter((p) => used.has(p.id)) };
}

function bbox(rects, pad = 0) {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...rects.map((r) => r.x)) - pad;
  const y = Math.min(...rects.map((r) => r.y)) - pad;
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) + pad - x, h: Math.max(...rects.map((r) => r.y + r.h)) + pad - y };
}

/** Screens with no board.json entry yet get a spot below everything, in memory only (the CLI must not rewrite board.json in CI) */
async function placeMissing(board, files, sizeOf) {
  const loose = files.filter((f) => !board.boards[f]);
  if (!loose.length) return board;
  const all = Object.values(board.boards);
  let x = all.length ? Math.min(...all.map((b) => b.x)) : 0;
  const y = all.length ? Math.max(...all.map((b) => b.y + b.h)) + 120 : 0;
  const boards = { ...board.boards };
  for (const f of loose) {
    const s = await sizeOf(f);
    boards[f] = { x, y, ...s, title: f.replace(/\.html$/, "") };
    x += s.w + 80;
  }
  return { ...board, boards, order: [...board.order, ...loose] };
}

/* ---------- Stamp ---------- */

/** Export time, plus <repo>@<short commit> when the design folder is in a git repository */
export async function exportStamp(dir, now = new Date()) {
  const at = now.toISOString();
  const top = await git(dir, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { at };
  const head = await git(dir, ["rev-parse", "--short", "HEAD"]);
  return { at, repo: path.basename(top.out.trim()), ...(head.code === 0 && head.out.trim() ? { commit: head.out.trim() } : {}) };
}

/* ---------- URLs inside screens ---------- */

const unent = (s) => s.replace(/&(amp|quot|#39|apos);/g, (_, e) => ({ amp: "&", quot: '"', "#39": "'", apos: "'" })[e]);
const FRAME_TAGS = new Set(["iframe", "frame", "embed", "object"]);
const URL_ATTRS = new Set(["src", "href", "poster", "data", "background", "xlink:href"]);
const TOKENS = /<!--[\s\S]*?-->|<script\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/script\s*>|<style\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/style\s*>|<[a-zA-Z][\w:-]*(?:"[^"]*"|'[^']*'|[^'">])*>/gi;

/** Calls fn(url) for every url() and @import in CSS; fn returns a replacement, or undefined to keep it */
export function mapCssUrls(css, fn) {
  return css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi, (m, a, b, c, d, e) => {
    const u = a ?? b ?? c ?? d ?? e ?? "";
    const r = u ? fn(u) : undefined;
    if (r === undefined || r === u) return m;
    return m.startsWith("@") ? `@import "${r}"` : `url("${r}")`;
  });
}

/**
 * Calls fn(url, kind) for every URL in an HTML document, outside scripts and comments; fn returns a replacement or undefined.
 * kind: "link" for <a>/<area> href (navigation), "frame" for iframe/frame/embed/object, "asset" for everything else.
 */
export function mapHtmlUrls(html, fn) {
  const tag = (t) => {
    const name = /^<([\w:-]+)/.exec(t)[1].toLowerCase();
    if (name === "base") return t;
    return t.replace(/(\s)([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+)/g, (m, sp, attr, eq, raw) => {
      const a = attr.toLowerCase();
      const val = unent(raw[0] === '"' || raw[0] === "'" ? raw.slice(1, -1) : raw);
      let next;
      if (a === "style") next = mapCssUrls(val, (u) => fn(u, "asset"));
      else if (a === "srcset" || a === "imagesrcset") next = mapSrcset(val, (u) => fn(u, "asset"));
      else if (URL_ATTRS.has(a)) next = fn(val, a === "href" && (name === "a" || name === "area") ? "link" : FRAME_TAGS.has(name) ? "frame" : "asset");
      if (next === undefined || next === val) return m;
      return `${sp}${attr}${eq}"${next.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
    });
  };
  return html.replace(TOKENS, (m, styleAttrs, styleBody) => {
    if (m.startsWith("<!--")) return m;
    if (/^<script\b/i.test(m)) return m.replace(/^<script\b(?:"[^"]*"|'[^']*'|[^'">])*>/i, tag);
    if (styleBody !== undefined) {
      const open = /^<style\b(?:"[^"]*"|'[^']*'|[^'">])*>/i.exec(m)[0];
      return tag(open) + mapCssUrls(styleBody, (u) => fn(u, "asset")) + m.slice(open.length + styleBody.length);
    }
    return tag(m);
  });
}

/** srcset candidates: a URL runs to the next whitespace (data: URLs keep their commas), descriptors run to the next comma */
function mapSrcset(val, fn) {
  const out = [];
  let changed = false;
  for (let i = 0; i < val.length; ) {
    while (i < val.length && /[\s,]/.test(val[i])) i++;
    if (i >= val.length) break;
    let j = i;
    while (j < val.length && !/\s/.test(val[j])) j++;
    let url = val.slice(i, j);
    let desc = "";
    if (url.endsWith(",")) url = url.replace(/,+$/, "");
    else {
      const k = val.indexOf(",", j);
      desc = val.slice(j, k < 0 ? val.length : k).trim();
      j = k < 0 ? val.length : k;
    }
    const r = fn(url);
    if (r !== undefined && r !== url) changed = true;
    out.push([r ?? url, desc].filter(Boolean).join(" "));
    i = j + 1;
  }
  return changed ? out.join(", ") : val;
}

/** Local URLs only: schemes (http:, data:, mailto:…), protocol-relative and fragment-only URLs are left alone */
const isLocal = (u) => !!u && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);
const splitSuffix = (u) => {
  const i = u.search(/[?#]/);
  return i < 0 ? [u, ""] : [u.slice(0, i), u.slice(i)];
};

/** Design-folder paths (posix) a local URL in fromRel may point to: a root-relative URL means screens/ first, then the folder (as the server serves it) */
export function refCandidates(fromRel, url) {
  if (!isLocal(url.trim())) return [];
  let [p] = splitSuffix(url.trim());
  try {
    p = decodeURIComponent(p);
  } catch {
    return [];
  }
  if (!p || p.includes("\0") || p.includes("\\")) return [];
  const list = p.startsWith("/") ? [`screens/${p.slice(1)}`, p.slice(1)] : [path.posix.join(path.posix.dirname(fromRel), p)];
  // Nothing outside the design folder, and no dot folders (.easel, .thumbs, .trash, .refs…) or dot files
  return list.map((r) => path.posix.normalize(r)).filter((r) => r && r !== "." && !r.startsWith("../") && r !== ".." && !path.posix.isAbsolute(r) && !r.split("/").some((s) => s.startsWith(".")));
}

const relFrom = (fromRel, rel) => path.posix.relative(path.posix.dirname(fromRel), rel) || path.posix.basename(rel);
const encodePath = (rel) => rel.split("/").map(encodeURIComponent).join("/");

/* ---------- Collecting what the screens need ---------- */

/**
 * Absolute path of a file inside the design folder, or null: missing, not a file, or a link that leads out of the folder.
 * An export is handed to other people, so a link in a cloned project must not pull in files from elsewhere on this machine.
 */
export async function fileIn(dir, rel) {
  const p = safeJoin(dir, rel);
  if (!p) return null;
  try {
    const [root, real] = await Promise.all([fs.realpath(dir), fs.realpath(p)]);
    if (!real.startsWith(root + path.sep)) return null;
    return (await fs.stat(real)).isFile() ? p : null;
  } catch {
    return null;
  }
}

/**
 * Walks the screens and everything they reference inside the design folder (CSS, images, fonts, scripts, embedded HTML).
 * Returns { files: Map<rel, Buffer>, skipped: [{ ref, from, reason }] }.
 */
async function collect(dir, screens, exclude) {
  const files = new Map();
  const skipped = [];
  const seen = new Set();
  const locate = async (fromRel, url) => {
    for (const c of refCandidates(fromRel, url)) {
      if (exclude(c)) continue;
      if (await fileIn(dir, c)) return c;
    }
    return null;
  };
  const visit = async (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const p = await fileIn(dir, rel);
    if (!p) throw fail(400, `${rel} is not a file inside the design folder`);
    const buf = await fs.readFile(p);
    files.set(rel, buf);
    const ext = path.posix.extname(rel).toLowerCase();
    if (ext !== ".html" && ext !== ".htm" && ext !== ".css") return;
    const found = [];
    const note = (u, kind) => {
      if (kind !== "link" && isLocal(u.trim())) found.push(u);
    };
    if (ext === ".css") mapCssUrls(buf.toString("utf8"), (u) => note(u, "asset"));
    else mapHtmlUrls(buf.toString("utf8"), note);
    for (const u of found) {
      const hit = await locate(rel, u);
      if (hit) await visit(hit);
      else if (!skipped.some((s) => s.ref === u && s.from === rel)) skipped.push({ ref: u, from: rel, reason: "not found in the design folder" });
    }
  };
  for (const f of screens) await visit(`screens/${f}`);
  return { files, skipped, locate };
}

/** Web folder: root-relative URLs become relative, so the copy works under any sub-path */
async function relativize(text, fromRel, isCss, locate) {
  const hits = new Map();
  const want = [];
  const note = (u) => {
    if (u.trim().startsWith("/") && isLocal(u.trim())) want.push(u);
  };
  if (isCss) mapCssUrls(text, note);
  else mapHtmlUrls(text, note);
  for (const u of want) {
    const hit = await locate(fromRel, u);
    if (hit) hits.set(u, relFrom(fromRel, hit) + splitSuffix(u.trim())[1]);
  }
  if (!hits.size) return text;
  return isCss ? mapCssUrls(text, (u) => hits.get(u)) : mapHtmlUrls(text, (u) => hits.get(u));
}

const mimeOf = (rel) => (DATA_MIME[path.posix.extname(rel).toLowerCase()] ?? "application/octet-stream").split(";")[0];

/** Single file: every asset a document references becomes a data: URL (CSS recursively); embedded HTML cannot be inlined and is listed */
async function inline(text, fromRel, isCss, ctx, depth = 0) {
  const { files, locate, skipped } = ctx;
  const map = new Map();
  const want = [];
  const note = (u, kind) => {
    if (isLocal(u.trim())) want.push([u, kind]);
  };
  if (isCss) mapCssUrls(text, (u) => note(u, "asset"));
  else mapHtmlUrls(text, note);
  for (const [u, kind] of want) {
    if (map.has(u)) continue;
    const hit = await locate(fromRel, u);
    if (kind === "link") {
      // Navigation stays a link (Play follows it inside the viewer); root-relative ones become relative so they resolve
      if (hit && u.trim().startsWith("/")) map.set(u, relFrom(fromRel, hit) + splitSuffix(u.trim())[1]);
      continue;
    }
    const buf = hit && files.get(hit);
    if (!buf) continue; // already listed as missing by collect()
    if (kind === "frame" || /\.html?$/i.test(hit)) {
      if (!skipped.some((s) => s.ref === u && s.from === fromRel)) skipped.push({ ref: u, from: fromRel, reason: "embedded HTML is not inlined in a single file" });
      continue;
    }
    if (/\.css$/i.test(hit) && depth < 8) {
      const css = await inline(buf.toString("utf8"), hit, true, ctx, depth + 1);
      map.set(u, `data:text/css;base64,${Buffer.from(css).toString("base64")}`);
    } else map.set(u, `data:${mimeOf(hit)};base64,${buf.toString("base64")}`);
  }
  if (!map.size) return text;
  return isCss ? mapCssUrls(text, (u) => map.get(u)) : mapHtmlUrls(text, (u) => map.get(u));
}

/* ---------- Viewer page ---------- */

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** JSON that is safe inside <script>: no </script> and no HTML comment openers */
const scriptJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

async function viewerBuild() {
  const d = path.join(TOOL_ROOT, "dist", "viewer");
  try {
    return { js: await fs.readFile(path.join(d, "viewer.js"), "utf8"), css: await fs.readFile(path.join(d, "viewer.css"), "utf8") };
  } catch {
    throw fail(500, "No viewer build found (run npm run build)");
  }
}

const page = ({ title, head, body }) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="generator" content="Easel">\n<title>${escHtml(title)} — view only</title>\n${head}\n</head>\n<body>\n<div id="root"></div>\n${body}\n</body>\n</html>\n`;

/* ---------- Output folder ---------- */

/** A path the manifest lists, only when it is a plain relative path inside out (no .., no absolute, no backslashes) */
function ownPath(out, rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\0") || rel.includes("\\") || path.posix.isAbsolute(rel) || /^[a-z]:/i.test(rel)) return null;
  if (rel.split("/").some((s) => s === ".." || s === "." || s === "")) return null;
  const p = path.join(out, ...rel.split("/"));
  return p.startsWith(out + path.sep) ? p : null;
}

async function readManifest(out) {
  try {
    const m = JSON.parse(await fs.readFile(path.join(out, MANIFEST), "utf8"));
    return m && m.easel === 1 && typeof m.exports === "object" && m.exports ? m : null;
  } catch {
    return null;
  }
}

/** Refuses folders that are not ours, then removes this kind's files from the previous export (only what the manifest lists) */
async function prepareOut(out, dir, kind) {
  const screensDir = path.join(dir, "screens");
  if (out === path.parse(out).root) throw fail(400, "Pick a folder for the export, not the drive root");
  if (dir === out || dir.startsWith(out + path.sep)) throw fail(400, `${out} holds the design folder; export to a folder of its own`);
  if (out === screensDir || out.startsWith(screensDir + path.sep)) throw fail(400, "The export folder cannot be inside screens/ (it would turn into boards)");
  const entries = await fs.readdir(out).catch((e) => (e.code === "ENOENT" ? null : Promise.reject(e)));
  if (!entries) {
    await fs.mkdir(out, { recursive: true });
    return { easel: 1, exports: {} };
  }
  const manifest = await readManifest(out);
  if (!manifest) {
    if (entries.length) throw fail(409, `${out} is not empty and was not made by an Easel export. Empty it or pick another folder.`);
    return { easel: 1, exports: {} };
  }
  const old = manifest.exports[kind]?.files ?? [];
  const dirs = new Set();
  for (const rel of Array.isArray(old) ? old : []) {
    const p = ownPath(out, rel);
    if (!p) continue;
    await fs.rm(p, { force: true });
    for (let d = path.dirname(p); d.startsWith(out + path.sep); d = path.dirname(d)) dirs.add(d);
  }
  // Empty folders left behind go too, deepest first
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) await fs.rmdir(d).catch(() => {});
  delete manifest.exports[kind];
  return manifest;
}

async function writeOut(out, manifest, kind, entries, at) {
  // The manifest lists the new files before they are written, so a failed export still leaves nothing untracked
  manifest.exports[kind] = { at, files: entries.map((e) => e.rel) };
  await fs.writeFile(path.join(out, MANIFEST), JSON.stringify(manifest, null, 1) + "\n");
  let bytes = 0;
  for (const e of entries) {
    const p = ownPath(out, e.rel);
    if (!p) throw fail(400, `Refusing to write outside the export folder: ${e.rel}`);
    await fs.mkdir(path.dirname(p), { recursive: true });
    if (e.from) await fs.copyFile(e.from, p);
    else await fs.writeFile(p, e.data);
    bytes += e.from ? (await fs.stat(p)).size : Buffer.byteLength(e.data);
  }
  return bytes;
}

/* ---------- PDF and PNG ---------- */

/** A throwaway static server for the design folder while Chromium renders it (the CLI runs without a canvas) */
async function serveDesign(dir) {
  const server = http.createServer(async (req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).slice(1);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    for (const c of rel.startsWith("screens/") ? [rel] : [`screens/${rel}`, rel]) {
      if (c.split("/").some((s) => s.startsWith("."))) continue;
      const p = await fileIn(dir, c);
      if (!p) continue;
      res.writeHead(200, { "Content-Type": MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream" });
      return res.end(await fs.readFile(p));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

async function renderBoards(dir, boards, newPage) {
  const srv = await serveDesign(dir);
  const shots = [];
  try {
    for (const b of boards) {
      let pg;
      try {
        pg = await newPage({ viewport: { width: b.w, height: b.h }, deviceScaleFactor: 2 });
      } catch (e) {
        throw fail(501, `PDF and PNG need a headless Chromium (${String(e.message ?? e).split("\n")[0]}). Run npx playwright install chromium.`);
      }
      try {
        await pg.goto(`${srv.url}/screens/${encodePath(b.file)}`, { waitUntil: "load", timeout: 20000 });
        await pg.waitForTimeout(150);
        shots.push({ ...b, png: await pg.screenshot({ type: "png" }) });
      } finally {
        await pg.close();
      }
    }
  } finally {
    await srv.close();
  }
  return shots;
}

/** One page per board, each page the board's own size (CSS named pages) */
async function pdfOf(shots, newPage) {
  const css = shots.map((s, i) => `@page b${i}{size:${s.w}px ${s.h}px;margin:0}.b${i}{page:b${i};width:${s.w}px;height:${s.h}px}`).join("");
  const body = shots.map((s, i) => `<div class="b${i}"><img src="data:image/png;base64,${s.png.toString("base64")}" alt=""></div>`).join("");
  const pg = await newPage();
  try {
    await pg.setContent(`<!doctype html><html><head><style>html,body{margin:0}div{break-after:page;overflow:hidden}div:last-child{break-after:auto}img{display:block;width:100%;height:100%}${css}</style></head><body>${body}</body></html>`, { waitUntil: "load" });
    return await pg.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await pg.close();
  }
}

/* ---------- Export ---------- */

/**
 * Exports the design folder. format: "web" (with singleFile for one .html), "pdf" or "png".
 * scope: page (id or name) or boards ([file]); neither = everything. dryRun: build in memory and return the size only.
 * Returns { kind, out, outRel, main, mainRel, files, bytes, skipped, deploy }.
 */
export async function exportDesign({ dir, out, store, format = "web", singleFile = false, page: pageId, boards: boardList, dryRun = false, now = new Date(), newPage = sharedNewPage }) {
  dir = path.resolve(dir);
  if (!existsSync(path.join(dir, "screens"))) throw fail(400, `No screens/ folder in ${dir}`);
  out = path.resolve(out ?? defaultOut(dir));
  const kind = format === "pdf" ? "pdf" : format === "png" ? "png" : singleFile ? "single" : "web";
  const st = store ?? createBoardStore(dir);
  const files = await st.listScreenFiles();
  const board = await placeMissing(await st.readBoard(), files, st.readBoardSize);
  const scope = pickScope(board, files, { page: pageId, boards: boardList });
  if (!scope.boards.length) throw fail(400, "Nothing to export: no boards in this scope");
  const root = rootOf(dir);
  const outRelOf = (p) => (p === root || p.startsWith(root + path.sep) ? toPosix(path.relative(root, p)) : toPosix(p));
  const entries = [];
  let skipped = [];
  let main;

  if (kind === "pdf" || kind === "png") {
    const status = newPage === sharedNewPage ? await browserStatus() : { ok: true };
    if (!status.ok) throw fail(501, `PDF and PNG are unavailable here. ${status.reason}`);
    const shots = await renderBoards(dir, scope.boards.map((f) => ({ file: f, w: board.boards[f].w, h: board.boards[f].h })), newPage);
    if (kind === "png") for (const s of shots) entries.push({ rel: `png/${s.file.replace(/\.html$/, "").replace(/\//g, "-")}@2x.png`, data: s.png });
    else entries.push({ rel: `${slug(dir)}-canvas.pdf`, data: await pdfOf(shots, newPage) });
    main = kind === "pdf" ? entries[0].rel : "png/";
  } else {
    const outInDir = out.startsWith(dir + path.sep) ? toPosix(path.relative(dir, out)) : null;
    const exclude = (rel) => !!outInDir && (rel === outInDir || rel.startsWith(outInDir + "/"));
    const col = await collect(dir, scope.boards, exclude);
    skipped = col.skipped;
    const viewer = await viewerBuild();
    const comments = (await readComments(dir)).filter((c) => scope.boards.includes(c.file));
    const pick = (obj, ids) => Object.fromEntries(ids.map((id) => [id, obj[id]]));
    const shapes = pick(board.shapes ?? {}, scope.shapes);
    const data = {
      version: 1,
      title: board.title,
      stamp: await exportStamp(dir, now),
      board: { version: 1, title: board.title, pages: scope.pages, boards: pick(board.boards, scope.boards), order: scope.boards, notes: pick(board.notes ?? {}, scope.notes), shapes, ...(board.groupNames ? { groupNames: board.groupNames } : {}) },
      files: scope.boards,
      comments,
    };
    // Image shapes point at ../assets/x (relative to screens/): the copy, or the image itself in a single file
    const shapeFiles = new Map();
    for (const [id, s] of Object.entries(shapes)) {
      if (s.kind !== "image" || !s.src) continue;
      const hit = await col.locate("screens/_", s.src);
      if (!hit) {
        skipped.push({ ref: s.src, from: "board.json", reason: "not found in the design folder" });
        continue;
      }
      const buf = col.files.get(hit) ?? (await fs.readFile(path.join(dir, hit)));
      shapeFiles.set(hit, buf);
      shapes[id] = { ...s, src: kind === "single" ? `data:${mimeOf(hit)};base64,${buf.toString("base64")}` : encodePath(hit) };
    }
    if (kind === "single") {
      data.screens = {};
      for (const f of scope.boards) data.screens[f] = await inline(col.files.get(`screens/${f}`).toString("utf8"), `screens/${f}`, false, col);
      main = singleName(dir);
      const html = page({
        title: board.title,
        head: `<style>${viewer.css.replace(/<\/style/gi, "<\\/style")}</style>`,
        body: `<script>window.EASEL_EXPORT=${scriptJson(data)};</script>\n<script>${viewer.js.replace(/<\/script/gi, "<\\/script")}</script>`,
      });
      entries.push({ rel: main, data: html });
    } else {
      for (const [rel, buf] of new Map([...col.files, ...shapeFiles])) {
        const ext = path.posix.extname(rel).toLowerCase();
        if ([".html", ".htm", ".css"].includes(ext)) entries.push({ rel, data: await relativize(buf.toString("utf8"), rel, ext === ".css", col.locate) });
        else entries.push({ rel, from: path.join(dir, rel) });
      }
      const ours = new Set(["index.html", ".nojekyll"]);
      for (const e of entries) if (ours.has(e.rel) || e.rel.startsWith(VIEWER + "/")) throw fail(409, `The design folder has ${e.rel}, which the viewer needs for itself`);
      entries.push(
        { rel: "index.html", data: page({ title: board.title, head: `<link rel="stylesheet" href="${VIEWER}/viewer.css">`, body: `<script src="${VIEWER}/data.js"></script>\n<script src="${VIEWER}/viewer.js"></script>` }) },
        { rel: `${VIEWER}/viewer.js`, data: viewer.js },
        { rel: `${VIEWER}/viewer.css`, data: viewer.css },
        { rel: `${VIEWER}/data.js`, data: `window.EASEL_EXPORT=${scriptJson(data)};\n` },
        // GitHub Pages: serve the folder as is (no Jekyll)
        { rel: ".nojekyll", data: "" },
      );
      main = "index.html";
    }
  }

  const result = { kind, out, outRel: outRelOf(out) + "/", main: path.join(out, main), mainRel: outRelOf(path.join(out, main)) + (main.endsWith("/") ? "/" : ""), files: entries.length, skipped };
  if (dryRun) return { ...result, bytes: entries.reduce((n, e) => n + (e.data != null ? Buffer.byteLength(e.data) : 0), 0) };
  const manifest = await prepareOut(out, dir, kind);
  const bytes = await writeOut(out, manifest, kind, entries, now.toISOString());
  return { ...result, bytes, ...(kind === "web" ? { deploy: deployCommand(root, out) } : {}) };
}

async function readComments(dir) {
  try {
    const d = JSON.parse(await fs.readFile(path.join(dir, "comments.json"), "utf8"));
    return Array.isArray(d.comments) ? d.comments : [];
  } catch {
    return [];
  }
}

const shellQuote = (s) => (/^[\w./@:,=+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
/** Hosts the web folder on Vercel (a preview URL); asks to sign in on first use, nothing to configure in the repo */
export const deployCommand = (root, out) => `npx vercel deploy ${shellQuote(out.startsWith(root + path.sep) ? toPosix(path.relative(root, out)) : out)}`;

function revealFolder(p) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [p]] : process.platform === "win32" ? ["explorer", [p]] : ["xdg-open", [p]];
  spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
}

/* ---------- HTTP ---------- */

/** reveal(path) opens a folder in the OS file manager (injectable for tests) */
export function exportRoutes({ reveal = revealFolder } = {}) {
  const wrote = new WeakMap(); // ctx → the export folder this server wrote
  // Expected failures (bad scope, foreign folder, no Chromium) answer with their status instead of a logged server error
  const guard = (h) => async (req, res, url, ctx) => {
    try {
      await h(req, res, url, ctx);
    } catch (e) {
      if (!e.status) throw e;
      sendJson(res, e.status, { error: e.message });
    }
  };
  const scopeOf = (b) => (b.scope === "page" ? { page: String(b.page ?? "") } : b.scope === "boards" ? { boards: Array.isArray(b.boards) ? b.boards.slice(0, 2000) : [] } : {});
  return [
    [
      "GET",
      "/api/export",
      async (req, res, url, ctx) => {
        const root = rootOf(ctx.dir);
        const out = defaultOut(ctx.dir);
        const dirRel = toPosix(path.relative(root, ctx.dir)) || ".";
        sendJson(res, 200, {
          project: path.basename(root),
          out: toPosix(path.relative(root, out)) + "/",
          single: singleName(ctx.dir),
          dirFlag: dirRel === "docs/design" || dirRel === "." ? "" : `--dir ${shellQuote(dirRel)}`,
          deploy: deployCommand(root, out),
          browser: await browserStatus(),
        });
      },
    ],
    [
      "POST",
      "/api/export",
      guard(async (req, res, url, ctx) => {
        const b = await readBody(req);
        await ctx.store.syncBoard();
        // The canvas always writes to <project root>/easel-export; only the CLI picks another folder
        const r = await exportDesign({ dir: ctx.dir, store: ctx.store, out: defaultOut(ctx.dir), format: ["pdf", "png"].includes(b.format) ? b.format : "web", singleFile: !!b.singleFile, ...scopeOf(b) });
        wrote.set(ctx, r.out);
        sendJson(res, 200, r);
      }),
    ],
    [
      "POST",
      "/api/export/estimate",
      guard(async (req, res, url, ctx) => {
        const b = await readBody(req);
        await ctx.store.syncBoard();
        const r = await exportDesign({ dir: ctx.dir, store: ctx.store, out: defaultOut(ctx.dir), singleFile: true, dryRun: true, ...scopeOf(b) });
        sendJson(res, 200, { bytes: r.bytes, name: singleName(ctx.dir), skipped: r.skipped.length });
      }),
    ],
    [
      "POST",
      "/api/export/reveal",
      async (req, res, url, ctx) => {
        const out = wrote.get(ctx);
        // Only the folder this server exported to, and only while it still holds an Easel export
        if (!out || !(await readManifest(out))) return sendJson(res, 409, { error: "Export first, then reveal the folder" });
        reveal(out);
        sendJson(res, 200, { ok: true, path: out });
      },
    ],
  ];
}
