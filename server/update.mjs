// AI-generated with Claude Code, 2026-11-15, reviewed by Hyun Park
// New-version notice: npx keeps the copy it cached, so nothing tells people a newer Easel exists. Once a day the canvas asks
// the npm registry for easel-canvas's latest version (only that: one GET, nothing about the project) and, when it is newer,
// says which command updates this install. Silent whenever it cannot ask: EASEL_NO_UPDATE_CHECK=1, CI, a source checkout
// (git clone or submodule: updated with git), offline, a slow or broken registry.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TOOL_ROOT } from "./args.mjs";
import { easelHome } from "./registry.mjs";

const DAY = 24 * 60 * 60 * 1000;
const REGISTRY = "https://registry.npmjs.org/easel-canvas/latest";

/** a > b for x.y.z versions; a pre-release (0.3.0-beta.1) is older than its release and never offered */
export function isNewer(a, b) {
  const parse = (v) => String(v).replace(/^v/, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  if (/-/.test(String(a))) return false;
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return /-/.test(String(b)); // 0.3.0 is newer than 0.3.0-beta.1
}

/** The command that updates the copy running from root: npx's cache, a project's node_modules, or a global install */
export function updateCommand(root = TOOL_ROOT) {
  const p = root.split(path.sep).join("/");
  if (p.includes("/_npx/")) return "npx easel-canvas@latest";
  if (/\/node_modules\/easel-canvas\/?$/.test(p)) {
    const global = /\/lib\/node_modules\/easel-canvas\/?$/.test(p) || /\/npm\/node_modules\/easel-canvas\/?$/i.test(p);
    return global ? "npm i -g easel-canvas@latest" : "npm i -D easel-canvas@latest";
  }
  return "npx easel-canvas@latest";
}

/**
 * Resolves to { current, latest, command } when the registry has a newer version, else null; never throws.
 * The answer is kept a day in <EASEL_HOME>/update.json. EASEL_UPDATE_URL points the check elsewhere (tests, trying it out
 * from a source checkout).
 */
export async function checkUpdate({ current, env = process.env, root = TOOL_ROOT, home = easelHome(env), now = Date.now(), fetchImpl = fetch } = {}) {
  try {
    if (env.EASEL_NO_UPDATE_CHECK === "1" || env.CI) return null;
    const url = env.EASEL_UPDATE_URL || REGISTRY;
    if (!env.EASEL_UPDATE_URL && existsSync(path.join(root, "app"))) return null;
    const file = path.join(home, "update.json");
    let latest = null;
    try {
      const c = JSON.parse(readFileSync(file, "utf8"));
      if (c.url === url && now - c.checkedAt < DAY) latest = c.latest;
    } catch {}
    if (!latest) {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(2000), headers: { accept: "application/json" } });
      if (!r.ok) return null;
      latest = (await r.json())?.version;
      if (typeof latest !== "string") return null;
      mkdirSync(home, { recursive: true });
      writeFileSync(file, JSON.stringify({ url, checkedAt: now, latest }));
    }
    return isNewer(latest, current) ? { current, latest, command: updateCommand(root) } : null;
  } catch {
    return null;
  }
}
