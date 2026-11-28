---
description: Make N alternatives of a screen side by side on the Easel canvas (default 3) for you to pick from
argument-hint: "[screen] [how many] [direction…]"
---

Make alternatives of a screen on the Easel canvas, following the `easel` skill (load it if it is not loaded yet).

Request: $ARGUMENTS

- **Which screen**: the board named in the request (a file like `signup.html` or a board title). If none is named, use the board selected on the canvas (`get_selection`: `selection.file`, else the only entry of `selectedArtboards`). If that is still unclear, list the boards and ask.
- **How many**: the number in the request, else 3. More than 6: ask first.
- **Direction**: anything else in the request is the brief every variant must meet.

Steps:

1. Make sure the canvas is running (`npx -y easel-canvas@latest up` prints its URL; it never starts a second one).
2. `read_board` the original, `get_tokens`, and `list_boards` for its position and size and for free space below it.
3. Choose N clearly different directions (layout, hierarchy, density, emphasis), each named in a few words. Not colour swaps.
4. Write each to a new file `<stem>-v1.html` … `<stem>-vN.html` with `write_board`, starting from the original's HTML. Do not change the original.
5. `place_board` each in one row below the original: `y` = original `y` + height + 120, `x` = original `x` + i × (width + 80), title `Variant i: <direction>`.
6. `check_tokens` each file and fix what it reports; `screenshot` each and fix anything broken or cramped.
7. `add_comment` on the original listing the N directions in one line each, then tell the person the file names and ask which one to keep. Do not delete, merge or rename anything until they choose.
