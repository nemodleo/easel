// Round 4 prototypes (p/4 "Three answers", p/5 "Ask all three"): builds only dist/p/4, dist/p/5 and their shared dist/p/r4.
// Takes the app's own styles and strings from main at build time (git show origin/main in the easel-forks worktree), never retyped.
// Needs node only (no node_modules). Usage: node site/proto/r4/build-r4.mjs   (build.mjs also calls buildR4 at its end)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const R4 = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.dirname(R4);
const SITE = path.dirname(PROTO);
const MAIN_REPO = process.env.EASEL_MAIN_REPO ?? path.join(path.dirname(path.dirname(SITE)), "easel-forks");

const gitShow = (p) => execFileSync("git", ["-C", MAIN_REPO, "show", `origin/main:${p}`], { encoding: "utf8", timeout: 20000 });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

export async function buildR4({ DIST = path.join(SITE, "dist"), log = console.log } = {}) {
  const commit = execFileSync("git", ["-C", MAIN_REPO, "rev-parse", "--short", "origin/main"], { encoding: "utf8", timeout: 20000 }).trim();
  const pkg = JSON.parse(gitShow("package.json"));
  const repoSlug = (pkg.repository?.url ?? "").match(/github\.com\/([^/]+\/[^/.]+)/)?.[1] ?? "nemodleo/easel";

  /* ---------- The app's strings: helpers + the occupancy block of app/src/strings.ts, types stripped ---------- */
  const strSrc = gitShow("app/src/strings.ts");
  const helpers = strSrc.split("\n").filter((l) => /^const (plural|variantsLabel) =/.test(l));
  const occStart = strSrc.indexOf("\n  occupancy: {");
  if (occStart < 0 || helpers.length !== 2) throw new Error("strings.ts: occupancy block or helpers not found");
  let depth = 0, close = -1;
  for (let i = strSrc.indexOf("{", occStart); i < strSrc.length; i++) {
    if (strSrc[i] === "{") depth++;
    else if (strSrc[i] === "}" && --depth === 0) { close = i + 1; break; }
  }
  const occTs = `${helpers.join("\n")}\nexport const occupancy = ${strSrc.slice(strSrc.indexOf("{", occStart), close)};\n`;
  const occJs = stripTypeScriptTypes(occTs);
  const occ = (await import(`data:text/javascript;base64,${Buffer.from(occJs).toString("base64")}`)).occupancy;
  for (const k of ["editing", "done", "clock", "forkBlockWhile", "useThisOne", "useThisOneTitle", "waitFor", "confirmFork", "confirmForkBody", "confirmKeep", "confirmKeepBody", "apply", "keepAll", "applied", "kept", "keptAll", "undo"])
    if (!(k in occ)) throw new Error(`strings.ts: occupancy.${k} missing`);
  // Icons the label, the button and the toast draw (app/src/icons.tsx)
  const iconSrc = gitShow("app/src/icons.tsx");
  const icon = (n) => iconSrc.match(new RegExp(`\\n\\s*${n}: "([^"]+)"`))?.[1] ?? (() => { throw new Error(`icons.tsx: ${n} missing`); })();
  const icons = { check: icon("check"), comment: icon("comment") };

  /* ---------- The app's styles: the rules for labels, tags, spinner, Use this one, the confirm, the fork caption and the toast ---------- */
  const css = gitShow("app/src/style.css").split("\n");
  // Single-line rules whose selector starts with one of these; scoped under .oc (the app's own root class, set on the stage)
  const wanted = [/^button \{/, /^button:(hover|active|disabled)/, /^:focus-visible/, /^\.icon-btn( |\.sm )/, /^\.spinner/, /^@keyframes (spin|appear|leave)/, /^\.board-label \{/, /^\.board-title/, /^\.board-file/, /^\.board:hover \.board-file/, /^\.board-btns/, /^\.board-label \.lab-row/, /^\.board-label\.tagged/, /^\.act-tags/, /^\.board-label\.fork-scene/, /^\.act-tag, \.occ-tag/, /^\.act-tag-text/, /^\.occ-tag/, /^\.board-label \.occ-tag/, /^\.lab-row:has/, /^\.oc \.board-btns/, /^\.menu \{/, /^\.menu\.confirm/, /^\.confirm /, /^\.fork-(link|svg|caption)/, /^\.toasts? /, /^\.toast(:not|\.ok|-action)/, /^\.entering, \.toast/, /^\.leaving/];
  const out = [];
  const lines = [];
  for (let i = 0; i < css.length; i++) {
    const l = css[i];
    if (!wanted.some((re) => re.test(l))) continue;
    let rule = l;
    lines.push(i + 1);
    // a rule over several lines (button { … }): take it to its closing brace
    const bal = (s) => (s.match(/\{/g) ?? []).length - (s.match(/\}/g) ?? []).length;
    if (bal(l) > 0) {
      let j = i, b = bal(l);
      while (b > 0 && j < css.length - 1) b += bal(css[++j]);
      rule = css.slice(i, j + 1).join("\n");
      i = j;
    }
    if (rule.startsWith("@keyframes")) { out.push(rule); continue; }
    const brace = rule.indexOf("{");
    const sel = rule.slice(0, brace).split(",").map((s) => s.trim()).map((s) => (s.startsWith(".oc ") ? s : `.oc ${s}`)).join(", ");
    out.push(`${sel} ${rule.slice(brace)}`);
  }
  // The app's reduced-motion rule, scoped
  out.push("@media (prefers-reduced-motion: reduce) { .oc *, .oc *::before, .oc *::after { animation-duration: 0ms !important; animation-iteration-count: 1 !important; transition-duration: 0ms !important; } .oc .spinner { animation-duration: 800ms !important; animation-iteration-count: infinite !important; } }");
  const appCss = `/* Easel's own styles, taken at build time from app/src/style.css on main (${repoSlug}@${commit}), lines ${lines.join(", ")}; scoped under .oc. Do not edit: rebuild. */\n${out.join("\n")}\n`;

  /* ---------- Evidence and boards ---------- */
  const run = JSON.parse(await fs.readFile(path.join(R4, "evidence", "run.json"), "utf8"));
  const shared = path.join(DIST, "p", "r4");
  await fs.rm(shared, { recursive: true, force: true });
  await fs.cp(path.join(R4, "screens"), path.join(shared, "screens"), { recursive: true });
  await fs.cp(path.join(R4, "assets"), path.join(shared, "assets"), { recursive: true });
  await fs.cp(path.join(R4, "stills"), path.join(shared, "stills"), { recursive: true }).catch(() => log("  (no stills yet: run shots for the JavaScript-off view)"));
  await fs.copyFile(path.join(R4, "evidence", "prompt.txt"), path.join(shared, "prompt.txt"));
  for (const f of ["stage.css", "stage.js", "page.js"]) await fs.copyFile(path.join(R4, f), path.join(shared, f));
  await fs.writeFile(path.join(shared, "app.css"), appCss);
  const appJs = `// Easel's own strings (app/src/strings.ts: plural, variantsLabel, strings.occupancy) and icons (app/src/icons.tsx), from main (${repoSlug}@${commit}) at build time, types stripped. Do not edit: rebuild.\n(() => {\n${occJs.replace("export const occupancy", "const occupancy")}\nwindow.EaselApp = { occupancy, icons: ${JSON.stringify(icons)}, commit: ${JSON.stringify(`${repoSlug}@${commit}`)} };\n})();\n`;
  await fs.writeFile(path.join(shared, "app-strings.js"), appJs);

  // Playback: the real run, N× faster
  const end = Math.max(...Object.values(run.times));
  const N = 10;
  const prompt = await fs.readFile(path.join(R4, "evidence", "prompt.txt"), "utf8");
  const human = prompt.match(/Task: (.*)/)[1];
  // The human sentence, as the brief shortens it: the ask and the last clause, the file name and the middle cut with an ellipsis
  const shortAsk = `Redesign the “Empty day” phone board so that an empty Wednesday feels like an invitation … make the three suggested films the main thing on the screen.`;
  if (!human.includes("so that an empty Wednesday feels like an invitation") || !human.includes("make the three suggested films the main thing on the screen")) throw new Error("prompt changed");
  const data = { ...run, N, end, ask: shortAsk, mainCommit: `${repoSlug}@${commit}` };
  await fs.writeFile(path.join(shared, "run.js"), `window.EaselRun=${JSON.stringify(data).replace(/</g, "\\u003c")};\n`);

  /* ---------- Pages ---------- */
  const partialSrc = await fs.readFile(path.join(PROTO, "partials.html"), "utf8");
  const r4Src = await fs.readFile(path.join(R4, "partials.html"), "utf8");
  const grab = (src) => Object.fromEntries([...src.matchAll(/<!--([A-Z_0-9]+)-->\n([\s\S]*?)(?=<!--[A-Z_0-9]+-->)/g)].map((m) => [m[1], m[2].trim()]));
  const partials = { ...grab(partialSrc), ...grab(r4Src) };
  const fmt = (s) => `${s} s`;
  const facts = {
    VERSION: pkg.version, REPO: repoSlug, MAIN: `${repoSlug}@${commit}`, N: String(N), ASK: esc(shortAsk),
    T_CLAUDE: fmt(run.times.claude), T_CODEX: fmt(run.times.codex), T_CURSOR: fmt(run.times.cursor),
    REPLAY_S: (end / N).toFixed(0),
    CAPTION: esc(occ.forkBlockWhile(2, run.titles["empty-day.html"], "Claude Code")),
    TITLE_O: esc(run.titles["empty-day.html"]), TITLE_CODEX: esc(run.titles["empty-day-codex.html"]), TITLE_CURSOR: esc(run.titles["empty-day-cursor.html"]),
    USE: esc(occ.useThisOne), USE_TITLE: esc(occ.useThisOneTitle(2)),
    ICON_CHECK: icons.check, ICON_COMMENT: icons.comment,
  };
  for (const n of ["4", "5"]) {
    const dir = path.join(DIST, "p", n);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const local = { ...facts, NP: n, CMD_CLASS: "ink", START_STATE: n === "4" ? "after" : "before", HM_LEAD: n === "4" ? `A real run · 19 Nov 2026 · times are real, replay ${N}× faster` : `Replay of a real run · 19 Nov 2026 · times are real, playback ${N}× faster` };
    const fill = (t) => t.replace(/\{\{([A-Z_0-9]+)\}\}/g, (m, k) => {
      if (k in partials) return fill(partials[k]);
      if (!(k in local)) throw new Error(`Unknown placeholder ${m} in p/${n}`);
      return local[k];
    });
    await fs.writeFile(path.join(dir, "index.html"), fill(await fs.readFile(path.join(PROTO, n, "index.html"), "utf8")));
  }
  for (const f of ["proto.css", "proto.js"]) await fs.copyFile(path.join(PROTO, f), path.join(DIST, "p", f));

  /* ---------- Report: the boards are the real files, byte for byte ---------- */
  const DEMO = process.env.EASEL_R4_DEMO ?? path.join(path.dirname(path.dirname(SITE)), "intercut-demo", "docs", "design", "screens");
  const pairs = [["empty-day.html", path.join(DEMO, "empty-day.html")], ["empty-day-codex.html", path.join(DEMO, "empty-day-codex.html")], ["empty-day-cursor.html", path.join(DEMO, "empty-day-cursor.html")]];
  const report = [];
  for (const [f, src] of pairs) {
    const a = await fs.readFile(path.join(shared, "screens", f));
    const b = await fs.readFile(src).catch(() => null);
    report.push(`${f} ${sha(a)} ${b ? (sha(b) === sha(a) ? "= source" : "DIFFERS from source") : "(source not readable)"}`);
  }
  const before = await fs.readFile(path.join(shared, "screens", "empty-day.before.html"));
  report.push(`empty-day.before.html ${sha(before)} ${sha(before) === sha(Buffer.from(gitShow("examples/demo/screens/empty-day.html"))) ? "= main examples/demo" : "DIFFERS"}`);
  log(`p/4 p/5 built from main ${repoSlug}@${commit} · app.css ${out.length} rules · N=${N} (${end} s → ${(end / N).toFixed(1)} s)\n  ${report.join("\n  ")}`);
  return { N, report };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await buildR4();
