// AI-generated with Claude Code, 2026-11-10, reviewed by Hyun Park
// Who is calling: MCP client names → display labels used as comment authors and undo-step authors (X-Easel-Agent).

/** MCP client name (claude-code, codex-mcp-client, cursor-vscode, gemini-cli-mcp-client, …) → label; unknown names pass through, none is "AI" */
export function agentLabel(clientName) {
  const n = String(clientName ?? "").trim();
  const l = n.toLowerCase();
  if (l.includes("claude")) return "Claude Code";
  if (l.includes("codex")) return "Codex";
  if (l.includes("cursor")) return "Cursor";
  if (l.includes("gemini")) return "Gemini CLI";
  return cleanAgent(n) || "AI";
}

/** Header value safe to store and show: printable, single line, at most 60 chars */
export const cleanAgent = (v) =>
  String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 60);
