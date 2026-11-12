// AI-generated with Claude Code, 2026-10-09, 2026-11-10 and 2026-11-12, reviewed by Hyun Park
// One chronological undo history: canvas operations (board.json), HTML edits and board file create/delete share the same stack.
// step = { id, label, changes: [{ path, before, after }], by?, client?, person? } — before/after null means the file does not exist.
// by: the agent (X-Easel-Agent or the in-app run), client/person: the browser and the person's name that made it (X-Easel-Client, X-Easel-Author).
// Outside changes (an agent's own file tools, an editor) become steps too: the last known content of every tracked file is kept,
// and anything that differs from it is recorded, grouped per in-app chat run or per burst of edits.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";

import { writeAtomic } from "./fsutil.mjs";

const LIMIT = 100;
/** Outside changes this close together (no run active) merge into one step */
export const GROUP_MS = 10000;

/** Per-request values set by the HTTP server: { agent } from X-Easel-Agent, { run } from X-Easel-Run, { client, person } from X-Easel-Client / X-Easel-Author */
export const requestScope = new AsyncLocalStorage();

/** "a.html, b.html, c.html +2" */
export const fileList = (names, max = 3) => names.slice(0, max).join(", ") + (names.length > max ? ` +${names.length - max}` : "");

/**
 * list: async () => absolute paths of the tracked files on disk now; isTracked(path) for paths seen earlier;
 * name(path) → short name for labels
 */
