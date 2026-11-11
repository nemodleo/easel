// AI-generated with Claude Code, 2026-11-10, reviewed by Hyun Park
// Fake agent for the undo tests: edits screens/a.html twice and screens/b.html with its own file writes, creates screens/c.html,
// and creates one board through the app API the way the MCP server does (X-Easel-Run), all in one run.
import fs from "node:fs";

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
out({ type: "system", subtype: "init", session_id: "fake-edits" });
const edit = (f, from, to) => fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(from, to));
edit("screens/a.html", "<title>A</title>", "<title>A1</title>");
await wait(300);
edit("screens/b.html", "<title>B</title>", "<title>B1</title>");
fs.writeFileSync("screens/c.html", "<!doctype html><title>C</title>");
await fetch(`http://127.0.0.1:${process.env.DESIGN_CANVAS_PORT}/api/boards/create`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Easel-Agent": "Claude Code", "X-Easel-Run": process.env.EASEL_RUN_ID ?? "" },
  body: JSON.stringify({ file: "d.html", template: "blank" }),
});
await wait(200);
edit("screens/a.html", "<title>A1</title>", "<title>A2</title>");
// Exit right after the last write: the run's step must still be complete when `end` arrives
out({ type: "result", subtype: "success", is_error: false, result: "Done", total_cost_usd: 0 });
