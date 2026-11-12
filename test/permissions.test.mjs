// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Permission requests from an in-app Claude Code run: the always-allow rule (never for shell operators), what the card shows,
// and the whole round trip through bin/mcp.mjs --permission: request → card event → allow once / always / deny, cancel denies
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { TOOL_ROOT } from "../server/args.mjs";
import { agentCommand, permissionMcpConfig } from "../server/chat.mjs";
import { createServer } from "../server/index.mjs";
import { createPermissions, describePermission, permissionRule, ruleMatches, toolAnswer } from "../server/permissions.mjs";
import { attach, extraRoutes } from "../server/routes.mjs";

test("always-allow rule: the tool name, or Bash and the first two words; never for file tools, shell operators, or programs that run other commands", () => {
  assert.deepEqual(permissionRule("Bash", { command: "npm install lucide-static" }), { rule: "Bash npm install", label: "npm install" });
  assert.deepEqual(permissionRule("Bash", { command: "make" }), { rule: "Bash make", label: "make" });
  assert.deepEqual(permissionRule("WebFetch", { url: "https://x.dev" }), { rule: "WebFetch", label: "WebFetch" });
  // A file tool only asks for a path outside the project: a rule by name would open all of them
  for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) assert.equal(permissionRule(tool, { file_path: "/etc/hosts" }), null, tool);
  for (const cmd of ["npm i; rm -rf /", "a && b", "a || b", "ls | sh", "echo x > f", "cat < f", "echo `id`", "echo $(id)", "a\nb", "sleep 1 &", ""]) assert.equal(permissionRule("Bash", { command: cmd }), null, cmd);
  for (const cmd of ["sh -c 'rm -rf ~'", "/bin/bash script.sh", "env FOO=1 rm x", "sudo rm x", "xargs rm", "node -e 1", "python3 -c 1", "osascript -e 1", "node --eval 1"]) assert.equal(permissionRule("Bash", { command: cmd }), null, cmd);
  const rules = new Set(["Bash npm install"]);
  assert.ok(ruleMatches(rules, "Bash", { command: "npm install left-pad" }));
  assert.ok(!ruleMatches(rules, "Bash", { command: "npm install x && curl evil" }), "an operator never rides on a rule");
  assert.ok(!ruleMatches(rules, "Bash", { command: "npm run build" }));
  assert.ok(!ruleMatches(rules, "Edit", { file_path: "a" }));
});

test("the card shows the request as it is: the exact command, the path (relative inside the project), outside the design folder", () => {
  const root = path.join(os.tmpdir(), "dc-perm-root");
  const ctx = { root, dir: path.join(root, "docs/design") };
  assert.deepEqual(describePermission("Bash", { command: 'node -e "1"', description: "x" }, ctx), { what: "command", tool: "Bash", subject: 'node -e "1"', where: root });
  const e = describePermission("Edit", { file_path: path.join(root, "src/App.tsx") }, ctx);
  assert.equal(e.subject, "src/App.tsx");
  assert.equal(e.outside, true);
  assert.equal(describePermission("Write", { file_path: "docs/design/screens/a.html" }, ctx).outside, false);
  assert.equal(describePermission("Edit", { file_path: "/etc/hosts" }, ctx).subject, "/etc/hosts");
  assert.equal(describePermission("WebFetch", { url: "https://x.dev" }, ctx).subject, "https://x.dev");
  assert.equal(describePermission("mcp__x__y", { a: 1 }, ctx).subject, JSON.stringify({ a: 1 }, null, 1));
  assert.deepEqual(toolAnswer("once", { a: 1 }), { behavior: "allow", updatedInput: { a: 1 } });
  assert.equal(toolAnswer("deny").behavior, "deny");
});

