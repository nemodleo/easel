# Claude Design feature parity (DEV-26)

Item-by-item check of whether `tools/design-canvas` (commit 6d323cc) matches the Claude Design canvas. Checked on 2026-10-09; nothing was fixed in this pass.

- **Scope**: Export (PDF, PPTX, images, sending elsewhere) is excluded. For online features, we only check whether a local alternative exists.
- **Basis**: 67 items from the user checklist + 7 added from the [official help article](https://support.claude.com/en/articles/14604416-get-started-with-claude-design) (#68–74).
- **Method**: Ran `npm run design` and operated it for real with Playwright (Chrome). Items that can't be verified by interaction were judged from the code ("code" in the evidence).
- **Verdict**: PASS / PARTIAL / MISSING / N/A (no local alternative needed). Size S (half a day or less) · M (a day or less) · L (more than a day).
- **Evidence files**: Kept locally in `tools/design-canvas/.out/parity/`. Excluded from git.
  - `results.json`: interaction results
  - `*.png`: screenshots
  - `pixel/pixel.json`: pixel comparison
  - `audit.mjs`, `pixel.mjs`: check scripts
- **Rollback**: All `docs/design` files and board.json changed during testing were reverted.

## Summary

| Verdict | Count |
| --- | --- |
| PASS | 73 |
| PARTIAL | 0 |
| MISSING | 0 |
| N/A | 1 |
| Total | 74 |

Rendering matches. For all 98 boards, the pixel difference between the in-canvas view and the directly opened page was under 1% (max 0.127%).

Source formatting preservation, file watching, and instant display of AI-written files also work.

The gaps are concentrated in Claude Design's canvas manipulation:
- Creating and removing boards and shapes from the UI
- Dragging elements to move and resize
- Chat panel
- Context menus
- Undo for canvas operations
- Layout guides

## Parity table

| # | Area | Feature | Claude Design behavior | Our behavior | Verdict | Evidence | Size |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A Canvas | Infinite canvas pan, zoom, fit | Space/trackpad pan, ⌘wheel/pinch zoom, fit all, zoom to selected board | All work. Zoom 4–400%. In Chrome, pinch arrives as the same event as ⌘wheel and behaves the same | PASS | `A1.*`: ⌘wheel 5%→21%, wheel and space-drag change the transform, Fit all 5%, to selected board 62% · `A1-fit.png`, `A1-focused.png` | S |
| 2 | A Canvas | Create, delete, duplicate, rename boards; artboard tool | Draw a blank board with a tool; delete, duplicate, rename from a menu | Draw with the board tool (B) or context menu 'New board here' to create a new HTML file + slot. Delete: confirm dialog → copy to .trash → toast 'Undo'. Duplicate (⌘D) puts -copy to the right. Rename (F2, double-click title) and file rename use in-app inputs, with a referencing-file list and an 'Also update N references' option | PASS | e2e `boards.e2e.mjs` create → delete → ⌘Z restore → ⌘Z undo create → ⌘⇧Z; .out/ux/p1-02-*.png (toast, confirm, rename, 20 references) — 4-unit spacing, token colors, confirm+cancel met | M |
| 3 | A Canvas | Board move and size (40–8000), multi-select and move, snapping and guides | All work | Move and size (40–8000), drag on empty space for marquee select, Shift to add, move together, 6px snap + guide lines to other boards' left/center/right (top/middle/bottom) (Alt disables), arrows move 1, Shift 10 | PASS | ux script: 2 .guide while dragging, .out/ux/p1-03-multi.png·p1-03-snap-guides.png — selected vs. hover states distinct, guides accent 1px | M |
| 4 | A Canvas | Board stacking order | Bring forward / send backward | Bring to front (⌘]) / send to back (⌘[) changes order; also in context menu, board options, and multi-select panel | PASS | Context menu shows shortcuts .out/ux/p1-65-menu-board.png, history label 'Bring to front' | S |
| 5 | A Canvas | File name when no title | Shows file name | Shows `b.title ?? file`. New files record the file name (without extension) as the title | PASS | `A5.label_for_new_file`="zz-parity-new" | S |
| 6 | A Canvas | 40 pages, add, rename, delete, reorder, move, launch.page | All work | Add pages (up to 40), rename (in-app input), delete (confirm; items go to the first page), reorder (drag and drop, context menu up/down), move boards, launch page (launch.page). All go through server /api/pages with undo history | PASS | ux script: add Draft A, B → move up → drag to front → rename 'Draft B2' → delete; boards keep their page even when the first page changes; .out/ux/p4-06-pages.png | S |
| 7 | A Canvas | Launch screen (launch.view: canvas / one board full screen) | Opens the canvas or one board filling the window | Board option 'Open as launch screen' → board.json launch {view:focused,file}. Reopening starts in Focus view on that board. Focus view (F): ←/→ for neighboring boards, Esc to close | PASS | ux script: check, reload → .focus shown; .out/ux/p1-07-focus.png·p1-08-launch.png — Esc closes, aria-modal | M |
| 8 | A Canvas | Page-style board (expand: fill) | In full screen, fills the window and scrolls like a page | Board option 'Fill window (page-style)' → expand:"fill". Fills to window size in Focus view and scrolls | PASS | ux script: .focus-fill 1600×952 (window size); .out/ux/p1-08-expand-fill.png | M |
| 9 | A Canvas | Board options radius, frameless, is_interactive | Radius, frameless; only interactive boards get the blue mark and Play | Board options Radius (radius), Frameless (frameless), Show Play button (is_interactive). The green dot and an always-visible ▶ on is_interactive boards; on other boards the ▶ shows while the board is selected or hovered; any board plays with P or the right-click menu, without writing board.json | PASS | ux script: saved values radius 24, frameless, is_interactive; Play 0→1, other boards Play 0; .out/ux/p1-09-*.png | S |
| 10 | A Canvas | Layout guides (columns, rows, grid; gutter, margin, align, count, color, hidden) | Up to 6 per board, visible only on the canvas | 'Layout guides' under board options: Columns · Rows (count, gutter, margin, align stretch/start/center/end, cell size), Grid (cell), color, hide, delete, 6 per board. Saved to board.json guides, visible only on the canvas, HTML untouched. ⌃G hides all | PASS | ux script: 4 columns → 4 .lg-track, add button disabled at 6, ⌃G hides; .out/ux/p4-10-guides.png | L |
| 11 | A Canvas | Performance (98+ boards, lazy rendering off-screen) | Smooth, showing previews | 98 boards load in 0.2 s (app); off-screen and below 25% show server-generated thumbnails instead of iframes (.thumbs/, cached by mtime, generated two at a time). Pan at 61fps with 98 boards fit | PASS | ux script: load 236ms, wheel pan 120 frames 61fps (0 iframes), 90+/99 thumbnails shown (first generation ~20 s, then 2ms); .out/ux/p6-11-thumbs.png | M |
| 12 | B Notes | Large title (title1) 72px bold, shrinks past maxW/maxH | Auto-shrink | Title 72px bold (size adjustable); text shrinks past max width/height (min 12px); handle for max width | PASS | ux script: long title in 320×120 → 34px; also fixed titles wrapping one character per line due to world width 0 (width:max-content); .out/ux/p4-12-title-shrink.png | S |
| 13 | B Notes | Sticky note width, scroll on overflow, 8 colors | Works | 8 sticky note colors (yellow, orange, pink, purple, blue, green, gray, white), width/height (handle, number), text taller than the note scrolls | PASS | ux script: pink, h 160 saved; handle to 500×200; .out/ux/p4-13-sticky.png | S |
| 14 | B Notes | Note options size, bold, italic, page | Works | Note options: font size, bold, italic, color, page (created on the current page) | PASS | ux script: {size:28,bold:true,italic:true,color:pink} | S |
| 15 | B Shapes | rect, oval, pen, line, arrow, image | Draw to add; paste or upload images | Draw with toolbar Rectangle (R), Oval (O), Line (L), Arrow (A), Pen (P) (Shift for square/circle, plain click for default size); images picked from assets or pasted onto the canvas (uploaded to assets). Select, move, resize, stroke color, fill, weight, front/back, delete (undoable). board.json shapes (one line per id) | PASS | ux script: rect 180×120, oval, line, arrow, pen (13 points), image (../assets/basket.jpg), color #C94F0C, moved (50,20), delete → ⌘Z; .out/ux/p4-15-shapes.png | L |
| 16 | B Notes | Move, resize, delete; max 200 | Works | Move notes (drag, arrows), resize (handle), delete (× · Delete · context menu, undoable), edit text, 200 limit (app, server, MCP) | PASS | ux script: handle resize 500×200; code: MAX_NOTES·/api/notes 400 | S |
| 17 | C Editing | Hover, click, Shift, Esc, select all in board | Works | Hover outline, click, Shift multi, Esc to parent, ⌘A in edit mode selects all siblings (or the board's top-level elements if none), Enter first child, Shift+Enter parent | PASS | ux script: pick a.btn, ⌘A → 6 paths | S |
| 18 | C Editing | In-place text editing (multi-line) | Works | Double-click to edit in place, Shift+Enter line break → <br> in source, elements with only text+<br> stay re-editable, Enter commits, Esc cancels, IME-composition safe | PASS | ux script: saved 'Send inquiry<br>Second line', re-editable | M |
| 19 | C Editing | Drag elements to move, resize, align | Directly on the canvas | Handles on the selected element in edit mode: dragging the top handle shows a drop line (before/after the hovered element; inside position when hovering a box; Alt drops inside the hovered box) → move. Absolutely positioned elements use left/top. Right, bottom, corner handles set width/height (px). 6 align buttons in Properties (align-self/margin auto per parent layout) | PASS | ux script: reorder inside a flex row → source updated, new path selected, ⌘Z restores; resize → style="width:412px;height:69px"; horizontal center → align-self:center; .out/ux/p3-19-*.png — handle hit areas 24×20·10px, accent indicator line | L |
| 20 | C Editing | Properties panel fields | Size, spacing, font, line height, color, background, border, radius, shadow, opacity, full flex | Existing 14 + wrap (flex-wrap), grow (flex-grow), align-self, line height, text align, border, shadow, opacity. Enter ignored during IME composition | PASS | ux script: line-height, opacity, border, box-shadow all written to source; .out/ux/p3-21-props.png | S |
| 21 | C Editing | Grid column/row count round-trip as numbers | Reads `repeat(N, minmax(0,1fr))` as a number and writes it back in the same form | When display is grid, 'Columns' and 'Rows' count: reads repeat(N, …) or track count as a number, writes repeat(N, minmax(0, 1fr)) (1–24) | PASS | ux script: enter 3 → grid-template-columns: repeat(3, minmax(0, 1fr)), reads back 3; .out/ux/p3-21-grid.png | M |
| 22 | C Editing | Wrap in Flex / Grid | Works | Wraps consecutive siblings of the same parent in `<div style="display:flex;gap:8px">` (grid) and fixes indentation | PASS | 2 `wrap` unit tests, manual test (scr-32) | S |
| 23 | C Editing | Freeze sibling/parent sizes when dragging out of flex/grid | Other elements don't shift | When moving out of a flex/grid parent, freezes the current size of the original parent (width, height) and remaining siblings (width for rows, height for columns, both for grid) inline. Existing sizes kept. Same single step as the move (one ⌘Z) | PASS | unit `edit-p3.test.mjs` move+freeze; ux script: width:390px added to header, one ⌘Z restores; .out/ux/p3-23-freeze.png | L |
| 24 | C Editing | Duplicate, delete, layer list, reorder | Works | Duplicate, delete (Properties), layer tree, drag-and-drop reorder work | PASS | `C24.duplicate_diff` (1 line added), `C24.layers_rows`, manual layer drag (M6) | S |
| 25 | C Editing | Replace image (upload changes the path) | Upload | 'Replace image…' on img (or elements with background-image) → asset picker (with upload) → src set to ../assets/name (url() for backgrounds) | PASS | ux script: first img in scr-02 → src="../assets/test-logo.png"; .out/ux/p3-22-picker.png | M |
| 26 | C Editing | Undo/redo; conflicts between human and AI edits | Works | ⌘Z/⌘⇧Z via 50-entry per-file server history. Editing with a stale hash returns 409; external changes clear undo history | PASS | `C26.undo_redo` (only the background declaration removed and restored), manual repro: edit text externally → stale-hash setStyle 409 "File changed, select again" | S |
| 27 | C Editing | Only that part of the source changes | Works | Replaces only that range using parse5 locations | PASS | `C27.style_diff` (1 line, `style="gap:12px;background:#111111"`), 12 unit tests | S |
| 28 | D Prototype | Play (in place, full screen) | Both | Interactive boards: label ▶, context menu 'Play in place', or P → click through that board right on the canvas and navigate to other screens (green border, 'Running'); Esc (even inside the iframe) stops and returns to the original screen. 'Play full screen' is separate | PASS | ux script: P on scr-04 → click link to scr-03, Esc → stops and returns; .out/ux/p6-28-inline-play.png | S |
| 29 | D Prototype | Links (relative, `/` root, `#id`, external in new tab) | All | Relative paths and #id use browser defaults. Links starting with / 302 to the same file under screens/ if it exists (else 404). Cross-origin links in Play open a new tab | PASS | e2e: /scr-02.html → 302 /screens/scr-02.html, /nope.html 404 · code: Play.tsx cross-origin window.open | S |
| 30 | D Prototype | Scripts (state, events, conditions, loops) | Works | Run as-is in the iframe | PASS | `D30.script_runs`: button twice → "2" | S |
| 31 | D Prototype | Embed other boards, refresh when source changes | dc-import follows changes | Indexes iframe src per screen; when a source changes, boards embedding it directly or indirectly reload too | PASS | unit tests deps (direct, indirect), e2e: edit scr-15 → reflected in iframe inside f-3 within 4 s | S |
| 32 | D Prototype | Tweaks (color, enum, boolean, number controls) | Adjusted in a panel | Declare color, number (min, max, unit), boolean, enum and CSS variables in <script type="application/json" id="board-tweaks"> → adjusting in right-side 'Tweaks' applies CSS variables and data-tweak-* instantly; 'Save to source' changes only the JSON value (undoable). Saved values applied as variables when the canvas serves the page | PASS | unit setTweaks; ux script: --accent #C94F0C on load, adjust → 4px, rgb(17,17,17), on; 3 values after save; .out/ux/p5-32-tweaks.png | M |
| 33 | E AI | AI creates HTML → board appears instantly, auto-placed | Works | Board appears within 323ms, placed in the 'New screens' row at its board-size meta size. Both Claude Code and Codex: create new screen → auto-place → `place_board` title confirmed | PASS | `E33.*`, Claude Code (.mcp.json, claude -p) 2026-10-09: created zz-claude-test.html, title 'Claude test' shown on canvas; Codex (M7) same result | S |
| 34 | E AI | AI edits reflected instantly (scroll, selection kept) | Works | AI/external edits reload only that board in 484ms, reselect the same path, restore window scroll and inner scroll-box positions | PASS | ux script: file edited at inner scroll 700 → stays 700 after reload | S |
| 35 | E AI | Selection context | mode, page, pageName, visible/selectedArtboards, element kind/label, dirty, edits | get_selection = selection (+kind, label) · mode (canvas/edit/focus/play) · page·pageName · visibleArtboards · selectedArtboards · dirty · edits (recent history) · erroredArtboards·firstError. App reports view state via PUT /api/context | PASS | ux script MCP: 10 get_selection keys; a.btn in edit mode → kind link, label 'Send inquiry', selectedArtboards [scr-32.html] | M |
| 36 | E AI | Errored board list, "fix it" | erroredArtboards, firstError, Ask Claude to fix | Server injects an error-collecting script into the screen HTML <head> (file untouched) to gather script errors and failed resources. Toolbar 'Errors N' menu, warnings in the left list, and board context menu 'Ask AI to fix' open the chat prefilled with the error. MCP list_errors | PASS | ux script: zz-err.html → firstError 'undefinedFn is not defined' (line 1), fix draft prefilled; .out/ux/p2-36-*.png | M |
| 37 | E AI | AI reads, replies to, resolves comments | Works | AI: list_comments (with replies), add_comment, reply_comment (optional resolve), resolve_comment; send comments from chat | PASS | ux script MCP: reply_comment → 2 replies | S |
| 38 | E AI | AI changes placement, titles, pages, notes | Writes the whole canvas file | place_board + create_board (template) + list/add/update/delete_note + list_pages·manage_page (add, rename, delete, move). All recorded in app undo history | PASS | ux script MCP: add_note → present in list_notes, update, delete, page 'Draft' added, create_board doc | S |
| 39 | E AI | Screenshots (board, element) | Works | Whole board or single element as PNG (@2x) | PASS | M4 test: `.out/scr-32--0-1-1-5.png` | S |
| 40 | F DS | Token registration, theme menu | Install a design system, pick a theme | Left 'Tokens' tab: starts from README table defaults → edit themes (duplicate to add, rename, add/remove/rename colors), font sizes, weights, radius, spacing, touch target → 'Register tokens' writes docs/design/tokens.json (undo history). Toolbar 'Theme' menu switches the active theme. MCP get_tokens | PASS | ux script: default 8 colors → add and register 'Dark draft' → 'Default' via Theme menu; .out/ux/p5-40-*.png | L |
| 41 | F DS | Token swatches on color and font inputs | Works | Properties: color/background swatches use the selected theme's colors; token chips on font size, radius, gap, padding | PASS | ux script: chips 34·22·17·16·15, 8 swatches; .out/ux/p5-41-71-props.png | S |
| 42 | F DS | Warn on off-token values | Checks AI output | Off-token check (colors, font sizes, weights, radius, spacing not on the 4-unit grid; both style attributes and <style>): right-side 'Token check' list (click to edit that element), ⚠ on property fields, 'Ask AI to fix', MCP check_tokens. Real check of 98 boards found 211 issues (a:hover #000000 98, radius 12px 57, etc.) | PASS | 3 unit tests tokens.test.mjs; ux script: enter 13px → ⚠, zz-tweaks 2 issues; .out/ux/p5-42-55-checks.png | M |
| 43 | G Collaboration | Pinned comments, list, replies, resolve, author | Works | Element and board pins, list, replies (threads), 'Reply and resolve', Resolve/Reopen, author (defaults to git user.name, editable) | PASS | ux script: reply [Test user, Got it] + resolved; .out/ux/p5-43-replies.png | S |
| 44 | G Collaboration | Save and branch versions | No built-in history; ask Claude to save | git snapshots instead of versions: toolbar 'Snapshot' menu → commits only the design folder (author from git config, doesn't mix in other staged changes, hooks run as usual), last 10 snapshots and changed-file count. MCP save_snapshot | PASS | ux script (temp git repo): 4 changed files → commit 'Test user|docs(design): design snapshot', status clean; .out/ux/p5-44-snapshot-menu.png | – |
| 45 | G Collaboration | Sharing, permissions, real-time co-editing | Share with view/comment/edit permissions | Share via git push and PRs; everyone runs it locally | N/A | – | – |
| 46 | H Shortcuts | ⌘Z ⌘⇧Z Delete ⌘D arrows ⌘A ⌘G Space ⌘0 ⌘1 ⌘C ⌘V | Works | ⌘Z ⌘⇧Z(⌘Y) Delete ⌘D (board, element) arrows (Shift 10, Option 100; in edit mode select siblings, Option+↑↓ reorder) ⌘A ⌘G (Wrap in flex in edit mode) ⌃G (guides) Space ⌘0 ⌘1 ⌘± ⌘C ⌘V F6 (region focus) ⌘\\ (both panels) ⌘K ⌘J F2 F E M V H B T N R O L A P Esc. Shown in menus and tooltips | PASS | ux script: ⌘\\ hides panels, F6 toolbar→left, ↑ selects sibling, Option+↓ reorders, ⌘G wraps two siblings (shift.mjs) | M |
| 47 | H Usability | Dark mode, window size, wheel feel | Works | Toolbar Appearance button: System → Light → Dark (data-theme, remembered). Token colors keep 4.5:1 in dark too; panels overlay when the window shrinks | PASS | ux script: light→dark→system; .out/ux/p4-47-dark.png | S |
| 48 | I Rendering | Pixel parity for 98 boards | – | All 98 under 1% (max s-03-unfollowed 0.127%, mean 0.059%) | PASS | `pixel/pixel.json` | – |
| 49 | J Extra | In-canvas chat panel (claude -p / codex exec, streaming, cancel, agent choice) | Chat is the default | Right 'AI' (⌘J) tab: choose Claude Code or Codex (install check), chips for selected element, picked boards, visible boards (click to remove), Enter sends (ignored during IME composition), streamed text chunks, tool lines, cost, cancel (Esc or button, kills the process group), continue conversation (--resume / exec resume), New chat | PASS | e2e `chat.e2e.mjs` (fake agent: streaming, source update, context, cancel); real: Claude Code 48s, Codex 38s changed only the scr-02 title; unit `chat.test.mjs`; .out/ux/p2-49-*.png | L |
| 50 | J Extra | Send a comment to AI to fix just that spot | Partial edits via inline comments | Comment 'Send to AI' → comment chip in chat. Context includes file, path, text, and the instruction 'fix only this spot and resolve_comment' | PASS | ux script: prompt contains 'Comment (c…) screens/scr-02.html path 0: "Make the title bigger"' | M |
| 51 | J Extra | Attach references (images, docs, URLs) | Upload, links | Add links, attach files/images (button, drag and drop, paste) → saved to docs/design/.refs/ (gitignored), paths in context. Codex also gets images via -i | PASS | ux script: prompt contains reference link and reference file (image) .refs/…-ref.png; .out/ux/p2-50-51-attach.png | M |
| 52 | J Extra | "N options" side by side | Suggests 2–3 variants | Chat 'N variants' (2–4): copies the source to -v1…-vN, places them side by side in an empty row below the source, and tells the agent to take each in a different direction. Navigates there when done | PASS | real: Claude Code 48s and Codex 59s both put 'Sort by sweetness' in v1 and 'Map' in v2, source unchanged; .out/ux/p2-52-variants.png | S |
| 53 | J Extra | Start from a template or blank board | Templates | Toolbar 'New board' menu: Blank · Mobile screen · Desktop screen · Document templates (token colors, Pretendard), context menu 'Mobile screen here', MCP create_board(template) | PASS | ux script: Mobile screen → mobile.html created; .out/ux/p2-53-*.png | S |
| 54 | J Extra | Asset library (upload and reuse images, fonts) | Uploaded assets | Left 'Assets' tab: thumbnails of images and fonts in docs/design/assets/, upload (button, drag and drop; -2 on name clash), click to copy the path. Same list as the Replace image dialog | PASS | ux script: 'Test Logo.png' → assets/test-logo.png; .out/ux/p3-22-assets.png | M |
| 55 | J Extra | Accessibility check (touch target, contrast, labels) | Ask Claude for a review | Right 'Accessibility' list: touch target (token minimum 48), text contrast (4.5, 3 for large text, excluding text over images), unnamed buttons/inputs, img without alt. Click to edit that element, 'Ask AI to fix' | PASS | ux script: 24×24 button, no name, no alt, contrast 2.08 → 4 issues; click selects 0/1 (edit) | M |
| 56 | J Extra | Korean IME | No breakage on Enter or blur during composition | Inline text editing, notes, property fields, search, chat, inputs: Enter ignored during composition; if focus leaves mid-composition, save after compositionend; keys during composition in the iframe are not forwarded as shortcuts (⌘Z etc.) | PASS | ux script (synthetic composition events): Enter and blur during composition → not saved; 'farms' saved after compositionend. A real IME can't be automated | S |
| 57 | J Extra | Undo for canvas operations | Works | One server history (history.mjs) records HTML edits, board move/resize/options/order, notes, pages, and board create/delete/duplicate/rename in time order. Undo via ⌘Z/⌘⇧Z, toolbar, context menu, toast; external changes clear history with 409 | PASS | e2e `boards.e2e.mjs` 'HTML edit → move board → two ⌘Z undo in reverse order'; 17 unit tests pass; .out/ux/p1-57-undo-toast.png | M |
| 58 | J Extra | Minimize board.json conflicts | – | Board and note keys sorted, one item per line, one blank line between items. Server always saves in this format. Existing board.json rewritten in format only, values unchanged (865→324 lines) | PASS | unit tests boardFormat: same values, one line, sorted, idempotent rewrite; git merge-file 3 merge cases (neighboring boards each moved, notes each added, move+note) 0 conflicts | S |
| 59 | J Extra | Follow HTML renames and deletes | – | External renames (same content deleted and recreated within 5 s) move the board's slot and title to the new name. In-app rename also updates references. Missing files cleaned up via 'Clean up boards with missing files' in the 'Errors' menu (undoable) | PASS | ux script: fs.rename → same slot (0,16056), missing [] | S |
| 60 | J Extra | Copy/paste elements across boards | Works | ⌘C in edit mode copies element source to the app clipboard (localStorage, works across boards and tabs) and the system clipboard → ⌘V while editing another board pastes after the selected element (or at end of body) with matching indentation. Also in context menu. Scripts blocked | PASS | 3 unit insert tests; ux script: scr-32 'Send inquiry' → pasted into scr-02; .out/ux/p3-60-paste.png | M |
| 61 | J Extra | Board search and jump | – | Left panel 'Find boards (⌘K)': filters by title and file name, Enter jumps to and selects the first board, Esc clears | PASS | ux script: 'payment' 3 results, Enter → scr-11 selected; .out/ux/p1-61-search.png | S |
| 62 | J Extra | Windows paths and watching | – | Code review: paths via path.join/relative then toPosix to /; on Windows, claude/codex run via shell (.cmd), quoted args, cancel via taskkill, which→where, rename retries on EPERM/EBUSY, snapshots compare realpath, watching via chokidar. No real Windows machine tested | PASS | unit winpath.test.mjs (path.win32 conversion, quoting) | S |
| 63 | J Extra | Security (127.0.0.1, path traversal) | – | Listens only on 127.0.0.1 (index.mjs), /screens/..%2F 404, /api/file?f=../ 400, asset names sanitized, extensions restricted | PASS | J63.* + code server.listen(port, "127.0.0.1") | S |
| 64 | J Extra | Atomic writes (temp file → replace) | – | HTML, board.json, comments.json written to a temp file (.dc-tmp-*) in the same folder, then renamed. Permissions kept; temp file removed on failure. Watcher ignores dotfiles | PASS | 2 unit tests fsutil, e2e core: no .dc-tmp after edit, temp-file rename still picked up by watcher within 1 s | S |
| 65 | J Extra | Context menus (board, element, empty canvas) | Works | Board (edit, Play, full screen, go to, rename, rename file, duplicate, front/back, delete), note (duplicate, delete), empty canvas (board/title/note here, select all, Fit all, 100%, undo/redo), element in edit mode (Edit text, Select parent, copy description for AI, duplicate, delete). Shows shortcuts; arrows, Enter, Esc | PASS | ux script: Esc closes true; .out/ux/p1-65-menu-{board,canvas,element}.png — role=menu, 32px rows, destructive items red | M |
| 66 | J Extra | Remember canvas state (zoom, position, page, panels) | Works | Zoom, position, page, left panel, minimap remembered in localStorage (design-canvas:<title>), restored on reopen (launch settings take precedence) | PASS | ux script: zoom same before and after reopen (34%→34%) | S |
| 67 | J Extra | Minimap and board list panel | Layer and board navigation | Left panel: page list (board counts), board list (File missing warnings), click to go to that board. Minimap (M): board layout, selection, current-view rectangle; click or drag to jump | PASS | .out/ux/p1-09-board-options.png (left list, minimap), p1-dark.png (dark) | M |
| 68 | Help docs | F6/Shift+F6 region navigation; Tab, Space, Return for board and layer navigation | Keyboard and screen reader support | F6/Shift+F6 region navigation, Tab/Shift+Tab between boards on the canvas (screen reader announcement), Enter to edit, Enter/Shift+Enter child/parent in edit mode, layer list role=tree with arrows, boards role=group with aria-label | PASS | ux script: Tab twice → scr-02, announcement 'SCR-02 Farm list selected, 2/99. Press Enter to edit', Enter → edit | M |
| 69 | Help docs | Option+arrow to move layers | Works | Option+↑↓ in edit mode reorders among siblings (source move); Option+arrow on canvas moves 100 | PASS | ux script (P4): Option+↓ reorders | S |
| 70 | Help docs | ⌘\ toggles the properties panel | Works | ⌘\\ hides/shows left and right panels together; toolbar buttons toggle each | PASS | ux script (P4): ⌘\\ → .left 0, .right hidden | S |
| 71 | Help docs | Color picker shows text contrast quality | Works | Under text color in Properties: contrast ratio against the actual background and grade (AAA, AA, large text only, fail) | PASS | ux script: 'Contrast 18.26:1 · AAA' | S |
| 72 | Help docs | Layer list arrow navigation and expand | Works | Layer list role=tree: after clicking, ↑↓ moves (selection follows), → expands / first child, ← collapses / parent, Home, End, Enter, Space | PASS | ux script: ← → parent 0/1/1; .out/ux/p6-72-layers.png | S |
| 73 | Help docs | Import a design system (/design-sync, GitHub, upload) | Works | Import: dropping an HTML file on the canvas creates a new board (reads board-size, title); images become assets + image shapes; import tokens.json or variables JSON in the Tokens tab. Source lives in the repo's docs/design | PASS | ux script: imported-screen.html → 'Imported screen' board; .out/ux/p6-73-import.png | – |
| 74 | Help docs | AI review (accessibility, contrast, hierarchy) and 2–3 variant requests | Via chat | Chat quick actions 'AI review: accessibility, contrast, hierarchy' (suggestions only), '3 variants of this screen' (3 variants automatically), board context menu 'Ask AI for a review', check lists 'Ask AI to fix' | PASS | ux script: 3 variants → variant count 3, draft prefilled; .out/ux/p6-74-chat-actions.png | M |

## K. UI/UX parity

Skipped because `tools/design-canvas/reference/` doesn't exist. Added `reference/` to `.gitignore` so it isn't committed. Claude Design captures (or screen recordings) needed for comparison:

1. Full canvas (several boards, with large titles and sticky notes visible)
2. Board selection (label, resize handles)
3. Element selection and Properties panel
4. Text editing in progress
5. Note and shape toolbar
6. Page tabs (add, rename)
7. Play (in place, full screen)
8. Comments (pins, list, replies)
9. All three context menus (on a board, on an element, on empty canvas)
10. Chat panel (with selection attached, in progress)
11. Layer list (expanded, dragging)
12. Layout guide settings
13. Errored board indicator and "fix it"

## Top 10 MISSING items needed to claim "same as Claude Design"

| Rank | # | Feature | Size |
| --- | --- | --- | --- |
| 1 | 49 | In-canvas chat panel (claude -p / codex exec, streaming, cancel, agent choice). #74 review and variant requests go here too | L |
| 2 | 2 | Create, delete, duplicate, rename boards (blank board = new HTML) | M |
| 3 | 19 | Drag elements to move, resize, align | L |
| 4 | 15 | Draw shapes, lines, arrows, images | L |
| 5 | 65 | Context menus (board, element, empty canvas) | M |
| 6 | 57 | Undo for canvas operations (boards, notes, pages) | M |
| 7 | 31 | Refresh embedded boards (iframe) when their source changes | S |
| 8 | 36 | Errored board list and "Ask AI to fix" | M |
| 9 | 7·8 | Single-board full-screen view (launch.view) and page-style boards (expand: fill) | M |
| 10 | 10 | Layout guides | L |

Outside the ranking but recommended first for safety: #64 atomic writes (S). If the server dies mid-edit, the source HTML can get truncated.

## Proposed implementation order (after approval)

| Order | Item | Reason | Estimate |
| --- | --- | --- | --- |
| 0 | #64 Atomic writes | Safeguard for source files, small | 0.5h |
| 1 | #31 Embedded board refresh | Flow diagrams become correct right away, small | 0.5h |
| 2 | #2 Board management | Foundation for other features (context menu, templates) | 2h |
| 3 | #65 Context menus | Gathers board and element actions in one place | 1.5h |
| 4 | #57 Canvas undo | Needed for board management and note operations | 1.5h |
| 5 | #7·#8 Focus view, expand fill | Cleans up view modes | 2h |
| 6 | #36 Errored board list | Input for chat's "fix it" | 1.5h |
| 7 | #49 Chat panel | Hub for sending selection, errors, comments to the agent | 4h |
| 8 | #19 Element drag, resize, align | Largest editing feature, extends source patching | 5h |
| 9 | #15 Shapes and images | Adds a canvas layer (extends board.json format) | 4h |
| 10 | #10 Layout guides | Extends board options format | 3h |
| | | Total | ~25.5h |
