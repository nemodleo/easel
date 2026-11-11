// AI-generated with Claude Code, 2026-11-10, reviewed by Hyun Park
// A copy of the tracked files before each in-app AI run, in <design dir>/.easel/runs/: revertable without git and after a restart.
import fs from "node:fs/promises";
import path from "node:path";

import { easelDir, toPosix, writeAtomic } from "./fsutil.mjs";

export const KEEP_RUNS = 10;
const read = (p) => fs.readFile(p, "utf8").catch(() => null);
const EXTRA = ["comments.json", "tokens.json"]; // copied for manual recovery, not restored by a revert

/** Tracked files relative to the design folder: screens/<…>.html and board.json when present */
async function trackedRel(store) {
  const out = (await store.listScreenFiles()).map((f) => toPosix(path.relative(path.dirname(store.screensDir), path.join(store.screensDir, f))));
  if ((await read(store.boardPath)) != null) out.push("board.json");
  return out;
}

/** A name trackedRel could have produced: board.json or screens/<…>.html, no dot segments */
const isTrackedRel = (f) => typeof f === "string" && (f === "board.json" || (/^screens\/.+\.html$/.test(f) && !f.split("/").some((s) => s === "" || s.startsWith("."))));

const runsDir = async (dir) => path.join(await easelDir(dir), "runs");

/** Copies the tracked files (plus comments.json/tokens.json) to .easel/runs/<id>/ and keeps the newest KEEP_RUNS copies */
export async function copyRun(ctx, id, meta) {
  const dest = path.join(await runsDir(ctx.dir), id);
  const files = await trackedRel(ctx.store);
  const extra = [];
  for (const f of EXTRA) if ((await read(path.join(ctx.dir, f))) != null) extra.push(f);
  for (const f of [...files, ...extra]) {
    await fs.mkdir(path.dirname(path.join(dest, f)), { recursive: true });
    await fs.copyFile(path.join(ctx.dir, f), path.join(dest, f));
  }
  await fs.writeFile(path.join(dest, "run.json"), JSON.stringify({ id, ...meta, at: new Date().toISOString(), files, extra }, null, 1) + "\n");
  await pruneRuns(ctx.dir);
  return dest;
}

/** Deletes run copies beyond the newest keep (ids are r<base36 time>) */
export async function pruneRuns(dir, keep = KEEP_RUNS) {
  const d = await runsDir(dir);
  const ids = (await fs.readdir(d).catch(() => [])).filter((n) => /^r[0-9a-z]+$/.test(n)).sort((a, b) => parseInt(b.slice(1), 36) - parseInt(a.slice(1), 36));
  for (const n of ids.slice(keep)) await fs.rm(path.join(d, n), { recursive: true, force: true });
}

/** Restores the tracked files to the copy of run id as one history step; null when the copy is gone */
export async function revertRun(ctx, id) {
  if (!/^r[0-9a-z]+$/.test(String(id ?? ""))) return null;
  const src = path.join(await runsDir(ctx.dir), id);
  const meta = await read(path.join(src, "run.json")).then((t) => (t ? JSON.parse(t) : null));
  if (!meta) return null;
  // run.json sits in the project folder where anything can edit it: only names of tracked files are restored
  const copied = (Array.isArray(meta.files) ? meta.files : []).filter(isTrackedRel);
  const changes = [];
  const now = await trackedRel(ctx.store);
  for (const f of [...new Set([...copied, ...now])]) {
    const p = path.join(ctx.dir, f);
    const before = await read(p);
    const after = copied.includes(f) ? await read(path.join(src, f)) : null;
    if (before === after) continue;
    if (after == null) await fs.rm(p, { force: true });
    else {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await writeAtomic(p, after);
    }
    changes.push({ path: p, before, after });
  }
  ctx.history.push(`Revert ${meta.label ?? "AI"} run`, changes);
  return { meta, changes };
}
