// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// In-canvas chat: spawns claude -p / codex exec and turns their output (JSONL) into uniform events streamed over WS.
// Attaches the selection, visible boards, comments, references and errors as context; for "N variants" it first creates copies side by side.
// Each run copies the tracked files to .easel/runs/<id>/ first (POST /api/chat/revert), and everything it changes becomes one undo step.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { createBoards } from "./boards.mjs";
import { copyRun, revertRun } from "./copies.mjs";
import { rootOf, toPosix } from "./fsutil.mjs";
import { readBody, sendJson } from "./index.mjs";
import { NO_TOKENS_NOTE, readTokens } from "./tokens.mjs";

export const AGENT_LABEL = { claude: "Claude Code", codex: "Codex" };
const LOGIN_CMD = { claude: "claude auth login", codex: "codex login" };
const fakeAgents = () => (process.env.DESIGN_CANVAS_AGENT_CMD ? JSON.parse(process.env.DESIGN_CANVAS_AGENT_CMD) : {});

/** Model names passed to --model / -m: aliases or full ids only (they reach a shell on Windows) */
export const validModel = (m) => (typeof m === "string" && /^[\w.:/[\]-]{1,100}$/.test(m.trim()) ? m.trim() : "");

/** Agent launch command. Tests override it with DESIGN_CANVAS_AGENT_CMD='{"claude":["node","fake.mjs"]}' */
export function agentCommand(agent, { prompt, resume, root, images = [], model = "" }) {
  const override = fakeAgents()[agent];
  if (override) return { cmd: override[0], args: [...override.slice(1), prompt] };
  if (agent === "codex") {
    const common = ["--json", "--skip-git-repo-check", "-s", "workspace-write", ...(model ? ["-m", model] : []), ...images.flatMap((i) => ["-i", i])];
    return resume ? { cmd: "codex", args: ["exec", "resume", resume, ...common, prompt] } : { cmd: "codex", args: ["exec", ...common, "-C", root, prompt] };
  }
  return {
    cmd: "claude",
    args: ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", "acceptEdits", "--allowedTools", "mcp__easel", "mcp__design-canvas", ...(model ? ["--model", model] : []), ...(resume ? ["--resume", resume] : [])],
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

/** Output of `claude auth status` / `codex login status` → ready | signin | unknown */
export function readiness(agent, r) {
  if (!r) return "unknown";
  if (agent === "codex") return r.code === 0 && /Logged in/.test(r.out) ? "ready" : "signin";
  try {
    const j = JSON.parse(r.out.slice(r.out.indexOf("{"), r.out.lastIndexOf("}") + 1));
    return j.loggedIn === true ? "ready" : j.loggedIn === false ? "signin" : "unknown";
  } catch {
    return "unknown";
  }
}

const which = (c) => new Promise((r) => spawn(process.platform === "win32" ? "where" : "which", [c], { windowsHide: true }).on("close", (code) => r(code === 0)).on("error", () => r(false)));

/** Whether an agent can run now: missing (not on PATH), signin, ready, unknown (status check failed or timed out) */
export async function agentStatus(agent) {
  if (fakeAgents()[agent]) return "ready";
  if (!(await which(agent))) return "missing";
  return readiness(agent, await runQuick(agent, agent === "codex" ? ["login", "status"] : ["auth", "status"]));
}

/** Known causes of a failed run → { cause, text }: one plain sentence with the next step. The raw output goes under Details */
export function classifyFailure({ agent, cmd = agent, text = "", code = null, signal = null, enoent = false, model = "" }) {
  const label = AGENT_LABEL[agent] ?? agent;
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
const READ_ONLY = /^(Read|Glob|Grep|LS|WebFetch|WebSearch|TodoWrite|Task|ToolSearch)$|(^|__)(list_|read_|get_|check_|screenshot)/;

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
      if (c.type === "tool_use") out.push({ kind: "tool", name: c.name, detail: short(c.input?.file_path ?? c.input?.path ?? c.input) });
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

/** y of the first row below the original where n variants do not overlap other boards */
function freeRowY(board, b, n) {
  const w = (b.w + 80) * n;
  let y = b.y + b.h + 160;
  for (let k = 0; k < 200; k++) {
    const hit = Object.values(board.boards).filter((o) => o.x < b.x + w && o.x + o.w > b.x && o.y < y + b.h + 160 && o.y + o.h > y - 80);
    if (!hit.length) return y;
    y = Math.max(...hit.map((o) => o.y + o.h)) + 160;
  }
  return y;
}

const readJson = (p, d) => fs.readFile(p, "utf8").then(JSON.parse, () => d);

export function chatRoutes({ getSelection } = {}) {
  const runs = new Map(); // id → { proc, agent, events, status }
  const state = { selection: null, context: null, errors: {} };

  return {
    state,
    routes: [
      [
        "POST",
        "/api/chat",
        async (req, res, url, ctx) => {
          const body = await readBody(req);
          const agent = body.agent === "codex" ? "codex" : "claude";
          if (!String(body.text ?? "").trim()) return sendJson(res, 400, { error: "Please enter a message" });
          state.selection = getSelection?.() ?? null;
          let id = `r${Date.now().toString(36)}`;
          while (runs.has(id)) id = `r${(parseInt(id.slice(1), 36) + 1).toString(36)}`;
          const label = AGENT_LABEL[agent];
          // Pre-run copy on disk (before variant copies too): revertable even after a restart, no git needed
          await ctx.store.exclusive(() => copyRun(ctx, id, { agent, label, request: String(body.text).slice(0, 200) })).catch((e) => console.error("run copy failed", e));
          // N variants: create copies of the original side by side to the right
          const n = Math.min(4, Math.max(0, Number(body.variants) || 0));
          if (n > 1) {
            const base = body.attach?.boards?.[0] ?? state.selection?.file;
            if (!base) return sendJson(res, 400, { error: "Select one board to make variants of" });
            const html = await fs.readFile(path.join(ctx.store.screensDir, base), "utf8");
            const { board } = await ctx.store.syncBoard();
            const b = board.boards[base] ?? { x: 0, y: 0, w: 390, h: 844 };
            const stem = base.replace(/\.html$/, "");
            const files = await ctx.store.exclusive(() =>
              createBoards(
                ctx,
                Array.from({ length: n }, (_, i) => ({ file: `${stem}-v${i + 1}.html`, html, x: b.x + (b.w + 80) * i, y: freeRowY(board, b, n), w: b.w, h: b.h, title: `${b.title ?? stem} variant ${i + 1}`, page: b.page })),
                `Create ${n} variants ${base}`,
              ),
            );
            body.variants = { base, files };
            body.attach = { ...body.attach, boards: [base, ...files] };
          } else body.variants = undefined;
          const prompt = await buildPrompt(ctx, body, state);
          const images = (body.attach?.refs ?? []).filter((r) => r.kind === "image").map((r) => path.join(ctx.dir, r.value));
          const model = validModel(body.model);
          const { cmd, args } = agentCommand(agent, { prompt, resume: body.resume, root: rootOf(ctx.dir), images, model });
          const request = String(body.text).trim().replace(/\s+/g, " ");
          ctx.history.beginRun({ id, label: `${label}: ${request.length > 40 ? request.slice(0, 40) + "…" : request}`, by: label });
          let proc;
          try {
            // Windows: claude/codex are .cmd wrappers so a shell is needed, and there is no process-group kill so detached is not used
            const win = process.platform === "win32";
            proc = spawn(cmd, win ? args.map(winQuote) : args, { cwd: rootOf(ctx.dir), stdio: ["ignore", "pipe", "pipe"], detached: !win, shell: win, windowsHide: true, env: { ...process.env, DESIGN_CANVAS_PORT: String(req.socket.localPort), EASEL_RUN_ID: id } });
          } catch (e) {
            ctx.history.endRun(id);
            return sendJson(res, 500, { error: `Could not run ${cmd}: ${e.message}` });
          }
          const run = { proc, agent, events: [], status: "running", prompt };
          runs.set(id, run);
          // Show tool paths relative to the project (agents report absolute, sometimes symlink-resolved, paths)
          const roots = [rootOf(ctx.dir), await fs.realpath(rootOf(ctx.dir)).catch(() => null)].filter(Boolean).map((r) => r + path.sep).sort((a, b) => b.length - a.length); // longest first: /private/var/… before /var/…
          // What a failure is classified from, and shown under Details: error events, non-JSON output, stderr (never the prompt)
          const seen = [];
          const emit = (ev) => {
            if (typeof ev.detail === "string") for (const r of roots) ev.detail = ev.detail.split(r).join("");
            if (ev.kind === "tool" && !READ_ONLY.test(ev.name)) run.changed = true;
            if ((ev.kind === "error" && !ev.cause) || ev.kind === "log") seen.push(ev.text);
            run.events.push(ev);
            ctx.broadcast({ type: "chat", id, ev });
          };
          const fail = ({ code = null, signal = null, enoent = false, message = "" }) => {
            const all = [...seen, err, message].join("\n").trim();
            const c = classifyFailure({ agent, cmd, text: all, code, signal, enoent, model });
            const shown = `$ ${cmd} ${args.filter((a) => a !== prompt).join(" ")}`.trim();
            const raw = [shown, ...all.split("\n").slice(-20), code != null || signal ? `Exit code ${code ?? signal}` : ""].filter(Boolean).join("\n");
            emit({ kind: "error", text: c.text, cause: c.cause, raw, changed: !!run.changed });
          };
          // At the end: diff the tracked files now (watcher events may still be pending), so the run's undo step is complete before `end`
          const finish = async () => {
            const steps = await ctx.store
              .exclusive(async () => {
                await ctx.history.observe().catch((e) => console.error("run diff failed", e));
                ctx.history.endRun(id);
                return ctx.history.runSteps(id);
              })
              .catch(() => []);
            if (steps.length) ctx.broadcast({ type: "history-changed" });
            const rel = (p) => toPosix(path.relative(ctx.store.screensDir, p));
            const changed = [...new Set(steps.flatMap((s) => s.changes.map((c) => c.path)).filter((p) => p.endsWith(".html") && !rel(p).startsWith("..")).map(rel))];
            return { changed, step: steps.length > 0 };
          };
          emit({ kind: "start", agent, prompt, variants: body.variants?.files });
          const st = {};
          let buf = "";
          proc.stdout.on("data", (d) => {
            buf += d;
            let i;
            while ((i = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, i);
              buf = buf.slice(i + 1);
              for (const ev of parseLine(agent, line, st)) emit(ev);
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
            if (buf.trim()) for (const ev of parseLine(agent, buf, st)) emit(ev);
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
      // Readiness per agent, checked on every call (the app asks when the AI tab opens and on Check again)
      [
        "GET",
        "/api/agents",
        async (req, res) => {
          const agents = await Promise.all(["claude", "codex"].map(async (id) => ({ id, label: AGENT_LABEL[id], status: await agentStatus(id) })));
          sendJson(res, 200, { agents: agents.map((a) => ({ ...a, ok: a.status !== "missing" })) });
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
