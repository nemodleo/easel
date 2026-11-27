# Easel MCP tools

The `easel` MCP server (`npx -y -p easel-canvas easel-mcp`) finds the canvas running for the folder the agent works in (each canvas registers itself in `~/.easel/servers/`). Every tool talks to that canvas; when none is running, the call fails with `Easel is not running for this project` (run `npx -y easel-canvas@latest up`, then call again). File names are relative to the screens folder, e.g. `home.html`.

## See

| Tool | Arguments | Returns / does |
| --- | --- | --- |
| `list_boards` | `page?` | `dir` (screens folder, relative to the project), `pages`, `boards` (file, title, x, y, w, h, page, `editing` = who is writing it now, `origin` for a variant or fork), `missingFiles` |
| `read_board` | `file` | The board's HTML exactly as stored |
| `get_selection` | none | What the person is looking at: `selection` (clicked element: file, `path` like `0/2/1`, tag, text, outerHTML up to 4 KB, computed styles), `mode` (canvas, edit, focus, play), `page`, `visibleArtboards`, `selectedArtboards`, `dirty`, recent `edits`, `erroredArtboards`, `firstError` |
| `screenshot` | `file`, `path?` | PNG of the board or one element, returned inline, saved under `<design folder>/.easel/screenshots/`. Needs Playwright's Chromium (`npx playwright install chromium`); if it is missing, say so and rely on `check_tokens` / `list_errors` |
| `list_errors` | none | Boards with script errors, failed images, missing files, and the first error |
| `get_tokens` | none | `tokens.json`: colours per theme, font sizes, weights, radii, spacing, fonts, minimum tap target. `registered: false` when the project has none: keep to the file's existing styles |
| `check_tokens` | `file?` | Off-token colours, font sizes, weights, radii, and spacing not a multiple of 4, per file (all screens when `file` is omitted). `registered: false` means there is nothing to check against |

## Write

| Tool | Arguments | Returns / does |
| --- | --- | --- |
| `claim_board` | `file` | Call before editing an existing board with your own file tools. Returns `{ file, forked, message }`: edit the returned `file`. When another agent is editing the board, that is a fork beside it (`forked: true`) |
| `write_board` | `file`, `html` | Writes the whole board through Easel (also creates a new file, which is then placed on the canvas). Same fork rule as `claim_board`; keep writing to the file it names |
| `create_board` | `file?`, `title?`, `template?` (`blank`, `mobile` 390×844, `desktop` 1440×900, `doc`), `x?`, `y?`, `w?`, `h?`, `page?` | New board from a template, placed on the canvas; edit the file afterwards |
| `place_board` | `file`, `x?`, `y?`, `title?`, `page?` | Sets a board's position, title and page in `board.json` |

Boards you claimed or wrote are released when your MCP session ends.

## Talk

| Tool | Arguments | Returns / does |
| --- | --- | --- |
| `list_comments` | `file?`, `unresolved?` | Comments (`docs/design/comments.json`) for one board or all, optionally only unresolved ones |
| `add_comment` | `file`, `text`, `path?`, `author?` | Comment on a board or an element; the author defaults to your agent's name |
| `reply_comment` | `id`, `text`, `resolve?`, `author?` | Reply, and with `resolve: true` also resolve |
| `resolve_comment` | `id`, `resolved?` | Resolve (or reopen with `resolved: false`) |

## Arrange

| Tool | Arguments | Returns / does |
| --- | --- | --- |
| `list_notes` | `page?` | Canvas notes (titles and sticky notes) |
| `add_note` | `kind` (`title` or `sticky`), `text`, `x`, `y`, `w?`, `page?` | Adds a note, e.g. a title above a row of variants |
| `update_note` | `id`, `text?`, `x?`, `y?`, `w?`, `page?`, `color?`, `size?`, `bold?`, `italic?` | Edits a note |
| `delete_note` | `id` | Deletes a note (the person can undo it) |
| `list_pages` | none | Canvas pages; the first is the default |
| `manage_page` | `action` (`add`, `rename`, `delete`, `move`), `id?`, `name?`, `index?` | Manages pages; a deleted page's items move to the first page |
| `save_snapshot` | `message?` | Commits only the design folder to git (or copies it to `.easel/snapshots/` outside git). Only when the person asks to save |

Everything an agent changes lands in the canvas's undo history, tagged with the agent's name, so the person can take it back.
