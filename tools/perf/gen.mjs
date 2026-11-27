#!/usr/bin/env node
// AI-generated with Claude Code, 2026-11-27
// Makes a big design folder for the performance check: N boards copied from the bundled demo (examples/demo), laid out as repeats
// of the demo's own layout, with its titles, stickies, arrows and a fork per repeat (a fork arrow). --heavy adds to every board a
// layer with a large DOM, inline images and SVG and a running animation, the way boards that hold a whole app mock-up look.
// Usage: node tools/perf/gen.mjs <out dir> <N> [--heavy]
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEMO = path.join(TOOL, "examples/demo");

/** Width and height of one repeat of the demo layout, plus a gap */
const PITCH = { x: 5200, y: 4300 };

export async function generate(out, n, { heavy = false } = {}) {
  const demo = JSON.parse(await fs.readFile(path.join(DEMO, "board.json"), "utf8"));
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(path.join(out, "screens"), { recursive: true });
  await fs.cp(path.join(DEMO, "assets"), path.join(out, "assets"), { recursive: true });
  const heavyLayer = heavy ? makeHeavyLayer() : "";
  const files = demo.order;
  const groups = Math.ceil(n / files.length);
  const cols = Math.ceil(Math.sqrt(groups * 1.4));
  const board = { version: 1, title: `perf-${n}${heavy ? "-heavy" : ""}`, pages: [], boards: {}, order: [], notes: {}, shapes: {} };
  let made = 0;
  for (let g = 0; g < groups; g++) {
    const ox = (g % cols) * PITCH.x;
    const oy = Math.floor(g / cols) * PITCH.y;
    const name = (f) => `g${g}-${f}`;
    for (const f of files) {
      if (made >= n) break;
      made++;
      let html = await fs.readFile(path.join(DEMO, "screens", f), "utf8");
      if (heavy) html = html.replace(/<\/body>/i, `${heavyLayer}</body>`);
      await fs.writeFile(path.join(out, "screens", name(f)), html);
      const b = { ...demo.boards[f], x: demo.boards[f].x + ox, y: demo.boards[f].y + oy, title: `${demo.boards[f].title} ${g + 1}` };
      // Each repeat's daylight twin is a fork of its home screen: the canvas draws a fork arrow between them
      if (f === "home-daylight.html" && board.boards[name("home.html")]) b.origin = { kind: "fork", of: name("home.html"), by: "claude", at: "2026-11-01T10:00:00.000Z" };
      board.boards[name(f)] = b;
      board.order.push(name(f));
    }
    for (const [id, note] of Object.entries(demo.notes)) board.notes[`g${g}-${id}`] = { ...note, x: note.x + ox, y: note.y + oy };
    for (const [id, s] of Object.entries(demo.shapes ?? {})) board.shapes[`g${g}-${id}`] = { ...s, x: s.x + ox, y: s.y + oy };
  }
  await fs.writeFile(path.join(out, "board.json"), JSON.stringify(board, null, 2));
  return { dir: out, boards: made };
}

/** About 3,000 elements, two 256 px noise PNGs inline, an SVG with 400 paths and a spinner that never stops */
function makeHeavyLayer() {
  const png = (seed) => `data:image/png;base64,${noisePng(256, 256, seed).toString("base64")}`;
  const cards = [];
  for (let i = 0; i < 600; i++)
    cards.push(`<div class="pf-card"><span class="pf-dot"></span><b>Item ${i}</b><i>Row ${i % 17} · ${i * 7}</i><em>${(i * 13) % 100}%</em></div>`);
  const paths = [];
  for (let i = 0; i < 400; i++) {
    const x = (i * 37) % 380, y = (i * 53) % 380;
    paths.push(`<path d="M${x} ${y}q${(i % 9) * 4} ${(i % 7) * 5} ${20 + (i % 11)} ${(i % 5) * 3}t${i % 13} ${i % 17}" stroke="hsl(${i % 360} 70% 50%)" fill="none"/>`);
  }
  return `
<style>
.pf-layer{position:fixed;inset:0;pointer-events:none;opacity:.32;z-index:2147483000;overflow:hidden;display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:4px;padding:8px;font:11px/14px sans-serif;color:#111}
.pf-card{display:flex;gap:4px;align-items:center;background:#fff8;border-radius:6px;padding:2px 4px;box-shadow:0 1px 2px #0003}
.pf-dot{width:8px;height:8px;border-radius:50%;background:#f40}
.pf-imgs{position:fixed;right:8px;bottom:8px;display:flex;gap:8px;opacity:.5}
.pf-imgs img{width:128px;height:128px;border-radius:12px}
.pf-svg{position:fixed;left:8px;bottom:8px;width:200px;height:200px;opacity:.5}
.pf-spin{position:fixed;right:16px;top:16px;width:24px;height:24px;border:3px solid #f40;border-top-color:transparent;border-radius:50%;animation:pf-spin 1s linear infinite}
@keyframes pf-spin{to{transform:rotate(360deg)}}
</style>
<div class="pf-layer" aria-hidden="true">${cards.join("")}</div>
<div class="pf-imgs" aria-hidden="true"><img alt="" src="${png(1)}"><img alt="" src="${png(2)}"></div>
<svg class="pf-svg" viewBox="0 0 400 400" aria-hidden="true">${paths.join("")}</svg>
<div class="pf-spin" aria-hidden="true"></div>
`;
}

/** A small RGB PNG of noise (does not compress, like a photo) */
function noisePng(w, h, seed) {
  let s = seed * 2654435761;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 16) & 255;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (rnd() >> 1) + ((x / 3 + y) & 127);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [out, n, ...rest] = process.argv.slice(2);
  if (!out || !n) {
    console.error("usage: node tools/perf/gen.mjs <out dir> <N> [--heavy]");
    process.exit(1);
  }
  const r = await generate(path.resolve(out), Number(n), { heavy: rest.includes("--heavy") });
  console.log(`${r.boards} boards in ${r.dir}`);
}