export function createHistory({ onWrite, list = async () => [], isTracked = () => true, name = (p) => path.basename(p) } = {}) {
  let undo = [];
  let redo = [];
  const known = new Map(); // path → last known content (null: absent)
  const runs = new Map(); // id → { id, label, by } for each in-app chat run that is going, oldest first
  let seq = 0;
  /** Step ids are unique for this server session only (the history is not kept across restarts) */
  const nextId = () => `s${++seq}`;
  // Disk changes nobody reported cannot be told apart between overlapping runs: they go to the one started last
  const current = () => [...runs.values()].at(-1) ?? null;

  const read = (p) => fs.readFile(p, "utf8").catch(() => null);
  const trim = () => undo.length > LIMIT && undo.shift();

  async function apply(changes, dir) {
    // Do not overwrite if the file changed outside in the meantime. Content the app itself wrote without a step
    // (board.json auto-placement, position saves) is known, so it is replaced instead of blocking the undo
    for (const c of changes) {
      const now = await read(c.path);
      const expect = dir === "undo" ? c.after : c.before;
      if (now !== expect && now !== (known.get(c.path) ?? null)) {
        undo = [];
        redo = [];
        throw Object.assign(new Error("A file changed outside the app, so the undo history was cleared"), { status: 409 });
      }
    }
    for (const c of changes) {
      const target = dir === "undo" ? c.before : c.after;
      if (target == null) await fs.rm(c.path, { force: true });
      else await writeAtomic(c.path, target);
      known.set(c.path, target);
      onWrite?.(c.path, target);
    }
  }

  /** Adds changes to the current group (the step of run, or a recent outside step), or opens a new one. Clears redo */
  function group(changes, run = current(), now = Date.now()) {
    if (!changes.length) return null;
    const top = undo[undo.length - 1];
    const fits = top?.outside && (run ? top.run === run.id : !top.run && now - top.lastAt < GROUP_MS);
    let step = fits ? top : null;
    if (!step) {
      step = { id: nextId(), label: run?.label ?? "", changes: [], at: now, outside: true, ...(run ? { run: run.id, by: run.by } : {}) };
      undo.push(step);
      trim();
    }
    for (const c of changes) {
      const prev = step.changes.find((x) => x.path === c.path);
      if (prev) prev.after = c.after;
      else step.changes.push({ path: c.path, before: c.before, after: c.after });
    }
    step.changes = step.changes.filter((c) => c.before !== c.after);
    step.lastAt = now;
    step.rev = (step.rev ?? 0) + 1; // grouped steps change in place: lets readers cache what they derive from a step
    if (!step.run) step.label = `Changed outside the app: ${fileList(step.changes.map((c) => name(c.path)))}`;
    if (!step.changes.length) undo.splice(undo.indexOf(step), 1);
    redo = [];
    return step;
  }

  /** Tracked files whose content differs from the last known → one outside step (or merged into the current group) */
  async function observe(paths) {
    const all = paths ?? [...new Set([...(await list()), ...[...known.keys()].filter(isTracked)])];
    const changes = [];
    for (const p of all) {
      const now = await read(p);
      const before = known.get(p) ?? null;
      if (now === before) continue;
      known.set(p, now);
      changes.push({ path: p, before, after: now });
    }
    return group(changes);
  }

  async function undoOne() {
    await observe(); // pending outside changes first, so undo takes back the latest change instead of tripping the safety check
    const step = undo[undo.length - 1];
    if (!step) return null;
    await apply([...step.changes].reverse(), "undo");
    undo.pop();
    redo.push(step);
    return step;
  }
  async function redoOne() {
    await observe();
    const step = redo[redo.length - 1];
    if (!step) return null;
    await apply(step.changes, "redo");
    redo.pop();
    undo.push(step);
    return step;
  }

  return {
    /** Records a change that has already been written. Inside a request from the running in-app agent (X-Easel-Run) it joins the run's step.
     *  mark: extra fields kept on the step (undoOf / redoOf: the run an undo-run step belongs to) */
    push(label, changes, mark = {}) {
      for (const c of changes) known.set(c.path, c.after);
      const real = changes.filter((c) => c.before !== c.after);
      if (!real.length) return;
      const scope = requestScope.getStore();
      const run = scope?.run ? runs.get(scope.run) : null;
      if (run) return void group(real, run);
      const who = scope?.agent ? { by: scope.agent } : scope?.person ? { person: scope.person } : {};
      undo.push({ id: nextId(), label, changes: real, at: Date.now(), ...who, ...(scope?.client ? { client: scope.client } : {}), ...mark });
      trim();
      redo = [];
    },
    /** The app wrote this content without a history step (auto-placement, positions): not an outside change */
    note(p, content) {
      known.set(p, content);
    },
    /** Reads every tracked file as the starting point */
    async seed() {
      known.clear();
      for (const p of await list()) known.set(p, await read(p));
    },
    observe,
    beginRun(r) {
      runs.set(r.id, r);
    },
    endRun(id) {
      runs.delete(id);
    },
    /** Undo steps made by a run (normally one) */
    runSteps: (id) => undo.filter((s) => s.run === id),
    /** The newest undo and redo steps: undo-run is a plain undo/redo when its step is on top */
    peek: () => ({ undo: undo[undo.length - 1] ?? null, redo: redo[redo.length - 1] ?? null }),
    /** Both stacks as they are (oldest first; the redo stack's last entry is the next redo). For reading only */
    entries: () => ({ undo: [...undo], redo: [...redo] }),
    /** Last content the history knows for a tracked file (what is on disk unless an outside change is still pending) */
    current: (p) => known.get(p) ?? null,
    undo: undoOne,
    redo: redoOne,
    /** History › Go back to here: undo (or redo) one step at a time until step id is the newest applied one. Returns the steps moved */
    async goTo(id) {
      await observe();
      const dir = undo.some((s) => s.id === id) ? "undo" : redo.some((s) => s.id === id) ? "redo" : null;
      if (!dir) throw Object.assign(new Error("That step is no longer in the history"), { status: 404 });
      let moved = 0;
      while (undo[undo.length - 1]?.id !== id) {
        if (!(await (dir === "undo" ? undoOne() : redoOne()))) break;
        moved++;
      }
      return moved;
    },
    state: () => {
      const brief = (s) => ({ id: s.id, label: s.label, ...(s.by ? { by: s.by } : {}), at: s.at });
      return {
        undo: undo.map((s) => s.label).slice(-20),
        redo: redo.map((s) => s.label).slice(-20),
        canUndo: undo.length > 0,
        canRedo: redo.length > 0,
        steps: undo.slice(-20).map(brief),
        redoSteps: redo.slice(-20).map(brief),
      };
    },
    clear() {
      undo = [];
      redo = [];
    },
  };
}