test("pending requests: wait times out to null, answer settles every waiter, always remembers the rule, denyAll per run", async () => {
  const p = createPermissions();
  const r1 = p.request("r1", "Bash", { command: "npm install a" });
  assert.equal(await p.wait(r1.id, 20), null);
  const w = p.wait(r1.id, 1000);
  assert.ok(p.answer(r1.id, "always"));
  assert.equal(await w, "always");
  assert.equal(p.answer(r1.id, "deny"), null, "answered once only");
  assert.equal(p.request("r1", "Bash", { command: "npm install b" }).decision, "always", "the rule covers the next one");
  assert.equal(p.request("r1", "Bash", { command: "npm install b; ls" }).decision, null);
  const r2 = p.request("r2", "Edit", {});
  const r3 = p.request("r3", "Edit", {});
  assert.deepEqual(p.denyAll("r2").map((x) => x.id), [r2.id]);
  assert.equal(await p.wait(r2.id), "deny");
  assert.equal(r3.decision, null);
  assert.equal(p.answer(r3.id, "maybe"), null);
  assert.equal(p.answer(p.request("r3", "Bash", { command: "a | b" }).id, "always"), null, "no always without a rule");
});

test("claude runs get an inline MCP server with only the permission tool, under a name of its own", async () => {
  const fake = process.env.DESIGN_CANVAS_AGENT_CMD;
  delete process.env.DESIGN_CANVAS_AGENT_CMD;
  const args = agentCommand("claude", { prompt: "p", root: "/r", permission: { port: 4999, runId: "rabc" } }).args;
  if (fake) process.env.DESIGN_CANVAS_AGENT_CMD = fake;
  assert.equal(args[args.indexOf("--permission-prompt-tool") + 1], "mcp__easel-chat__permission");
  const cfg = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
  assert.deepEqual(Object.keys(cfg.mcpServers), ["easel-chat"]);
  assert.deepEqual(cfg.mcpServers["easel-chat"].args.slice(1), ["--permission", "--port", "4999"]);
  assert.equal(cfg.mcpServers["easel-chat"].env.EASEL_RUN_ID, "rabc");
  assert.equal(JSON.parse(permissionMcpConfig({ port: 1, runId: "r1" })).mcpServers["easel-chat"].command, process.execPath);
  const client = new Client({ name: "claude-code", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(TOOL_ROOT, "bin/mcp.mjs"), "--permission", "--port", "1"], stderr: "ignore" }));
  try {
    assert.equal(client.getServerVersion().name, "easel-chat");
    assert.deepEqual((await client.listTools()).tools.map((t) => t.name), ["permission"]);
    // No canvas on that port: the tool denies instead of hanging
    const r = await client.callTool({ name: "permission", arguments: { tool_name: "Bash", input: { command: "ls" } } });
    assert.equal(JSON.parse(r.content[0].text).behavior, "deny");
  } finally {
    await client.close();
  }
});

/* ---------- Round trip through a real server, the fake agent and bin/mcp.mjs --permission ---------- */
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
let dir, app, base, ws;
const events = [];
const post = (p, body, origin = base) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
const chatEvents = (id) => events.filter((e) => e.type === "chat" && e.id === id).map((e) => e.ev);
const until = async (fn, ms = 10000) => {
  for (let i = 0; i < ms / 50; i++) {
    const v = fn();
    if (v) return v;
    await wait(50);
  }
  throw new Error("timed out");
};

