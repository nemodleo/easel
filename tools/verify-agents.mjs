#!/usr/bin/env node
// AI-generated with Claude Code, 2026-11-27, reviewed by Hyun Park
// Maintainer check before a release: installs Easel into each agent CLI found on PATH, each in its own config home under a
// temp folder (never ~/.claude, ~/.codex, ~/.cursor, ~/.gemini), checks the plugin, skill and MCP server are there, prints
// pass / skip / fail per check, and removes the temp folder. Not part of npm test.
//
//   node tools/verify-agents.mjs                      this checkout (local marketplace path)
//   node tools/verify-agents.mjs --source github      nemodleo/easel from GitHub, sparse, as the README installs it
//   node tools/verify-agents.mjs --source github@<ref>   (a tag or commit for the npx skills row; a branch works for the others)
//   node tools/verify-agents.mjs --only claude,codex  --keep (leave the temp folder)  --live (one prompt per logged-in agent)
//
// No keys are read or stored here. --live runs only for an agent that is logged in inside its temp home, which in practice
// means its own API key variable is already set in your environment (ANTHROPIC_API_KEY, CODEX_API_KEY, CURSOR_API_KEY, …).
// npx keeps using your npm cache (npm_config_cache), so the MCP server is not downloaded again for every temp home.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : (argv.find((a) => a.startsWith(`${n}=`))?.slice(n.length + 1) ?? null);
};
const sourceArg = opt("--source") ?? "local";
const github = sourceArg.startsWith("github");
const ref = github && sourceArg.includes("@") ? sourceArg.slice(sourceArg.indexOf("@") + 1) : null;
const only = opt("--only")?.split(",").map((s) => s.trim());
const live = flag("--live");
const keep = flag("--keep");

const TMP = realpathSync(mkdtempSync(path.join(os.tmpdir(), "easel-verify-")));
const NPM_CACHE = process.env.npm_config_cache || path.join(os.homedir(), ".npm");
const rows = [];
const row = (agent, check, result, note = "") => rows.push({ agent, check, result, note });

