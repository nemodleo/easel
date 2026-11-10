#!/usr/bin/env node
// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// MCP server (stdio): exposes boards, selection, screenshots, comments and placement through the app server API (http://localhost:<port>). PLAN.md ch. 6.
// The agent creates and edits HTML by writing files directly. This server only observes, points at things, and places boards.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { parseArgs } from "../server/args.mjs";

const { port } = parseArgs();
const BASE = `http://127.0.0.1:${port}`;

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Easel is not running. Start it with npm run design from the repo root (${BASE}).`);
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

const server = new McpServer({ name: "easel", version: "0.1.0" });

server.registerTool(
  "list_boards",
  {
    description: "List the boards on the design canvas (each board is a docs/design/screens/*.html file) with file, title, size, position and page. Use it to find which file to read or edit.",
    inputSchema: { page: z.string().optional().describe("Only return boards on this page id") },
  },
  async ({ page }) => {
    const { board, missing } = await callJson("GET", "/api/board");
    const first = board.pages[0]?.id;
    const rows = board.order
      .filter((f) => board.boards[f])
      .map((f) => ({ file: f, ...board.boards[f], page: board.boards[f].page ?? first }))
      .filter((b) => !page || b.page === page);
    return ok({ dir: "docs/design/screens", pages: board.pages, boards: rows, missingFiles: missing });
  },
);

server.registerTool(
  "read_board",
  { description: "Read a board's source HTML exactly as stored in the file. Use it before editing a board.", inputSchema: { file: z.string().describe("Board file name, e.g. scr-01.html") } },
  async ({ file }) => ok(await call("GET", `/api/file?f=${encodeURIComponent(file)}`)),
);

server.registerTool(
  "get_selection",
  {
    description:
      "What the user is looking at right now: selection (the element clicked in edit mode: file, path as element indexes from the children of <body>, tag, kind and label, text, source outerHTML up to 4KB, hash, computed styles), mode (canvas, edit, focus, play), page and pageName, visibleArtboards (boards visible on screen), selectedArtboards, dirty (pending saves), edits (recent edit history), erroredArtboards and firstError (boards with errors). Use it for requests like 'fix the selected element' or 'this screen'.",
    inputSchema: {},
  },
  async () => {
    return ok(await callJson("GET", "/api/selection"));
  },
);

server.registerTool(
  "screenshot",
  {
    description: "Take a PNG screenshot of a board, or of an element inside it, and return the image file path. Use it to check how a change looks (requires playwright).",
    inputSchema: { file: z.string(), path: z.string().optional().describe("Element path, e.g. 0/2/1; omit for the whole board") },
  },
  async ({ file, path }) => ok(await callJson("POST", "/api/screenshot", { file, path })),
);

server.registerTool(
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

server.registerTool(
  "add_comment",
  {
    description: "Add a comment to a board, or to an element inside it when path is given.",
    inputSchema: { file: z.string(), path: z.string().optional(), text: z.string(), author: z.string().optional() },
  },
  async (args) => ok(await callJson("POST", "/api/comments", { ...args, author: args.author ?? "AI" })),
);

server.registerTool(
  "resolve_comment",
  { description: "Mark a comment as resolved (pass resolved=false to reopen it). Use it after fixing what a comment asked for.", inputSchema: { id: z.string(), resolved: z.boolean().optional() } },
  async ({ id, resolved }) => ok(await callJson("POST", "/api/comments", { action: "resolve", id, resolved: resolved ?? true })),
);

server.registerTool(
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

server.registerTool(
  "list_errors",
  { description: "List boards with errors (script errors, images that failed to load, missing files) and the first error. Use it to check your edits did not break a board.", inputSchema: {} },
  async () => {
    const s = await callJson("GET", "/api/selection");
    const { errors } = await callJson("GET", "/api/errors");
    return ok({ erroredArtboards: s.erroredArtboards, firstError: s.firstError, errors });
  },
);

server.registerTool(
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

server.registerTool(
  "list_notes",
  { description: "List canvas notes (titles and sticky notes), optionally for one page.", inputSchema: { page: z.string().optional() } },
  async ({ page }) => {
    const { board } = await callJson("GET", "/api/board");
    const first = board.pages[0]?.id;
    return ok(Object.entries(board.notes).map(([id, n]) => ({ id, ...n, page: n.page ?? first })).filter((n) => !page || n.page === page));
  },
);

server.registerTool(
  "add_note",
  {
    description: "Add a note to the canvas. kind=title (large heading) or sticky (sticky note).",
    inputSchema: { kind: z.enum(["title", "sticky"]), text: z.string(), x: z.number(), y: z.number(), w: z.number().optional(), page: z.string().optional() },
  },
  async (args) => ok(await callJson("POST", "/api/notes", { action: "add", ...args })),
);

server.registerTool(
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

server.registerTool(
  "delete_note",
  { description: "Delete a note (the user can undo it in the app).", inputSchema: { id: z.string() } },
  async ({ id }) => ok(await callJson("POST", "/api/notes", { action: "delete", id })),
);

server.registerTool(
  "list_pages",
  { description: "List canvas pages (the first page is the default).", inputSchema: {} },
  async () => ok((await callJson("GET", "/api/board")).board.pages),
);

server.registerTool(
  "manage_page",
  {
    description: "Manage pages: add (name), rename (id, name), delete (id; its items move to the first page), move (id, index).",
    inputSchema: { action: z.enum(["add", "rename", "delete", "move"]), id: z.string().optional(), name: z.string().optional(), index: z.number().optional() },
  },
  async (args) => ok(await callJson("POST", "/api/pages", args)),
);

server.registerTool(
  "get_tokens",
  {
    description:
      "Get the design tokens (colors per theme, font sizes, weights, radii, spacing, fonts, minimum tap target) from tokens.json. Use only these values when creating or editing screens. If the project has no tokens.json it returns registered: false and no values; then keep to the styles already in the file.",
    inputSchema: {},
  },
  async () => ok(await callJson("GET", "/api/tokens?agent=1")),
);

server.registerTool(
  "check_tokens",
  {
    description:
      "Find off-token values in screen HTML (colors, font sizes, weights, radii, spacing not a multiple of 4). Use it to verify your edits. Omit file to check all screens. If the project has no tokens.json it returns registered: false and no violations (nothing to check against).",
    inputSchema: { file: z.string().optional() },
  },
  async ({ file }) => ok(await callJson("GET", `/api/lint${file ? `?f=${encodeURIComponent(file)}` : ""}`)),
);

server.registerTool(
  "reply_comment",
  { description: "Reply to a comment (resolve=true replies and marks it resolved).", inputSchema: { id: z.string(), text: z.string(), resolve: z.boolean().optional(), author: z.string().optional() } },
  async (args) => ok(await callJson("POST", "/api/comments", { action: "reply", ...args, author: args.author ?? "AI" })),
);

server.registerTool(
  "save_snapshot",
  { description: "Save a snapshot by committing only the design folder to git (a saved version). Use only when the user explicitly asks to save.", inputSchema: { message: z.string().optional() } },
  async ({ message }) => ok(await callJson("POST", "/api/snapshot", { message })),
);

await server.connect(new StdioServerTransport());
