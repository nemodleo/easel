// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Fake agent for the undo-run tests: the request says what to do, e.g. "edit:a.html,b.html add:n.html" appends a marker to
// screens/a.html and screens/b.html and writes a new screens/n.html, with its own file writes like an agent's Edit/Write tools.
import fs from "node:fs";

const prompt = process.argv.at(-1);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
out({ type: "system", subtype: "init", session_id: "fake-run" });
const stamp = `${process.env.EASEL_RUN_ID}`;
for (const f of /edit:([\w.,-]+)/.exec(prompt)?.[1].split(",") ?? []) fs.appendFileSync(`screens/${f}`, `<!-- ${stamp} -->`);
const add = /add:([\w.-]+)/.exec(prompt)?.[1];
if (add) fs.writeFileSync(`screens/${add}`, `<!doctype html><title>${add}</title>`);
out({ type: "result", subtype: "success", is_error: false, result: "Done", total_cost_usd: 0 });
