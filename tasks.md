# tasks.md — tools/design-canvas

## DEV-26 Local design canvas

- Issue: DEV-26 · Branch: `nemodleo/dev-26-design-canvas`
- Plan (serves as spec): [PLAN.md](PLAN.md)
- Goal: a local canvas that shows `docs/design/screens/*.html` as boards and edits the source directly. Claude Code and Codex share selection, screenshots, comments, and layout through MCP.
- Scope (paths allowed to change): `tools/design-canvas/**`, `docs/design/board.json`, `docs/design/comments.json`, the `design` and `design:install` scripts in the root `package.json`, the root `.mcp.json`, the one design line in `AGENTS.md`
- Out of scope: the app (`apps/`, `packages/`), root workspaces, Tweaks, Theme menu, real-time co-editing, login

### Tasks
- [x] M0 Skeleton, static serving, root scripts, board.json
- [x] M1 Canvas, boards, name labels, notes, pages, saving
- [x] M2 File watching, reloading only changed boards, auto-placing new files
- [x] M3 Play, links between boards
- [x] M4 Selection overlay, /api/selection, comments, screenshots, MCP
- [x] M5 Source patching (setText, setStyle, setAttr), Properties panel, undo
- [x] M6 Layers, move, wrap, duplicate, delete
- [x] M7 README, AGENTS.md, .mcp.json, draft PR, Codex trial (new screen shows up automatically; get_selection, place_board, fix the selected element)
- [x] M7 Claude Code trial (.mcp.json): get_selection, fix the selected element, auto-placing new screens, place_board passed (10/09)

### Decisions
- 10/09 Minimum zoom is 4% (PLAN said 10%), so all 98 boards (about 17,700 tall) fit on one screen.
- 10/09 The server computes element hashes from the source HTML range (parse5 locations). Browser outerHTML differs from the source formatting, so its hashes would not match.
- 10/09 Auto-placed boards keep `autoPlaced: true` in board.json, so the next new file continues to the right in the same row. The flag is removed when the board is moved.
- 10/09 Vite is attached as middleware with HMR off (avoids failed connections on a separate port). Refresh the browser after code changes.
- 10/09 Codex needs `default_tools_approval_mode = "approve"` on the MCP server to call tools from codex exec (reflected in README and PLAN).

### Log
- 10/09 M0–M6 done, one commit per milestone.
- 10/09 M7: created a new screen with Codex → auto-placed and shown; get_selection, place_board, and editing text of the selected element passed. Could not test the Claude Code CLI because its OAuth had expired. HTML and board.json changed during the trial were reverted.

### Follow-up: Claude Design core features (P0–P5, based on PARITY.md)
- Added scope: `docs/design/tokens.json` (when tokens are registered), `docs/design/.trash`, `.refs`, `.thumbs` (each with `.gitignore *`). Tweaks and the Theme menu are now in scope in an alternative form.
- [x] P0 Safety and bugs: atomic writes, note ids, `/` links, refreshing embedded boards, board.json sorting and one entry per line
- [x] P1 Canvas basics: board management, right-click, single-history undo, multi-select, snapping, ordering, Focus view, launch screen, Fill window (page-style), board options, search, Minimap, remembered state
- [x] P2 AI: chat panel (claude -p, codex exec), comments and references, selection details, error boards, MCP notes, pages, and templates, N variants
- [x] P3 Direct editing: dragging, resizing, and aligning elements, pinning when dragged out of flex, properties and grid column count, images and assets, copying between boards, Korean IME composition
- [x] P4 Drawing and tools: note options, shapes, Layout guides, page management, shortcuts, Appearance
- [x] P5 Design system and collaboration: tokens, themes, warnings, Accessibility, comment replies, git snapshots, Tweaks, Windows and key binding checks
- [x] Wrap-up: thumbnails, Play in place, multi-line text, following renames, keyboard navigation, import → PARITY PASS 73, N/A 1 (#45 online sharing)

### Decisions (follow-up)
- 10/09 Undo is a single server-side history (`history.mjs`): HTML edits and board.json and board file create/delete stack in one line; an external change clears it with 409.
- 10/09 Requests that change boards or files, and auto-placement, are serialized with `store.exclusive` (fixes a race where auto-placement revived a board deleted during undo).
- 10/09 Error collection and Tweaks are applied by injecting a script into `<head>` when serving screen HTML (the file is unchanged; element paths are based on `<body>`, so they are unaffected).
- 10/09 Shapes (`shapes`) are objects keyed by id, one per line, like notes (avoids merge conflicts between two branches).
- 10/09 Snapshots commit only design folder paths and do not revert (use git directly).
- 10/09 Accessibility thresholds: 48 for tap targets, per the example project's README tokens (N-02); text contrast 4.5 (3 for large text).

### Log (follow-up)
- 10/09 P0–P5 and wrap-up done; pushed at each stage and updated the progress table in PR #63. 8 e2e tests (select → edit → source; file watching, embedded boards, root links; board create, delete, undo, single history; chat panel) passed at every stage, plus 30 unit tests.
- 10/09 AI items verified with real Claude Code and Codex: edits and 2 variants (in a temp folder). No docs/design changes during the trial (all in temp copies).

### Follow-up: canvas lag on large projects (open, handed off 11/27)
Measured in #24 on a 105-board project (boards up to 24,600px tall) at 1440×900 and 630×830; the table and method are in the #24 description. The server is not the bottleneck (board HTML 0–3 ms, thumbnails 1–5 ms warm), so a server rewrite would not help. #24 fixed the per-frame chrome measuring (`snapWidths`), which cut pan and zoom main-thread time by 43–48% at 1440 but gave no measurable gain at 630. What is left:
- [x] (Done in #30: live frames mount one at a time, 40 ms apart, after the view settles; no cap on their number) Cap and stagger live frames: mount new live iframes about 150 ms after the view settles, nearest the centre first, with a cap of around 12. Today 12 (630 wide) to 24 (1440 wide) full pages are live at once, memory reaches 1.6–1.9 GB, and crossing the 25% zoom threshold mounts a batch in one task. The board being played, edited or typed in must stay exempt (rule added in #24).
- [x] (Done in #30: a pan renders the canvas but no board) Stop re-rendering the whole app on every pan or wheel step: the view state lives at the top of `App.tsx`, so all boards, overlays and side panels re-render per frame. Let only the canvas and minimap follow the view; memoize board components with stable callbacks. About 1–2 days.
- [ ] Thumbnail queue: one shared browser context (each render re-downloads the page's fonts today), newest request first, drop jobs nobody waits for. A first thumbnail costs 0.5–3.2 s.
- [ ] Tall boards (10k–25k px) are laid out and scaled in full even when a strip is on screen; check after the cap above whether this still matters.
- [x] (Done in #30: headed Chromium on this Mac's display, numbers in the #30 description) Measure on a real display. The #24 numbers are main-thread time from headless Chromium, not frame rate.

Not verified in #24, worth a manual check:
- [ ] Hide the window pane, show it again, and confirm boards load (the zero-size step and its fix were tested; the real pane-hide behaviour was not).
- [ ] Look at the label Play button on selected, hovered and flagged boards; the 21 design screens were updated by script, not re-captured.

Still open from #18:
- [ ] The first save of a hand- or agent-written `board.json` rewrites the whole file into Easel's format (every entry moves). Keeping the file's existing layout means patching the original text per entry.
- [ ] With one board selected, P plays instead of picking the pen (Esc then P, or the dock). Decide whether Play should move to another key.
- [ ] New files from #18 and #24 carry "AI-generated with Claude Code" headers without ", reviewed by Hyun Park"; add it after review.
