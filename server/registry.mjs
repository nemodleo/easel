// AI-generated with Claude Code, 2026-11-10, reviewed by Hyun Park
// Running canvases: each app server writes <EASEL_HOME or ~/.easel>/servers/<port>.json, and the MCP server
// picks the one for the project it was started in, so agent configs need no --port.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_PORT } from "./args.mjs";

export const easelHome = (env = process.env) => env.EASEL_HOME || path.join(os.homedir(), ".easel");
const serversDir = (home) => path.join(home, "servers");
/** Resolved path (links like /var → /private/var), also for a folder that does not exist yet: its nearest existing parent */
const real = (p) => {
  const abs = path.resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    const up = path.dirname(abs);
    return up === abs ? abs : path.join(real(up), path.basename(abs));
  }
};

/** Records a listening canvas; returns the remover (removes only our own entry) */
export function writeEntry({ port, dir, root, pid = process.pid }, home = easelHome()) {
  const d = serversDir(home);
  mkdirSync(d, { recursive: true });
  const file = path.join(d, `${port}.json`);
  writeFileSync(file, JSON.stringify({ port, pid, dir, root, startedAt: new Date().toISOString() }, null, 2) + "\n");
  return () => {
    try {
      if (JSON.parse(readFileSync(file, "utf8")).pid === pid) rmSync(file, { force: true });
    } catch {
      /* already gone */
    }
  };
}

export function readEntries(home = easelHome()) {
  const d = serversDir(home);
  if (!existsSync(d)) return [];
  const out = [];
  for (const n of readdirSync(d).filter((n) => /^\d+\.json$/.test(n))) {
    try {
      const e = JSON.parse(readFileSync(path.join(d, n), "utf8"));
      if (Number.isInteger(e.port) && e.dir && e.root) out.push(e);
    } catch {
      /* half-written or broken: skip */
    }
  }
  return out.sort((a, b) => a.port - b.port);
}

/** Whether a (resolved) folder is inside another one, or the same */
export const within = (child, parent) => {
  const r = path.relative(parent, child);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
};

/**
 * Pure choice among live canvases for an MCP server started in cwd (paths already resolved):
 * the entry whose root contains cwd (longest root wins), else the only one below cwd (several below: ambiguous),
 * else the only one at all, else ambiguous/none.
 */
export function pickServer(entries, cwd) {
  const around = entries.filter((e) => within(cwd, e.root)).sort((a, b) => b.root.length - a.root.length);
  if (around.length) return { entry: around[0] };
  const below = entries.filter((e) => within(e.root, cwd));
  if (below.length) return below.length === 1 ? { entry: below[0] } : { ambiguous: below };
  if (entries.length === 1) return { entry: entries[0] };
  return entries.length ? { ambiguous: entries } : {};
}

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/** /api/health answers and serves the same design folder */
export async function isAlive(e, ms = 800) {
  try {
    const r = await fetch(`http://127.0.0.1:${e.port}/api/health`, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) return false;
    const h = await r.json();
    return real(h.dir) === real(e.dir);
  } catch {
    return false;
  }
}

/**
 * Port for the MCP server: explicit (--port, or DESIGN_CANVAS_PORT from an in-app run) wins, else the registry, else the default.
 * Throws when several canvases are live and cwd does not single one out.
 */
export async function discoverPort({ port = null, cwd = process.cwd(), home = easelHome() } = {}) {
  if (port) return port;
  const live = [];
  for (const e of readEntries(home)) {
    if (await isAlive(e)) live.push({ ...e, root: real(e.root) });
    else if (!pidAlive(e.pid)) rmSync(path.join(serversDir(home), `${e.port}.json`), { force: true }); // left behind by a crash
  }
  const pick = pickServer(live, real(cwd));
  if (pick.entry) return pick.entry.port;
  if (pick.ambiguous)
    throw new Error(`Several Easel canvases are running and ${cwd} does not single one out:\n${pick.ambiguous.map((e) => `  ${e.root}  (port ${e.port})`).join("\n")}\nPass --port <n> to easel-mcp to pick one.`);
  return DEFAULT_PORT;
}
