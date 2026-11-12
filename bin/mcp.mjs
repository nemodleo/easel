#!/usr/bin/env node
// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// MCP server (stdio): exposes boards, selection, screenshots, comments and placement through the app server API (http://localhost:<port>). PLAN.md ch. 6.
// The agent creates and edits HTML by writing files directly. This server only observes, points at things, and places boards.
// With --permission it exposes a single tool instead: the permission prompt of an in-app chat run, answered in the Easel chat.
// No port needed: the canvas for the folder the agent runs in is found through the registry (server/registry.mjs) on each call.
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { agentLabel } from "../server/agents.mjs";
import { parseArgs, TOOL_ROOT } from "../server/args.mjs";
import { discoverPort } from "../server/registry.mjs";

const args = parseArgs();
const pkg = JSON.parse(readFileSync(path.join(TOOL_ROOT, "package.json"), "utf8"));
// --port wins; an in-app chat run passes the canvas it was started from
const explicit = args.portGiven ? args.port : Number(process.env.DESIGN_CANVAS_PORT) || null;
const IMAGE_LIMIT = 4 * 1024 * 1024;

let port = null;
const resolvePort = async (fresh = false) => (port = !fresh && port ? port : await discoverPort({ port: explicit }));

/** This MCP server's id at the canvas: the boards it writes are released when its client disconnects */
const CLIENT = `mcp-${process.pid.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
/** Header values for the app server: who made a change (undo history, comments), which in-app run it belongs to, and this client */
const agentHeaders = () => ({ "X-Easel-Agent": agent(), "X-Easel-Client": CLIENT, ...(process.env.EASEL_RUN_ID ? { "X-Easel-Run": process.env.EASEL_RUN_ID } : {}) });
const agent = () => agentLabel(server.server.getClientVersion()?.name);

async function call(method, path, body) {
  const send = async () =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { ...agentHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  let res;
  try {
    await resolvePort();
    res = await send();
  } catch (e) {
    if (e.message?.startsWith("Several Easel canvases")) throw e;
    // Nothing was sent: the canvas may have restarted on another port, or started after this server
    try {
      if (explicit) throw e;
      await resolvePort(true);
      res = await send();
    } catch (e2) {
      if (e2.message?.startsWith("Several Easel canvases")) throw e2;
      throw new Error(`Easel is not running for this project (tried http://localhost:${port}). Start it in the project with \`npx easel-canvas\` (add --dir <design folder> when the screens are not in ./docs/design or the current folder), then try again.`);
    }
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error ?? text;
    } catch {
      /* keep as is */
    }
    throw new Error(`${res.status} ${msg}`);
  }
  return text;
}
const callJson = async (m, p, b) => JSON.parse(await call(m, p, b));
const ok = (data) => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });

// --permission: started by an in-app Claude Code run (inline --mcp-config) for its permission prompts only, under its own name
const server = new McpServer({ name: args.permission ? "easel-chat" : "easel", version: pkg.version });
/** The canvas tools; none of them in --permission mode (the project's own easel server already has them) */
const tool = args.permission ? () => {} : (...a) => server.registerTool(...a);

if (args.permission)
  server.registerTool(
    "permission",
    {
      description: "Asks the user in the Easel chat whether a tool call may run (Claude Code --permission-prompt-tool). Returns allow or deny.",
      inputSchema: { tool_name: z.string(), input: z.record(z.string(), z.unknown()), tool_use_id: z.string().optional() },
    },
    async ({ tool_name, input, tool_use_id }) => {
      let answer;
      try {
        let r = await callJson("POST", "/api/chat/permission", { tool_name, input, tool_use_id });
        // The user may take a while: poll until the card is answered (or the run is cancelled, which denies it)
        while (r.pending) r = await callJson("GET", `/api/chat/permission?id=${encodeURIComponent(r.id)}`);
        answer = r.behavior === "allow" ? { behavior: "allow", updatedInput: r.updatedInput ?? input } : { behavior: "deny", message: String(r.message ?? "Denied") };
      } catch (e) {
        answer = { behavior: "deny", message: `Easel could not ask the user: ${e.message}` };
      }
      return { content: [{ type: "text", text: JSON.stringify(answer) }] };
    },
  );

tool(
  "list_boards",
  {
    description:
      "List the boards on the design canvas (each board is an .html file in the screens folder, returned as dir) with file, title, size, position and page, who is editing it right now (editing), and origin for a variant or fork of another board. Use it to find which file to read or edit.",
    inputSchema: { page: z.string().optional().describe("Only return boards on this page id") },
  },
  async ({ page }) => {
    const { board, missing, screens } = await callJson("GET", "/api/board");
    const occ = (await callJson("GET", "/api/boards/occupancy").catch(() => null))?.boards ?? {};
    const first = board.pages[0]?.id;
    const editing = (f) => (occ[f] ?? []).filter((h) => h.state === "editing").map((h) => h.by ?? h.person ?? "someone");
    const rows = board.order
      .filter((f) => board.boards[f])
      .map((f) => ({ file: f, ...board.boards[f], page: board.boards[f].page ?? first, ...(editing(f).length ? { editing: editing(f) } : {}) }))
      .filter((b) => !page || b.page === page);
    return ok({ dir: screens ?? "screens", pages: board.pages, boards: rows, missingFiles: missing });
  },
);