before(async () => {
  if (skip) return;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-perm-"));
  await fs.mkdir(path.join(dir, "screens"));
  await fs.writeFile(path.join(dir, "screens/scr-02.html"), "<!doctype html><title>Two</title>");
  process.env.DESIGN_CANVAS_AGENT_CMD = JSON.stringify({ claude: ["node", path.join(TOOL_ROOT, "test/e2e/fake-agent.mjs")] });
  const port = await freePort();
  app = await createServer({ dir, port, dev: false, extraRoutes });
  await attach(app);
  base = `http://127.0.0.1:${port}`;
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.onmessage = (m) => events.push(JSON.parse(m.data));
  await new Promise((r) => (ws.onopen = r));
});
after(async () => {
  delete process.env.DESIGN_CANVAS_AGENT_CMD;
  ws?.close();
  await app?.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

const startRun = async (text) => (await (await post("/api/chat", { agent: "claude", text })).json()).id;
const card = (id) => until(() => chatEvents(id).find((e) => e.kind === "permission"));
const ended = (id) => until(() => chatEvents(id).find((e) => e.kind === "end"));

test("request → card event → Allow once → the agent gets allow and the run continues", { skip }, async () => {
  const id = await startRun("please ask permission then stop");
  const c = await card(id);
  assert.equal(c.what, "command");
  assert.equal(c.subject, "npm install lucide-static");
  assert.equal(c.rule, "npm install");
  assert.equal(c.decision, undefined);
  // Only the page itself may answer: no Origin (an agent's own curl) or another site is refused
  assert.equal((await post("/api/chat/permission/answer", { id: c.id, decision: "once" }, null)).status, 403);
  assert.equal((await post("/api/chat/permission/answer", { id: c.id, decision: "once" }, "http://evil.example")).status, 403);
  assert.equal((await post("/api/chat/permission/answer", { id: c.id, decision: "once" })).status, 200);
  assert.equal((await ended(id)).status, "done");
  const evs = chatEvents(id);
  assert.deepEqual(evs.find((e) => e.kind === "permission-answered"), { kind: "permission-answered", id: c.id, decision: "once" });
  assert.ok(evs.filter((e) => e.kind === "delta").map((e) => e.text).join("").includes("Permission answer: allow."));
});

test("Always allow: remembered in memory for the next run, nothing written to the project; Deny reaches the agent", { skip }, async () => {
  const id = await startRun("ask permission then stop");
  const c = await card(id);
  assert.equal((await post("/api/chat/permission/answer", { id: c.id, decision: "always" })).status, 200);
  await ended(id);
  const id2 = await startRun("ask permission then stop");
  const c2 = await card(id2);
  assert.equal(c2.decision, "always", "answered by the rule, shown folded");
  await ended(id2);
  assert.ok(chatEvents(id2).filter((e) => e.kind === "delta").map((e) => e.text).join("").includes("allow"));
  const files = await fs.readdir(dir, { recursive: true });
  assert.ok(!files.some((f) => /permission|rules|settings|always/i.test(f)), files.join(","));
  // With a shell operator the rule does not apply, and no Always allow is offered
  const id3 = await startRun("ask permission with operators then stop");
  const c3 = await card(id3);
  assert.equal(c3.rule, null);
  assert.equal(c3.decision, undefined);
  assert.equal((await post("/api/chat/permission/answer", { id: c3.id, decision: "always" })).status, 409);
  assert.equal((await post("/api/chat/permission/answer", { id: c3.id, decision: "deny" })).status, 200);
  await ended(id3);
  assert.ok(chatEvents(id3).filter((e) => e.kind === "delta").map((e) => e.text).join("").includes("Permission answer: deny."));
});

test("cancelling the run denies what is pending; a request without a running run is denied", { skip }, async () => {
  const id = await startRun("ask permission with operators then stop");
  const c = await card(id);
  assert.equal((await post("/api/chat/cancel", { id })).status, 200);
  const ans = await until(() => chatEvents(id).find((e) => e.kind === "permission-answered"));
  assert.deepEqual(ans, { kind: "permission-answered", id: c.id, decision: "deny" });
  assert.equal((await ended(id)).status, "cancelled");
  const r = await (await fetch(base + "/api/chat/permission", { method: "POST", headers: { "Content-Type": "application/json", "X-Easel-Run": "rnone" }, body: JSON.stringify({ tool_name: "Bash", input: {} }) })).json();
  assert.equal(r.behavior, "deny");
});

test("closing the server denies an open request, so the waiting agent goes on", { skip }, async () => {
  await fs.rm(path.join(dir, "answer.txt"), { force: true });
  const id = await startRun("ask permission with operators then stop");
  await card(id);
  await app.close();
  app = null;
  for (let i = 0; i < 100 && !existsSync(path.join(dir, "answer.txt")); i++) await wait(50);
  assert.equal(await fs.readFile(path.join(dir, "answer.txt"), "utf8"), "deny");
});
