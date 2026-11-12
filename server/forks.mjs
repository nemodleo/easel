// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// One writer per board: a second agent writing a board another agent is editing gets a fork next to it, and its later writes to the
// original go there while the fork exists. Forks and the chat's variants record where they came from in board.json (origin), and
// "Use this" makes one version the board (file name, title, position and comments stay) and moves the others to trash in one step.
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { cleanAgent } from "./agents.mjs";
import { commitBoard, trashFiles, uniqueName, unlinkOrigins } from "./boards.mjs";
import { isTrackedRel } from "./copies.mjs";
import { rootOf, toPosix, writeAtomic } from "./fsutil.mjs";
import { requestScope } from "./history.mjs";
import { readBody, safeJoin, sendJson } from "./index.mjs";
import { besideSpot } from "./place.mjs";

const read = (p) => fs.readFile(p, "utf8").catch(() => null);
/** A board name a request may use: an .html under screens/, no dot segments */
export const boardFile = (f) => typeof f === "string" && isTrackedRel(`screens/${f}`);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "agent";

/** The fork an agent already has of a board, while its file exists */
export function forkOf(board, file, by, exists = () => true) {
  return Object.entries(board.boards).find(([f, b]) => b.origin?.kind === "fork" && b.origin.of === file && b.origin.by === by && exists(f))?.[0] ?? null;
}

/**
 * Where a write to file goes: { action: "write" } to the board itself, { action: "redirect", file } to the writer's own fork, or
 * { action: "fork", while } when another agent is editing it (holders: agents editing file now). People (no by) are never forked
 */
export function decideWrite({ board, file, by, holders = [], exists = () => true }) {
  if (!by) return { action: "write", file };
  const fork = forkOf(board, file, by, exists);
  if (fork) return { action: "redirect", file: fork };
  const other = holders.find((h) => h.by !== by);
  return other ? { action: "fork", while: other.by } : { action: "write", file };
}

/**
 * The versions "Use this" chooses between: a variant or fork and the others made from the same board, or a board with forks.
 * { original, kind: "variant" | "fork", chosen, alts: the variants or forks (chosen included when it is one) } or null
 */
export function choiceGroup(board, file) {
  const it = board.boards[file];
  if (!it) return null;
  const linked = (o, kind) => Object.keys(board.boards).filter((f) => f !== o && board.boards[f].origin?.of === o && board.boards[f].origin.kind === kind);
  if (it.origin?.of && board.boards[it.origin.of]) return { original: it.origin.of, kind: it.origin.kind, chosen: file, alts: linked(it.origin.of, it.origin.kind) };
  const alts = linked(file, "fork");
  return alts.length ? { original: file, kind: "fork", chosen: file, alts } : null;
}

