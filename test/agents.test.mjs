// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// More agents: Cursor Agent and Gemini CLI launch commands and output parsing (recorded output shapes), readiness, and custom
// commands (stored per user in EASEL_HOME, split without a shell, {prompt} as one argument, added only from the Easel page)
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { TOOL_ROOT } from "../server/args.mjs";
import { agentCommand, geminiReadiness, parseLine, readiness } from "../server/chat.mjs";
import { addCustom, checkCustom, customArgv, readCustom, removeCustom, splitCommand } from "../server/custom.mjs";
import { createServer } from "../server/index.mjs";
import { attach, extraRoutes } from "../server/routes.mjs";

const j = (o) => JSON.stringify(o);
const run = (agent, lines) => {
  const st = {};
  return lines.flatMap((l) => parseLine(agent, typeof l === "string" ? l : j(l), st));
};

test("Cursor Agent: headless print mode with --trust and --force, stream-json with partial output; model and resume", () => {
  const prev = process.env.DESIGN_CANVAS_AGENT_CMD;
  delete process.env.DESIGN_CANVAS_AGENT_CMD;
  try {
    const c = agentCommand("cursor", { prompt: "do it", root: "/r", model: "sonnet-4", resume: "chat-1" });
    assert.equal(c.cmd, "cursor-agent");
    assert.deepEqual(c.args, ["-p", "--output-format", "stream-json", "--stream-partial-output", "--trust", "--force", "--approve-mcps", "--model", "sonnet-4", "--resume", "chat-1", "do it"]);
    const g = agentCommand("gemini", { prompt: "do it", root: "/r", model: "gemini-2.5-pro" });
    assert.equal(g.cmd, "gemini");
    assert.deepEqual(g.args, ["-p", "do it", "--output-format", "stream-json", "--approval-mode", "auto_edit", "-m", "gemini-2.5-pro"]);
  } finally {
    if (prev != null) process.env.DESIGN_CANVAS_AGENT_CMD = prev;
  }
});

test("Cursor Agent output (recorded from cursor-agent 2026.11.05): session, streamed text once, tools, done", () => {
  const ts = 1794410447841;
  const evs = run("cursor", [
    { type: "system", subtype: "init", apiKeySource: "login", cwd: "/w", session_id: "7389cef7", model: "Auto", permissionMode: "default" },
    { type: "user", message: { role: "user", content: [{ type: "text", text: "Read a.html" }] }, session_id: "7389cef7" },
    { type: "thinking", subtype: "delta", text: "The", session_id: "7389cef7", timestamp_ms: ts },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "I'll" }] }, session_id: "7389cef7", timestamp_ms: ts },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: " read `a.html`." }] }, session_id: "7389cef7", timestamp_ms: ts },
    { type: "tool_call", subtype: "started", call_id: "c1", tool_call: { globToolCall: { args: { globPattern: "**/a.html" } }, toolCallId: "c1" }, session_id: "7389cef7", timestamp_ms: ts },
    { type: "tool_call", subtype: "completed", call_id: "c1", tool_call: { globToolCall: { args: { globPattern: "**/a.html" }, result: { success: { files: ["./a.html"] } } } }, session_id: "7389cef7" },
    { type: "tool_call", subtype: "started", call_id: "c2", tool_call: { readToolCall: { args: { path: "/w/a.html" } } }, session_id: "7389cef7", timestamp_ms: ts },
    { type: "tool_call", subtype: "started", call_id: "c3", tool_call: { editToolCall: { args: { path: "/w/screens/a.html" } } }, session_id: "7389cef7", timestamp_ms: ts },
    { type: "tool_call", subtype: "started", call_id: "c4", tool_call: { shellToolCall: { args: { command: "npm test" } } }, session_id: "7389cef7", timestamp_ms: ts },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "- X" }] }, session_id: "7389cef7", timestamp_ms: ts },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "- X" }] }, session_id: "7389cef7" },
    { type: "result", subtype: "success", duration_ms: 7617, is_error: false, result: "I'll read `a.html`.- X", session_id: "7389cef7" },
  ]);
  assert.deepEqual(evs, [
    { kind: "session", id: "7389cef7" },
    { kind: "delta", text: "I'll" },
    { kind: "delta", text: " read `a.html`." },
    { kind: "tool", name: "Glob", detail: "**/a.html" },
    { kind: "tool", name: "Read", detail: "/w/a.html" },
    { kind: "tool", name: "Edit", detail: "/w/screens/a.html" },
    { kind: "tool", name: "Shell", detail: "npm test" },
    { kind: "delta", text: "- X" },
    { kind: "done" },
  ]);
  // Without --stream-partial-output only whole messages come: shown once
  assert.deepEqual(run("cursor", [{ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } }]), [{ kind: "text", text: "Done." }]);
  assert.deepEqual(run("cursor", [{ type: "result", subtype: "error", is_error: true, result: "Not logged in" }]), [{ kind: "error", text: "Not logged in" }]);
  assert.deepEqual(run("cursor", [{ type: "tool_call", subtype: "started", tool_call: { function: { name: "mcp_easel_list_boards", arguments: "{}" } } }]), [{ kind: "tool", name: "mcp_easel_list_boards", detail: "{}" }]);
});