tool(
  "read_board",
  { description: "Read a board's source HTML exactly as stored in the file. Use it before editing a board.", inputSchema: { file: z.string().describe("Board file name, e.g. scr-01.html") } },
  async ({ file }) => ok(await call("GET", `/api/file?f=${encodeURIComponent(file)}`)),
);

tool(
  "claim_board",
  {
    description:
      "Call before you edit a board's file with your own file tools, so people and other agents see you are editing it. Returns the file to edit: the board itself, or, when another agent is editing that board right now, a fork next to it (a copy) so you do not overwrite each other. Edit the returned file. Reading never needs this.",
    inputSchema: { file: z.string().describe("Board file name, e.g. scr-01.html") },
  },
  async ({ file }) => ok(await callJson("POST", "/api/boards/claim", { file })),
);

tool(
  "write_board",
  {
    description:
      "Write a board's whole HTML through Easel (instead of writing the file yourself). If another agent is editing that board right now, your version goes to a fork next to it, and the reply says which file you are on; keep writing to that file.",
    inputSchema: { file: z.string().describe("Board file name, e.g. scr-01.html"), html: z.string().describe("The complete HTML of the board") },
  },
  async ({ file, html }) => ok(await callJson("POST", "/api/boards/write", { file, html })),
);

tool(
  "get_selection",
  {
    description:
      "What the user is looking at right now: selection (the element the user clicked on a board: file, path as element indexes from the children of <body>, tag, kind and label, text, source outerHTML up to 4KB, hash, computed styles), mode (canvas, edit = an element is selected, focus, play), page and pageName, visibleArtboards (boards visible on screen), selectedArtboards, dirty (pending saves), edits (recent edit history), erroredArtboards and firstError (boards with errors). Use it for requests like 'fix the selected element' or 'this screen'.",
    inputSchema: {},
  },
  async () => {
    return ok(await callJson("GET", "/api/selection"));
  },
);

tool(
  "screenshot",
  {
    description:
      "Take a PNG screenshot of a board, or of an element inside it, and return the image (plus the path it was saved to, in the design folder's .easel/screenshots/). Use it to check how a change looks (requires playwright).",
    inputSchema: { file: z.string(), path: z.string().optional().describe("Element path, e.g. 0/2/1; omit for the whole board") },
  },
  async ({ file, path: elPath }) => {
    const r = await callJson("POST", "/api/screenshot", { file, path: elPath });
    const png = await fs.readFile(r.path).catch(() => null);
    const where = `Saved to ${r.relPath ?? r.path}`;
    if (!png) return ok(where);
    if (png.length > IMAGE_LIMIT) return ok(`${where} (${(png.length / 1048576).toFixed(1)} MB, too large to return inline; open the file or screenshot an element by path)`);
    return { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }, { type: "text", text: where }] };
  },
);

tool(
  "list_comments",
  {
    description: "List board comments (docs/design/comments.json), optionally for one file or only unresolved ones.",
    inputSchema: { file: z.string().optional(), unresolved: z.boolean().optional() },
  },
  async ({ file, unresolved }) => {
    const q = new URLSearchParams();
    if (file) q.set("file", file);
    if (unresolved) q.set("unresolved", "1");
    return ok(await callJson("GET", `/api/comments?${q}`));
  },
);

tool(
  "add_comment",
  {
    description: "Add a comment to a board, or to an element inside it when path is given.",
    inputSchema: { file: z.string(), path: z.string().optional(), text: z.string(), author: z.string().optional() },
  },
  async (args) => ok(await callJson("POST", "/api/comments", { ...args, author: args.author ?? agent() })),
);

tool(
  "resolve_comment",
  { description: "Mark a comment as resolved (pass resolved=false to reopen it). Use it after fixing what a comment asked for.", inputSchema: { id: z.string(), resolved: z.boolean().optional() } },
  async ({ id, resolved }) => ok(await callJson("POST", "/api/comments", { action: "resolve", id, resolved: resolved ?? true })),
);

tool(
  "place_board",
  {
    description: "Record a board's canvas position, title and page in board.json. Use it after creating a new screen to set its name and position.",
    inputSchema: {
      file: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      title: z.string().optional(),
      page: z.string().optional(),
    },
  },
  async (args) => ok(await callJson("POST", "/api/place", args)),
);

tool(
  "list_errors",
  { description: "List boards with errors (script errors, images that failed to load, missing files) and the first error. Use it to check your edits did not break a board.", inputSchema: {} },
  async () => {
    const s = await callJson("GET", "/api/selection");
    const { errors } = await callJson("GET", "/api/errors");
    return ok({ erroredArtboards: s.erroredArtboards, firstError: s.firstError, errors });
  },
);

