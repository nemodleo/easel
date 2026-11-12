// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Share › Export: web folder and single file (relative URLs, scope, dot folders, stamp), the export folder's safety rules,
// PDF/PNG (skipped without Chromium), the HTTP routes and the CLI flags
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseArgs, TOOL_ROOT } from "../server/args.mjs";
import { exportDesign, exportRoutes, exportStamp, MANIFEST, mapCssUrls, mapHtmlUrls, pickScope, refCandidates } from "../server/export.mjs";
import { createServer } from "../server/index.mjs";

const skip = !existsSync(path.join(TOOL_ROOT, "dist/viewer/viewer.js")) && "needs the viewer build (npm run build)";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2213fbc0000000049454e44ae426082", "hex");

/** A design folder with pages, a subfolder screen, CSS with fonts, root-relative and escaping URLs, dot folders and comments */
async function makeDesign() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "dc-export-"));
  const dir = path.join(base, "design");
  const w = async (rel, data) => {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), data);
  };
  await fs.writeFile(path.join(base, "outside.png"), PNG);
  await w(
    "board.json",
    JSON.stringify({
      version: 1,
      title: "Relay",
      pages: [
        { id: "p1", name: "One" },
        { id: "p2", name: "Two" },
      ],
      boards: { "a.html": { x: 0, y: 0, w: 390, h: 844, title: "A" }, "b.html": { x: 500, y: 0, w: 390, h: 844, page: "p2" }, "sub/c.html": { x: 0, y: 1000, w: 300, h: 300 } },
      order: ["a.html", "b.html", "sub/c.html"],
      notes: { n1: { kind: "sticky", x: 100, y: -100, text: "Near A", w: 200 }, n2: { kind: "title", x: 500, y: -200, text: "Two", page: "p2" } },
      shapes: { s1: { kind: "image", x: 0, y: -300, w: 40, h: 40, src: "../assets/pic.png" } },
    }),
  );
  await w(
    "comments.json",
    JSON.stringify({
      comments: [
        { id: "c1", file: "a.html", path: "0", text: "On A", author: "Hyun", createdAt: "2026-11-10T10:00:00Z", resolved: false, replies: [{ id: "r1", author: "Mina", text: "Agree", createdAt: "2026-11-10T10:05:00Z" }] },
        { id: "c2", file: "b.html", path: "", text: "On B", author: "Jo", createdAt: "2026-11-10T11:00:00Z", resolved: false },
      ],
    }),
  );
  await w(
    "screens/a.html",
    `<!doctype html><html><head><meta charset="utf-8"><title>A</title><link rel="stylesheet" href="../styles/app.css"><style>.x{background:url('/assets/pic.png')}</style></head>
<body><img src="/assets/pic.png" alt=""><img src="../assets/pic.png?v=1" srcset="../assets/pic.png 1x, /assets/pic.png 2x" alt=""><a href="b.html">B</a><a href="/b.html">B again</a>
<img src="../.easel/secret.png" alt=""><img src="../../outside.png" alt=""><img src="https://example.com/x.png" alt=""><iframe src="sub/c.html"></iframe>
<script>var s = '<img src="/never-rewritten.png">';</script></body></html>`,
  );
  await w("screens/b.html", `<!doctype html><title>B</title><div style="background-image:url(../assets/pic.png)">B</div>`);
  await w("screens/sub/c.html", `<!doctype html><title>C</title><img src="../../assets/pic.png" alt="">`);
  await w("screens/.hidden/d.html", "<!doctype html><title>D</title>");
  await w("styles/app.css", `@font-face{font-family:F;src:url(../assets/font.woff2) format("woff2")}body{background:url("/assets/pic.png")}`);
  await w("assets/pic.png", PNG);
  await w("assets/font.woff2", Buffer.from("wOF2fake"));
  await w("assets/unused.png", PNG);
  await w(".easel/secret.png", PNG);
  await w(".thumbs/a.jpg", PNG);
  return { base, dir, cleanup: () => fs.rm(base, { recursive: true, force: true }) };
}