/** Creates the fork of file for agent by (html: its first content) beside the original, as one history step; returns its file name */
export async function createFork(ctx, file, { by, whileBy, html }) {
  const { board } = await ctx.store.syncBoardNow();
  const { origin, autoPlaced, x, y, title, ...o } = board.boards[file] ?? { x: 0, y: 0, w: 390, h: 844 };
  const stem = file.replace(/\.html$/, "");
  const name = await uniqueName(ctx.store.screensDir, `${stem}-${slug(by)}.html`);
  const p = safeJoin(ctx.store.screensDir, name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await writeAtomic(p, html);
  const at = besideSpot(board, { ...o, x, y });
  await commitBoard(
    ctx,
    `Fork ${file} for ${by}`,
    (b) => {
      b.boards[name] = { ...o, x: at.x, y: at.y, title: `${title ?? path.posix.basename(stem)} · ${by}`, origin: { kind: "fork", of: file, by, while: whileBy, at: new Date().toISOString() } };
      const i = b.order.indexOf(file);
      b.order = b.order.filter((f) => f !== name);
      b.order.splice(i < 0 ? b.order.length : i + 1, 0, name);
    },
    [{ path: p, before: null, after: html }],
  );
  return name;
}

/**
 * Where the calling agent's write to file goes (making its fork when another agent is editing the board). html: the content to
 * start a new fork with (default: the board as it was when the other writer started). → { file, forked, created, while }
 */
export async function routeWrite(ctx, file, html = null) {
  const by = requestScope.getStore()?.agent ?? null;
  const board = await ctx.store.readBoard();
  const d = decideWrite({ board, file, by, holders: ctx.occupancy?.agentsOn(file) ?? [], exists: (f) => existsSync(path.join(ctx.store.screensDir, f)) });
  if (d.action === "fork") {
    const start = html ?? ctx.occupancy.base(file) ?? (await read(safeJoin(ctx.store.screensDir, file))) ?? "";
    return { file: await createFork(ctx, file, { by, whileBy: d.while, html: start }), forked: true, created: true, while: d.while };
  }
  if (d.action === "redirect") return { file: d.file, forked: true, created: false, while: board.boards[d.file]?.origin?.while ?? null };
  return { file, forked: false, created: false, while: null };
}

/** What the agent is told: plainly which file it is on now */
export function forkMessage(ctx, original, r, { claim = false } = {}) {
  const dir = toPosix(path.relative(rootOf(ctx.dir), ctx.store.screensDir)) || "screens";
  if (!r.forked) return claim ? `You are editing ${dir}/${original} now. Edit it with your own file tools; another agent that writes it meanwhile gets a fork.` : `Wrote ${dir}/${original}.`;
  const why = r.while ? `${r.while} ${r.created ? "is" : "was"} editing ${original}` : `${original} has a fork of yours`;
  const what = r.created ? (claim ? `a fork was made for you: ${dir}/${r.file} (a copy of the board as it was when ${r.while} started)` : `your change went to a fork next to it: ${dir}/${r.file}`) : `you are working on your fork ${dir}/${r.file}`;
  return `${why}, so ${what}. Keep working on ${r.file}, not ${original}; your later writes to ${original} go to the fork too. The person picks one version later.`;
}

export function forkRoutes() {
  return [
    // Who is on which board (also sent over the WebSocket as "occupancy" events)
    ["GET", "/api/boards/occupancy", async (req, res, url, ctx) => sendJson(res, 200, { boards: ctx.occupancy.snapshot() })],
    // An agent writes a whole board through Easel: it holds the board, or works on a fork when another agent is editing it
    [
      "POST",
      "/api/boards/write",
      async (req, res, url, ctx) => {
        const b = await readBody(req);
        if (!boardFile(b.file) || typeof b.html !== "string") return sendJson(res, 400, { error: "file (a board .html in the screens folder) and html are required" });
        const r = await routeWrite(ctx, b.file, b.html);
        if (!r.created) {
          const p = safeJoin(ctx.store.screensDir, r.file);
          const before = await read(p);
          if (before !== b.html) {
            await fs.mkdir(path.dirname(p), { recursive: true });
            await writeAtomic(p, b.html);
            ctx.history.push(`Write board ${r.file}`, [{ path: p, before, after: b.html }]);
            ctx.broadcast({ type: "history-changed" });
            if (before == null) {
              await ctx.store.syncBoardNow();
              ctx.broadcast({ type: "board-changed", source: "server:write" });
            }
          } else holdForCaller(ctx, r.file, before);
        }
        sendJson(res, 200, { file: r.file, forked: r.forked, ...(r.forked ? { original: b.file } : {}), message: forkMessage(ctx, b.file, r) });
      },
    ],
    // An agent is about to edit a board with its own file tools: which file to edit (the board, or its fork when another agent is on it)
    [
      "POST",
      "/api/boards/claim",
      async (req, res, url, ctx) => {
        const b = await readBody(req);
        if (!boardFile(b.file)) return sendJson(res, 400, { error: "file (a board .html in the screens folder) is required" });
        const now = await read(safeJoin(ctx.store.screensDir, b.file));
        if (now == null) return sendJson(res, 404, { error: "File not found" });
        const r = await routeWrite(ctx, b.file);
        if (!r.created) holdForCaller(ctx, r.file, r.file === b.file ? now : await read(safeJoin(ctx.store.screensDir, r.file)));
        sendJson(res, 200, { file: r.file, forked: r.forked, ...(r.forked ? { original: b.file } : {}), message: forkMessage(ctx, b.file, r, { claim: true }) });
      },
    ],
    // An MCP server's client disconnected: the boards it kept busy are done
    [
      "POST",
      "/api/boards/release",
      async (req, res, url, ctx) => {
        const client = cleanAgent((await readBody(req)).client);
        if (client) ctx.occupancy.clientGone(client);
        sendJson(res, 200, { ok: true });
      },
    ],
    // Use this (one): the chosen version becomes the original board and the others go to trash, as one history step
    [
      "POST",
      "/api/boards/use",
      async (req, res, url, ctx) => {
        const b = await readBody(req);
        const board = await ctx.store.readBoard();
        const g = boardFile(b.file) ? choiceGroup(board, b.file) : null;
        if (!g) return sendJson(res, 400, { error: "That board is not a variant or fork of another board" });
        const busy = [g.original, ...g.alts].flatMap((f) => ctx.occupancy.agentsOn(f).map((h) => ({ file: f, by: h.by })));
        if (busy.length) return sendJson(res, 409, { error: `${busy[0].by} is still editing ${board.boards[busy[0].file]?.title ?? busy[0].file}`, busy });
        const changes = [];
        if (g.chosen !== g.original) {
          const src = await read(safeJoin(ctx.store.screensDir, g.chosen));
          if (src == null) return sendJson(res, 404, { error: "File not found" });
          const op = safeJoin(ctx.store.screensDir, g.original);
          const before = await read(op);
          if (before !== src) {
            await writeAtomic(op, src);
            changes.push({ path: op, before, after: src });
          }
        }
        const gone = await trashFiles(ctx, g.alts);
        const label = g.chosen === g.original ? `Keep ${g.original}, trash ${g.alts.join(", ")}` : `Use ${g.chosen} for ${g.original}`;
        await commitBoard(
          ctx,
          label,
          (bd) => {
            for (const f of g.alts) delete bd.boards[f];
            bd.order = bd.order.filter((f) => !g.alts.includes(f));
            unlinkOrigins(bd, g.alts);
          },
          [...changes, ...gone.changes],
        );
        for (const f of g.alts) ctx.occupancy.forget(f);
        sendJson(res, 200, { ok: true, kind: g.kind, original: g.original, chosen: g.chosen, trashed: g.alts, step: ctx.history.peek().undo?.id ?? null });
      },
    ],
    // Keep all: the variants (or forks) stay as ordinary boards; only the link to the original goes
    [
      "POST",
      "/api/boards/keep",
      async (req, res, url, ctx) => {
        const b = await readBody(req);
        const board = await ctx.store.readBoard();
        const g = boardFile(b.file) ? choiceGroup(board, b.file) : null;
        if (!g) return sendJson(res, 400, { error: "That board is not a variant or fork of another board" });
        await commitBoard(ctx, `Keep all ${g.kind === "variant" ? "variants" : "versions"} of ${g.original}`, (bd) => {
          for (const f of g.alts) if (bd.boards[f]) delete bd.boards[f].origin;
        });
        sendJson(res, 200, { ok: true, kind: g.kind, original: g.original, kept: g.alts, step: ctx.history.peek().undo?.id ?? null });
      },
    ],
  ];
}

/** The calling agent holds file (a claim, or a write that changed nothing); people hold boards through Edit mode instead */
function holdForCaller(ctx, file, before) {
  const s = requestScope.getStore();
  if (s?.agent) ctx.occupancy.agentWrite(file, s.agent, { run: s.run && ctx.history.running(s.run) ? s.run : undefined, client: s.client, before });
}