tool(
  "create_board",
  {
    description: "Create a new board (HTML file) from a template and place it on the canvas. Templates: blank (Blank), mobile (390×844 Mobile screen), desktop (1440×900 Desktop screen), doc (Document). Edit the created file directly afterwards.",
    inputSchema: {
      file: z.string().optional().describe("File name, e.g. scr-40.html; generated if omitted"),
      title: z.string().optional(),
      template: z.enum(["blank", "mobile", "desktop", "doc"]).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional(),
      h: z.number().optional(),
      page: z.string().optional(),
    },
  },
  async (args) => ok(await callJson("POST", "/api/boards/create", args)),
);

tool(
  "list_notes",
  { description: "List canvas notes (titles and sticky notes), optionally for one page.", inputSchema: { page: z.string().optional() } },
  async ({ page }) => {
    const { board } = await callJson("GET", "/api/board");
    const first = board.pages[0]?.id;
    return ok(Object.entries(board.notes).map(([id, n]) => ({ id, ...n, page: n.page ?? first })).filter((n) => !page || n.page === page));
  },
);

tool(
  "add_note",
  {
    description: "Add a note to the canvas. kind=title (large heading) or sticky (sticky note).",
    inputSchema: { kind: z.enum(["title", "sticky"]), text: z.string(), x: z.number(), y: z.number(), w: z.number().optional(), page: z.string().optional() },
  },
  async (args) => ok(await callJson("POST", "/api/notes", { action: "add", ...args })),
);

tool(
  "update_note",
  {
    description: "Edit a note (text, position, width, page, color, size, bold, italic).",
    inputSchema: {
      id: z.string(),
      text: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional(),
      page: z.string().optional(),
      color: z.string().optional(),
      size: z.number().optional(),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
    },
  },
  async (args) => ok(await callJson("POST", "/api/notes", { action: "update", ...args })),
);

tool(
  "delete_note",
  { description: "Delete a note (the user can undo it in the app).", inputSchema: { id: z.string() } },
  async ({ id }) => ok(await callJson("POST", "/api/notes", { action: "delete", id })),
);

tool(
  "list_pages",
  { description: "List canvas pages (the first page is the default).", inputSchema: {} },
  async () => ok((await callJson("GET", "/api/board")).board.pages),
);

tool(
  "manage_page",
  {
    description: "Manage pages: add (name), rename (id, name), delete (id; its items move to the first page), move (id, index).",
    inputSchema: { action: z.enum(["add", "rename", "delete", "move"]), id: z.string().optional(), name: z.string().optional(), index: z.number().optional() },
  },
  async (args) => ok(await callJson("POST", "/api/pages", args)),
);

tool(
  "get_tokens",
  {
    description:
      "Get the design tokens (colors per theme, font sizes, weights, radii, spacing, fonts, minimum tap target) from tokens.json. Use only these values when creating or editing screens. If the project has no tokens.json it returns registered: false and no values; then keep to the styles already in the file.",
    inputSchema: {},
  },
  async () => ok(await callJson("GET", "/api/tokens?agent=1")),
);

tool(
  "check_tokens",
  {
    description:
      "Find off-token values in screen HTML (colors, font sizes, weights, radii, spacing not a multiple of 4). Use it to verify your edits. Omit file to check all screens. If the project has no tokens.json it returns registered: false and no violations (nothing to check against).",
    inputSchema: { file: z.string().optional() },
  },
  async ({ file }) => ok(await callJson("GET", `/api/lint${file ? `?f=${encodeURIComponent(file)}` : ""}`)),
);

tool(
  "reply_comment",
  { description: "Reply to a comment (resolve=true replies and marks it resolved).", inputSchema: { id: z.string(), text: z.string(), resolve: z.boolean().optional(), author: z.string().optional() } },
  async (args) => ok(await callJson("POST", "/api/comments", { action: "reply", ...args, author: args.author ?? agent() })),
);

tool(
  "save_snapshot",
  {
    description: "Save a snapshot (a saved version): commits only the design folder to git, or outside a git repository copies it to .easel/snapshots/. Use only when the user explicitly asks to save.",
    inputSchema: { message: z.string().optional() },
  },
  async ({ message }) => ok(await callJson("POST", "/api/snapshot", { message })),
);

await server.connect(new StdioServerTransport());

// The client went away (stdin closed, or we are told to stop): the boards this client was editing are released, then exit
let leaving = false;
const leave = async () => {
  if (leaving) return;
  leaving = true;
  if (!args.permission && port)
    await fetch(`http://127.0.0.1:${port}/api/boards/release`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: CLIENT }), signal: AbortSignal.timeout(1000) }).catch(() => {});
  process.exit(0);
};
process.stdin.on("end", leave);
process.stdin.on("close", leave);
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, leave);
