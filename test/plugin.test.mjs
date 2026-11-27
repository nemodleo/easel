// AI-generated with Claude Code, 2026-11-27, reviewed by Hyun Park
// The agent plugin (plugin/): manifests at the package version, the MCP entry the same as connect writes, the skill valid
// under the Agent Skills rules, its tool reference in step with bin/mcp.mjs, marketplaces and skills.sh.json pointing at it
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { TOOL_ROOT } from "../server/args.mjs";
import { MCP_COMMAND } from "../server/connect.mjs";
import { sync } from "../tools/plugin-sync.mjs";

const read = (rel) => readFileSync(path.join(TOOL_ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

test("plugin manifests carry the package version (tools/plugin-sync.mjs)", () => {
  assert.deepEqual(sync({ check: true }), [], "run node tools/plugin-sync.mjs");
  assert.equal(json("plugin/.claude-plugin/plugin.json").name, "easel");
  assert.equal(json("plugin/plugin.json").name, "easel");
});

test("the plugin's MCP server is the one connect writes, port-less", () => {
  const m = json("plugin/mcp.json");
  assert.deepEqual(Object.keys(m.mcpServers), ["easel"]);
  assert.deepEqual(m.mcpServers.easel, { type: "stdio", ...MCP_COMMAND });
  assert.equal(json("plugin/.claude-plugin/plugin.json").mcpServers, "./mcp.json");
});

test("marketplaces (Claude Code, Codex) and skills.sh.json point at plugin/", () => {
  const claude = json(".claude-plugin/marketplace.json");
  assert.deepEqual(claude.plugins.map((p) => [p.name, p.source]), [["easel", "./plugin"]]);
  const codex = json(".agents/plugins/marketplace.json");
  assert.deepEqual(codex.plugins.map((p) => [p.name, p.source]), [["easel", { source: "local", path: "./plugin" }]]);
  assert.equal(codex.name, claude.name);
  for (const p of json("skills.sh.json").paths) assert.ok(existsSync(path.join(TOOL_ROOT, p)), p);
});

const frontmatter = (text) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, "SKILL.md starts with --- frontmatter");
  return Object.fromEntries(m[1].split("\n").filter((l) => /^[a-z-]+:/.test(l)).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
};

test("the easel skill follows the Agent Skills rules and its references exist", () => {
  const text = read("plugin/skills/easel/SKILL.md");
  const fm = frontmatter(text);
  assert.equal(fm.name, "easel", "name matches the folder");
  assert.match(fm.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(fm.description.length > 0 && fm.description.length <= 1024, `description is ${fm.description.length} characters`);
  assert.ok(text.split("\n").length < 500);
  for (const [, ref] of text.matchAll(/\]\(([^)#]+\.md)\)/g)) assert.ok(existsSync(path.join(TOOL_ROOT, "plugin/skills/easel", ref)), ref);
  for (const f of ["open.md", "variants.md"]) assert.match(read(`plugin/commands/${f}`), /^---\ndescription: .+\n/);
});

test("references/tools.md lists exactly the tools easel-mcp registers", () => {
  const src = read("bin/mcp.mjs");
  const registered = [...src.matchAll(/^tool\(\n\s+"([a-z_]+)"/gm)].map((m) => m[1]).sort();
  assert.ok(registered.length >= 20, `found ${registered.length} tools`);
  const documented = [...read("plugin/skills/easel/references/tools.md").matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]).sort();
  assert.deepEqual(documented, registered);
});