test("Gemini CLI output (shape from the gemini-cli headless docs; not run here): session, deltas, tools, warnings as log, result", () => {
  const evs = run("gemini", [
    { type: "init", timestamp: "2026-11-11T00:00:00.000Z", session_id: "g1", model: "gemini-2.5-pro" },
    { type: "message", role: "user", content: "Make it calmer", timestamp: "…" },
    { type: "message", role: "assistant", content: "Reading ", delta: true },
    { type: "tool_use", tool_name: "read_file", tool_id: "t1", parameters: { absolute_path: "/w/screens/a.html" } },
    { type: "tool_result", tool_id: "t1", status: "success", output: "<html>" },
    { type: "tool_use", tool_name: "replace", tool_id: "t2", parameters: { file_path: "/w/screens/a.html", old_string: "a", new_string: "b" } },
    { type: "error", severity: "warning", message: "Loop detected, continuing" },
    { type: "message", role: "assistant", content: "done.", delta: true },
    { type: "result", status: "success", stats: { total_tokens: 250, tool_calls: 2 } },
  ]);
  assert.deepEqual(evs, [
    { kind: "session", id: "g1" },
    { kind: "delta", text: "Reading " },
    { kind: "tool", name: "read_file", detail: "/w/screens/a.html" },
    { kind: "tool", name: "replace", detail: "/w/screens/a.html" },
    { kind: "log", text: "Loop detected, continuing" },
    { kind: "delta", text: "done." },
    { kind: "done" },
  ]);
  assert.deepEqual(run("gemini", [{ type: "result", status: "error", error: { type: "FatalAuthenticationError", message: "Please set an Auth method" } }]), [{ kind: "error", text: "Please set an Auth method" }]);
  assert.deepEqual(run("gemini", [{ type: "message", role: "assistant", content: "Whole answer" }]), [{ kind: "text", text: "Whole answer" }]);
});

test("readiness: cursor-agent status text; Gemini by API key or saved Google sign-in, else unknown", async () => {
  assert.equal(readiness("cursor", { code: 0, out: "✓ Logged in as someone@example.com\n" }), "ready");
  assert.equal(readiness("cursor", { code: 1, out: "Not logged in\n" }), "signin");
  assert.equal(readiness("cursor", { code: 0, out: "???" }), "unknown");
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "dc-gem-"));
  try {
    assert.equal(geminiReadiness({}, home), "unknown");
    assert.equal(geminiReadiness({ GEMINI_API_KEY: "k" }, home), "ready");
    await fs.mkdir(path.join(home, ".gemini"));
    await fs.writeFile(path.join(home, ".gemini/oauth_creds.json"), "{}");
    assert.equal(geminiReadiness({}, home), "ready");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("custom command: split like a shell without one; {prompt} required after the program; substituted inside one argument", () => {
  assert.deepEqual(splitCommand(`aider --message {prompt} --yes`), ["aider", "--message", "{prompt}", "--yes"]);
  assert.deepEqual(splitCommand(`run 'a b' "c \\"d\\"" e\\ f ''`), ["run", "a b", 'c "d"', "e f", ""]);
  assert.deepEqual(splitCommand(`echo $(id) ; rm -rf / && x | y > z`), ["echo", "$(id)", ";", "rm", "-rf", "/", "&&", "x", "|", "y", ">", "z"], "operators are plain arguments");
  assert.throws(() => splitCommand(`a 'open`), /Unclosed quote/);
  assert.match(checkCustom({ name: "A", command: "aider --yes" }).error, /\{prompt\}/);
  assert.match(checkCustom({ name: "A", command: "{prompt} x" }).error, /program/);
  assert.match(checkCustom({ name: "", command: "a {prompt}" }).error, /name/);
  assert.match(checkCustom({ name: "A", command: "a {prompt}\nrm -rf /" }).error, /one line/);
  assert.deepEqual(checkCustom({ name: " Aider ", command: " aider --message {prompt} " }), { name: "Aider", command: "aider --message {prompt}" });
  const evil = `x"; rm -rf ~; echo "`;
  assert.deepEqual(customArgv("aider --message {prompt} --yes", evil), { cmd: "aider", args: ["--message", evil, "--yes"] });
  assert.deepEqual(customArgv("tool --msg={prompt}", "a b"), { cmd: "tool", args: ["--msg=a b"] });
});

test("custom commands are stored in EASEL_HOME/agents.json, never in the project", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "dc-home-"));
  try {
    assert.deepEqual(await readCustom(home), []);
    const { agent } = await addCustom({ name: "Aider", command: "aider --message {prompt} --yes" }, home);
    assert.match(agent.id, /^c[0-9a-z]+$/);
    assert.deepEqual(await readCustom(home), [agent]);
    assert.match((await addCustom({ name: "Bad", command: "rm -rf /" }, home)).error, /\{prompt\}/);
    // A hand-edited file with a bad entry: the bad one is ignored
    const f = path.join(home, "agents.json");
    const d = JSON.parse(await fs.readFile(f, "utf8"));
    d.custom.push({ id: "c1", name: "x", command: "no-prompt" }, { id: "../x", name: "y", command: "a {prompt}" });
    await fs.writeFile(f, JSON.stringify(d));
    assert.deepEqual((await readCustom(home)).map((c) => c.name), ["Aider"]);
    await removeCustom(agent.id, home);
    assert.deepEqual(await readCustom(home), []);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

/* ---------- Through the server: agent list, adding from the page only, running one ---------- */
const skip = !existsSync(path.join(TOOL_ROOT, "dist/index.html")) && "needs an app build (npm run build)";
const freePort = () =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
let dir, home, app, base, ws;
const events = [];
const prevHome = process.env.EASEL_HOME;
before(async () => {
  if (skip) return;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-agents-"));
  home = path.join(dir, ".easel-home");
  process.env.EASEL_HOME = home;
  await fs.mkdir(path.join(dir, "screens"));
  await fs.writeFile(path.join(dir, "screens/a.html"), "<!doctype html><title>A</title>");
  const port = await freePort();
  app = await createServer({ dir, port, dev: false, extraRoutes });
  await attach(app);
  base = `http://127.0.0.1:${port}`;
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.onmessage = (m) => events.push(JSON.parse(m.data));
  await new Promise((r) => (ws.onopen = r));
});
after(async () => {
  ws?.close();
  await app?.close();
  if (prevHome == null) delete process.env.EASEL_HOME;
  else process.env.EASEL_HOME = prevHome;
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});
const post = (p, body, origin) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });

