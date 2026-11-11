// AI-generated with Claude Code, 2026-11-10, reviewed by Hyun Park
// `easel-canvas connect`: writes the Easel MCP entry (no port: easel-mcp finds the canvas for its folder) into each agent's config,
// merged into what is there, idempotent, never overwriting a file it cannot parse.
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const MCP_COMMAND = { command: "npx", args: ["-y", "-p", "easel-canvas", "easel-mcp"] };

/** Agent → where its config lives and the entry it gets. JSON targets are project files; Codex only has a user config here */
export function targets({ project, home = os.homedir(), env = process.env }) {
  const codexHome = env.CODEX_HOME || path.join(home, ".codex");
  return {
    claude: { label: "Claude Code", file: path.join(project, ".mcp.json"), entry: { type: "stdio", ...MCP_COMMAND }, applies: true },
    cursor: { label: "Cursor", file: path.join(project, ".cursor/mcp.json"), entry: { type: "stdio", ...MCP_COMMAND }, applies: existsSync(path.join(project, ".cursor")) || existsSync(path.join(home, ".cursor")) },
    gemini: { label: "Gemini CLI", file: path.join(project, ".gemini/settings.json"), entry: { ...MCP_COMMAND }, applies: existsSync(path.join(project, ".gemini")) || existsSync(path.join(home, ".gemini")) },
    codex: { label: "Codex", file: path.join(codexHome, "config.toml"), toml: true, applies: existsSync(codexHome), needs: codexHome },
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Existing JSON text (or null) → { status: "write" | "unchanged" | "invalid", text } with mcpServers.easel set */
export function mergeJson(text, entry) {
  let data = {};
  if (text != null && text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      return { status: "invalid" };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return { status: "invalid" };
  }
  if (data.mcpServers != null && (typeof data.mcpServers !== "object" || Array.isArray(data.mcpServers))) return { status: "invalid" };
  if (same(data.mcpServers?.easel, entry)) return { status: "unchanged" };
  const indent = /^[ \t]+(?=")/m.exec(text ?? "")?.[0] ?? 2;
  return { status: "write", text: JSON.stringify({ ...data, mcpServers: { ...data.mcpServers, easel: entry } }, null, indent) + "\n" };
}

export const CODEX_BLOCK = `[mcp_servers.easel]
command = "npx"
args = [${MCP_COMMAND.args.map((a) => JSON.stringify(a)).join(", ")}]
default_tools_approval_mode = "approve"  # the tools only view, comment and arrange
`;

/** Existing config.toml text (or null) → the block appended when there is no [mcp_servers.easel] table; other content is never touched */
export function mergeToml(text) {
  const t = text ?? "";
  const m = /^[ \t]*\[mcp_servers\.(?:easel|"easel")\][^\n]*\n([\s\S]*?)(?=^[ \t]*\[|(?![\s\S]))/m.exec(t);
  if (m) return { status: "unchanged", note: /--port/.test(m[1]) ? "has --port; remove it so easel-mcp finds the canvas by folder" : "" };
  return { status: "write", text: t + (t && !t.endsWith("\n") ? "\n" : "") + (t.trim() ? "\n" : "") + CODEX_BLOCK };
}

/**
 * Writes (or with dryRun only reports) each agent's config. agents: ids to write, default every one that applies.
 * Returns one line per target.
 */
export async function connect({ project, home, env, agents = null, dryRun = false }) {
  const all = targets({ project, home, env });
  const unknown = (agents ?? []).filter((a) => !all[a]);
  if (unknown.length) throw new Error(`Unknown agent ${unknown.join(", ")}. Use ${Object.keys(all).join(",")}`);
  const lines = [];
  const show = (f) => (f.startsWith(project + path.sep) ? path.relative(project, f) : f.replace(home ?? os.homedir(), "~"));
  for (const [id, t] of Object.entries(all)) {
    if (agents && !agents.includes(id)) continue;
    if (!agents && !t.applies && !t.needs) {
      lines.push(`skipped  ${show(t.file)} (${t.label}): not used here (no .${id} folder); --agents ${id} writes it anyway`);
      continue;
    }
    if (t.needs && !existsSync(t.needs)) {
      lines.push(`skipped  ${show(t.file)} (${t.label}): ${show(t.needs)} not found, is Codex installed?`);
      continue;
    }
    const text = await fs.readFile(t.file, "utf8").catch(() => null);
    const r = t.toml ? mergeToml(text) : mergeJson(text, t.entry);
    if (r.status === "invalid") {
      lines.push(`skipped  ${show(t.file)} (${t.label}): not valid JSON, left as is; add the easel entry by hand`);
      continue;
    }
    if (r.status === "unchanged") {
      lines.push(`unchanged ${show(t.file)} (${t.label})${r.note ? `: ${r.note}` : ""}`);
      continue;
    }
    if (dryRun) {
      lines.push(`would write ${show(t.file)} (${t.label}):\n${(t.toml ? CODEX_BLOCK : r.text).replace(/^/gm, "    ")}`);
      continue;
    }
    await fs.mkdir(path.dirname(t.file), { recursive: true });
    await fs.writeFile(t.file, r.text);
    lines.push(`wrote    ${show(t.file)} (${t.label})`);
  }
  return lines;
}
