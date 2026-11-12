// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Command-line args: [connect] [--dir <design folder>] [--port 4317] [--open] [--demo] [--init] [--help] [--version],
// plus --agents a,b and --dry-run for connect, --out, --page, --boards a,b, --single-file, --pdf, --png for export,
// and --permission for easel-mcp (only the permission tool of an in-app chat run).
// Default design folder: <repo>/docs/design when Easel lives in <repo>/tools/<name> (submodule); otherwise
// ./docs/design or the current folder if it has screens/ (npx).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const TOOL_ROOT = path.resolve(here, "..");
export const DEFAULT_PORT = 4317;

export function defaultDir(cwd = process.cwd()) {
  const asSubmodule = path.resolve(TOOL_ROOT, "../../docs/design");
  // Installed by npm/npx (node_modules, _npx cache): the current folder wins. In a repo/submodule: <repo>/docs/design wins
  const fromPackageManager = /[\\/](node_modules|_npx)[\\/]/.test(TOOL_ROOT);
  const candidates = fromPackageManager ? [path.resolve(cwd, "docs/design"), cwd, asSubmodule] : [asSubmodule, path.resolve(cwd, "docs/design"), cwd];
  for (const c of candidates) if (existsSync(path.join(c, "screens"))) return c;
  return candidates[0];
}
export const DEFAULT_DIR = defaultDir();

const expand = (p) => path.resolve(p.replace(/^~(?=\/)/, process.env.HOME ?? "~"));

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { command: null, dir: null, port: DEFAULT_PORT, portGiven: false, dirGiven: false, agents: null, dryRun: false, out: null, page: null, boards: null, singleFile: false, pdf: false, png: false, permission: false, open: false, noOpen: false, demo: false, init: false, help: false, version: false, prod: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--dir") out.dir = expand(next());
    else if (a.startsWith("--dir=")) out.dir = expand(a.slice(6));
    else if (a === "--port") out.port = Number(next());
    else if (a.startsWith("--port=")) out.port = Number(a.slice(7));
    else if (a === "--agents") out.agents = next();
    else if (a.startsWith("--agents=")) out.agents = a.slice(9);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--out") out.out = argv[i + 1] ? expand(next()) : null;
    else if (a.startsWith("--out=")) out.out = expand(a.slice(6));
    else if (a === "--page") out.page = next();
    else if (a.startsWith("--page=")) out.page = a.slice(7);
    else if (a === "--boards") out.boards = next();
    else if (a.startsWith("--boards=")) out.boards = a.slice(9);
    else if (a === "--single-file") out.singleFile = true;
    else if (a === "--pdf") out.pdf = true;
    else if (a === "--png") out.png = true;
    else if (i === 0 && (a === "connect" || a === "export")) out.command = a;
    else if (a === "--open") out.open = true;
    else if (a === "--no-open") out.noOpen = true;
    else if (a === "--demo") out.demo = true;
    else if (a === "--init") out.init = true;
    else if (a === "--prod") out.prod = true;
    else if (a === "--permission") out.permission = true;
    else if (a === "-h" || a === "--help") out.help = true;
    else if (a === "-v" || a === "--version") out.version = true;
  }
  out.portGiven = argv.some((a) => a === "--port" || a.startsWith("--port="));
  out.dirGiven = out.dir != null;
  out.agents = out.agents ? out.agents.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
  out.boards = out.boards ? out.boards.split(",").map((s) => s.trim()).filter(Boolean) : null;
  out.dir ??= DEFAULT_DIR;
  return out;
}
