// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// In-canvas chat: spawns claude -p / codex exec and turns their output (JSONL) into uniform events streamed over WS.
// Attaches the selection, visible boards, comments, references and errors as context; for "N variants" it first creates copies side by side.
// Each run copies the tracked files to .easel/runs/<id>/ first (POST /api/chat/revert), and everything it changes becomes one undo step
// that "Undo this run" takes back. Claude Code's permission prompts come back through bin/mcp.mjs --permission as cards in the chat.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { TOOL_ROOT } from "./args.mjs";
import { createBoards } from "./boards.mjs";
import { copyRun, revertRun } from "./copies.mjs";
import { addCustom, customArgv, readCustom, removeCustom } from "./custom.mjs";
import { boardFile, routeWrite } from "./forks.mjs";
import { rootOf, toPosix } from "./fsutil.mjs";
import { requestScope } from "./history.mjs";
import { originAllowed, readBody, sendJson } from "./index.mjs";
import { createPermissions, describePermission, permissionRule, toolAnswer } from "./permissions.mjs";
import { freeRow } from "./place.mjs";
import { applyRunChanges, dropMissingAutoPlaced, mergeSteps, readRunFile, runBoards, runCopyInfo, undoChanges, withBase } from "./runs.mjs";
import { NO_TOKENS_NOTE, readTokens } from "./tokens.mjs";

export const AGENTS = ["claude", "codex", "cursor", "gemini"];
export const AGENT_LABEL = { claude: "Claude Code", codex: "Codex", cursor: "Cursor Agent", gemini: "Gemini CLI" };
/** Program each agent runs as, and the arguments of its sign-in check */
export const AGENT_CLI = { claude: "claude", codex: "codex", cursor: "cursor-agent", gemini: "gemini" };
const STATUS_ARGS = { claude: ["auth", "status"], codex: ["login", "status"], cursor: ["status"] };
const LOGIN_CMD = { claude: "claude auth login", codex: "codex login", cursor: "cursor-agent login", gemini: "gemini" };
/** Vendor install pages for "How to install" */
export const INSTALL_URL = {
  claude: "https://docs.anthropic.com/en/docs/claude-code/setup",
  codex: "https://github.com/openai/codex#quickstart",
  cursor: "https://cursor.com/cli",
  gemini: "https://github.com/google-gemini/gemini-cli#-installation",
};
/** MCP server name for the run's permission prompts: distinct from a project-configured "easel" server */
export const PERMISSION_SERVER = "easel-chat";
const fakeAgents = () => (process.env.DESIGN_CANVAS_AGENT_CMD ? JSON.parse(process.env.DESIGN_CANVAS_AGENT_CMD) : {});

/** Model names passed to --model / -m: aliases or full ids only (they reach a shell on Windows) */
export const validModel = (m) => (typeof m === "string" && /^[\w.:/[\]-]{1,100}$/.test(m.trim()) ? m.trim() : "");

/** Inline --mcp-config for a Claude Code run: this package's MCP server with only the permission tool, bound to this canvas and run */
export function permissionMcpConfig({ port, runId }) {
  const env = { DESIGN_CANVAS_PORT: String(port), EASEL_RUN_ID: runId };
  return JSON.stringify({ mcpServers: { [PERMISSION_SERVER]: { type: "stdio", command: process.execPath, args: [path.join(TOOL_ROOT, "bin/mcp.mjs"), "--permission", "--port", String(port)], env } } });
}

/**
 * Agent launch command. Tests override it with DESIGN_CANVAS_AGENT_CMD='{"claude":["node","fake.mjs"]}'.
 * permission: { port, runId } routes Claude Code's permission prompts to the chat (anything else is refused in headless mode)
 */
export function agentCommand(agent, { prompt, resume, root, images = [], model = "", permission = null }) {
  const override = fakeAgents()[agent];
  if (override) return { cmd: override[0], args: [...override.slice(1), prompt] };
  if (agent === "codex") {
    const common = ["--json", "--skip-git-repo-check", "-s", "workspace-write", ...(model ? ["-m", model] : []), ...images.flatMap((i) => ["-i", i])];
    return resume ? { cmd: "codex", args: ["exec", "resume", resume, ...common, prompt] } : { cmd: "codex", args: ["exec", ...common, "-C", root, prompt] };
  }
  // Headless print mode needs --trust (no workspace prompt) and --force (otherwise edits are only proposed)
  if (agent === "cursor")
    return { cmd: AGENT_CLI.cursor, args: ["-p", "--output-format", "stream-json", "--stream-partial-output", "--trust", "--force", "--approve-mcps", ...(model ? ["--model", model] : []), ...(resume ? ["--resume", resume] : []), prompt] };
  if (agent === "gemini") return { cmd: AGENT_CLI.gemini, args: ["-p", prompt, "--output-format", "stream-json", "--approval-mode", "auto_edit", ...(model ? ["-m", model] : []), ...(resume ? ["--resume", resume] : [])] };
  return {
    cmd: "claude",
    args: [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      "mcp__easel",
      "mcp__design-canvas",
      ...(permission ? ["--mcp-config", permissionMcpConfig(permission), "--permission-prompt-tool", `mcp__${PERMISSION_SERVER}__permission`] : []),
      ...(model ? ["--model", model] : []),
      ...(resume ? ["--resume", resume] : []),
    ],
  };
}

