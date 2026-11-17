// AI-generated with Claude Code, 2026-11-17, reviewed by Hyun Park
// An in-app Claude Code run carries Easel's own tools: the inline server (bin/mcp.mjs --chat) has the canvas tools and the permission
// tool, other easel servers are denied so the model sees one set, and a stand-in run's write through that server lands in the run's undo step
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { parseArgs, TOOL_ROOT } from "../server/args.mjs";
import { agentCommand, buildPrompt, easelToolName, parseLine, runMcpConfig } from "../server/chat.mjs";
import { createServer } from "../server/index.mjs";
import { attach, extraRoutes } from "../server/routes.mjs";

const CANVAS_TOOLS = 22;
const claudeArgs = (opts) => {
  const fake = process.env.DESIGN_CANVAS_AGENT_CMD;
  delete process.env.DESIGN_CANVAS_AGENT_CMD;
  try {
    return agentCommand("claude", { prompt: "p", root: "/r", ...opts }).args;
  } finally {
    if (fake) process.env.DESIGN_CANVAS_AGENT_CMD = fake;
  }
};
/** The values after a flag, up to the next flag */
const values = (args, flag) => {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const end = args.findIndex((a, j) => j > i && a.startsWith("--"));
  return args.slice(i + 1, end < 0 ? undefined : end);
};
const listTools = async (flags) => {
  const client = new Client({ name: "claude-code", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(TOOL_ROOT, "bin/mcp.mjs"), ...flags, "--port", "1"], stderr: "ignore" }));
  try {
    return { name: client.getServerVersion().name, tools: (await client.listTools()).tools.map((t) => t.name) };
  } finally {
    await client.close();
  }
};

test("a claude run's arguments: its own server allowed, other easel servers denied, the inline config bound to this canvas and run", () => {
  const args = claudeArgs({ run: { port: 4999, runId: "rabc" } });
  assert.deepEqual(values(args, "--allowedTools"), ["mcp__easel-chat"]);
  assert.deepEqual(values(args, "--disallowedTools"), ["mcp__easel", "mcp__design-canvas"]);
  assert.deepEqual(values(args, "--permission-prompt-tool"), ["mcp__easel-chat__permission"]);
  const cfg = JSON.parse(values(args, "--mcp-config")[0]);
  assert.deepEqual(Object.keys(cfg.mcpServers), ["easel-chat"]);
  const srv = cfg.mcpServers["easel-chat"];
  assert.equal(srv.command, process.execPath);
  assert.deepEqual(srv.args, [path.join(TOOL_ROOT, "bin/mcp.mjs"), "--chat", "--port", "4999"]);
  assert.deepEqual(srv.env, { DESIGN_CANVAS_PORT: "4999", EASEL_RUN_ID: "rabc" });
  assert.equal(runMcpConfig({ port: 4999, runId: "rabc" }), values(args, "--mcp-config")[0]);
  // Without a run (no canvas to bind to) nothing is denied: the project's own easel server stays usable
  const bare = claudeArgs({});
  assert.deepEqual(values(bare, "--allowedTools"), ["mcp__easel", "mcp__design-canvas"]);
  assert.equal(bare.indexOf("--disallowedTools"), -1);
  assert.equal(bare.indexOf("--mcp-config"), -1);
  // The prompt stays the last thing after -p, model and resume after the lists
  assert.equal(claudeArgs({ run: { port: 1, runId: "r" }, model: "opus" }).slice(-2).join(" "), "--model opus");
});

test("--chat lists the canvas tools and the permission tool as easel-chat; --permission still lists only the permission tool", async () => {
  assert.equal(parseArgs(["--chat"]).chat, true);
  assert.equal(parseArgs([]).chat, false);
  const chat = await listTools(["--chat"]);
  assert.equal(chat.name, "easel-chat");
  assert.equal(chat.tools.length, CANVAS_TOOLS + 1);
  assert.ok(chat.tools.includes("permission") && chat.tools.includes("check_tokens") && chat.tools.includes("write_board"));
  const plain = await listTools([]);
  assert.equal(plain.name, "easel");
  assert.deepEqual([...plain.tools].sort(), chat.tools.filter((t) => t !== "permission").sort(), "the same canvas tools as a connected project's server");
  assert.deepEqual(await listTools(["--permission"]), { name: "easel-chat", tools: ["permission"] });
});

