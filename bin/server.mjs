#!/usr/bin/env node
// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Usage: easel-canvas [--dir <design folder>] [--port 4317] [--open] [--demo] [--init] | easel-canvas connect [--agents …] [--dry-run]
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseArgs, TOOL_ROOT } from "../server/args.mjs";

const args = parseArgs();
const pkg = JSON.parse(readFileSync(path.join(TOOL_ROOT, "package.json"), "utf8"));

if (args.version) {
  console.log(pkg.version);
  process.exit(0);
}
if (args.help) {
  console.log(`Easel ${pkg.version} — an HTML design canvas for AI agents

Usage
  npx easel-canvas                 open ./docs/design (or the current folder if it has screens/)
  npx easel-canvas --demo          copy the demo project to ./easel-demo and open it
  npx easel-canvas --init          create ./docs/design with a starter screen, then open it
  npx easel-canvas --dir <folder>  open a specific design folder
  npx easel-canvas connect         add the Easel MCP server to your agents' configs (run in the project)

Options
  --port <n>   port to listen on (default 4317; when it is busy and --port is not given, the next free one)
  --open       open the canvas in your browser (--demo and --init do this; --no-open to skip)
  -h, --help   show this help
  -v, --version

connect
  --agents <list>  claude,cursor,gemini,codex (default: Claude Code, plus the others found on this machine)
  --dry-run        print what would be written, write nothing
  Writes .mcp.json, .cursor/mcp.json, .gemini/settings.json in the project and [mcp_servers.easel] in ~/.codex/config.toml.

A design folder holds screens/*.html (one board per file). Easel keeps board.json and
comments.json next to them. The MCP server (npx -y -p easel-canvas easel-mcp) finds the canvas
running for the folder your agent works in; pass --port <n> to it to pick one by hand.
Docs: ${pkg.homepage}`);
  process.exit(0);
}

if (args.command === "connect") {
  const { connect } = await import("../server/connect.mjs");
  const { rootOf } = await import("../server/fsutil.mjs");
  try {
    const lines = await connect({ project: args.dirGiven ? rootOf(args.dir) : process.cwd(), agents: args.agents, dryRun: args.dryRun });
    console.log(lines.join("\n"));
    if (!args.dryRun) console.log("\nStart the canvas with npx easel-canvas, then restart your agent so it loads the MCP server.");
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  process.exit(0);
}

let dir = args.dir;
let open = args.open;
if (args.demo) {
  dir = path.resolve("easel-demo");
  if (!existsSync(dir)) {
    cpSync(path.join(TOOL_ROOT, "examples/demo"), dir, { recursive: true });
    console.log(`Copied the demo project to ${dir}`);
  }
  open = true;
} else if (args.init) {
  if (!existsSync(path.join(dir, "screens"))) {
    const { newBoardHtml } = await import("../server/boards.mjs");
    const { projectName } = await import("../server/fsutil.mjs");
    mkdirSync(path.join(dir, "screens"), { recursive: true });
    writeFileSync(path.join(dir, "screens/home.html"), newBoardHtml({ title: "Home", w: 390, h: 844, template: "mobile", brand: projectName(dir) }));
    console.log(`Created ${path.join(dir, "screens/home.html")}`);
  }
  open = true;
}

if (!existsSync(dir)) {
  console.error(`No design folder at ${dir}

Try one of:
  npx easel-canvas --demo          open the demo project
  npx easel-canvas --init          start a new design folder here (./docs/design)
  npx easel-canvas --dir <folder>  open an existing folder of screens/*.html`);
  process.exit(1);
}

const { createServer } = await import("../server/index.mjs");
const { attach, closeBrowser, extraRoutes } = await import("../server/routes.mjs");
let app;
try {
  app = await createServer({ dir, port: args.port, dev: !args.prod, extraRoutes, autoPort: !args.portGiven, register: true });
} catch (e) {
  if (e.code !== "EADDRINUSE") throw e;
  console.error(e.message);
  process.exit(1);
}
await attach(app);
console.log(`Easel: ${app.url}  (design folder ${dir})${app.port !== args.port ? `  port ${args.port} was busy` : ""}`);

if (open && !args.noOpen) {
  const [cmd, cmdArgs] = process.platform === "darwin" ? ["open", [app.url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", app.url]] : ["xdg-open", [app.url]];
  spawn(cmd, cmdArgs, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
}

process.on("exit", () => app.unregister());
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"])
  process.on(sig, async () => {
    app.unregister();
    await closeBrowser();
    process.exit(0);
  });