test("the agent list has the four agents with status and install pages, and when it was checked", { skip }, async () => {
  const r = await (await fetch(base + "/api/agents")).json();
  assert.deepEqual(r.agents.slice(0, 4).map((a) => a.id), ["claude", "codex", "cursor", "gemini"]);
  assert.deepEqual(r.agents.slice(0, 4).map((a) => a.label), ["Claude Code", "Codex", "Cursor Agent", "Gemini CLI"]);
  for (const a of r.agents) assert.ok(["ready", "signin", "missing", "unknown"].includes(a.status), a.status);
  assert.equal(r.agents.find((a) => a.id === "gemini").install, "https://github.com/google-gemini/gemini-cli#-installation");
  assert.ok(Date.now() - Date.parse(r.checkedAt) < 60000);
});

test("a custom command is added only from the Easel page, stored outside the project, and runs without a shell; output is plain text", { skip }, async () => {
  const script = path.join(dir, "echo-args.mjs");
  await fs.writeFile(script, "for (const a of process.argv.slice(2)) console.log(JSON.stringify(a));\n");
  const body = { name: "Echo", command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)} --message {prompt} --yes` };
  assert.equal((await post("/api/agents/custom", body)).status, 403, "no Origin: not from the page");
  assert.equal((await post("/api/agents/custom", body, "http://evil.example")).status, 403);
  const r = await post("/api/agents/custom", body, base);
  assert.equal(r.status, 200);
  const { agent } = await r.json();
  assert.equal(agent.status, "ready");
  assert.ok(existsSync(path.join(home, "agents.json")));
  assert.ok(!(await fs.readdir(dir)).includes("agents.json"));
  const list = await (await fetch(base + "/api/agents")).json();
  assert.equal(list.agents.at(-1).id, agent.id);
  const text = `hi; touch pwned $(touch pwned2) "quoted"`;
  const { id } = await (await post("/api/chat", { agent: agent.id, text }, base)).json();
  let end;
  for (let i = 0; i < 100 && !end; i++) {
    end = events.find((e) => e.type === "chat" && e.id === id && e.ev.kind === "end");
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.equal(end.ev.status, "done");
  const plain = events.filter((e) => e.type === "chat" && e.id === id && e.ev.kind === "plain").map((e) => JSON.parse(e.ev.text));
  assert.equal(plain.length, 3, "three arguments: --message, the prompt, --yes");
  assert.equal(plain[0], "--message");
  assert.ok(plain[1].includes("[Design canvas context]") && plain[1].endsWith(`[Request]\n${text}`));
  assert.equal(plain[2], "--yes");
  assert.ok(!existsSync(path.join(dir, "pwned")) && !existsSync(path.join(dir, "pwned2")), "nothing was run by a shell");
  // A request for a custom command that is not stored is refused
  assert.equal((await post("/api/chat", { agent: "custom:cnope", text: "x" }, base)).status, 400);
  assert.equal((await post("/api/agents/custom", { action: "delete", id: agent.id }, base)).status, 200);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(home, "agents.json"), "utf8")).custom, []);
});
