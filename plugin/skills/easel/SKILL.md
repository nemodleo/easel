---
name: easel
description: Design, redesign, compare or review UI screens on Easel, a local design canvas where each screens/*.html file in the repo is one board the person sees live. Use when the person asks to design or mock up a screen, make alternatives or variants side by side, change "the selected element" or "this screen" on the canvas, review UI or fix comments left on boards, or when the project has a docs/design (or screens/) folder and the work is visual.
license: MIT
metadata:
  homepage: https://github.com/nemodleo/easel
---

# Easel

Easel shows a folder of plain HTML files as boards on a canvas in the browser. Each `screens/<name>.html` is one board. You write the HTML; the person sees it redraw a moment later, edits it on the canvas, and leaves comments. The `easel` MCP tools let you see what they see (boards, selection, screenshots), talk (comments) and arrange (placement, notes, pages).

## 1. Make sure a canvas is running for this project

Run, from the project root:

```bash
npx -y easel-canvas@latest up
```

It prints the canvas URL and exits. It never starts a second canvas for the same folder: if one is running it just prints that one. It opens `./docs/design`, or the current folder when it has `screens/`; pass `--dir <folder>` for another one. Tell the person the URL.

- `No design folder at …`: say there is no design folder yet and ask before creating one; then run `npx -y easel-canvas@latest up --init` (creates `docs/design/screens/home.html`).
- Check without starting anything: `npx -y easel-canvas@latest status --json` (`running`, `url`, `dir`; exit 1 when none).
- If an `easel` tool says `Easel is not running for this project`, run `up` and call the tool again. If it says `Several Easel canvases are running`, work from the project folder or ask which one.
- No `easel` tools at all: the MCP server is not configured for this agent. You can still edit the HTML files; suggest `npx easel-canvas connect` (then restart the agent) for the tools.

## 2. The working loop

1. **Look.** `list_boards` (files, titles, sizes, positions, who is editing). For "this", "the selected …" or "what I'm looking at", call `get_selection` first. `list_comments` with `unresolved: true` when asked to address feedback.
2. **Read** the board with `read_board` (or your file tools) before changing it. Call `get_tokens` before writing styles.
3. **Claim, then write.** Before editing an existing board with your own file tools, call `claim_board` and edit **the file it returns**. Or send the whole HTML with `write_board`. If the reply says you are on a fork, keep writing to the fork, not the original.
4. **Check.** `check_tokens` for the files you touched (fix off-token colours, sizes, radii, spacing), `list_errors` for script errors and broken images.
5. **Look at the result.** `screenshot` the board (or an element by `path`) and actually look at it. Fix what is wrong before you report.
6. **Report on the canvas.** `add_comment` on the board with a one or two line summary of what changed and why, and `resolve_comment` / `reply_comment` for comments you addressed. Then tell the person in chat.

New screen: write `screens/<name>.html` (with `write_board`, or `create_board` for a template), include `<meta name="board-size" content="390x844">` (or the real size) and a `<title>`, then `place_board` to set its title and position next to related boards.

## 3. Alternatives side by side

When asked for options, variants or "a few directions" (default 3):

1. Read the original and the tokens. Decide N clearly different directions first (layout, hierarchy, density, emphasis), not N colour swaps; name each in a few words.
2. Write each one to its own new file, `screens/<stem>-v1.html` … `-vN.html`, starting from the original's HTML. Never change the original.
3. `place_board` each in one row below the original (`y` = original `y` + height + 120; `x` from the original's `x`, stepping by its width + 80; check `list_boards` that the row is free) with a title like `Variant 2: denser list, actions on top`.
4. `check_tokens` and `screenshot` every variant; fix any that break.
5. Summarise the N directions in one comment on the original and ask the person which to keep. Do not delete or merge anything until they choose.

## Rules

- **One writer per board.** Never edit a board someone else's agent is editing (`list_boards` shows `editing`); `claim_board`/`write_board` route you to a fork instead. Reading never needs a claim.
- **Easel owns `board.json`, `comments.json` and `.easel/`** in the design folder. Never edit them by hand: use `place_board`, `add_note`, `manage_page`, `add_comment` and the other tools. Edit only files in `screens/` (and assets you add).
- **Screens are plain HTML.** One self-contained file per board: inline `<style>`, no build step, no framework runtime, relative paths to `../assets/`. Use the project's tokens (`get_tokens`); with no `tokens.json`, keep to the styles already in the files. Change only what was asked.
- `save_snapshot` only when the person asks to save a version.

## More

- Every tool, its arguments and what it returns: [references/tools.md](references/tools.md)
- Board HTML conventions, sizes, tokens and the design folder layout: [references/boards.md](references/boards.md)
