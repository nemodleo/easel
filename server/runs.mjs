// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Undo and redo of one whole in-app AI run, and read-only access to a run's pre-run copy (Compare, restore after a restart).
// A run on top of the history is a plain undo/redo; an older run takes back only its own files, and asks before overwriting later changes.
import fs from "node:fs/promises";
import path from "node:path";

import { formatBoard } from "./boardFormat.mjs";
import { isTrackedRel } from "./copies.mjs";
import { toPosix, writeAtomic } from "./fsutil.mjs";

const read = (p) => fs.readFile(p, "utf8").catch(() => null);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const parse = (t) => {
  try {
    return t ? JSON.parse(t) : {};
  } catch {
    return null;
  }
};

/** A run's undo steps → one change per file, from its first before to its last after */
export function mergeSteps(steps) {
  const m = new Map();
  for (const s of steps)
    for (const c of s.changes) {
      const prev = m.get(c.path);
      if (prev) prev.after = c.after;
      else m.set(c.path, { path: c.path, before: c.before, after: c.after });
    }
  return [...m.values()].filter((c) => c.before !== c.after);
}

/** Boards a run touched, relative to screens/: changed, added (did not exist before) or removed */
export function runBoards(changes, screensDir) {
  const out = [];
  for (const c of changes) {
    const rel = toPosix(path.relative(screensDir, c.path));
    if (!c.path.endsWith(".html") || rel.startsWith("..")) continue;
    out.push({ file: rel, kind: c.before == null ? "added" : c.after == null ? "removed" : "changed" });
  }
  return out;
}

/**
 * board.json: applies the from → to difference of boards/notes entries (and pages/title) onto the current file, key by key,
 * so moving another board since does not block the undo. conflicts: entries that changed since (board file names, note ids)
 */
export function mergeBoardJson(curText, fromText, toText, force = false) {
  const cur = parse(curText);
  const from = parse(fromText);
  const to = parse(toText);
  if (!cur || !from || !to) return { text: force ? toText : curText, conflicts: force ? [] : ["board.json"] };
  const conflicts = [];
  for (const sec of ["boards", "notes"]) {
    const c = { ...(cur[sec] ?? {}) };
    for (const k of new Set([...Object.keys(from[sec] ?? {}), ...Object.keys(to[sec] ?? {})])) {
      const a = from[sec]?.[k];
      const b = to[sec]?.[k];
      if (same(a, b) || same(c[k], b)) continue;
      if (!same(c[k], a) && !force) {
        conflicts.push(k);
        continue;
      }
      if (b === undefined) delete c[k];
      else c[k] = b;
    }
    cur[sec] = c;
  }
  for (const key of ["pages", "title"]) {
    if (same(from[key], to[key]) || same(cur[key], to[key])) continue;
    if (!same(cur[key], from[key]) && !force) conflicts.push(key);
    else cur[key] = to[key];
  }
  const order = (Array.isArray(cur.order) ? cur.order : []).filter((f) => cur.boards?.[f]);
  for (const f of Object.keys(cur.boards ?? {})) if (!order.includes(f)) order.push(f);
  cur.order = order;
  return { text: formatBoard(cur), conflicts };
}

/**
 * Applies a run's changes backwards (undo) or forwards (redo) as one new history step. Files changed since are conflicts:
 * without mode the call writes nothing and returns them; mode "rest" skips them, "all" overwrites them.
 */
export async function applyRunChanges(ctx, changes, dir, { mode, label, mark }) {
  const plan = [];
  const conflicts = [];
  for (const c of changes) {
    const from = dir === "undo" ? c.after : c.before;
    const to = dir === "undo" ? c.before : c.after;
    const now = await read(c.path);
    if (c.path === ctx.store.boardPath) {
      const m = mergeBoardJson(now, from, to, mode === "all");
      if (m.conflicts.length && mode !== "rest") conflicts.push(...m.conflicts.map((k) => ({ file: k, board: true })));
      if (m.text !== now && (!m.conflicts.length || mode)) plan.push({ path: c.path, before: now, after: m.text });
      continue;
    }
    if (now === to) continue;
    if (now !== from) {
      conflicts.push({ file: toPosix(path.relative(ctx.store.screensDir, c.path)) });
      if (mode !== "all") continue;
    }
    plan.push({ path: c.path, before: now, after: to });
  }
  if (conflicts.length && !mode) return { conflicts };
  for (const c of plan) {
    if (c.after == null) await fs.rm(c.path, { force: true });
    else {
      await fs.mkdir(path.dirname(c.path), { recursive: true });
      await writeAtomic(c.path, c.after);
    }
  }
  ctx.history.push(label, plan, mark);
  await dropMissingAutoPlaced(ctx);
  return { changed: plan.length, skipped: mode === "rest" ? conflicts.map((c) => c.file) : [] };
}

/** Entries auto-placed for files that are gone again (an undone run's new screens): placement is not an undo step, so neither is this */
export async function dropMissingAutoPlaced(ctx) {
  const board = await ctx.store.readBoard();
  const files = new Set(await ctx.store.listScreenFiles());
  const gone = Object.keys(board.boards).filter((f) => board.boards[f].autoPlaced && !files.has(f));
  if (!gone.length) return;
  for (const f of gone) delete board.boards[f];
  board.order = board.order.filter((f) => !gone.includes(f));
  await ctx.store.writeBoard(board);
}

/* ---------- The pre-run copy in .easel/runs/<id>/ ---------- */
const validId = (id) => /^r[0-9a-z]+$/.test(String(id ?? ""));
const copyDir = (dir, id) => path.join(dir, ".easel", "runs", id);

/** Saved time and label of a run's copy; null when it is gone (pruned) or the id is not a run id */
export async function runCopyInfo(dir, id) {
  if (!validId(id)) return null;
  const meta = parse(await read(path.join(copyDir(dir, id), "run.json")));
  return meta && typeof meta.at === "string" ? { at: meta.at, label: typeof meta.label === "string" ? meta.label : "" } : null;
}

/**
 * A screen as it was before run id: f is screens/<…>.html (validated like the revert, and listed in the copy's run.json).
 * null when the id, the name or the copy is not valid
 */
export async function readRunFile(dir, id, f) {
  if (!validId(id) || !isTrackedRel(f) || !String(f).startsWith("screens/")) return null;
  const src = copyDir(dir, id);
  const meta = parse(await read(path.join(src, "run.json")));
  if (!meta || !Array.isArray(meta.files) || !meta.files.includes(f)) return null;
  return read(path.join(src, f));
}

/** <base> so a copy served from the API resolves ../assets and links like the live screen at /screens/<file> */
export function withBase(html, file) {
  const tag = `<base href="/screens/${file.split("/").map(encodeURIComponent).join("/")}">`;
  const m = /<head[^>]*>/i.exec(html) ?? /<html[^>]*>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
  return m ? html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length) : tag + html;
}
