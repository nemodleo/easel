# Boards and the design folder

```
docs/design/            the design folder (or any folder with screens/, opened with --dir)
├── screens/*.html      one board per file: you write these
├── assets/             fonts, images, SVGs the screens use (../assets/… from a screen)
├── tokens.json         design tokens (optional; read them with get_tokens)
├── board.json          positions, titles, pages, notes: Easel's, change it with the tools
├── comments.json       comments: Easel's, change it with the comment tools
└── .easel/             screenshots, snapshots, run copies: Easel's, git-ignored
```

## A board file

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="board-size" content="390x844">
<title>Sign up</title>
<style>
  :root { --ink: #111111; --field: #FFFFFF; }
  body { margin: 0; background: var(--field); color: var(--ink); }
</style>
</head>
<body>
  …
</body>
</html>
```

- `board-size` sets the board's size on the canvas (common sizes: 390x844 phone, 1440x900 desktop). A new file with it is placed automatically; `place_board` then names and positions it. `<title>` is the board's default title.
- Self-contained: styles inline in `<style>`, no build step, no external frameworks or CDNs unless the project already uses them, assets by relative path. Scripts are allowed for interactive boards; the person plays them with Play.
- Reuse what is already there: copy the base block (fonts, `:root` variables, shared classes) from the project's other screens so a new board matches them. A `CLAUDE.md` or README in the design folder may describe the patterns to reuse.
- Tokens: colours, font sizes, weights and radii from `get_tokens`, spacing in multiples of 4. `check_tokens` lists what is off.
- Edit surgically. The person edits the same files on the canvas, and Easel patches only the source range they change; keep your edits to what was asked, so their formatting and edits survive.

## Several agents, several people

- `list_boards` shows `editing` on a board another agent is writing. Leave it alone, or `claim_board` it and work on the fork you are given.
- A fork is named after the agent and sits beside the original; the person picks a version on the canvas ("Use this one").
- Variants you make for the person to choose from are ordinary boards in a row below the original, titled `Variant N: …`. Delete or merge only after they choose.
