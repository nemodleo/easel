// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Agent output (JSONL) -> common events
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { agentCommand, buildPrompt, classifyFailure, parseLine, readiness, validModel } from "../server/chat.mjs";
import { ko } from "./fixtures/ko-strings.mjs";

const j = (o) => JSON.stringify(o);

test("claude stream-json: session, text delta, tool, done", () => {
  const st = {};
  assert.deepEqual(parseLine("claude", j({ type: "system", subtype: "init", session_id: "s1" }), st), [{ kind: "session", id: "s1" }]);
  assert.deepEqual(parseLine("claude", j({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: ko.hello } } }), st), [{ kind: "delta", text: ko.hello }]);
  // Once deltas arrived, the assistant message's same text is not emitted again
  assert.deepEqual(parseLine("claude", j({ type: "assistant", message: { content: [{ type: "text", text: ko.hello }, { type: "tool_use", name: "Edit", input: { file_path: "a.html" } }] } }), st), [{ kind: "tool", name: "Edit", detail: "a.html" }]);
  assert.deepEqual(parseLine("claude", j({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.5 }), st), [{ kind: "done", cost: 0.5 }]);
  assert.deepEqual(parseLine("claude", j({ type: "result", subtype: "error_max_turns", is_error: true, result: "x" }), st), [{ kind: "error", text: "x" }]);
});

test("codex --json: thread, message, command, file change, done; config warnings are hidden", () => {
  const st = {};
  assert.deepEqual(parseLine("codex", j({ type: "thread.started", thread_id: "t1" }), st), [{ kind: "session", id: "t1" }]);
  assert.deepEqual(parseLine("codex", j({ type: "item.completed", item: { type: "error", message: "Ignoring unknown `features`" } }), st), []);
  assert.deepEqual(parseLine("codex", j({ type: "item.started", item: { type: "command_execution", command: "ls" } }), st), [{ kind: "tool", name: "Command", detail: "ls" }]);
  assert.deepEqual(parseLine("codex", j({ type: "item.completed", item: { type: "file_change", changes: [{ path: "a.html" }] } }), st), [{ kind: "tool", name: "File change", detail: "a.html" }]);
  assert.deepEqual(parseLine("codex", j({ type: "item.completed", item: { type: "agent_message", text: ko.done } }), st), [{ kind: "text", text: ko.done }]);
  assert.equal(parseLine("codex", j({ type: "turn.completed", usage: {} }), st)[0].kind, "done");
  assert.equal(parseLine("codex", j({ type: "turn.failed", error: { message: "x" } }), st)[0].text, "x");
});

test("non-JSON lines become log", () => {
  assert.deepEqual(parseLine("codex", "Reading additional input", {}), [{ kind: "log", text: "Reading additional input" }]);
  assert.deepEqual(parseLine("codex", "  ", {}), []);
});

test("prompt: no tokens.json → one neutral line, no default palette; registered → the token rule", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-prompt-"));
  const ctx = { dir, store: { syncBoard: async () => ({ board: { boards: {} } }) } };
  const state = { context: null, selection: null, errors: {} };
  try {
    const p1 = await buildPrompt(ctx, { text: "x" }, state);
    assert.match(p1, /No design tokens are registered; keep to the styles already in the file\./);
    assert.doesNotMatch(p1, /C94F0C|Pretendard|design tokens \(theme/);
    await fs.writeFile(path.join(dir, "tokens.json"), JSON.stringify({ active: "Brand", themes: { Brand: { Accent: "#0057FF" } } }));
    const p2 = await buildPrompt(ctx, { text: "x" }, state);
    assert.match(p2, /Use the design tokens \(theme "Brand"\): colors Accent #0057FF;/);
    assert.doesNotMatch(p2, /No design tokens are registered/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("readiness: claude auth status JSON, codex login status text; anything unreadable is unknown", () => {
  assert.equal(readiness("claude", { code: 0, out: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) }), "ready");
  assert.equal(readiness("claude", { code: 1, out: `{\n  "loggedIn": false\n}\n` }), "signin");
  assert.equal(readiness("claude", { code: 0, out: "Usage: claude auth" }), "unknown");
  assert.equal(readiness("claude", null), "unknown");
  assert.equal(readiness("codex", { code: 0, out: "Logged in using ChatGPT\n" }), "ready");
  assert.equal(readiness("codex", { code: 1, out: "Not logged in\n" }), "signin");
  assert.equal(readiness("codex", null), "unknown");
});

test("model: passed as --model to claude and -m to codex (new and resumed); odd values are dropped", () => {
  assert.deepEqual(agentCommand("claude", { prompt: "p", root: "/r", model: "opus" }).args.slice(-2), ["--model", "opus"]);
  assert.ok(!agentCommand("claude", { prompt: "p", root: "/r" }).args.includes("--model"));
  const codex = agentCommand("codex", { prompt: "p", root: "/r", model: "gpt-5" }).args;
  assert.equal(codex[codex.indexOf("-m") + 1], "gpt-5");
  const resumed = agentCommand("codex", { prompt: "p", root: "/r", resume: "t1", model: "gpt-5" }).args;
  assert.deepEqual(resumed.slice(0, 3), ["exec", "resume", "t1"]);
  assert.equal(resumed[resumed.indexOf("-m") + 1], "gpt-5");
  assert.equal(validModel(" claude-opus-4-1[1m] "), "claude-opus-4-1[1m]");
  for (const bad of ["", "a b", "x;rm -rf", "$(id)", 3, null]) assert.equal(validModel(bad), "");
});

test("failure classifier: known causes → one sentence with the next step", () => {
  const c = (o) => classifyFailure({ agent: "claude", ...o });
  assert.deepEqual(c({ text: "Invalid API key · Please run /login", code: 1 }), { cause: "signin", text: "Claude Code is not signed in. Run `claude auth login`, then Retry." });
  assert.equal(c({ text: "Error: Not logged in", code: 1 }).cause, "signin");
  assert.equal(classifyFailure({ agent: "codex", text: "authentication required", code: 1 }).text, "Codex is not signed in. Run `codex login`, then Retry.");
  assert.deepEqual(c({ text: "API Error: model: claude-x not found", code: 1, model: "claude-x" }), { cause: "model", text: 'Model "claude-x" is not available to this account. Pick another model, or the CLI default.' });
  assert.equal(c({ text: `The model "gpt-9" is not supported`, code: 1 }).text, 'Model "gpt-9" is not available to this account. Pick another model, or the CLI default.');
  const limit = classifyFailure({ agent: "codex", text: `error: usage_limit_reached\n"You've hit your usage limit. Try again at Nov 26th, 2026 9:14 AM."`, code: 1 });
  assert.deepEqual(limit, { cause: "limit", text: "Codex hit its usage limit. Try again after Nov 26th, 2026 9:14 AM, or switch agent." });
  assert.equal(classifyFailure({ agent: "codex", text: "rate limit exceeded", code: 1 }).text, "Codex hit its usage limit. Try again later, or switch agent.");
  assert.deepEqual(c({ cmd: "claude", enoent: true, text: "spawn claude ENOENT" }), { cause: "missing", text: "claude command not found. Install it, then Check again." });
  assert.equal(c({ cmd: "claude", text: "'claude' is not recognized as an internal or external command", code: 1 }).cause, "missing");
  assert.deepEqual(c({ text: "Segmentation fault", code: 139 }), { cause: "crash", text: "Claude Code stopped unexpectedly (exit 139). Retry; if it repeats, copy Details into an issue." });
  assert.deepEqual(c({ text: "spawn EACCES\nmore", code: null }), { cause: "other", text: "spawn EACCES" });
});
