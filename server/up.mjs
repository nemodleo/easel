// AI-generated with Claude Code, 2026-11-27, reviewed by Hyun Park
// `easel-canvas up` / `status`: is a canvas running for this project, and if not (up), start one in the background.
// Used by agents (the Easel skill and plugin commands) so asking twice never starts a second server for the same folder.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";

import { TOOL_ROOT } from "./args.mjs";
import { projectName } from "./fsutil.mjs";
import { easelHome, isAlive, readEntries, real, within } from "./registry.mjs";

const view = (e) => ({ running: true, url: `http://localhost:${e.port}`, port: e.port, pid: e.pid, dir: e.dir, root: e.root });

/**
 * The live canvas for this project: one serving exactly `dir`; without an explicit --dir also one whose project root
 * contains cwd (longest root wins), so `up` from a subfolder or with the screens in another folder finds it. Never
 * another project's canvas. Returns null when there is none.
 */
export async function findCanvas({ dir, dirGiven = false, cwd = process.cwd(), home = easelHome() }) {
  const live = [];
  for (const e of readEntries(home)) if (await isAlive(e)) live.push(e);
  const exact = live.find((e) => real(e.dir) === real(dir));
  if (exact) return view(exact);
  if (dirGiven) return null;
  const here = real(cwd);
  const around = live.filter((e) => within(here, real(e.root))).sort((a, b) => real(b.root).length - real(a.root).length);
  return around.length ? view(around[0]) : null;
}

const tail = (file, n = 20) => {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-n).join("\n");
  } catch {
    return "";
  }
};

/**
 * Starts `easel-canvas` detached (it outlives this process and the agent's shell), its output in
 * <EASEL_HOME>/logs/<folder>-<hash>.log, and waits until it has registered itself. Rejects with the log's end when it exits first.
 */
export async function startCanvas({ dir, port = null, init = false, open = true, prod = false, home = easelHome(), timeoutMs = 30000, env = process.env }) {
  const logs = path.join(home, "logs");
  mkdirSync(logs, { recursive: true });
  const log = path.join(logs, `${projectName(dir)}-${crypto.createHash("sha1").update(real(dir)).digest("hex").slice(0, 8)}.log`);
  const fd = openSync(log, "w");
  const args = [path.join(TOOL_ROOT, "bin/server.mjs"), "--dir", dir, ...(port ? ["--port", String(port)] : []), ...(init ? ["--init"] : []), open ? "--open" : "--no-open", ...(prod ? ["--prod"] : [])];
  const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", fd, fd], env: { ...env, EASEL_HOME: home }, windowsHide: true });
  closeSync(fd);
  let exited = null;
  child.on("exit", (code, signal) => (exited = { code, signal }));
  child.on("error", (e) => (exited = { error: e }));
  const until = Date.now() + timeoutMs;
  try {
    while (Date.now() < until) {
      if (exited) {
        const why = exited.error ? exited.error.message : `exited with ${exited.signal ?? exited.code}`;
        throw Object.assign(new Error(`Easel did not start (${why}).${tail(log) ? `\n${tail(log)}` : ""}`), { log });
      }
      const e = readEntries(home).find((x) => x.pid === child.pid);
      if (e && (await isAlive(e))) return { ...view(e), started: true, log };
      await new Promise((r) => setTimeout(r, 150));
    }
    child.kill();
    throw Object.assign(new Error(`Easel did not start within ${Math.round(timeoutMs / 1000)} s; see ${log}`), { log });
  } finally {
    child.unref();
  }
}

/** `up`: the running canvas for this project, or a newly started one. A missing design folder is an error unless init */
export async function up({ dir, dirGiven = false, port = null, init = false, open = true, prod = false, cwd, home = easelHome(), timeoutMs }) {
  const found = await findCanvas({ dir, dirGiven, cwd, home });
  if (found) return { ...found, started: false };
  if (!init && !existsSync(dir))
    throw Object.assign(new Error(`No design folder at ${dir}. Run again with --init to create it with a starter screen, or pass --dir <folder of screens/*.html>.`), { code: "NO_DESIGN_FOLDER" });
  return startCanvas({ dir, port, init, open, prod, home, timeoutMs });
}

/** One line for people (and agents reading the output) */
export function describe(r, dir) {
  if (!r) return `No Easel canvas is running for ${dir}. Start one with: npx easel-canvas up`;
  return `${r.started ? "Started Easel" : "Easel is already running"}: ${r.url}  (design folder ${r.dir}, pid ${r.pid})${r.log ? `\nLog: ${r.log}` : ""}`;
}
