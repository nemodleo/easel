// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Keeps board.json (board layout, notes, pages) in sync with the actual files under screens/. PLAN.md ch. 2.
import fs from "node:fs/promises";
import path from "node:path";

import { formatBoard } from "./boardFormat.mjs";
import { htmlTitle, projectName, writeAtomic } from "./fsutil.mjs";

const DEFAULT_SIZE = { w: 390, h: 844 };
const GAP_X = 80;
const GAP_Y = 120;

/**
 * order lists each board exactly once: duplicates and names missing from boards are dropped, boards missing from order
 * are appended. Hand edits and agents writing board.json can leave a file twice, which renders two boards with one key.
 * The next save writes the cleaned list back.
 */
export function normalizeOrder(order, boards) {
  const out = [...new Set((Array.isArray(order) ? order : []).filter((f) => typeof f === "string" && Object.hasOwn(boards, f)))];
  const seen = new Set(out);
  for (const f of Object.keys(boards)) if (!seen.has(f)) out.push(f);
  return out;
}

/** onWrite(path, text) runs after every board.json save (the undo history keeps it as known content) */
export function createBoardStore(dir, { onWrite } = {}) {
  const boardPath = path.join(dir, "board.json");
  const screensDir = path.join(dir, "screens");

  // Canvas name: the project folder. Older versions stored the design folder's name ("design") as the title, so that counts as unset
  const name = projectName(dir);
  const titleOf = (t) => (!t || (t === path.basename(dir) && t !== name) ? name : t);

  async function readBoard() {
    try {
      const raw = await fs.readFile(boardPath, "utf8");
      const b = JSON.parse(raw);
      return {
        ...b,
        version: 1,
        title: titleOf(b.title),
        pages: b.pages ?? [],
        boards: b.boards ?? {},
        order: normalizeOrder(b.order, b.boards ?? {}),
        notes: b.notes ?? {},
      };
    } catch (e) {
      if (e.code === "ENOENT") return { version: 1, title: name, pages: [], boards: {}, order: [], notes: {} };
      throw e;
    }
  }

  let writing = Promise.resolve();
  let lastWritten = null;
  async function writeBoard(board) {
    // Serialized saves: two concurrent requests must not interleave their writes
    const text = formatBoard(board);
    lastWritten = text;
    writing = writing.then(() => writeAtomic(boardPath, text));
    await writing;
    onWrite?.(boardPath, text);
  }

  /** .html files under screens/ (including subfolders, ignoring .icloud placeholders) */
  async function listScreenFiles() {
    const out = [];
    async function walk(rel) {
      let entries = [];
      try {
        entries = await fs.readdir(path.join(screensDir, rel), { withFileTypes: true });
      } catch (e) {
        if (e.code === "ENOENT") return;
        throw e;
      }
      for (const ent of entries) {
        if (ent.name.startsWith(".")) continue;
        const r = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) await walk(r);
        else if (ent.name.endsWith(".html")) out.push(r);
      }
    }
    await walk("");
    return out.sort();
  }

  /** <meta name="board-size" content="390x844"> → {w,h}, plus the file's <title> (null when missing) */
  async function readBoardInfo(file) {
    const html = await fs.readFile(path.join(screensDir, file), "utf8").catch(() => ""); // unreadable: default size, no title
    const m = html.match(/<meta\s+name=["']board-size["']\s+content=["'](\d+)\s*[x×]\s*(\d+)["']/i);
    return { size: m ? { w: Number(m[1]), h: Number(m[2]) } : { ...DEFAULT_SIZE }, title: htmlTitle(html) };
  }
  const readBoardSize = async (file) => (await readBoardInfo(file)).size;

  /** Row for new screens: right of the last auto-placed board, otherwise below everything + 120 */
  function placeNew(board, size) {
    const all = Object.values(board.boards);
    const auto = all.filter((b) => b.autoPlaced);
    if (auto.length) {
      const last = auto.reduce((a, b) => (b.x > a.x ? b : a));
      return { x: last.x + last.w + GAP_X, y: last.y, ...size };
    }
    const bottom = all.reduce((m, b) => Math.max(m, b.y + b.h), 0);
    const left = all.reduce((m, b) => Math.min(m, b.x), 0);
    return { x: left, y: bottom + GAP_Y, ...size };
  }

  // Queue board/file-changing requests and auto-placement in a single line. If auto-placement slipped in while an undo
  // is writing board.json and deleting files, the deleted board would come back.
  let chain = Promise.resolve();
  function exclusive(fn) {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  }

  /** Auto-places files missing from board.json, records them, and returns the result plus missing/orphan lists */
  const syncBoard = () => exclusive(syncBoardNow);
  /** Variant to call from inside exclusive */
  async function syncBoardNow() {
    const board = await readBoard();
    const files = await listScreenFiles();
    const fileSet = new Set(files);
    let changed = false;
    for (const f of files) {
      if (board.boards[f]) continue;
      const { size, title } = await readBoardInfo(f);
      board.boards[f] = { ...placeNew(board, size), title: title ?? f.replace(/\.html$/, ""), autoPlaced: true };
      if (!board.order.includes(f)) board.order.push(f);
      changed = true;
    }
    if (changed) await writeBoard(board);
    const missing = Object.keys(board.boards).filter((f) => !fileSet.has(f));
    return { board, files, missing, added: changed };
  }

  return { dir, screensDir, boardPath, readBoard, writeBoard, listScreenFiles, syncBoard, syncBoardNow, exclusive, readBoardSize, lastWritten: () => lastWritten };
}