const listFiles = async (root, rel = "") => {
  const out = [];
  for (const e of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(root, r)));
    else out.push(r);
  }
  return out.sort();
};
/** Every URL an exported HTML/CSS file still references (outside scripts) */
const urlsIn = (text, css = false) => {
  const all = [];
  if (css) mapCssUrls(text, (u) => void all.push(u));
  else mapHtmlUrls(text, (u, kind) => void all.push({ u, kind }));
  return all;
};
const readData = async (out) => {
  const js = await fs.readFile(path.join(out, "easel-viewer/data.js"), "utf8");
  return JSON.parse(js.replace(/^window\.EASEL_EXPORT=/, "").replace(/;\s*$/, ""));
};

test("refCandidates: relative, root-relative (screens/ first), and nothing outside or in dot folders", () => {
  assert.deepEqual(refCandidates("screens/a.html", "../assets/x.png?v=2#y"), ["assets/x.png"]);
  assert.deepEqual(refCandidates("screens/a.html", "/assets/x.png"), ["screens/assets/x.png", "assets/x.png"]);
  assert.deepEqual(refCandidates("screens/sub/c.html", "img%20one.png"), ["screens/sub/img one.png"]);
  for (const u of ["../../x.png", "../.easel/x.png", ".thumbs/a.jpg", "https://e.com/x.png", "data:image/png;base64,AA", "//cdn/x.js", "#top", "mailto:a@b", "/../../etc/passwd"]) assert.deepEqual(refCandidates("screens/a.html", u), [], u);
});

test("mapHtmlUrls skips scripts and comments, keeps everything it does not replace byte for byte", () => {
  const html = `<a href="x.html">x</a><!-- <img src="c.png"> --><script src="s.js">var t='<img src="no.png">'</script><img alt="a>b" src='i.png' srcset="i.png 1x, j.png 2x"><div style="background:url(k.png)"></div><style>.a{background:url("l.png")}</style>`;
  const seen = urlsIn(html).map((x) => `${x.kind}:${x.u}`);
  assert.deepEqual(seen, ["link:x.html", "asset:s.js", "asset:i.png", "asset:i.png", "asset:j.png", "asset:k.png", "asset:l.png"]);
  assert.equal(mapHtmlUrls(html, () => undefined), html);
  assert.match(mapHtmlUrls(html, (u) => (u === "i.png" ? "data:x" : undefined)), /src="data:x"/);
});

test("pickScope: whole canvas, a page by id or name, chosen boards with the notes next to them; unknown names fail", () => {
  const board = { title: "t", pages: [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }], boards: { "a.html": { x: 0, y: 0, w: 100, h: 100 }, "b.html": { x: 5000, y: 0, w: 100, h: 100, page: "p2" } }, order: ["a.html", "b.html"], notes: { n1: { x: 50, y: -50 }, n2: { x: 5000, y: -50, page: "p2" }, far: { x: 2000, y: 2000 } }, shapes: {} };
  const files = ["a.html", "b.html"];
  assert.deepEqual(pickScope(board, files).boards, ["a.html", "b.html"]);
  assert.deepEqual(pickScope(board, files, { page: "Two" }), { boards: ["b.html"], notes: ["n2"], shapes: [], pages: [{ id: "p2", name: "Two" }] });
  assert.deepEqual(pickScope(board, files, { page: "p1" }).notes, ["n1", "far"]);
  assert.deepEqual(pickScope(board, files, { boards: ["a.html"] }).notes, ["n1"]);
  for (const bad of [{ boards: ["../board.json"] }, { boards: ["missing.html"] }, { page: "Nope" }]) assert.throws(() => pickScope(board, files, bad), (e) => e.status === 400);
  // A board whose file is gone is left out of the whole canvas
  assert.deepEqual(pickScope(board, ["a.html"]).boards, ["a.html"]);
});

