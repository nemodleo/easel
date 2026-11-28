#!/usr/bin/env node
// AI-generated with Claude Code, 2026-11-27, reviewed by Hyun Park
// Keeps the agent plugin's manifests at the package version (npm version runs it; see "version" in package.json).
// --check: change nothing, exit 1 and list what differs. The skill itself has one copy (plugin/skills/easel); nothing else to sync.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFESTS = ["plugin/.claude-plugin/plugin.json", "plugin/plugin.json"];

export function sync({ check = false } = {}) {
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const off = [];
  for (const rel of MANIFESTS) {
    const file = path.join(root, rel);
    const text = readFileSync(file, "utf8");
    const m = JSON.parse(text);
    if (m.version === version) continue;
    off.push(`${rel}: ${m.version ?? "(none)"} → ${version}`);
    if (!check) writeFileSync(file, text.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`));
  }
  return off;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const off = sync({ check });
  for (const l of off) console.log(`${check ? "differs" : "updated"}  ${l}`);
  process.exit(check && off.length ? 1 : 0);
}
