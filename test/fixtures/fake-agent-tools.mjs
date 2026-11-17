// AI-generated with Claude Code, 2026-11-17, reviewed by Hyun Park
// Fake agent for the run-tools test: starts the MCP server from the --mcp-config it was given (as Claude Code does with an inline config),
// lists its tools into tools.json, then rewrites screens/a.html with write_board and checks it with check_tokens, all through that server.
import fs from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const argv = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const cfg = JSON.parse(argv[argv.indexOf("--mcp-config") + 1]);
const [name, srv] = Object.entries(cfg.mcpServers)[0];
out({ type: "system", subtype: "init", session_id: "fake-tools" });
const client = new Client({ name: "claude-code", version: "1.0.0" });
// Claude Code starts the server with its own environment plus the entry's env (not the run's EASEL_RUN_ID: the entry must carry it)
const env = { ...process.env, EASEL_RUN_ID: "", DESIGN_CANVAS_PORT: "", ...srv.env };
await client.connect(new StdioClientTransport({ command: srv.command, args: srv.args, env, stderr: "ignore" }));
fs.writeFileSync("tools.json", JSON.stringify({ server: name, tools: (await client.listTools()).tools.map((t) => t.name) }));
const html = "<!doctype html><title>A by tool</title>";
out({ type: "assistant", message: { content: [{ type: "tool_use", name: `mcp__${name}__write_board`, input: { file: "a.html", html } }] } });
await client.callTool({ name: "write_board", arguments: { file: "a.html", html } });
out({ type: "assistant", message: { content: [{ type: "tool_use", name: `mcp__${name}__check_tokens`, input: { file: "a.html" } }] } });
const lint = await client.callTool({ name: "check_tokens", arguments: { file: "a.html" } });
fs.writeFileSync("lint.json", lint.content[0].text);
await client.close();
out({ type: "stream_event", event: { type: "message_start" } });
out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Rewrote a.html." } } });
out({ type: "result", subtype: "success", is_error: false, result: "Done", total_cost_usd: 0.001 });