test("web folder: viewer, screens and only the referenced assets, all relative; no dot folders; data for the viewer", { skip }, async () => {
  const d = await makeDesign();
  try {
    const out = path.join(d.base, "out");
    const r = await exportDesign({ dir: d.dir, out, now: new Date("2026-11-10T14:02:00Z") });
    assert.equal(r.kind, "web");
    const files = await listFiles(out);
    for (const f of ["index.html", ".nojekyll", MANIFEST, "easel-viewer/viewer.js", "easel-viewer/viewer.css", "easel-viewer/data.js", "screens/a.html", "screens/b.html", "screens/sub/c.html", "styles/app.css", "assets/pic.png", "assets/font.woff2"]) assert.ok(files.includes(f), f);
    assert.ok(!files.some((f) => /unused|secret|\.thumbs|\.easel\/|\.hidden|outside|board\.json|comments\.json/.test(f)), files.join(" "));
    assert.equal(r.files, files.length - 1); // everything but the manifest
    // Skipped: the dot folder and the file outside the design folder, never the external URL or the screen link
    assert.deepEqual(r.skipped.map((s) => s.ref).sort(), ["../../outside.png", "../.easel/secret.png"]);
    // Root-relative URLs became relative; nothing points at / any more (scripts are left as they were)
    const a = await fs.readFile(path.join(out, "screens/a.html"), "utf8");
    const local = urlsIn(a).filter((x) => !/^(https?:|data:)/.test(x.u));
    assert.ok(local.every((x) => !x.u.startsWith("/")), JSON.stringify(local));
    assert.ok(local.some((x) => x.u === "../assets/pic.png") && local.some((x) => x.kind === "link" && x.u === "b.html"));
    assert.match(a, /'<img src="\/never-rewritten.png">'/);
    assert.deepEqual(urlsIn(await fs.readFile(path.join(out, "styles/app.css"), "utf8"), true), ["../assets/font.woff2", "../assets/pic.png"]);
    const index = await fs.readFile(path.join(out, "index.html"), "utf8");
    assert.deepEqual(urlsIn(index).map((x) => x.u), ["easel-viewer/viewer.css", "easel-viewer/data.js", "easel-viewer/viewer.js"]);
    assert.ok(!/\/api\/|\/_app\//.test(index + (await fs.readFile(path.join(out, "easel-viewer/data.js"), "utf8"))));
    // Data: boards, notes, comments (read-only copies), the image shape pointing at the copied asset, the stamp
    const data = await readData(out);
    assert.deepEqual(data.files, ["a.html", "b.html", "sub/c.html"]);
    assert.deepEqual(Object.keys(data.board.notes).sort(), ["n1", "n2"]);
    assert.equal(data.board.shapes.s1.src, "assets/pic.png");
    assert.deepEqual(data.comments.map((c) => c.id), ["c1", "c2"]);
    assert.equal(data.comments[0].replies[0].text, "Agree");
    assert.equal(data.stamp.at, "2026-11-10T14:02:00.000Z");
    assert.equal(data.screens, undefined);
  } finally {
    await d.cleanup();
  }
});

test("web folder scope: a page or chosen boards, and their comments only", { skip }, async () => {
  const d = await makeDesign();
  try {
    const out = path.join(d.base, "out");
    await exportDesign({ dir: d.dir, out, page: "Two" });
    let data = await readData(out);
    assert.deepEqual(data.files, ["b.html"]);
    assert.deepEqual(data.comments.map((c) => c.id), ["c2"]);
    assert.deepEqual(data.board.pages, [{ id: "p2", name: "Two" }]);
    assert.ok(!existsSync(path.join(out, "screens/a.html")));
    await exportDesign({ dir: d.dir, out, boards: ["a.html"] });
    data = await readData(out);
    assert.deepEqual(data.files, ["a.html"]);
    assert.deepEqual(Object.keys(data.board.notes), ["n1"]);
    // Re-export replaced the page export: b.html is gone, the embedded sub/c.html came along for a.html
    assert.ok(!existsSync(path.join(out, "screens/b.html")) && existsSync(path.join(out, "screens/sub/c.html")));
    await assert.rejects(exportDesign({ dir: d.dir, out, boards: ["../board.json"] }), (e) => e.status === 400);
    await assert.rejects(exportDesign({ dir: d.dir, out, boards: ["screens/../../outside.png"] }), (e) => e.status === 400);
  } finally {
    await d.cleanup();
  }
});

test("export folder: re-export removes only its own files; a foreign non-empty folder is refused; the manifest cannot reach outside", { skip }, async () => {
  const d = await makeDesign();
  try {
    const out = path.join(d.base, "out");
    await exportDesign({ dir: d.dir, out });
    await fs.writeFile(path.join(out, "vercel.json"), "{}");
    await fs.mkdir(path.join(out, ".vercel"));
    await fs.writeFile(path.join(out, ".vercel/project.json"), "{}");
    await exportDesign({ dir: d.dir, out, page: "Two" });
    assert.ok(existsSync(path.join(out, "vercel.json")) && existsSync(path.join(out, ".vercel/project.json")));
    assert.ok(!existsSync(path.join(out, "screens/a.html")) && !existsSync(path.join(out, "styles")));
    // Other kinds of export in the same folder stay
    await exportDesign({ dir: d.dir, out, singleFile: true });
    await exportDesign({ dir: d.dir, out });
    assert.ok(existsSync(path.join(out, "design-canvas.html")));

    // Not ours: refused, nothing touched
    const foreign = path.join(d.base, "foreign");
    await fs.mkdir(foreign);
    await fs.writeFile(path.join(foreign, "notes.txt"), "mine");
    await assert.rejects(exportDesign({ dir: d.dir, out: foreign }), (e) => e.status === 409);
    assert.deepEqual(await fs.readdir(foreign), ["notes.txt"]);

    // A manifest that lists paths outside the folder: those are never deleted
    const victim = path.join(d.base, "victim.txt");
    await fs.writeFile(victim, "keep");
    const m = JSON.parse(await fs.readFile(path.join(out, MANIFEST), "utf8"));
    m.exports.web.files.push("../victim.txt", victim, "screens/../../victim.txt", "./x", "a\\..\\..\\victim.txt");
    await fs.writeFile(path.join(out, MANIFEST), JSON.stringify(m));
    await exportDesign({ dir: d.dir, out });
    assert.equal(await fs.readFile(victim, "utf8"), "keep");

    // Folders that would swallow the design folder or turn into boards
    for (const bad of [d.dir, d.base, path.join(d.dir, "screens"), path.join(d.dir, "screens/out")]) await assert.rejects(exportDesign({ dir: d.dir, out: bad }), (e) => e.status === 400, bad);
  } finally {
    await d.cleanup();
  }
});

test("single file: one self-contained .html (assets inlined), embedded HTML listed as skipped; the size without writing", { skip }, async () => {
  const d = await makeDesign();
  try {
    const out = path.join(d.base, "out");
    const dry = await exportDesign({ dir: d.dir, out, singleFile: true, dryRun: true });
    assert.ok(!existsSync(out));
    const r = await exportDesign({ dir: d.dir, out, singleFile: true });
    assert.equal(r.kind, "single");
    assert.deepEqual((await fs.readdir(out)).sort(), [MANIFEST, "design-canvas.html"]);
    const html = await fs.readFile(r.main, "utf8");
    assert.equal(Buffer.byteLength(html), dry.bytes);
    // Outside the scripts, the page references nothing at all
    const outer = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
    assert.ok(!/\s(src|href)\s*=/i.test(outer), outer);
    assert.ok(!/url\((?!["']?data:)/.test(html.match(/<style>([\s\S]*?)<\/style>/)[1]));
    const data = JSON.parse(html.match(/window\.EASEL_EXPORT=(.*?);<\/script>/s)[1]);
    assert.deepEqual(Object.keys(data.screens).sort(), ["a.html", "b.html", "sub/c.html"]);
    assert.match(data.board.shapes.s1.src, /^data:image\/png;base64,/);
    for (const [f, s] of Object.entries(data.screens)) {
      for (const { u, kind } of urlsIn(s)) {
        if (kind === "link") assert.ok(!u.startsWith("/") && !/^https?:/.test(u), `${f}: ${u}`);
        else if (kind === "frame") assert.equal(u, "sub/c.html");
        else assert.ok(/^(data:|https:\/\/example\.com)/.test(u) || /\.easel|outside/.test(u), `${f}: ${u}`);
      }
    }
    // The stylesheet and its font became data URLs too
    assert.match(data.screens["a.html"], /href="data:text\/css;base64,/);
    const css = Buffer.from(/href="data:text\/css;base64,([^"]+)"/.exec(data.screens["a.html"])[1], "base64").toString();
    assert.match(css, /url\("data:font\/woff2;base64,/);
    assert.ok(r.skipped.some((s) => s.ref === "sub/c.html" && /embedded HTML/.test(s.reason)));
  } finally {
    await d.cleanup();
  }
});

test("links that lead out of the design folder are never copied or inlined; a linked screen is refused", { skip }, async () => {
  const d = await makeDesign();
  try {
    // A cloned project can ship links like these: the export must not pick up what they point at
    await fs.writeFile(path.join(d.base, "private.txt"), "PRIVATE-NOTES");
    await fs.symlink(path.join(d.base, "private.txt"), path.join(d.dir, "assets/leak.txt"));
    await fs.symlink(d.base, path.join(d.dir, "assets/up"));
    await fs.symlink(path.join(d.dir, "assets/pic.png"), path.join(d.dir, "assets/alias.png")); // a link that stays inside is fine
    await fs.writeFile(path.join(d.dir, "screens/b.html"), `<!doctype html><title>B</title><img src="../assets/leak.txt" alt=""><img src="../assets/up/outside.png" alt=""><img src="../assets/alias.png" alt="">`);
    const out = path.join(d.base, "out");
    const r = await exportDesign({ dir: d.dir, out, boards: ["b.html"] });
    const files = await listFiles(out);
    assert.ok(files.includes("assets/alias.png"));
    assert.ok(!files.some((f) => /leak|up\//.test(f)), files.join(" "));
    assert.deepEqual(r.skipped.map((s) => s.ref).sort(), ["../assets/leak.txt", "../assets/up/outside.png"]);
    const single = await exportDesign({ dir: d.dir, out: path.join(d.base, "one"), boards: ["b.html"], singleFile: true });
    const html = await fs.readFile(single.main, "utf8");
    assert.ok(!html.includes(Buffer.from("PRIVATE-NOTES").toString("base64")));
    assert.match(html, /alias\.png|data:image\/png/);

    await fs.writeFile(path.join(d.base, "elsewhere.html"), "<!doctype html><title>Elsewhere</title>");
    await fs.symlink(path.join(d.base, "elsewhere.html"), path.join(d.dir, "screens/linked.html"));
    await assert.rejects(exportDesign({ dir: d.dir, out, boards: ["linked.html"] }), (e) => e.status === 400 && /linked\.html is not a file inside the design folder/.test(e.message));
  } finally {
    await d.cleanup();
  }
});

test("stamp: time only outside git; repo@commit inside a repository", async () => {
  const d = await makeDesign();
  try {
    const now = new Date("2026-11-10T14:02:00Z");
    assert.deepEqual(await exportStamp(d.dir, now), { at: "2026-11-10T14:02:00.000Z" });
    const g = (...a) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d.base, encoding: "utf8" });
    if (g("init", "-q").status !== 0) return;
    g("add", "-A");
    g("commit", "-qm", "init");
    const head = g("rev-parse", "--short", "HEAD").stdout.trim();
    assert.deepEqual(await exportStamp(d.dir, now), { at: "2026-11-10T14:02:00.000Z", repo: path.basename(d.base), commit: head });
  } finally {
    await d.cleanup();
  }
});

test("PDF and PNG: a clear 501 when Chromium cannot start, and the previous export stays", { skip }, async () => {
  const d = await makeDesign();
  try {
    const out = path.join(d.base, "out");
    await fs.mkdir(out);
    await fs.writeFile(path.join(out, MANIFEST), JSON.stringify({ easel: 1, exports: { pdf: { at: "x", files: ["design-canvas.pdf"] } } }));
    await fs.writeFile(path.join(out, "design-canvas.pdf"), "old");
    const newPage = async () => {
      throw new Error("Executable doesn't exist at /nowhere/chrome");
    };
    for (const format of ["pdf", "png"]) await assert.rejects(exportDesign({ dir: d.dir, out, format, newPage }), (e) => e.status === 501 && /Chromium/.test(e.message));
    assert.equal(await fs.readFile(path.join(out, "design-canvas.pdf"), "utf8"), "old");
  } finally {
    await d.cleanup();
  }
});

test("PDF one page per board, PNG one 2x image per board (skipped without Chromium)", { skip }, async (t) => {
  const d = await makeDesign();
  const { closeBrowser } = await import("../server/browser.mjs");
  try {
    const out = path.join(d.base, "out");
    let pdf;
    try {
      pdf = await exportDesign({ dir: d.dir, out, format: "pdf" });
    } catch (e) {
      if (e.status === 501) return t.skip("no Chromium for playwright");
      throw e;
    }
    const buf = await fs.readFile(pdf.main);
    assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
    assert.equal((buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length, 3);
    const png = await exportDesign({ dir: d.dir, out, format: "png", boards: ["a.html"] });
    assert.deepEqual(await fs.readdir(path.join(out, "png")), ["a@2x.png"]);
    const img = await fs.readFile(path.join(out, "png/a@2x.png"));
    assert.deepEqual([img.readUInt32BE(16), img.readUInt32BE(20)], [780, 1688]);
    assert.equal(png.files, 1);
    assert.ok(existsSync(pdf.main), "the PNG export left the PDF alone");
  } finally {
    await closeBrowser();
    await d.cleanup();
  }
});

const freePort = () =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });

test("HTTP: export to <root>/easel-export (no out from the request), size estimate, reveal only that folder", { skip: (!existsSync(path.join(TOOL_ROOT, "dist/index.html")) && "needs an app build (npm run build)") || skip }, async () => {
  const d = await makeDesign();
  const revealed = [];
  const port = await freePort();
  const app = await createServer({ dir: d.dir, port, dev: false, extraRoutes: exportRoutes({ reveal: (p) => revealed.push(p) }) });
  const api = async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  try {
    const info = await api("GET", "/api/export");
    assert.equal(info.body.out, "easel-export/");
    assert.equal(info.body.single, "design-canvas.html");
    assert.equal(typeof info.body.browser.ok, "boolean");
    assert.equal((await api("POST", "/api/export/reveal", {})).status, 409);
    const est = await api("POST", "/api/export/estimate", { scope: "boards", boards: ["b.html"] });
    assert.ok(est.body.bytes > 1000);
    const r = await api("POST", "/api/export", { scope: "page", page: "p2", out: "/tmp/elsewhere", format: "web" });
    assert.equal(r.status, 200);
    assert.equal(r.body.out, path.join(d.dir, "easel-export"));
    assert.equal(r.body.outRel, "easel-export/");
    assert.equal(r.body.deploy, "npx vercel deploy easel-export");
    assert.equal((await api("POST", "/api/export", { scope: "boards", boards: ["../comments.json"] })).status, 400);
    assert.equal((await api("POST", "/api/export/reveal", {})).status, 200);
    assert.deepEqual(revealed, [path.join(d.dir, "easel-export")]);
    // The export folder sits inside this design folder here (no docs/design): its files are never exported again
    const again = await api("POST", "/api/export", { scope: "all" });
    assert.ok(!(await listFiles(path.join(d.dir, "easel-export"))).some((f) => f.startsWith("easel-export/")));
    assert.equal(again.status, 200);
  } finally {
    await app.close();
    await d.cleanup();
  }
});

test("CLI flags for export", () => {
  const a = parseArgs(["export", "--dir", "x", "--out", "dist/share", "--page", "Onboarding flow", "--boards", "a.html, b.html", "--single-file", "--pdf", "--png"]);
  assert.equal(a.command, "export");
  assert.equal(a.out, path.resolve("dist/share"));
  assert.equal(a.page, "Onboarding flow");
  assert.deepEqual(a.boards, ["a.html", "b.html"]);
  assert.deepEqual([a.singleFile, a.pdf, a.png], [true, true, true]);
  const b = parseArgs(["export", "--out=../up", "--page=p1", "--boards=c.html"]);
  assert.deepEqual([b.out, b.page, b.boards], [path.resolve("../up"), "p1", ["c.html"]]);
  const c = parseArgs(["export"]);
  assert.deepEqual([c.out, c.page, c.boards, c.singleFile, c.pdf, c.png], [null, null, null, false, false, false]);
  assert.equal(parseArgs(["--dir", "export"]).command, null);
});

test("CLI: easel-canvas export runs without a canvas and prints what it wrote", { skip }, async () => {
  const d = await makeDesign();
  try {
    const out = path.join(d.base, "share");
    const r = spawnSync(process.execPath, [path.join(TOOL_ROOT, "bin/server.mjs"), "export", "--dir", d.dir, "--out", out, "--boards", "a.html"], { encoding: "utf8", env: { ...process.env, EASEL_HOME: path.join(d.base, "home") } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Web folder: ${out.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/index.html`));
    assert.match(r.stdout, /skipped \.\.\/\.easel\/secret\.png/);
    assert.ok(existsSync(path.join(out, "screens/a.html")));
    const bad = spawnSync(process.execPath, [path.join(TOOL_ROOT, "bin/server.mjs"), "export", "--dir", d.dir, "--out", d.base], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Export failed/);
  } finally {
    await d.cleanup();
  }
});