test("tool lines: Easel's own tools read as their names, other MCP tools keep theirs", () => {
  assert.equal(easelToolName("mcp__easel-chat__check_tokens"), "check_tokens");
  assert.equal(easelToolName("mcp__easel__get_board"), "get_board");
  assert.equal(easelToolName("mcp__design-canvas__screenshot"), "screenshot");
  assert.equal(easelToolName("mcp__figma__get_code"), "mcp__figma__get_code");
  assert.equal(easelToolName("Edit"), "Edit");
  const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__easel-chat__check_tokens", input: { file: "a.html" } }] } });
  assert.deepEqual(parseLine("claude", line, {}), [{ kind: "tool", name: "check_tokens", detail: JSON.stringify({ file: "a.html" }) }]);
});

test("the token rule: a Claude Code run is told to check with check_tokens; other agents keep 'if available'", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-runtools-prompt-"));
  const ctx = { dir, store: { syncBoard: async () => ({ board: { boards: {} } }) } };
  const state = { context: null, selection: null, errors: {} };
  try {
    await fs.writeFile(path.join(dir, "tokens.json"), JSON.stringify({ active: "Brand", themes: { Brand: { Accent: "#0057FF" } } }));
    for (const agent of [undefined, "claude"]) {
      const p = await buildPrompt(ctx, { text: "x", agent }, state);
      assert.match(p, /Check with check_tokens\./, String(agent));
      assert.doesNotMatch(p, /if available/);
    }
    for (const agent of ["codex", "cursor", "gemini", "custom:abc"]) assert.match(await buildPrompt(ctx, { text: "x", agent }, state), /Check with check_tokens if available\./, agent);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/* ---------- A stand-in run calls the canvas tools through the run's own server ---------- */
const skip = !existsSync(path.join(TOOL_ROOT, "dist/index.html")) && "needs an app build (npm run build)";
const freePort = () =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, () => {
      const pt = s.address().port;
      s.close(() => r(pt));
    });
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const A = "<!doctype html><title>A</title>";
let dir, app, base, ws;
const events = [];
const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const read = (f) => fs.readFile(path.join(dir, f), "utf8").catch(() => null);

before(async () => {
  if (skip) return;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-runtools-"));
  await fs.mkdir(path.join(dir, "screens"));
  await fs.writeFile(path.join(dir, "screens/a.html"), A);
  await fs.writeFile(path.join(dir, "tokens.json"), JSON.stringify({ active: "Brand", themes: { Brand: { Accent: "#0057FF" } } }));
  process.env.DESIGN_CANVAS_AGENT_CMD = JSON.stringify({ claude: ["node", path.join(TOOL_ROOT, "test/fixtures/fake-agent-tools.mjs")] });
  const port = await freePort();
  app = await createServer({ dir, port, dev: false, extraRoutes });
  await attach(app);
  base = `http://127.0.0.1:${port}`;
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.onmessage = (m) => events.push(JSON.parse(m.data));
  await new Promise((r) => (ws.onopen = r));
  await api("GET", "/api/board");
  await wait(400);
});
after(async () => {
  delete process.env.DESIGN_CANVAS_AGENT_CMD;
  ws?.close();
  await app?.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

test("a stand-in run reaches the canvas tools through its own server; the write is in the run's undo step and tagged with the run", { skip }, async () => {
  const { body } = await api("POST", "/api/chat", { agent: "claude", text: "rewrite a" });
  let end;
  for (let i = 0; i < 150 && !end; i++) {
    end = events.find((x) => x.type === "chat" && x.id === body.id && x.ev.kind === "end")?.ev;
    if (!end) await wait(100);
  }
  assert.ok(end, "run ended");
  assert.equal(end.status, "done");
  const listed = JSON.parse(await read("tools.json"));
  assert.equal(listed.server, "easel-chat");
  assert.equal(listed.tools.length, CANVAS_TOOLS + 1);
  assert.ok(typeof JSON.parse(await read("lint.json")) === "object", "check_tokens answered");
  const lines = events.filter((x) => x.type === "chat" && x.id === body.id && x.ev.kind === "tool").map((x) => x.ev.name);
  assert.deepEqual(lines, ["write_board", "check_tokens"]);
  assert.equal(await read("screens/a.html"), "<!doctype html><title>A by tool</title>");
  assert.equal(end.step, true);
  assert.deepEqual(end.boards, [{ file: "a.html", kind: "changed" }]);
  const act = (await api("GET", "/api/activity")).body;
  assert.deepEqual(act.tags["a.html"].map((t) => [t.by, t.run]), [["Claude Code", body.id]], "the board's tag carries the run");
  assert.equal(act.steps.find((s) => s.run === body.id)?.by, "Claude Code");
  const u = await api("POST", "/api/chat/undo-run", { id: body.id });
  assert.equal(u.status, 200);
  assert.equal(await read("screens/a.html"), A, "Undo this run takes back the tool's write");
});