/** Runs a short command; null when it cannot start or takes longer than ms */
function runQuick(cmd, args, ms = 5000) {
  return new Promise((resolve) => {
    const win = process.platform === "win32";
    let out = "";
    let p;
    try {
      p = spawn(cmd, win ? args.map(winQuote) : args, { shell: win, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      return resolve(null);
    }
    const done = (v) => {
      clearTimeout(t);
      resolve(v);
    };
    const t = setTimeout(() => {
      p.kill();
      done(null);
    }, ms);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", () => done(null));
    p.on("close", (code) => done({ code, out }));
  });
}

/** Output of `claude auth status` / `codex login status` / `cursor-agent status` → ready | signin | unknown */
export function readiness(agent, r) {
  if (!r) return "unknown";
  if (agent === "codex") return r.code === 0 && /Logged in/.test(r.out) ? "ready" : "signin";
  if (agent === "cursor") return /not logged in|not authenticated/i.test(r.out) ? "signin" : r.code === 0 && /logged in/i.test(r.out) ? "ready" : "unknown";
  try {
    const j = JSON.parse(r.out.slice(r.out.indexOf("{"), r.out.lastIndexOf("}") + 1));
    return j.loggedIn === true ? "ready" : j.loggedIn === false ? "signin" : "unknown";
  } catch {
    return "unknown";
  }
}

const which = (c) => new Promise((r) => spawn(process.platform === "win32" ? "where" : "which", [c], { windowsHide: true }).on("close", (code) => r(code === 0)).on("error", () => r(false)));

/** Gemini CLI has no status command: an API key in the environment or saved Google sign-in counts as ready, anything else is unknown */
export function geminiReadiness(env = process.env, home = os.homedir()) {
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENAI_USE_VERTEXAI) return "ready";
  return existsSync(path.join(home, ".gemini", "oauth_creds.json")) ? "ready" : "unknown";
}

/** Whether an agent can run now: missing (not on PATH), signin, ready, unknown (status check failed or timed out) */
export async function agentStatus(agent) {
  if (fakeAgents()[agent]) return "ready";
  if (!(await which(AGENT_CLI[agent]))) return "missing";
  if (agent === "gemini") return geminiReadiness();
  return readiness(agent, await runQuick(AGENT_CLI[agent], STATUS_ARGS[agent]));
}

/** A custom command is ready when its program is on PATH (or an existing path) */
const customStatus = async (command) => {
  const cmd = customArgv(command, "").cmd;
  return (/[\\/]/.test(cmd) ? existsSync(cmd) : await which(cmd)) ? "ready" : "missing";
};

/** Known causes of a failed run → { cause, text }: one plain sentence with the next step. The raw output goes under Details */
export function classifyFailure({ agent, cmd = agent, text = "", code = null, signal = null, enoent = false, model = "", label = AGENT_LABEL[agent] ?? agent }) {
  const t = String(text ?? "");
  if (enoent || /command not found|is not recognized as an internal or external command/i.test(t)) return { cause: "missing", text: `${cmd} command not found. Install it, then Check again.` };
  if (/usage limit|usage_limit_reached|rate limit/i.test(t)) {
    const at = /try again at\s+(.+?)(?:\.(?=\s|"|$)|"|\n|$)/i.exec(t)?.[1]?.trim();
    return { cause: "limit", text: `${label} hit its usage limit. Try again ${at ? `after ${at}` : "later"}, or switch agent.` };
  }
  if (/model/i.test(t) && /not supported|not found|unknown|invalid|does not exist|not available/i.test(t)) {
    const name = model || /model\W{0,3}["'`]([^"'`\s]+)["'`]/i.exec(t)?.[1] || "";
    return { cause: "model", text: `${name ? `Model "${name}"` : "This model"} is not available to this account. Pick another model, or the CLI default.` };
  }
  if (/not logged in|please run \/login|authenticat|\blog ?in\b/i.test(t)) return { cause: "signin", text: `${label} is not signed in. Run \`${LOGIN_CMD[agent] ?? `${cmd} login`}\`, then Retry.` };
  if ((code != null && code !== 0) || signal) return { cause: "crash", text: `${label} stopped unexpectedly (exit ${code ?? signal}). Retry; if it repeats, copy Details into an issue.` };
  return { cause: "other", text: t.trim().split("\n")[0] || "Failed" };
}

/** Tools that only read (anything else may have changed files) */
const READ_ONLY = /^(Read|Glob|Grep|LS|WebFetch|WebSearch|TodoWrite|Task|ToolSearch|glob|search_file_content|google_web_search|web_fetch)$|(^|__)(list_|read_|get_|check_|screenshot)/;

/** Cursor tool_call payload ({ readToolCall: { args } }, { function: { name, arguments } }) → a tool event */
function cursorTool(tc) {
  const [key, v] = Object.entries(tc ?? {}).find(([k]) => k.endsWith("ToolCall") || k === "function") ?? [];
  if (!key) return { kind: "tool", name: "Tool" };
  if (key === "function") return { kind: "tool", name: v?.name ?? "Tool", detail: short(v?.arguments) };
  const base = key.replace(/ToolCall$/, "");
  const name = base === "ls" ? "LS" : base.charAt(0).toUpperCase() + base.slice(1);
  const a = v?.args ?? {};
  return { kind: "tool", name: base === "mcp" ? (a.toolName ?? a.name ?? "MCP") : name, detail: short(a.path ?? a.command ?? a.globPattern ?? a.pattern ?? a.args ?? a) };
}

const short = (v, n = 120) => {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length > n ? s.slice(0, n) + "…" : s;
};

/** One line of agent output → list of common events */
export function parseLine(agent, line, st) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return line.trim() ? [{ kind: "log", text: line.trim() }] : [];
  }
  const out = [];
  if (agent === "cursor") {
    // With --stream-partial-output text comes as assistant deltas (timestamp_ms), then once more as the whole message: that copy is skipped
    if (o.type === "system" && o.subtype === "init") out.push({ kind: "session", id: o.session_id });
    else if (o.type === "assistant") {
      const text = (o.message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
      if (o.timestamp_ms != null) {
        st.seg = true;
        if (text) out.push({ kind: "delta", text });
      } else if (st.seg) st.seg = false;
      else if (text) out.push({ kind: "text", text });
    } else if (o.type === "tool_call" && o.subtype === "started") {
      st.seg = false;
      out.push(cursorTool(o.tool_call));
    } else if (o.type === "result") out.push(o.is_error ? { kind: "error", text: o.result ?? o.subtype ?? "Failed" } : { kind: "done" });
    else if (o.type === "error") out.push({ kind: "error", text: o.message ?? o.error?.message ?? "Failed" });
    return out;
  }
  if (agent === "gemini") {
    if (o.type === "init") out.push({ kind: "session", id: o.session_id });
    else if (o.type === "message" && o.role === "assistant" && o.content) out.push(o.delta ? { kind: "delta", text: o.content } : { kind: "text", text: o.content });
    else if (o.type === "tool_use") {
      const a = o.parameters ?? {};
      out.push({ kind: "tool", name: o.tool_name ?? "Tool", detail: short(a.file_path ?? a.absolute_path ?? a.path ?? a.command ?? a.pattern ?? a) });
    } else if (o.type === "error") out.push(o.severity === "warning" ? { kind: "log", text: o.message } : { kind: "error", text: o.message ?? "Failed" });
    else if (o.type === "result") out.push(o.status === "error" ? { kind: "error", text: o.error?.message ?? "Failed" } : { kind: "done" });
    return out;
  }
  if (agent === "codex") {
    if (o.type === "thread.started") out.push({ kind: "session", id: o.thread_id });
    else if (o.type === "item.started" || o.type === "item.completed") {
      const it = o.item ?? {};
      if (it.type === "agent_message" && o.type === "item.completed") out.push({ kind: "text", text: it.text ?? "" });
      else if (it.type === "command_execution" && o.type === "item.started") out.push({ kind: "tool", name: "Command", detail: short(it.command) });
      else if (it.type === "file_change" && o.type === "item.completed") out.push({ kind: "tool", name: "File change", detail: (it.changes ?? []).map((c) => c.path).join(", ") });
      else if (it.type === "mcp_tool_call" && o.type === "item.started") out.push({ kind: "tool", name: it.tool ?? "MCP", detail: short(it.arguments) });
      else if (it.type === "error" && !String(it.message).startsWith("Ignoring unknown")) out.push({ kind: "error", text: it.message });
    } else if (o.type === "turn.completed") out.push({ kind: "done", usage: o.usage });
    else if (o.type === "turn.failed" || o.type === "error") out.push({ kind: "error", text: o.error?.message ?? o.message ?? "Failed" });
    return out;
  }
  // claude stream-json
  if (o.type === "system" && o.subtype === "init") out.push({ kind: "session", id: o.session_id });
  else if (o.type === "stream_event" && o.event?.type === "content_block_delta" && o.event.delta?.type === "text_delta") {
    st.streamed = true;
    out.push({ kind: "delta", text: o.event.delta.text });
  } else if (o.type === "stream_event" && o.event?.type === "message_start") out.push({ kind: "break" });
  else if (o.type === "assistant") {
    for (const c of o.message?.content ?? []) {
      if (c.type === "tool_use") out.push({ kind: "tool", name: c.name, detail: short(c.input?.file_path ?? c.input?.path ?? c.input?.command ?? c.input) });
      else if (c.type === "text" && !st.streamed) out.push({ kind: "text", text: c.text });
    }
  } else if (o.type === "result") out.push(o.is_error ? { kind: "error", text: o.result ?? o.subtype } : { kind: "done", cost: o.total_cost_usd });
  return out;
}

/** Windows shell argument: wrap in double quotes and double any inner double quotes */
export const winQuote = (a) => (/^[\w./:=-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);

/** Context block */
export async function buildPrompt(ctx, body, state) {
  const { board } = await ctx.store.syncBoard();
  const rel0 = path.relative(rootOf(ctx.dir), ctx.dir);
  const rel = rel0 || ".";
  const lines = [`[Design canvas context]`, `- Design folder: ${rel} (screens are ${rel0 ? rel0 + "/" : ""}screens/*.html, canvas positions are in board.json)`];
  const c = state.context;
  if (c) {
    if (c.pageName) lines.push(`- Current page: ${c.pageName}`);
    if (body.attach?.visible !== false && c.visibleArtboards?.length) lines.push(`- Visible boards: ${c.visibleArtboards.slice(0, 20).join(", ")}`);
  }
  const boards = [...new Set(body.attach?.boards ?? [])];
  if (boards.length) lines.push(`- Target boards: ${boards.map((f) => `${rel0 ? rel0 + "/" : ""}screens/${f} ("${board.boards[f]?.title ?? f}")`).join(", ")}`);
  const sel = state.selection;
  if (body.attach?.selection !== false && sel) {
    lines.push(`- Selected element: ${rel0 ? rel0 + "/" : ""}screens/${sel.file} path ${sel.path} <${sel.tag}>${sel.label ? ` "${sel.label}"` : ""}`);
    lines.push("  Source excerpt:\n" + sel.outerHTML.slice(0, 1200).replace(/^/gm, "    "));
  }
  const comments = body.attach?.comments ?? [];
  if (comments.length) {
    const d = await readJson(path.join(ctx.dir, "comments.json"), {});
    const all = Array.isArray(d.comments) ? d.comments : [];
    for (const id of comments) {
      const cm = all.find((x) => x.id === id);
      if (cm) lines.push(`- Comment (${cm.id}) ${rel0 ? rel0 + "/" : ""}screens/${cm.file}${cm.path ? ` path ${cm.path}` : ""}: "${cm.text}" — change only this location, then mark it resolved with resolve_comment`);
    }
  }
  for (const r of body.attach?.refs ?? []) {
    if (r.kind === "url") lines.push(`- Reference link: ${r.value}`);
    else lines.push(`- Reference file (${r.kind === "image" ? "image" : "document"}): ${path.relative(rootOf(ctx.dir), path.join(ctx.dir, r.value))} — read it for reference`);
  }
  const errs = Object.entries(state.errors).filter(([f]) => boards.includes(f));
  for (const [f, list] of errs) lines.push(`- ${f} error: ${list[0].message}${list[0].line ? ` (line ${list[0].line})` : ""}`);
  for (const f of body.forks ?? []) {
    const at = (x) => `${rel0 ? rel0 + "/" : ""}screens/${x}`;
    const why = f.created === false ? `${at(f.of)} already has a fork of yours from an earlier run: ${at(f.file)}` : `${f.while} is editing ${at(f.of)} right now, so a fork was made for you: ${at(f.file)}`;
    lines.push(`- ${why}. Make your changes in ${f.file}, not in ${f.of}.`);
  }
  if (body.variants?.files?.length) {
    lines.push(`- Make ${body.variants.files.length} distinct variants of "${body.variants.base}". Copies have already been created side by side: ${body.variants.files.map((f) => `${rel0 ? rel0 + "/" : ""}screens/${f}`).join(", ")}. Take each file in a different direction, and use place_board to retitle each one like "Variant 1: summary". Do not modify the original.`);
  }
  // Design tokens from tokens.json. Without one the AI gets no default palette, only "keep to the file's styles"
  const tk = await readTokens(ctx.dir);
  const palette = Object.entries(tk.themes?.[tk.active] ?? {}).map(([n, v]) => `${n} ${v}`).join(", ");
  const tokenRule = tk.registered ? `Use the design tokens (theme "${tk.active}"): colors ${palette}; font sizes ${tk.fontSizes.join("/")}px; radii ${tk.radii.join("/")}px; spacing in multiples of 4; font ${tk.fontFamily}. Check with check_tokens if available.` : NO_TOKENS_NOTE;
  lines.push(
    `Rules: Only edit design files inside ${rel}/screens. Change only what is asked and leave everything else as is. New screens must include <meta name="board-size" content="390x844">; after creating one, use place_board to set its name and position. ${tokenRule}`,
    "",
    "[Request]",
    body.text,
  );
  return lines.join("\n");
}

const readJson = (p, d) => fs.readFile(p, "utf8").then(JSON.parse, () => d);

/** A request that changes per-user settings or answers for the user: only the app page itself (same-origin, with an Origin header) */
const fromBrowser = (req) => !!req.headers.origin && originAllowed(req.headers);

export function chatRoutes({ getSelection } = {}) {
  const runs = new Map(); // id → { proc, agent, events, status, emit, changes, boards, label, undone }
  const state = { selection: null, context: null, errors: {} };
  const perms = createPermissions();
  /** Settles open permission requests as denied (run cancelled or ended, server closing) and says so in the chat */
  const denyOpen = (runId) => {
    for (const p of perms.denyAll(runId)) runs.get(p.run)?.emit?.({ kind: "permission-answered", id: p.id, decision: "deny" });
  };

  return {
    state,
    close: () => denyOpen(),
    routes: [
      [
        "POST",
        "/api/chat",
        async (req, res, url, ctx) => {
          const body = await readBody(req);
          const custom = String(body.agent ?? "").startsWith("custom:") ? (await readCustom()).find((c) => `custom:${c.id}` === body.agent) : null;
          if (String(body.agent ?? "").startsWith("custom:") && !custom) return sendJson(res, 400, { error: "That custom command is gone; pick another agent" });
          const agent = custom ? body.agent : AGENTS.includes(body.agent) ? body.agent : "claude";
          if (!String(body.text ?? "").trim()) return sendJson(res, 400, { error: "Please enter a message" });
          state.selection = getSelection?.() ?? null;
          let id = `r${Date.now().toString(36)}`;
          while (runs.has(id)) id = `r${(parseInt(id.slice(1), 36) + 1).toString(36)}`;
          const label = custom?.name ?? AGENT_LABEL[agent];
          // Pre-run copy on disk (before variant copies too): revertable even after a restart, no git needed
          await ctx.store.exclusive(() => copyRun(ctx, id, { agent, label, request: String(body.text).slice(0, 200) })).catch((e) => console.error("run copy failed", e));
          const request = String(body.text).trim().replace(/\s+/g, " ");
          const historyLabel = `${label}: ${request.length > 40 ? request.slice(0, 40) + "…" : request}`;
          // From here every change (variant copies included) joins the run's one undo step
          ctx.history.beginRun({ id, label: historyLabel, by: label });
          // N variants: create copies of the original side by side, in a row below it
          const n = Math.min(4, Math.max(0, Number(body.variants) || 0));
          if (n > 1) {
            const base = body.attach?.boards?.[0] ?? state.selection?.file;
            if (!base) {
              ctx.history.endRun(id);
              ctx.occupancy?.runEnded(id);
              return sendJson(res, 400, { error: "Select one board to make variants of" });
            }
            const html = await fs.readFile(path.join(ctx.store.screensDir, base), "utf8");
            const { board } = await ctx.store.syncBoard();
            const b = board.boards[base] ?? { x: 0, y: 0, w: 390, h: 844 };
            const stem = base.replace(/\.html$/, "");
            // In the first free row below the original (never on top of notes or boards); each one remembers where it came from
            const spots = freeRow(board, b, n);
            const origin = { kind: "variant", of: base, at: new Date().toISOString() };
            const files = await requestScope.run({ ...requestScope.getStore(), run: id }, () =>
              ctx.store.exclusive(() =>
                createBoards(
                  ctx,
                  Array.from({ length: n }, (_, i) => ({ file: `${stem}-v${i + 1}.html`, html, ...spots[i], w: b.w, h: b.h, title: `${b.title ?? stem} variant ${i + 1}`, page: b.page, origin })),
                  `Create ${n} variants ${base}`,
                ),
              ),
            );
            body.variants = { base, files };
            body.attach = { ...body.attach, boards: [base, ...files] };
          } else {
            body.variants = undefined;
            // A target board another agent is editing right now: this run works on a fork of it (one writer per board)
            const targets = [...new Set([...(body.attach?.boards ?? []), ...(state.selection?.file ? [state.selection.file] : [])])].filter(boardFile);
            const forks = [];
            for (const f of targets) {
              const r = await requestScope.run({ ...requestScope.getStore(), agent: label, run: id }, () => ctx.store.exclusive(() => routeWrite(ctx, f)));
              if (r.forked) forks.push({ of: f, file: r.file, while: r.while ?? "another agent", created: r.created });
            }
            body.forks = forks;
            if (forks.length) body.attach = { ...body.attach, boards: (body.attach?.boards ?? []).map((f) => forks.find((x) => x.of === f)?.file ?? f) };
          }
          const prompt = await buildPrompt(ctx, body, state);
          const images = (body.attach?.refs ?? []).filter((r) => r.kind === "image").map((r) => path.join(ctx.dir, r.value));
          const model = custom ? "" : validModel(body.model);
          const { cmd, args } = custom ? customArgv(custom.command, prompt) : agentCommand(agent, { prompt, resume: body.resume, root: rootOf(ctx.dir), images, model, permission: { port: req.socket.localPort, runId: id } });
          let proc;
          try {
            // Windows: claude/codex are .cmd wrappers so a shell is needed, and there is no process-group kill so detached is not used.
            // A custom command never goes through a shell: its arguments are passed as they are
            const win = process.platform === "win32";
            const shell = win && !custom;
            proc = spawn(cmd, shell ? args.map(winQuote) : args, { cwd: rootOf(ctx.dir), stdio: ["ignore", "pipe", "pipe"], detached: !win, shell, windowsHide: true, env: { ...process.env, DESIGN_CANVAS_PORT: String(req.socket.localPort), EASEL_RUN_ID: id } });
          } catch (e) {
            ctx.history.endRun(id);
            ctx.occupancy?.runEnded(id);
            return sendJson(res, 500, { error: `Could not run ${cmd}: ${e.message}` });
          }
          const run = { proc, agent, events: [], status: "running", prompt, label: historyLabel, custom: !!custom };
          runs.set(id, run);
          // Show tool paths relative to the project (agents report absolute, sometimes symlink-resolved, paths)
          const roots = [rootOf(ctx.dir), await fs.realpath(rootOf(ctx.dir)).catch(() => null)].filter(Boolean).map((r) => r + path.sep).sort((a, b) => b.length - a.length); // longest first: /private/var/… before /var/…
          // What a failure is classified from, and shown under Details: error events, non-JSON output, stderr (never the prompt)
          const seen = [];
          const emit = (ev) => {
            if (typeof ev.detail === "string") for (const r of roots) ev.detail = ev.detail.split(r).join("");
            if (ev.kind === "tool" && !READ_ONLY.test(ev.name)) run.changed = true;
            if ((ev.kind === "error" && !ev.cause) || ev.kind === "log" || ev.kind === "plain") seen.push(ev.text);
            run.events.push(ev);
            ctx.broadcast({ type: "chat", id, ev });
          };
          run.emit = emit;
          const fail = ({ code = null, signal = null, enoent = false, message = "" }) => {
            const all = [...seen, err, message].join("\n").trim();
            const c = classifyFailure({ agent, cmd, text: all, code, signal, enoent, model, label });
            const shown = `$ ${cmd} ${args.filter((a) => a !== prompt && !a.includes(prompt)).join(" ")}`.trim();
            const raw = [shown, ...all.split("\n").slice(-20), code != null || signal ? `Exit code ${code ?? signal}` : ""].filter(Boolean).join("\n");
            emit({ kind: "error", text: c.text, cause: c.cause, raw, changed: !!run.changed });
          };
          // At the end: diff the tracked files now (watcher events may still be pending), so the run's undo step is complete before `end`
          const finish = async () => {
            denyOpen(id);
            const steps = await ctx.store
              .exclusive(async () => {
                await ctx.history.observe().catch((e) => console.error("run diff failed", e));
                ctx.history.endRun(id);
                ctx.occupancy?.runEnded(id);
                return ctx.history.runSteps(id);
              })
              .catch(() => []);
            if (steps.length) ctx.broadcast({ type: "history-changed" });
            run.changes = mergeSteps(steps);
            run.boards = runBoards(run.changes, ctx.store.screensDir);
            const rel = (p) => toPosix(path.relative(ctx.store.screensDir, p));
            const changed = [...new Set(steps.flatMap((s) => s.changes.map((c) => c.path)).filter((p) => p.endsWith(".html") && !rel(p).startsWith("..")).map(rel))];
            return { changed, step: steps.length > 0, boards: run.boards };
          };
          emit({ kind: "start", agent, prompt, variants: body.variants?.files });
          const st = {};
          let buf = "";
          // A custom command's output is shown as plain text, line by line
          const parse = (line) => (custom ? [{ kind: "plain", text: line.replace(/\r$/, "") }] : parseLine(agent, line, st));
          proc.stdout.on("data", (d) => {
            buf += d;
            let i;
            while ((i = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, i);
              buf = buf.slice(i + 1);
              for (const ev of parse(line)) emit(ev);
            }
          });
          let err = "";
          proc.stderr.on("data", (d) => (err += d).length > 4000 && (err = err.slice(-4000)));
          proc.on("error", async (e) => {
            run.status = "error";
            fail({ enoent: e.code === "ENOENT", message: e.message });
            emit({ kind: "end", status: "error", ...(await finish()) });
          });
          proc.on("close", async (code, signal) => {
            if (run.status === "error") return;
            if (buf.trim()) for (const ev of parse(buf)) emit(ev);
            run.status = run.cancelled ? "cancelled" : code === 0 ? "done" : "error";
            if (run.status === "error") fail({ code, signal });
            emit({ kind: "end", status: run.status, ...(await finish()) });
          });
          sendJson(res, 200, { id, variants: body.variants?.files ?? [] });
        },
      ],
      [
        "POST",
        "/api/chat/cancel",
        async (req, res) => {
          const { id } = await readBody(req);
          const run = runs.get(id);
          if (!run || run.status !== "running") return sendJson(res, 404, { error: "Not running" });
          run.cancelled = true;
          denyOpen(id);
          try {
            if (process.platform === "win32") spawn("taskkill", ["/pid", String(run.proc.pid), "/T", "/F"], { windowsHide: true });
            else process.kill(-run.proc.pid, "SIGTERM"); // the whole process group
          } catch {
            run.proc.kill("SIGTERM");
          }
          sendJson(res, 200, { ok: true });
        },
      ],
      ["GET", "/api/chat", async (req, res, url) => sendJson(res, 200, { events: runs.get(url.searchParams.get("id"))?.events ?? [] })],
      // Claude Code asks (through bin/mcp.mjs --permission, header X-Easel-Run): a card in the chat, or an answer right away when
      // a remembered "Always allow" rule covers it. The MCP tool then polls GET until the user answers
      [
        "POST",
        "/api/chat/permission",
        async (req, res, url, ctx) => {
          const b = await readBody(req);
          const runId = requestScope.getStore()?.run;
          const run = runs.get(runId);
          if (!run || run.status !== "running" || run.agent !== "claude") return sendJson(res, 200, { behavior: "deny", message: "No Easel run is waiting for this request" });
          const tool = String(b.tool_name ?? "");
          const input = b.input && typeof b.input === "object" ? b.input : {};
          const p = perms.request(runId, tool, input);
          const rule = permissionRule(tool, input);
          run.emit({ kind: "permission", id: p.id, ...describePermission(tool, input, { root: rootOf(ctx.dir), dir: ctx.dir }), rule: rule?.label ?? null, ...(p.decision ? { decision: p.decision } : {}) });
          sendJson(res, 200, p.decision ? toolAnswer(p.decision, input) : { id: p.id, pending: true });
        },
      ],
      [
        "GET",
        "/api/chat/permission",
        async (req, res, url) => {
          const id = url.searchParams.get("id") ?? "";
          const d = await perms.wait(id, Math.min(25000, Number(url.searchParams.get("ms")) || 25000));
          sendJson(res, 200, d ? toolAnswer(d, perms.pending.get(id)?.input) : { id, pending: true });
        },
      ],
      [
        "POST",
        "/api/chat/permission/answer",
        async (req, res) => {
          if (!fromBrowser(req)) return sendJson(res, 403, { error: "Only the Easel page can answer a permission request" });
          const { id, decision } = await readBody(req);
          const p = perms.answer(id, decision);
          if (!p) return sendJson(res, 409, { error: "This request is no longer waiting" });
          runs.get(p.run)?.emit?.({ kind: "permission-answered", id: p.id, decision });
          sendJson(res, 200, { ok: true });
        },
      ],
      // Puts the tracked files back as they were before a run, as one undo step. Works from the disk copy, so also after a restart
      [
        "POST",
        "/api/chat/revert",
        async (req, res, url, ctx) => {
          const { id } = await readBody(req);
          if (runs.get(id)?.status === "running") return sendJson(res, 409, { error: "The run is still going; cancel it first" });
          const r = await revertRun(ctx, id);
          if (!r) return sendJson(res, 404, { error: "No copy of that run is left (only the newest 10 are kept)" });
          ctx.broadcast({ type: "board-changed", source: "server:revert" });
          ctx.broadcast({ type: "history-changed" });
          const rel = (p) => toPosix(path.relative(ctx.store.screensDir, p));
          sendJson(res, 200, { ok: true, label: `Revert ${r.meta.label ?? "AI"} run`, changed: r.changes.map((c) => c.path).filter((p) => p.endsWith(".html")).map(rel) });
        },
      ],
      // Undo this run: a plain undo when its step is the newest, else only its own files (409 with the boards changed since,
      // unless mode is "rest" or "all"). Either way one history step, so Cmd+Z brings it back
      [
        "POST",
        "/api/chat/undo-run",
        async (req, res, url, ctx) => {
          const { id, mode } = await readBody(req);
          const run = runs.get(id);
          if (!run || !run.changes) return sendJson(res, 404, { error: "This run's changes are no longer in the undo history" });
          if (run.status === "running") return sendJson(res, 409, { error: "The run is still going; cancel it first" });
          if (run.undone) return sendJson(res, 409, { error: "This run is already undone" });
          await ctx.history.observe();
          const steps = ctx.history.runSteps(id);
          const top = ctx.history.peek().undo;
          const onTop = top && ((steps.length === 1 && top === steps[0]) || top.redoOf === id) ? 1 : 0;
          const r = await undoChanges(ctx, { onTop, changes: run.changes, mode, label: `Undo ${run.label}`, mark: { undoOf: id } });
          if (r.conflicts) return sendJson(res, 409, { conflicts: r.conflicts, error: "Some boards changed since this run" });
          run.undone = true;
          await ctx.store.syncBoardNow();
          ctx.broadcast({ type: "board-changed", source: "server:undo-run" });
          ctx.broadcast({ type: "history-changed" });
          run.emit({ kind: "run-undo", undone: true });
          sendJson(res, 200, { ok: true, boards: run.boards.length });
        },
      ],
      [
        "POST",
        "/api/chat/redo-run",
        async (req, res, url, ctx) => {
          const { id, mode } = await readBody(req);
          const run = runs.get(id);
          if (!run?.undone || !run.changes) return sendJson(res, 409, { error: "This run is not undone" });
          await ctx.history.observe();
          const pk = ctx.history.peek();
          if (pk.redo?.run === id) await ctx.history.redo();
          else if (pk.undo?.undoOf === id) {
            await ctx.history.undo();
            await dropMissingAutoPlaced(ctx);
          } else {
            const r = await applyRunChanges(ctx, run.changes, "redo", { mode: ["rest", "all"].includes(mode) ? mode : undefined, label: `Redo ${run.label}`, mark: { redoOf: id } });
            if (r.conflicts) return sendJson(res, 409, { conflicts: r.conflicts, error: "Some boards changed since the undo" });
          }
          run.undone = false;
          await ctx.store.syncBoardNow(); // screens the run created are back: place them now (the watcher may see only a change)
          ctx.broadcast({ type: "board-changed", source: "server:redo-run" });
          ctx.broadcast({ type: "history-changed" });
          run.emit({ kind: "run-undo", undone: false });
          sendJson(res, 200, { ok: true, boards: run.boards.length });
        },
      ],
      // What the chat can still do for earlier runs: undo (this server's history) or restore the pre-run copy (saved time; null when pruned)
      [
        "GET",
        "/api/chat/runs",
        async (req, res, url, ctx) => {
          const ids = (url.searchParams.get("ids") ?? "").split(",").filter((x) => /^r[0-9a-z]+$/.test(x)).slice(0, 200);
          const out = {};
          for (const id of ids) {
            const run = runs.get(id);
            out[id] = { live: !!run?.changes, undone: !!run?.undone, status: run?.status ?? null, copy: await runCopyInfo(ctx.dir, id) };
          }
          sendJson(res, 200, { boot: ctx.boot, runs: out });
        },
      ],
      // Read-only: a screen as it was before a run (Compare's "before"), with a <base> so its assets resolve like the live screen
      [
        "GET",
        "/api/chat/run-file",
        async (req, res, url, ctx) => {
          const f = url.searchParams.get("f") ?? "";
          const html = await readRunFile(ctx.dir, url.searchParams.get("id"), f);
          if (html == null) return sendJson(res, 404, { error: "No copy of that screen for this run" });
          const out = withBase(html, f.slice("screens/".length));
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(out), "Cache-Control": "no-store" });
          res.end(out);
        },
      ],
      // Readiness per agent plus the user's custom commands, checked on every call (the app asks when the AI tab opens and on Check again)
      [
        "GET",
        "/api/agents",
        async (req, res) => {
          const agents = await Promise.all(AGENTS.map(async (id) => ({ id, label: AGENT_LABEL[id], status: await agentStatus(id), install: INSTALL_URL[id] })));
          const custom = await Promise.all((await readCustom()).map(async (c) => ({ id: `custom:${c.id}`, label: c.name, command: c.command, custom: true, status: await customStatus(c.command) })));
          sendJson(res, 200, { agents: [...agents, ...custom].map((a) => ({ ...a, ok: a.status !== "missing" })), checkedAt: new Date().toISOString() });
        },
      ],
      // Custom commands are stored per user (EASEL_HOME), only from the app page
      [
        "POST",
        "/api/agents/custom",
        async (req, res) => {
          if (!fromBrowser(req)) return sendJson(res, 403, { error: "Custom commands can only be added from the Easel page" });
          const b = await readBody(req);
          if (b.action === "delete") {
            await removeCustom(String(b.id ?? "").replace(/^custom:/, ""));
            return sendJson(res, 200, { ok: true });
          }
          const r = await addCustom(b);
          if (r.error) return sendJson(res, 400, { error: r.error });
          sendJson(res, 200, { agent: { id: `custom:${r.agent.id}`, label: r.agent.name, command: r.agent.command, custom: true, status: await customStatus(r.agent.command), ok: true } });
        },
      ],
      // Upload references: stored in docs/design/.refs/ (kept out of the repo by .gitignore)
      [
        "POST",
        "/api/refs",
        async (req, res, url, ctx) => {
          const b = await readBody(req, 20 * 1024 * 1024);
          const name = String(b.name ?? "ref").replace(/[^\w.-]+/g, "_").slice(-80);
          const dir = path.join(ctx.dir, ".refs");
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(path.join(dir, ".gitignore"), "*\n").catch(() => {});
          const file = `${Date.now().toString(36)}-${name}`;
          await fs.writeFile(path.join(dir, file), Buffer.from(String(b.data ?? ""), "base64"));
          sendJson(res, 200, { value: `.refs/${file}`, kind: /\.(png|jpe?g|gif|webp)$/i.test(name) ? "image" : "file", name });
        },
      ],
      // Canvas state (mode, page, visible boards, selected boards, pending saves) and board errors
      [
        "PUT",
        "/api/context",
        async (req, res) => {
          state.context = { ...(await readBody(req)), at: new Date().toISOString() };
          sendJson(res, 200, { ok: true });
        },
      ],
      [
        "PUT",
        "/api/errors",
        async (req, res, url, ctx) => {
          const { file, errors } = await readBody(req);
          if (!file) return sendJson(res, 400, { error: "file is required" });
          if (errors?.length) state.errors[file] = errors.slice(0, 20);
          else delete state.errors[file];
          ctx.broadcast({ type: "errors-changed" });
          sendJson(res, 200, { ok: true });
        },
      ],
      ["GET", "/api/errors", async (req, res) => sendJson(res, 200, { errors: state.errors })],
    ],
  };
}
