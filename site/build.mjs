// Builds easel.d-t-it.com into site/dist/: the hand-written page, the repo's own export of examples/demo in canvas/,
// web-sized cuts of the recording, and the facts stamped from the repo (version, tool count, export date and commit).
// Usage: npm run site   (needs ffmpeg on PATH and a viewer build in dist/viewer, i.e. npm run build once)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyEdit } from "../server/edit.mjs";
import { exportDesign } from "../server/export.mjs";
import { elementChildren, findBody, parseHtml } from "../server/html.mjs";

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SITE);
const DIST = path.join(SITE, "dist");
const CACHE = path.join(SITE, ".cache");
const SHOTS = path.join(ROOT, "docs", "screenshots");
const DEMO = path.join(ROOT, "examples", "demo");
const ORIGIN = "https://easel.d-t-it.com/";

const read = (p) => fs.readFile(p, "utf8");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* ---------- Facts from the repo ---------- */

const pkg = JSON.parse(await read(path.join(ROOT, "package.json")));
const repoSlug = (pkg.repository?.url ?? "").match(/github\.com\/([^/]+\/[^/.]+)/)?.[1] ?? "nemodleo/easel";
// MCP tools: every tool("name", …) the canvas server registers (the permission tool is for in-app runs only)
const mcpSrc = await read(path.join(ROOT, "bin", "mcp.mjs"));
const toolCount = [...mcpSrc.matchAll(/^\s*tool\(\s*\n\s*"([a-z_]+)"/gm)].length;
// Agent CLIs the in-app chat runs out of the box
const chatSrc = await read(path.join(ROOT, "server", "chat.mjs"));
const agentCount = JSON.parse(chatSrc.match(/export const AGENTS = (\[[^\]]*\])/)[1].replace(/'/g, '"')).length;
if (!toolCount || !agentCount) throw new Error(`Could not count tools (${toolCount}) or agents (${agentCount})`);

/* ---------- Clean output ---------- */

await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(path.join(DIST, "media"), { recursive: true });
await fs.mkdir(CACHE, { recursive: true });

/* ---------- The canvas: the repo's own export of examples/demo ---------- */

if (!existsSync(path.join(ROOT, "dist", "viewer", "viewer.js"))) throw new Error("No viewer build in dist/viewer: run npm run build first");
const now = new Date();
const exp = await exportDesign({ dir: DEMO, out: path.join(DIST, "canvas"), now });
// The stamp names the repo by its folder; a worktree or a clone under another name would print that, so name it by its GitHub slug
const dataPath = path.join(DIST, "canvas", "easel-viewer", "data.js");
const dataSrc = await read(dataPath);
const data = JSON.parse(dataSrc.replace(/^window\.EASEL_EXPORT=/, "").replace(/;\s*$/, ""));
data.stamp.repo = repoSlug;
await fs.writeFile(dataPath, `window.EASEL_EXPORT=${JSON.stringify(data).replace(/</g, "\\u003c")};\n`);
const commit = data.stamp.commit ?? "";
const exportedOn = now.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/* ---------- Media: web-sized cuts of the recording and stills ---------- */

const ff = (args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
/** Runs make(out) only when the cached file is missing or older than its sources, then copies it into dist/media */
async function media(name, sources, make) {
  const cached = path.join(CACHE, name);
  const newest = Math.max(...(await Promise.all(sources.map((s) => fs.stat(s)))).map((s) => s.mtimeMs), (await fs.stat(fileURLToPath(import.meta.url))).mtimeMs);
  const have = await fs.stat(cached).catch(() => null);
  if (!have || have.mtimeMs < newest) {
    console.log(`  making ${name}`);
    make(cached);
  }
  await fs.copyFile(cached, path.join(DIST, "media", name));
}
const REC = path.join(SHOTS, "demo.mp4"); // master: 2880×1800, 36.8 s
const POSTER = path.join(SHOTS, "demo-poster.png");
const noAudio = ["-an", "-movflags", "+faststart"];
console.log("Media");
await media("run-1920.mp4", [REC], (o) => ff(["-i", REC, "-vf", "scale=1920:1200:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p", "-profile:v", "high", ...noAudio, o]));
// Phones: the board list at the left (a sixth of the frame) cut away, so the boards and the chat read larger at 390 wide
await media("run-960.mp4", [REC], (o) => ff(["-i", REC, "-vf", "crop=2320:1800:560:0,scale=960:744:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "29", "-pix_fmt", "yuv420p", "-profile:v", "high", ...noAudio, o]));
await media("poster-1920.webp", [POSTER], (o) => ff(["-i", POSTER, "-vf", "scale=1920:-1:flags=lanczos", "-c:v", "libwebp", "-quality", "78", o]));
await media("poster-960.webp", [POSTER], (o) => ff(["-i", POSTER, "-vf", "crop=iw*2320/2880:ih:iw*560/2880:0,scale=960:-1:flags=lanczos", "-c:v", "libwebp", "-quality", "78", o]));

/** A still cut from the recording at time t (master pixels: x, y, w, h), saved at width outW */
const still = (name, t, [x, y, w, h], outW) =>
  media(name, [REC], (o) => ff(["-ss", String(t), "-i", REC, "-frames:v", "1", "-vf", `crop=${w}:${h}:${x}:${y},scale=${outW}:-1:flags=lanczos`, "-c:v", "libwebp", "-quality", "80", o]));
const crop = (name, src, [x, y, w, h], outW) =>
  media(name, [src], (o) => ff(["-i", src, "-vf", `crop=${w}:${h}:${x}:${y},scale=${outW}:-1:flags=lanczos`, "-c:v", "libwebp", "-quality", "80", o]));
// The four proofs, 4:3. Times are scene times in .out/demo/timing.json
await still("proof-edit.webp", 7.8, [560, 200, 1040, 780], 1040);
await still("proof-ask.webp", 27.3, [1440, 760, 1440, 1080], 1040);
await crop("proof-agents.webp", path.join(SHOTS, "agents.png"), [580, 90, 2280, 1710], 1040);
await still("proof-share.webp", 36.2, [1400, 120, 1480, 1110], 1040);
// Shown in place of the live canvas when it fails to load (and with JavaScript off)
await crop("canvas-still.webp", path.join(SHOTS, "overview.png"), [0, 0, 2880, 1800], 1440);
await fs.copyFile(path.join(ROOT, "docs", "social-preview.png"), path.join(DIST, "media", "social-preview.png"));

/* ---------- Proof 1's diff: the edit the recording makes, run through Easel's own edit code ---------- */

const homeSrc = await read(path.join(DEMO, "screens", "home.html"));
/** Element path (as the canvas computes it) of the first element matching pred */
function pathOf(html, pred) {
  const walk = (node, trail) => {
    for (const [i, k] of elementChildren(node).entries()) {
      const p = [...trail, i];
      if (pred(k)) return p.join("/");
      const r = walk(k, p);
      if (r) return r;
    }
    return null;
  };
  return walk(findBody(parseHtml(html)), []);
}
const titlePath = pathOf(homeSrc, (n) => n.attrs?.some((a) => a.name === "class" && a.value === "next-title display splice"));
const edited = applyEdit(homeSrc, { op: "setText", path: titlePath, text: "Rain" });
const before = homeSrc.split("\n");
const after = edited.split("\n");
const changed = before.map((l, i) => i).filter((i) => before[i] !== after[i]);
if (before.length !== after.length || changed.length !== 1) throw new Error("Expected the edit to change exactly one line");
const line = changed[0];
const diff = [`@@ screens/home.html, line ${line + 1} @@`, `- ${before[line].trim()}`, `+ ${after[line].trim()}`];

/* ---------- Evidence for "inside the apps": a real run's tool calls, and the Codex config connect writes ---------- */

const run = JSON.parse(await read(path.join(SITE, "evidence", "claude-run.json")));
const short = (v) => JSON.stringify(v);
const resultLine = (c) => {
  const r = c.result;
  if (c.tool === "list_boards") return `${r.boards.length} boards: ${r.boards.slice(0, 3).map((b) => `${b.file} “${b.title}”`).join(", ")}, …`;
  if (c.tool === "check_tokens") return `theme ${r.theme} · ${Object.entries(r.files).map(([f, l]) => `${f}: ${l.length} issues`).join(", ")}`;
  if (c.tool === "add_comment") return `comment ${r.comment.id} on ${r.comment.file}, author “${r.comment.author}”`;
  return short(r).slice(0, 120);
};
const transcript = [
  `<span class="t-call">you  ${esc(run.prompt)}</span>`,
  ...run.calls.map((c) => `<span class="t-call">tool ${esc(c.tool)} ${esc(short(c.input))}\n  →  ${esc(resultLine(c))}</span>`),
  `<span class="t-say">${esc(run.reply)}</span>`,
].join("\n\n");
const codexSnippet = (await read(path.join(SITE, "evidence", "codex-config.toml"))).trim();
// codex mcp list prints wide columns; keep the name, command, args and status
const codexList = (await read(path.join(SITE, "evidence", "codex-mcp-list.txt")))
  .trim()
  .split("\n")
  .map((l) => l.split(/\s{2,}/))
  .map((c) => [c[0], c[1], c[2], c[5]]);
const widths = [0, 1, 2].map((i) => Math.max(...codexList.map((r) => r[i].length)));
const codexTable = codexList.map((r) => r.map((v, i) => (i < 3 ? v.padEnd(widths[i] + 2) : v)).join("")).join("\n");
const codexVer = (await read(path.join(SITE, "evidence", "codex-version.txt"))).trim().replace(/^codex-cli\s*/, "");
const runDate = new Date(run.date + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/* ---------- The page ---------- */

const facts = {
  VERSION: pkg.version,
  TOOLS: String(toolCount),
  AGENTS: String(agentCount),
  COMMIT: commit,
  REPO: repoSlug,
  EXPORTED: exportedOn,
  EXPORT_KB: String(Math.round(exp.bytes / 1024)),
  DIFF_HEAD: esc(diff[0]),
  DIFF_DEL: esc(diff[1]),
  DIFF_ADD: esc(diff[2]),
  ORIGIN,
  CLAUDE_VER: esc(run.claude_code_version),
  RUN_DATE: runDate,
  CLAUDE_TRANSCRIPT: transcript,
  CODEX_SNIPPET: esc(codexSnippet),
  CODEX_LIST: esc(codexTable),
  CODEX_VER: esc(codexVer),
};
let html = await read(path.join(SITE, "index.html"));
html = html.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
  if (!(k in facts)) throw new Error(`Unknown placeholder ${m}`);
  return facts[k];
});
await fs.writeFile(path.join(DIST, "index.html"), html);
for (const f of ["style.css", "main.js", "favicon.svg", "robots.txt"]) await fs.copyFile(path.join(SITE, f), path.join(DIST, f));
await fs.writeFile(path.join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${ORIGIN}</loc><lastmod>${now.toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`);

/* ---------- Round 3 prototypes: three first screens at p/1, p/2, p/3 (sources in site/proto) ---------- */

const PROTO = path.join(SITE, "proto");
await still("proto-edit-wide.webp", 7.8, [0, 0, 2880, 1800], 1920);
await still("proto-undo-wide.webp", 30.2, [0, 0, 2880, 1800], 1920);
await still("proto-ask-poster-1920.webp", 13.1, [0, 0, 2880, 1800], 1920);
await still("proto-ask-poster-960.webp", 13.1, [560, 0, 2320, 1800], 960);
const partialSrc = await read(path.join(PROTO, "partials.html"));
const partials = Object.fromEntries([...partialSrc.matchAll(/<!--([A-Z_]+)-->\n([\s\S]*?)(?=<!--[A-Z_]+-->)/g)].map((m) => [m[1], m[2].trim()]));
const shortLine = (l) => l.replace(/^[-+]\s*/, "").trim();
const tokens = JSON.parse(await read(path.join(DEMO, "tokens.json")));
const night = Object.entries(tokens.themes[tokens.active]).map(([name, value]) => ({ name, value }));
// Prototype 2's bundle: Easel's own edit functions for the browser. The sha1 stand-in must agree with node's before it is used
const { createHash: shimHash } = await import(path.join(PROTO, "2", "sha1-shim.mjs"));
const { createHash: nodeHash } = await import("node:crypto");
for (const t of ["", "Winter", homeSrc]) if (shimHash("sha1").update(t).digest("hex") !== nodeHash("sha1").update(t).digest("hex")) throw new Error("sha1 stand-in differs from node:crypto");
const esbuild = await import("esbuild");
const stub = { name: "stand-ins", setup(b) {
  b.onResolve({ filter: /^node:crypto$/ }, () => ({ path: path.join(PROTO, "2", "sha1-shim.mjs") }));
  b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "empty" }));
  b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "export const useCallback=()=>{},useEffect=()=>{},useRef=()=>({}),useState=()=>[];", loader: "js" }));
} };
await fs.mkdir(path.join(DIST, "p", "2"), { recursive: true });
const bundle = await esbuild.build({ entryPoints: [path.join(PROTO, "2", "edit-entry.mjs")], bundle: true, format: "iife", globalName: "EaselEdit", platform: "browser", target: "es2020", minify: true, outfile: path.join(DIST, "p", "2", "edit.js"), plugins: [stub], metafile: true, logLevel: "warning" });
const bundled = Object.keys(bundle.metafile.inputs).filter((f) => !f.includes("node_modules")).map((f) => f.replace(/^.*?(server|app\/src|site\/proto)/, "$1"));
for (const f of ["proto.css", "proto.js"]) await fs.copyFile(path.join(PROTO, f), path.join(DIST, "p", f));
for (const n of ["1", "2", "3"]) {
  const dir = path.join(DIST, "p", n);
  await fs.mkdir(dir, { recursive: true });
  const local = { ...facts, N: n, CMD_CLASS: n === "2" || n === "3" ? "ink" : "accent", DIFF_DEL_SHORT: esc(shortLine(diff[1])), DIFF_ADD_SHORT: esc(shortLine(diff[2])), HOME_SRC_JSON: JSON.stringify(homeSrc).replace(/</g, "\\u003c"), TOKENS_JSON: JSON.stringify(night) };
  const fill = (t) => t.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (k in partials) return fill(partials[k]);
    if (!(k in local)) throw new Error(`Unknown placeholder ${m} in p/${n}`);
    return local[k];
  });
  await fs.writeFile(path.join(dir, "index.html"), fill(await read(path.join(PROTO, n, "index.html"))));
  for (const f of await fs.readdir(path.join(PROTO, n))) if (/\.(js|css)$/.test(f)) await fs.copyFile(path.join(PROTO, n, f), path.join(dir, f));
}
console.log(`Prototypes: p/1 p/2 p/3 · p/2 bundles ${bundled.join(", ")} (${Math.round((await fs.stat(path.join(DIST, "p", "2", "edit.js"))).size / 1024)} KB)`);
// Round 4 prototypes p/4 and p/5 (the app's styles and strings come from main at build time; see proto/r4/build-r4.mjs)
await (await import("./proto/r4/build-r4.mjs")).buildR4({ DIST });

/* ---------- Report: what a first visit loads ---------- */

const size = async (rel) => (await fs.stat(path.join(DIST, rel))).size;
const sum = async (list) => (await Promise.all(list.map(size))).reduce((a, b) => a + b, 0);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const pageBytes = await sum(["index.html", "style.css", "main.js", "favicon.svg"]);
const canvasFiles = (await fs.readdir(path.join(DIST, "canvas"), { recursive: true, withFileTypes: true })).filter((d) => d.isFile() && !d.name.startsWith("."));
const canvasBytes = (await Promise.all(canvasFiles.map((d) => fs.stat(path.join(d.parentPath ?? d.path, d.name)).then((s) => s.size)))).reduce((a, b) => a + b, 0);
console.log(`\nBuilt ${path.relative(ROOT, DIST)}/ · Easel ${pkg.version} · ${toolCount} MCP tools · ${agentCount} agent CLIs · export ${exportedOn} ${repoSlug}@${commit}`);
console.log(`  page (html, css, js, icon)  ${kb(pageBytes)}`);
console.log(`  canvas export (all files)   ${kb(canvasBytes)}`);
console.log(`  poster 1920 / 960           ${kb(await size("media/poster-1920.webp"))} / ${kb(await size("media/poster-960.webp"))}`);
console.log(`  video 1920 / 960 (mp4)      ${kb(await size("media/run-1920.mp4"))} / ${kb(await size("media/run-960.mp4"))}`);
if (exp.skipped.length) console.log(`  export skipped: ${exp.skipped.map((s) => s.ref).join(", ")}`);
