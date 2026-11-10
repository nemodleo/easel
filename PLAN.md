# design-canvas — local design canvas (DEV-26, MVP in one day)

Each `docs/design/screens/*.html` file is one board. There is no export step.
When Claude Code or Codex writes HTML, it shows up on the board right away, and edits made on the board are saved straight to the source HTML.
Everyone runs it locally and shares through git.

## 0. Principles

- **The HTML files are the source of truth.** The canvas app is only a window for viewing and editing those files. It has no storage of its own.
- **Only two extra files.** Both are committed to `docs/design/`.
  - `board.json`: board layout, titles, notes, pages
  - `comments.json`: comments
- **Preserve source formatting.** Edits touch only the changed ranges of the source HTML. Files are never re-serialized.
- **It lives in the team repo at `tools/design-canvas/`.** The branch is `nemodleo/dev-26-design-canvas` (from origin/main), and commits and the PR reference `DEV-26` (the original project's issue).
  - Do **not** add it to the root npm workspaces (`apps/*`, `packages/*`). Keep it as a standalone package with its own `package.json` and `package-lock.json`, so it does not affect app install, build, Vercel, or CI (the apps job).
  - Add only two script lines to the root `package.json`.
    `"design": "npm --prefix tools/design-canvas start"`, `"design:install": "npm --prefix tools/design-canvas install"`
    (Changing the root package.json triggers the CI apps job, which must still pass.)
  - The default target folder is the repo's `docs/design` (`../../docs/design` relative to the script), and `--dir` overrides it.
  - Document how to run it and how to connect Claude Code and Codex over MCP in `tools/design-canvas/README.md`, and link to it with one line next to the design-related line in `AGENTS.md`.
  - Commit this PLAN.md as `tools/design-canvas/PLAN.md`.
- Out of scope: Tweaks, design system theme menu, real-time co-editing, login.

## 1. Stack

| Part | Choice |
|---|---|
| Runtime | Node 20+ (the team repo uses Node 24, so it works as is) |
| App | Vite + React + TypeScript (one package) |
| Server | Node `http` + `ws` + `chokidar` (Vite dev server middleware or a separate port 4317) |
| HTML parsing and patching | `parse5` (`sourceCodeLocationInfo: true`) |
| MCP | `@modelcontextprotocol/sdk` (stdio). Calls the app server's HTTP API |
| Screenshots and export | `playwright` (optional dependency; if missing, only those tools are disabled) |

Run: from the repo root, `npm run design:install` (first time only) → `npm run design` → http://localhost:4317

## 2. File formats

### board.json
```json
{
  "version": 1,
  "title": "Example project design",
  "pages": [{"id": "consumer", "name": "Consumer"}],
  "boards": {
    "scr-01.html": {"x": 1320, "y": 0, "w": 390, "h": 1300, "title": "SCR-01 Home · Discover", "page": "consumer"}
  },
  "order": ["scr-01.html"],
  "notes": {
    "tb": {"kind": "title", "x": 0, "y": -320, "text": "Consumer app", "maxW": 6970},
    "nb": {"kind": "sticky", "x": 0, "y": -210, "w": 1330, "text": "Token notes"}
  }
}
```
- Keys are paths relative to `screens/`. Subfolders are allowed.
- If `pages` is empty, everything is shown on one canvas with no page tabs. A board without `page` belongs to the first page.
- **Initial data:** a `board.json` converted from the Claude Design canvas `canvas.json` is provided. It already contains coordinates for 98 boards.

### comments.json
```json
{"comments": [{"id": "c1", "file": "scr-32.html", "path": "1/2/0", "text": "Make spacing 16", "author": "Hyun", "createdAt": "2026-10-09T09:00:00Z", "resolved": false}]}
```

- Commit the provided initial `board.json` (98 boards, 10 title notes) as is to `docs/design/board.json`.

### New board size
- When an HTML file appears that is not in `board.json`, read `<meta name="board-size" content="390x844">`.
- If there is no meta tag, use 390×844.
- Place it at the end of the "new screens" row: x is the last board's x + w + 80, and y is the overall bottom edge + 120.
- Once placed, write it to `board.json` immediately.

## 3. Element paths (shared by selection, editing, and MCP)

- The roots are the child elements of `<body>`. In the repo's files, `<div class="x-dc">` is the root.
- A path is a string of element-only child indexes joined with `/`. Example: `0/1/3`. Text nodes and comments are not counted.
- The same rule applies to the browser DOM (iframe) and the parse5 tree.
- Since the HTML is static, the two match. If they don't, reject the edit and show "File changed, select again".
- Each edit request includes a hash of the target element's `outerHTML`. The server rejects it if the hash differs. This prevents conflicts when another person or an AI edited the file in the meantime.

## 4. Server API (shared by MCP and the app)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/board` | board.json + actual file list (missing and orphaned files flagged) |
| PUT | `/api/board` | Save board.json (layout, notes, pages) |
| GET | `/screens/*` | Static serving of HTML and assets (same-origin, for iframes) |
| GET | `/api/file?f=` | Source HTML |
| POST | `/api/edit` | `{file, path, hash, op, …}` → patch the source (ops below) |
| POST | `/api/undo`, `/api/redo` | Per-file in-memory history (last 50) |
| GET/PUT | `/api/selection` | Current selection `{file, path, text, outerHTML(up to 4KB), styles}` |
| GET/POST | `/api/comments` | List, add, and resolve comments |
| POST | `/api/screenshot` | `{file, path?}` → PNG path |
| WS | `/ws` | `file-changed`, `board-changed`, `selection-changed` notifications |

Edit ops:
- `setText {text}`: only for elements whose sole child is a single text node. Replaces that text range.
- `setStyle {prop, value}`: adds, replaces, or removes only that declaration inside the `style` attribute. Creates the `style` attribute if missing.
- `setAttr {name, value}`
- `move {toParentPath, index}`: cuts the element's range out of the source string and pastes it at the target position. Allowed only within the same file.
- `wrap {paths[], display: "flex"|"grid", direction?}`: wraps consecutive siblings under the same parent in `<div style="display:flex;gap:8px">`.
- `delete`, `duplicate`

## 5. App UI

- **Canvas**
  - Pan with Space or middle-button drag; zoom with ⌘/Ctrl+wheel (10–400%).
  - Provide "Fit all" and "Go to board" (selected board) buttons.
  - Boards are rendered as iframes, with a label (title, file name) above each.
  - While zoomed, iframes get `pointer-events:none`; it is turned off only in edit mode.
- **Board handling:** dragging a label moves the board and updates x, y in `board.json`. Dragging a corner updates w, h.
- **Notes:** large titles (grouping several boards) and sticky notes can be added, moved, edited, and deleted.
- **Pages:** in the top tabs, add and rename pages and move boards to another page.
- **Edit mode** (double-click a board)
  - Inject an overlay script into the iframe. It is same-origin, so access it directly through `contentDocument`.
  - Hover shows an outline; click selects (Shift for multiple). Esc selects the parent element.
  - When the selection changes, notify the server with `PUT /api/selection`.
  - Double-click to edit text in place; send `setText` on Enter or blur.
  - **Properties panel** (right): edit width, height, padding, margin, gap, font size, weight, color, background, Radius, display, flex direction, and alignment. Changing a value sends `setStyle`. The 7 token colors are offered as swatches.
  - Dragging to reorder in the Layers list sends `move`; "Wrap in flex" and "Wrap in grid" send `wrap`.
  - ⌘Z / ⌘⇧Z call server undo and redo.
- **Play:** pressing a board's ▶ button opens it in a full-screen overlay where you can interact with it. `<a href="scr-02.html">` navigates directly inside it.
- **Comments:** commenting on a selected element shows a pin on the board, and the list appears in the right panel.
- **Live updates:** when `file-changed` arrives over WS, only that board's iframe is reloaded. Scroll position and the selected path are kept.
- **Copy button:** copies the selected element as `scr-32.html 1/2/0 "Send inquiry" (button)`. This is for pasting into an agent that is not connected over MCP.

## 6. MCP server (`node tools/design-canvas/bin/mcp.mjs`)

| Tool | Input | Output |
|---|---|---|
| `list_boards` | `page?` | File, title, size, page |
| `read_board` | `file` | Source HTML |
| `get_selection` | – | Current selection (file, path, text, outerHTML, computed styles). "No selection" if none |
| `screenshot` | `file, path?` | PNG file path |
| `list_comments` | `file?, unresolved?` | Comments |
| `add_comment` / `resolve_comment` | … | … |
| `place_board` | `file, x?, y?, title?, page?` | Updates board.json (for setting a new screen's title and position) |

Agents create and modify HTML by writing files directly, as usual. MCP only handles viewing, pointing at, and placing things.

Connecting:
```bash
# Claude Code
# Claude Code (from the repo root; written to .mcp.json at project scope so the team shares it)
claude mcp add --scope project design-canvas -- node tools/design-canvas/bin/mcp.mjs --port 4317
# Codex (~/.codex/config.toml, per person)
[mcp_servers.design-canvas]
command = "node"
args = ["<absolute repo path>/tools/design-canvas/bin/mcp.mjs", "--port", "4317"]
default_tools_approval_mode = "approve"  # without this, MCP calls are blocked in codex exec (approval policy never)
```

## 7. Order for the day (commit at each milestone; drop M6 if out of time)

| # | Work | Done when | Target |
|---|---|---|---|
| M0 | Branch, `tools/design-canvas` skeleton (Vite, server), `--dir`, static serving, root scripts, commit board.json | `npm run design` → `/screens/scr-01.html` opens; root `npm ci` and `npm run typecheck` still pass | 0:30 |
| M1 | Canvas (pan, zoom), board iframes, label move and resize, notes, pages, saving board.json | All 98 boards appear in the canvas.json layout; moving one updates board.json | 1:30 |
| M2 | chokidar + WS, reload only changed boards, auto-place new files | Saving HTML in an editor shows up within 1 second; new files appear in the "new screens" row | 0:30 |
| M3 | Play overlay, links between boards | Click through from scr-01 to scr-04 | 0:30 |
| M4 | Selection overlay + `/api/selection` + MCP (list, read, get_selection, screenshot, comments, place) | In Claude Code and Codex, `get_selection` returns the element just clicked | 1:30 |
| M5 | parse5 paths and hashes, setText, setStyle, setAttr, Properties panel, undo and redo | Editing text, spacing, or color changes only that part of the source (check with `git diff`) | 2:00 |
| M6 | Layers list, move, wrap (flex, grid), duplicate, delete | Reordering and wrapping are reflected in the source with formatting preserved | 1:30 |
| M7 | Real test (Codex "make a new screen" → shows up automatically, Claude "fix the selection" → applied), README, one line in AGENTS.md, `.mcp.json`, draft PR | Both agents pass, CI passes, test HTML changes reverted | 0:30 |

## 8. Commit and PR rules

- Commit at each milestone. Messages use the format `feat(design-canvas): … (DEV-26)`. Commit `board.json` separately as `docs(design): … (DEV-26)`.
- If you edited `docs/design/screens/*.html` while testing, revert it before committing. Delete any test screens too.
- Add `node_modules` and screenshot output (`tools/design-canvas/.out/`) to `.gitignore`.
- Open the PR as a draft. The title is `[DEV-26] Local design canvas`, and fill in the "AI use" section of the description.
- Add the comment `AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park` at the top of the code, as required by the original project's course AI-reporting rules.

## 9. Risks to check

- **98 iframes:** render only boards visible on screen and leave the rest as thumbnails or empty frames (IntersectionObserver). Below 25% zoom, use thumbnails instead of iframes, unless a board is still at least 640 px on screen (long side). Thumbnails are rendered at 600 / 1200 / 2400 px on the long side, whichever covers the board on screen at the display's pixel ratio.
- **Path mismatch:** whitespace text or `<template>` in the source can throw paths off. Validate the path and hash together.
- **Concurrent edits:** an AI and a person may edit the same file at the same time. If the hash differs, reject and make the client reload.
- **iCloud:** the design folder is inside iCloud. Enable `awaitWriteFinish` in chokidar and ignore `.icloud` placeholder files.
