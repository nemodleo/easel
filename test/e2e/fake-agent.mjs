// AI-generated with Claude Code, 2026-10-09 and 2026-11-11, reviewed by Hyun Park
// Fake agent for e2e: prints output shaped like claude -p --output-format stream-json and edits screens/scr-02.html.
// If the request contains "go slow", it waits 30 seconds (cancel test). "ask permission" first asks to run `npm install lucide-static`
// through the real permission tool (bin/mcp.mjs --permission, as Claude Code would) and reports the answer; "then stop" ends there.
// "markdown answer" streams a markdown reply; "two boards" also edits screens/scr-15.html.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const prompt = process.argv.at(-1);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const say = async (parts) => {
  out({ type: "stream_event", event: { type: "message_start" } });
  for (const t of parts) {
    out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: t } } });
    await wait(30);
  }
};
out({ type: "system", subtype: "init", session_id: "fake-session" });
fs.writeFileSync("prompt.txt", prompt);
if (prompt.includes("go slow")) await wait(30000);
if (prompt.includes("ask permission")) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/mcp.mjs");
  const client = new Client({ name: "claude-code", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [tool, "--permission", "--port", process.env.DESIGN_CANVAS_PORT], env: { ...process.env }, stderr: "ignore" }));
  const input = { command: prompt.includes("with operators") ? "npm install lucide-static && rm -rf dist" : "npm install lucide-static", description: "Install the icon set" };
  out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input }] } });
  const r = await client.callTool({ name: "permission", arguments: { tool_name: "Bash", input, tool_use_id: "toolu_fake" } });
  await client.close();
  const answer = JSON.parse(r.content[0].text);
  fs.writeFileSync("answer.txt", answer.behavior);
  await say([`Permission answer: ${answer.behavior}.`]);
  if (prompt.includes("then stop")) {
    out({ type: "result", subtype: "success", is_error: false, result: "Done", total_cost_usd: 0.001 });
    process.exit(0);
  }
}
if (prompt.includes("markdown answer")) {
  await say(["Added a pricing section to `screens/scr-02.html`:\n\n", "- Three plans: **Free**, Team, *Business*\n- Prices use the Blue token\n", "  - nested detail\n\n", "```html\n<div class=\"plan\">Team</div>\n```\n\n", "The cards need icons from [lucide-static](https://lucide.dev).\n"]);
} else await say(["Fixing ", "the scr-02 ", "title."]);
out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "screens/scr-02.html" } }] } });
const p = "screens/scr-02.html";
fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("<title>", '<title data-ai="1">'));
if (prompt.includes("two boards")) {
  // Changes every time, so the run always changes both boards
  out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "screens/scr-15.html" } }] } });
  for (const f of [p, "screens/scr-15.html"]) fs.appendFileSync(f, `\n<!-- fake edit ${Date.now()} -->\n`);
}
out({ type: "result", subtype: "success", is_error: false, result: "Done", total_cost_usd: 0.001 });