const run = (cmd, args, { env = {}, cwd = TMP, timeout = 180000, input } = {}) => {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, npm_config_cache: NPM_CACHE, ...env }, encoding: "utf8", timeout, input });
  return { code: r.status ?? (r.error?.code === "ETIMEDOUT" || r.signal ? "timeout" : "error"), out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const onPath = (bin) => run(process.platform === "win32" ? "where" : "which", [bin]).code === 0;
const last = (s) => s.trim().split("\n").filter(Boolean).at(-1)?.slice(0, 110) ?? "";

/** A scratch project with a design folder: a package.json of its own (else npx in the Easel checkout runs the local package), git */
function scratchProject(name) {
  const p = path.join(TMP, name, "project");
  mkdirSync(path.join(p, "docs/design/screens"), { recursive: true });
  writeFileSync(path.join(p, "package.json"), JSON.stringify({ name: `scratch-${name}`, private: true }) + "\n");
  writeFileSync(path.join(p, "docs/design/screens/home.html"), '<!doctype html><meta name="board-size" content="390x844"><title>Home</title><body>Home</body>\n');
  run("git", ["init", "-q"], { cwd: p });
  return p;
}
const home = (name) => {
  const h = path.join(TMP, name, "home");
  mkdirSync(h, { recursive: true });
  return h;
};

const PROMPT = "Use the easel MCP tool list_boards and reply with only the number of boards it returns.";
/** --live: start a canvas for the project (its own registry), ask the agent, expect "1" */
function liveCheck(agent, project, cmd, args, env) {
  const easelHome = path.join(TMP, agent, "easel-home");
  const up = run(process.execPath, [path.join(REPO, "bin/server.mjs"), "up", "--json", "--no-open"], { cwd: project, env: { EASEL_HOME: easelHome } });
  let pid = null;
  try {
    pid = JSON.parse(up.out).pid;
  } catch {
    return row(agent, "live prompt", "fail", `could not start a canvas: ${last(up.out)}`);
  }
  try {
    const r = run(cmd, args, { cwd: project, env: { ...env, EASEL_HOME: easelHome }, timeout: 300000 });
    row(agent, "live prompt", r.code === 0 && /\b1\b/.test(r.out) ? "pass" : "fail", last(r.out));
  } finally {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

const AGENTS = {
  claude() {
    const env = { CLAUDE_CONFIG_DIR: home("claude") };
    const project = scratchProject("claude");
    const install = github
      ? [run("claude", ["plugin", "marketplace", "add", `nemodleo/easel${ref ? `@${ref}` : ""}`, "--sparse", ".claude-plugin", "plugin"], { env }), run("claude", ["plugin", "install", "easel@easel"], { env })]
      : [run("claude", ["plugin", "install", "easel", "--marketplace", REPO], { env })];
    const bad = install.find((r) => r.code !== 0);
    row("claude", "install plugin", bad ? "fail" : "pass", bad ? last(bad.out) : github ? "marketplace add --sparse, plugin install" : "plugin install --marketplace <checkout>");
    if (bad) return;
    const d = run("claude", ["plugin", "details", "easel"], { env }).out;
    const skills = /Skills \(\d+\)\s+(.+)/.exec(d)?.[1].trim() ?? "";
    row("claude", "skill + commands", ["easel", "open", "variants"].every((s) => skills.split(/,\s*/).includes(s)) ? "pass" : "fail", skills || last(d));
    row("claude", "MCP server listed", /MCP servers \(1\)\s+easel/.test(d) ? "pass" : "fail");
    let conn = "";
    for (let i = 0; i < 2 && !/Connected/.test(conn); i++) conn = run("claude", ["mcp", "get", "plugin:easel:easel"], { env, cwd: project, timeout: 120000 }).out; // the first npx start can pass the 30 s limit
    row("claude", "MCP server connects", /Connected/.test(conn) ? "pass" : "fail", /Status:\s*(.+)/.exec(conn)?.[1] ?? last(conn));
    if (!live) return;
    const auth = run("claude", ["auth", "status"], { env }).out;
    if (!/"loggedIn":\s*true/.test(auth)) return row("claude", "live prompt", "skip", "not logged in in the temp home (ANTHROPIC_API_KEY not set)");
    liveCheck("claude", project, "claude", ["-p", PROMPT, "--allowedTools", "mcp__plugin_easel_easel__list_boards"], env);
  },

  codex() {
    const env = { CODEX_HOME: home("codex") };
    const project = scratchProject("codex");
    const add = github
      ? run("codex", ["plugin", "marketplace", "add", "nemodleo/easel", ...(ref ? ["--ref", ref] : []), "--sparse", ".agents/plugins", "--sparse", "plugin"], { env })
      : run("codex", ["plugin", "marketplace", "add", REPO], { env });
    const inst = add.code === 0 ? run("codex", ["plugin", "add", "easel@easel"], { env }) : add;
    row("codex", "install plugin", inst.code === 0 ? "pass" : "fail", inst.code === 0 ? (github ? "marketplace add --sparse, plugin add" : "marketplace add <checkout>, plugin add") : last(inst.out));
    if (inst.code !== 0) return;
    const list = run("codex", ["plugin", "list"], { env }).out;
    row("codex", "plugin enabled", /easel@easel\s+installed, enabled/.test(list) ? "pass" : "fail", /easel@easel.*/.exec(list)?.[0].replace(/\s+/g, " ").slice(0, 60) ?? "");
    const root = /Installed plugin root:\s*(.+)/.exec(inst.out)?.[1].trim();
    row("codex", "skill in plugin", root && existsSync(path.join(root, "skills/easel/SKILL.md")) ? "pass" : "fail", root ? "skills/easel/SKILL.md" : "no plugin root reported");
    const mcp = run("codex", ["mcp", "list"], { env, cwd: project }).out;
    row("codex", "MCP server listed", /^easel\s+npx\s+-y -p easel-canvas easel-mcp.*enabled/m.test(mcp) ? "pass" : "fail", "codex mcp list (Codex does not connect here)");
    if (!live) return;
    if (run("codex", ["login", "status"], { env }).code !== 0) return row("codex", "live prompt", "skip", "not logged in in the temp home (CODEX_API_KEY not set)");
    liveCheck("codex", project, "codex", ["exec", "--skip-git-repo-check", PROMPT], env);
  },

  "cursor-agent"() {
    const env = { HOME: home("cursor") };
    const project = scratchProject("cursor");
    // npx skills reads owner/repo@<tag or commit>; a branch name with a slash is taken apart, so it cannot be checked that way
    if (github && ref?.includes("/")) row("cursor-agent", "skill (npx skills)", "skip", `npx skills cannot install from branch ${ref}; pass a tag or commit`);
    const skillSrc = github ? `nemodleo/easel${ref ? `@${ref}` : ""}` : REPO;
    const sk = github && ref?.includes("/") ? null : run("npx", ["-y", "skills@latest", "add", skillSrc, "--skill", "easel", "-a", "cursor", "-y"], { env: { ...env, DISABLE_TELEMETRY: "1" }, cwd: project, timeout: 300000 });
    const skillFile = path.join(project, ".agents/skills/easel/SKILL.md");
    const same = existsSync(skillFile) && readFileSync(skillFile, "utf8") === readFileSync(path.join(REPO, "plugin/skills/easel/SKILL.md"), "utf8");
    if (sk) row("cursor-agent", "skill (npx skills)", existsSync(skillFile) ? "pass" : "fail", existsSync(skillFile) ? `.agents/skills/easel${github ? "" : same ? ", same as plugin/" : ", DIFFERS from plugin/"}` : last(sk.out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")));
    const c = run(process.execPath, [path.join(REPO, "bin/server.mjs"), "connect", "--agents", "cursor"], { env, cwd: project });
    row("cursor-agent", "connect (MCP config)", c.code === 0 && existsSync(path.join(project, ".cursor/mcp.json")) ? "pass" : "fail", ".cursor/mcp.json in the project");
    run("cursor-agent", ["mcp", "enable", "easel"], { env, cwd: project, timeout: 120000 });
    let l = "";
    for (let i = 0; i < 3 && !/easel: ready/.test(l); i++) l = run("cursor-agent", ["mcp", "list"], { env, cwd: project, timeout: 120000 }).out;
    row("cursor-agent", "MCP server ready", /easel: ready/.test(l) ? "pass" : "fail", last(l));
    if (!live) return;
    const status = run("cursor-agent", ["status"], { env }).out;
    if (/Not logged in/i.test(status) || !/Logged in/i.test(status)) return row("cursor-agent", "live prompt", "skip", "not logged in in the temp home (CURSOR_API_KEY not set)");
    liveCheck("cursor-agent", project, "cursor-agent", ["-p", PROMPT, "--force"], env);
  },

  gemini() {
    const env = { HOME: home("gemini") };
    const project = scratchProject("gemini");
    const c = run(process.execPath, [path.join(REPO, "bin/server.mjs"), "connect", "--agents", "gemini"], { env, cwd: project });
    row("gemini", "connect (MCP config)", c.code === 0 && existsSync(path.join(project, ".gemini/settings.json")) ? "pass" : "fail", ".gemini/settings.json in the project");
    const l = run("gemini", ["mcp", "list"], { env, cwd: project, timeout: 120000 }).out;
    row("gemini", "MCP server listed", /easel/.test(l) ? "pass" : "fail", last(l));
    if (live) row("gemini", "live prompt", "skip", "not implemented for Gemini CLI");
  },
};

try {
  for (const [name, check] of Object.entries(AGENTS)) {
    if (only && !only.includes(name) && !only.includes(name.replace("-agent", ""))) continue;
    if (!onPath(name)) {
      row(name, "-", "skip", "not installed (not on PATH)");
      continue;
    }
    try {
      check();
    } catch (e) {
      row(name, "-", "fail", e.message.slice(0, 110));
    }
  }
} finally {
  if (keep) console.log(`Kept ${TMP}`);
  else rmSync(TMP, { recursive: true, force: true });
}

const w = (k) => Math.max(k.length, ...rows.map((r) => r[k].length));
const line = (r) => `${r.agent.padEnd(w("agent"))}  ${r.check.padEnd(w("check"))}  ${r.result.toUpperCase().padEnd(7)}${r.note}`;
console.log(`Easel agent check, source: ${github ? `GitHub nemodleo/easel${ref ? `@${ref}` : ""}` : REPO}\n`);
console.log(line({ agent: "agent", check: "check", result: "result", note: "note" }));
for (const r of rows) console.log(line(r));
const n = (k) => rows.filter((r) => r.result === k).length;
console.log(`\n${n("pass")} pass, ${n("skip")} skip, ${n("fail")} fail`);
process.exit(n("fail") ? 1 : 0);
