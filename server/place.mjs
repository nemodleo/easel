// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Where the server puts a new board (auto-placed screens, duplicates, forks, the chat's variants): the first free spot that covers
// neither another board nor a note on the same page. Note sizes are estimated from their text, as the canvas draws them.

export const GAP_X = 80;
export const GAP_Y = 120;
/** Clearance kept around boards and notes (board labels and tags sit above a board) */
const CLEAR = 80;

/** Rough width of one character at a font size: wide scripts (CJK, Hangul) take a full em */
const charW = (ch, size) => ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? size : size * 0.6);
const textW = (line, size) => [...line].reduce((w, ch) => w + charW(ch, size), 0);

/** A note's box on the canvas (sticky: 20px side padding and 1.45 line height at 22px; title: max-content up to maxW at 1.1 line height) */
export function noteRect(n) {
  const text = String(n.text ?? "");
  if (n.kind === "title") {
    const size = n.size ?? 72;
    const maxW = n.maxW ?? 4000;
    const lines = text.split("\n");
    const w = Math.min(maxW, Math.max(size, ...lines.map((l) => textW(l, size))));
    const rows = lines.reduce((k, l) => k + Math.max(1, Math.ceil(textW(l, size) / maxW)), 0);
    return { x: n.x, y: n.y, w, h: n.maxH || rows * size * 1.1 };
  }
  const size = n.size ?? 22;
  const w = n.w ?? 320;
  const inner = Math.max(40, w - 40);
  const rows = text.split("\n").reduce((k, l) => k + Math.max(1, Math.ceil(textW(l, size) / inner)), 0);
  return { x: n.x, y: n.y, w, h: n.h || rows * size * 1.45 + 32 };
}

/** Boards and notes on a page (items without page are on the first page) as boxes, leaving out the files in ignore */
export function obstacles(board, page, ignore = []) {
  const first = board.pages?.[0]?.id;
  const on = (it) => !board.pages?.length || (it.page ?? first) === (page ?? first);
  const boxes = Object.entries(board.boards ?? {})
    .filter(([f, b]) => !ignore.includes(f) && on(b))
    .map(([, b]) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  for (const n of Object.values(board.notes ?? {})) if (on(n)) boxes.push(noteRect(n));
  return boxes;
}

const hits = (r, o) => r.x < o.x + o.w + CLEAR && r.x + r.w + CLEAR > o.x && r.y < o.y + o.h + CLEAR && r.y + r.h + CLEAR > o.y;

/**
 * The first spot for rect (x, y, w, h) that is clear of the page's boards and notes, moving right past whatever is in the way
 * (dir "right": a fork, a duplicate, the next auto-placed screen) or down (dir "down": a row of variants, a new row)
 */
export function freeSpot(board, rect, { dir = "right", page, ignore = [] } = {}) {
  const obs = obstacles(board, page, ignore);
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: rect.w, h: rect.h };
  for (let k = 0; k < 1000; k++) {
    const hit = obs.filter((o) => hits(r, o));
    if (!hit.length) return r;
    if (dir === "down") r.y = Math.round(Math.max(...hit.map((o) => o.y + o.h)) + GAP_Y);
    else r.x = Math.round(Math.max(...hit.map((o) => o.x + o.w)) + GAP_X);
  }
  return r;
}

/** Spot for a copy that belongs next to board o (a fork): right of it when that is free, otherwise the nearer of further right and below */
export function besideSpot(board, o) {
  const x = o.x + o.w + GAP_X;
  const right = freeSpot(board, { x, y: o.y, w: o.w, h: o.h }, { dir: "right", page: o.page });
  if (right.x === Math.round(x)) return right;
  const down = freeSpot(board, { x: o.x, y: o.y + o.h + GAP_Y, w: o.w, h: o.h }, { dir: "down", page: o.page });
  return down.y - o.y < right.x - o.x ? down : right;
}

/** Spot for a new screen: right of the last auto-placed board, otherwise a new row below everything; either way clear of boards and notes */
export function placeNew(board, size, page) {
  const all = Object.values(board.boards);
  const auto = all.filter((b) => b.autoPlaced);
  if (auto.length) {
    const last = auto.reduce((a, b) => (b.x > a.x ? b : a));
    return freeSpot(board, { x: last.x + last.w + GAP_X, y: last.y, ...size }, { dir: "right", page });
  }
  const bottom = all.reduce((m, b) => Math.max(m, b.y + b.h), 0);
  const left = all.reduce((m, b) => Math.min(m, b.x), 0);
  return freeSpot(board, { x: left, y: bottom + GAP_Y, ...size }, { dir: "down", page });
}

/** A row of n copies of board b (variants): the first free row below it */
export function freeRow(board, b, n) {
  const r = freeSpot(board, { x: b.x, y: b.y + b.h + GAP_Y, w: n * b.w + (n - 1) * GAP_X, h: b.h }, { dir: "down", page: b.page });
  return Array.from({ length: n }, (_, i) => ({ x: r.x + (b.w + GAP_X) * i, y: r.y }));
}
