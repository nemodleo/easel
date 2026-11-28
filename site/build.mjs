// Builds easel.d-t-it.com into site/dist/. Everything the page states is taken from the repo at build time:
// the version, licence and Node range (package.json), the install lines (README.md), the tool and agent counts (bin/mcp.mjs,
// server/chat.mjs), the 19 Nov 2026 three-agent run (site/run/: the three HTML files they wrote and the tool-call log), and
// the view-only export of examples/demo that the share section frames with ?embed.
// Usage: npm run site   (needs ffmpeg on PATH for the stills, and a viewer build in dist/viewer, i.e. npm run build once)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { exportDesign } from "../server/export.mjs";

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SITE);
const DIST = path.join(SITE, "dist");
const CACHE = path.join(SITE, ".cache");
const RUN = path.join(SITE, "run");
const SHOTS = path.join(ROOT, "docs", "screenshots");
const DEMO = path.join(ROOT, "examples", "demo");
const ORIGIN = "https://easel.d-t-it.com/";

const read = (p) => fs.readFile(p, "utf8");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fail = (msg) => {
  throw new Error(msg);
};

/* ---------- Facts from the repo ---------- */

const pkg = JSON.parse(await read(path.join(ROOT, "package.json")));
const repoSlug = (pkg.repository?.url ?? "").match(/github\.com\/([^/]+\/[^/.]+)/)?.[1] ?? "nemodleo/easel";
const GH = `https://github.com/${repoSlug}`;
const NPM = `https://www.npmjs.com/package/${pkg.name}`;
const node = (pkg.engines?.node ?? "").match(/(\d+)/)?.[1] ?? fail("package.json: engines.node missing");
const licence = pkg.license ?? fail("package.json: license missing");
const holder = (await read(path.join(ROOT, "LICENSE"))).match(/Copyright \(c\) (\d{4}) (.+)/) ?? fail("LICENSE: copyright line missing");
const mcpSrc = await read(path.join(ROOT, "bin", "mcp.mjs"));
const toolCount = [...mcpSrc.matchAll(/^\s*tool\(\s*\n\s*"([a-z_]+)"/gm)].length;
const chatSrc = await read(path.join(ROOT, "server", "chat.mjs"));
const agents = JSON.parse(chatSrc.match(/export const AGENTS = (\[[^\]]*\])/)?.[1].replace(/'/g, '"') ?? "[]");
const AGENT_NAMES = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", gemini: "Gemini CLI" };
if (!toolCount || !agents.length || agents.some((a) => !AGENT_NAMES[a])) fail(`Could not count tools (${toolCount}) or name agents (${agents})`);
const demoBoards = (await fs.readdir(path.join(DEMO, "screens"))).filter((f) => f.endsWith(".html")).length;
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const listAnd = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/* ---------- README: the install lines, copied exactly ---------- */

const readme = await read(path.join(ROOT, "README.md"));
const anchors = new Set([...readme.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/ /g, "-")));
const doc = (anchor) => (anchors.has(anchor) ? `${GH}#${anchor}` : fail(`README has no heading for #${anchor}`));
const installRow = (agent) => {
  const m = readme.match(new RegExp(`^\\| \\*\\*${agent}\\*\\* \\| \`([^\`]+)\` \\| (.+?) \\|$`, "m")) ?? fail(`README: no install row for ${agent}`);
  return { cmd: m[1], what: m[2] };
};
const install = { claude: installRow("Claude Code"), codex: installRow("Codex"), cursor: installRow("Cursor") };
const DEMO_CMD = "npx easel-canvas@latest --demo";
const CONNECT_CMD = "npx easel-canvas connect";
const EXPORT_CMD = "npx easel-canvas export";
for (const c of [DEMO_CMD, CONNECT_CMD, EXPORT_CMD, "?embed"]) if (!readme.includes(c)) fail(`README no longer says ${c}`);
/** README inline markdown (backticks only) to HTML */
const md = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

/* ---------- The real run, 19 Nov 2026 ---------- */

const run = JSON.parse(await read(path.join(RUN, "run.json")));
const prompt = await read(path.join(RUN, "prompt.txt"));
const ask = prompt.match(/Task: (.*)/)?.[1] ?? fail("prompt.txt: no Task line");
// The prompt as the page quotes it: the ask and its last clause, the middle cut with an ellipsis
const head = "Redesign the “Empty day” phone board so that an empty Wednesday feels like an invitation";
const tail = "make the three suggested films the main thing on the screen.";
if (!/^redesign the "Empty day" phone board .*so that an empty Wednesday feels like an invitation/.test(ask) || !ask.endsWith(tail)) fail("prompt.txt changed: re-cut the quote");
const ASK = `${head} … ${tail}`;
// The run was made with the Easel of that day (main 28d8844, 0.2.1) through each agent's command-line tool, not the desktop apps
const RUN_EASEL = "0.2.1";
const RUN_DATE = new Date(run.t0).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const RUN_T0 = new Date(run.t0).toISOString().slice(11, 19);
const ORDER = ["claude", "codex", "cursor"]; // the sentence's order, never sorted by speed
const FILE = { claude: "empty-day.html", codex: "empty-day-codex.html", cursor: "empty-day-cursor.html" };
const CLI = { claude: "Claude Code CLI", codex: "Codex CLI", cursor: "Cursor’s agent CLI" };
const lanes = ORDER.map((k) => {
  const ev = run.events[k] ?? fail(`run.json: no events for ${k}`);
  const claim = ev.find((e) => e.tool === "claim_board") ?? fail(`run.json: ${k} never claimed`);
  const comment = ev.find((e) => e.tool === "add_comment") ?? fail(`run.json: ${k} left no comment`);
  if (claim.got !== FILE[k]) fail(`run.json: ${k} got ${claim.got}, expected ${FILE[k]}`);
  return { k, name: AGENT_NAMES[k], t: run.times[k], ev, claim, forked: !!claim.forked, comment: comment.text ?? comment.args.text };
});
const END = Math.max(...lanes.map((l) => l.t));
const pct = (t) => `${((t / END) * 100).toFixed(3)}%`;
const writes = (l) => l.ev.filter((e) => e.tool === "write_board");
/** Labels under a lane: writes less than 30 s apart share one label, counted with the screenshots between them */
function belowTags(l) {
  const w = writes(l);
  if (w.length > 1 && w.at(-1).t - w[0].t < 30) {
    const shots = l.ev.filter((e) => e.tool === "screenshot").length;
    return [{ t: w[0].t, text: `write_board ×${w.length}${shots ? `, screenshot ×${shots}` : ""}` }];
  }
  return w.map((e, i) => ({ t: e.t, text: i ? "write_board again" : "write_board" }));
}
const placed = (e) => e.src === "placed";
const anyPlaced = lanes.some((l) => l.ev.some(placed));
const mark = (e) =>
  `<i class="ev${e.tool === "write_board" ? " w" : ""}${placed(e) ? " placed" : ""}" style="left:${pct(e.t)}" title="${esc(e.tool)} · ${e.t} s${placed(e) ? " (order known, time placed)" : ""}"></i>`;
const tag = (t, text, cls = "") => `<span class="tag${cls}${t / END > 0.62 ? " flip" : ""}" style="left:${pct(t)}">${esc(text)}</span>`;
const ticks = [];
for (let s = 0; s <= END; s += 30) ticks.push(`<span style="left:${pct(s)}">${s} s</span>`);
const timeline = `<div class="tl" role="img" aria-label="${esc(
  lanes.map((l) => `${l.name}: ${l.ev.length} tool calls in ${l.t} s, ${l.forked ? `claimed the board and was given a fork, ${l.claim.got}` : "claimed the board itself"}`).join(". "),
)}.">
  <div class="tl-axis" aria-hidden="true"><div class="tl-ticks">${ticks.join("")}</div></div>
  ${lanes
    .map(
      (l) => `<div class="tl-lane" aria-hidden="true"><div class="tl-name"><b>${esc(l.name)}</b><span>${l.ev.length} tool calls</span></div><div class="tl-track"><span class="bar" style="width:${pct(l.t)}"></span>${l.ev.map(mark).join("")}${tag(
        l.claim.t,
        l.forked ? `claim_board → a fork, ${l.claim.got}` : "claim_board → the board itself",
      )}${belowTags(l)
        .map((b) => tag(b.t, b.text, " below"))
        .join("")}<span class="end" style="left:${pct(l.t)}">${l.t} s</span></div></div>`,
    )
    .join("\n  ")}
</div>`;
const legend = `<span><i class="lg w"></i>write_board</span><span><i class="lg"></i>any other Easel tool call</span>${
  anyPlaced ? `<span><i class="lg placed"></i>Codex’s CLI logs no times: these are in the order it made them, spaced between the times its files and comment recorded</span>` : ""
}`;
const mini = (l) =>
  `<div class="mini" aria-hidden="true"><span class="bar" style="width:${pct(l.t)}"></span>${l.ev.map((e) => `<i class="ev${e.tool === "write_board" ? " w" : ""}${placed(e) ? " placed" : ""}" style="left:${pct(e.t)}"></i>`).join("")}</div>`;
const quote = (s) => `“${esc(s)}”`;
const comments = lanes.map((l) => `<div><p class="label">${esc(l.name)} · its own comment on the board</p><p class="said">${quote(l.comment)}</p></div>`).join("");
const phoneRun = lanes
  .map(
    (l) => `<div class="pr"><div class="pr-head"><b>${esc(l.name)}</b><span class="mono">${l.t} s</span><span class="label">${l.forked ? "got a fork" : "got the board"}</span></div>${mini(l)}<p class="said">${quote(l.comment)}</p></div>`,
  )
  .join("");

/* ---------- Clean output ---------- */

await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(path.join(DIST, "media"), { recursive: true });
await fs.mkdir(CACHE, { recursive: true });

/* ---------- The run's files, byte for byte ---------- */

await fs.mkdir(path.join(DIST, "run", "screens"), { recursive: true });
for (const f of Object.values(FILE)) await fs.copyFile(path.join(RUN, "screens", f), path.join(DIST, "run", "screens", f));
await fs.cp(path.join(RUN, "assets"), path.join(DIST, "run", "assets"), { recursive: true });
await fs.cp(path.join(RUN, "stills"), path.join(DIST, "run", "stills"), { recursive: true });
for (const f of ["run.json", "prompt.txt"]) await fs.copyFile(path.join(RUN, f), path.join(DIST, "run", f));

/* ---------- The canvas for the share section: the repo's own export of examples/demo ---------- */

if (!existsSync(path.join(ROOT, "dist", "viewer", "viewer.js"))) fail("No viewer build in dist/viewer: run npm run build first");
const now = new Date();
const exp = await exportDesign({ dir: DEMO, out: path.join(DIST, "canvas"), now });
const dataPath = path.join(DIST, "canvas", "easel-viewer", "data.js");
const data = JSON.parse((await read(dataPath)).replace(/^window\.EASEL_EXPORT=/, "").replace(/;\s*$/, ""));
data.stamp.repo = repoSlug; // the stamp names the repo by its folder; a worktree would print its own name
await fs.writeFile(dataPath, `window.EASEL_EXPORT=${JSON.stringify(data).replace(/</g, "\\u003c")};\n`);
const boardIds = Object.keys(data.board?.boards ?? {});
const EMBED_FIT = ["home.html", "film.html", "ticket.html"].filter((b) => boardIds.includes(b));
if (EMBED_FIT.length < 3) fail(`Export is missing the boards the embed frames (has ${boardIds.join(", ")})`);

/* ---------- Stills from docs/screenshots (2880×1800 captures of the app) ---------- */

const ff = (args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
/** Makes a webp at width w from a screenshot, cached in site/.cache until the source changes */
async function still(name, src, w, quality = 80) {
  const cached = path.join(CACHE, name);
  const have = await fs.stat(cached).catch(() => null);
  if (!have || have.mtimeMs < (await fs.stat(src)).mtimeMs) {
    console.log(`  making ${name}`);
    ff(["-i", src, "-vf", `scale=${w}:-1:flags=lanczos`, "-c:v", "libwebp", "-quality", String(quality), cached]);
  }
  await fs.copyFile(cached, path.join(DIST, "media", name));
}
console.log("Media");
for (const n of ["select", "ai-chat", "agents", "share"]) await still(`${n}-960.webp`, path.join(SHOTS, `${n}.png`), 960);
await still("overview-1600.webp", path.join(SHOTS, "overview.png"), 1600, 78);
await fs.copyFile(path.join(ROOT, "docs", "social-preview.png"), path.join(DIST, "media", "social-preview.png"));

/* ---------- Section 3: one window capture per app, when it exists ---------- */

// Each slot takes site/media/app-<key>.webp, 16:10 (2560×1600, the chat with the canvas beside it, a real capture: no drawn
// chrome). Until a capture exists the slot shows Easel's own canvas and says so.
const APPS = [
  {
    key: "claude", tab: "Claude desktop app", install: install.claude,
    lead: "In the Code tab, ask Claude to open the design canvas. It opens in the app’s Browser pane, next to the conversation.",
    steps: ["Install the plugin for Claude Code.", "Say <i>“open the design canvas”</i>, or run <code>/easel:open</code>."],
    evidence: "Seen on 17 Nov 2026: the canvas in the Browser pane of the Claude desktop app.",
    capture: "The Claude desktop app, Code tab, with the canvas in its Browser pane",
  },
  {
    key: "codex", tab: "Codex app", install: install.codex,
    lead: "The plugin gives Codex Easel’s tools and skill. Keep the canvas open beside the Codex app and ask for a screen.",
    steps: ["Install the plugin for Codex.", "Ask for a screen. It lands on the canvas as an HTML file."],
    capture: "The Codex app with the canvas beside it",
  },
  {
    key: "cursor", tab: "Cursor", install: install.cursor, also: CONNECT_CMD,
    lead: "The skill teaches Cursor’s agent the canvas; <code>connect</code> adds the tools. Keep the canvas in a tab beside it.",
    steps: ["Add the skill with the first line below.", "Run the second in your project to add the tools."],
    capture: "Cursor with the canvas beside it",
  },
];
const runEvidence = (k) => {
  const l = lanes.find((x) => x.k === k);
  const w = writes(l);
  return `From the ${RUN_DATE} run (${CLI[k]}):<pre>claim_board ${esc(FILE.claude)}\n  → ${esc(l.claim.got)}${l.forked ? " · fork" : ""}\nwrite_board ${esc(w[0].args.file)}${w.length > 1 ? ` ×${w.length}` : ""}</pre>`;
};
const missing = [];
const cmdBlock = (cmd, { accent = false, light = false, label } = {}) =>
  `<div class="cmd${light ? " light" : ""}"><span class="p" aria-hidden="true">$</span><code>${esc(cmd)}</code><button class="copy" type="button" data-copy="${esc(cmd)}"${accent ? " data-accent" : ""}${label ? ` aria-label="Copy the ${esc(label)} line"` : ""}>Copy</button></div>`;
const appPanels = [];
for (const [i, a] of APPS.entries()) {
  const own = path.join(SITE, "media", `app-${a.key}.webp`);
  let fig;
  if (existsSync(own)) {
    await fs.copyFile(own, path.join(DIST, "media", `app-${a.key}.webp`));
    fig = `<figure class="win"><div class="shot r1610"><img src="media/app-${a.key}.webp" width="1600" height="1000" loading="lazy" decoding="async" alt="${esc(a.capture)}"></div></figure>`;
  } else {
    missing.push(`site/media/app-${a.key}.webp`);
    fig = `<figure class="win"><div class="shot r1610"><img src="media/overview-1600.webp" width="1600" height="1000" loading="lazy" decoding="async" alt="Easel’s canvas with the bundled demo’s boards: a brand sheet, phone screens and campaign pieces"></div><figcaption class="cap">Easel’s canvas on its own, in a browser tab.</figcaption></figure>`;
  }
  appPanels.push(`<div class="app" id="app-${a.key}" role="tabpanel" aria-labelledby="tab-${a.key}" data-app="${a.key}"${i ? " data-later" : ""}>
    ${fig}
    <div class="app-text">
      <h3 class="h3">${esc(a.tab)}</h3>
      <p class="body">${a.lead}</p>
      <ol class="steps">${a.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
      <div class="ev-note">${a.evidence ? esc(a.evidence) : runEvidence(a.key)}</div>
    </div>
    <div class="app-cmds">${cmdBlock(a.install.cmd, { label: a.tab })}${a.also ? cmdBlock(a.also, { light: true, label: `${a.tab} connect` }) : ""}</div>
  </div>`);
}
const appTabs = APPS.map(
  (a, i) => `<button class="seg-btn" type="button" role="tab" id="tab-${a.key}" aria-controls="app-${a.key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(a.tab)}</button>`,
).join("");

/* ---------- First screen: the three answers ---------- */

const answers = lanes
  .map(
    (l) => `<figure class="ans" data-src="run/screens/${l.claim.got}">
      <figcaption class="who"><b>${esc(l.name)}</b><span class="t">${l.t} s</span>${l.forked ? `<span class="f">fork</span>` : ""}</figcaption>
      <div class="phone"><img src="run/stills/${l.claim.got.replace(".html", ".webp")}" width="390" height="844" decoding="async" fetchpriority="${l.k === "claude" ? "high" : "auto"}" alt="${esc(l.name)}’s version of the Empty day phone screen: ${esc(l.comment.split(/[.,;(]/)[0])}"></div>
      <span class="use" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>Use this one</span>
    </figure>`,
  )
  .join("\n    ");

/* ---------- Install list ---------- */

const installRows = [
  { name: "Claude Code", what: install.claude.what, cmd: install.claude.cmd },
  { name: "Codex", what: install.codex.what, cmd: install.codex.cmd },
  { name: "Cursor", what: install.cursor.what, cmd: install.cursor.cmd },
]
  .map((r) => `<div class="irow"><div class="iname"><b>${esc(r.name)}</b><p class="small">${md(r.what)}</p></div>${cmdBlock(r.cmd, { label: r.name })}</div>`)
  .join("\n    ");

/* ---------- The page ---------- */

const facts = {
  VERSION: esc(pkg.version),
  ORIGIN,
  GH,
  REPO: esc(repoSlug),
  NPM,
  DOC_README: `${GH}#readme`,
  DOC_INSTALL: doc("install-into-your-agent"),
  DOC_CONNECT: doc("connect-your-ai-agent"),
  DOC_SHARE: doc("share-a-view-only-copy"),
  DOC_TRY: doc("try-it-in-30-seconds"),
  ISSUES: `${GH}/issues`,
  ASK: esc(ASK),
  RUN_DATE,
  RUN_T0,
  RUN_EASEL,
  ANSWERS: answers,
  DEMO_CMD_BLOCK: cmdBlock(DEMO_CMD, { accent: true, label: "demo" }),
  DEMO_CMD_LIGHT: cmdBlock(DEMO_CMD, { light: true, label: "demo" }),
  TIMELINE: timeline,
  LEGEND: legend,
  COMMENTS: comments,
  PHONE_RUN: phoneRun,
  END: String(END),
  APP_TABS: appTabs,
  APP_PANELS: appPanels.join("\n  "),
  INSTALL_ROWS: installRows,
  DEMO_BOARDS: String(demoBoards),
  EXPORT_CMD: esc(EXPORT_CMD),
  EMBED_SRC: `canvas/index.html?embed&amp;fit=${EMBED_FIT.join(",")}&amp;inset=40,40,104,40`,
  TOOLS: String(toolCount),
  AGENT_COUNT: COUNT_WORDS[agents.length][0].toUpperCase() + COUNT_WORDS[agents.length].slice(1),
  AGENT_LIST: esc(listAnd(agents.map((a) => AGENT_NAMES[a]))),
  LICENCE: esc(licence),
  NODE: node,
  HOLDER: esc(`${holder[1]} ${holder[2].trim()}`),
};
let html = await read(path.join(SITE, "index.html"));
html = html.replace(/\{\{([A-Z_0-9]+)\}\}/g, (m, k) => (k in facts ? facts[k] : fail(`Unknown placeholder ${m}`)));
await fs.writeFile(path.join(DIST, "index.html"), html);
for (const f of ["style.css", "main.js", "favicon.svg", "robots.txt"]) await fs.copyFile(path.join(SITE, f), path.join(DIST, f));
await fs.writeFile(path.join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${ORIGIN}</loc><lastmod>${now.toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`);

/* ---------- Report: what a visit loads ---------- */

const size = async (rel) => (await fs.stat(path.join(DIST, rel))).size;
const sum = async (list) => (await Promise.all(list.map(size))).reduce((a, b) => a + b, 0);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const pageFiles = ["index.html", "style.css", "main.js", "favicon.svg"];
const stills = Object.values(FILE).map((f) => `run/stills/${f.replace(".html", ".webp")}`);
const frames = [...Object.values(FILE).map((f) => `run/screens/${f}`), "run/assets/fonts/anton-latin-400.woff2", "run/assets/fonts/jetbrains-mono-latin-400.woff2"];
const lazyImgs = ["media/select-960.webp", "media/ai-chat-960.webp", "media/agents-960.webp", "media/overview-1600.webp"];
const canvasFiles = (await fs.readdir(path.join(DIST, "canvas"), { recursive: true, withFileTypes: true })).filter((d) => d.isFile() && !d.name.startsWith("."));
const canvasBytes = (await Promise.all(canvasFiles.map((d) => fs.stat(path.join(d.parentPath ?? d.path, d.name)).then((s) => s.size)))).reduce((a, b) => a + b, 0);
console.log(`\nBuilt ${path.relative(ROOT, DIST)}/ · Easel ${pkg.version} · ${toolCount} MCP tools · ${agents.length} agents · export of examples/demo ${repoSlug}@${data.stamp.commit ?? ""}`);
console.log(`  page (html, css, js, icon)       ${kb(await sum(pageFiles))}`);
console.log(`  first screen stills (3)          ${kb(await sum(stills))}`);
console.log(`  live answers, desktop (3 + fonts) ${kb(await sum(frames))}`);
console.log(`  images below the fold (lazy)     ${kb(await sum(lazyImgs))}`);
console.log(`  embedded canvas (lazy, desktop)  ${kb(canvasBytes)} (export ${kb(exp.bytes)})`);
if (missing.length) console.log(`  window captures still missing:   ${missing.join(", ")} (16:10, 2560×1600)`);
if (exp.skipped.length) console.log(`  export skipped: ${exp.skipped.map((s) => s.ref).join(", ")}`);
