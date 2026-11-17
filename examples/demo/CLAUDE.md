# Intercut No.14 · notes for agents

A city film festival: brand, site, phone app (390×844), desktop timetable, campaign. Each board is one hand-written HTML file in `screens/`. Edit them with your file edit tool; there is nothing to build, measure or run, so no scripts and no shell.

- Every board opens with the same base block (fonts, `:root` colour tokens, `.display`, `.mono`, `.splice`). Colours are `var(--token)` named after `tokens.json` (theme Night; `home-daylight.html` uses Daylight in its `:root`).
- Type: `.display` is Anton caps in a box exactly cap-high; `.mono` is JetBrains Mono small print. Sizes come from `tokens.json`. No need to measure the fonts: an Anton cap is about 0.45em wide, so a 120px phone title holds about seven letters, and a line may run off the right edge on purpose (the board crops it).
- The splice: add `splice` to one `.display` line; its filter is in the `<svg class="defs">` at the end of the body. Only the "now" line is spliced.
- Patterns to copy: `.film-row` (time, title, cinema), `.day-cell`, `.ticket-bar`, `.fact`, and the scannable ticket QR, an image any board can reuse: `<img class="qr" src="../assets/ticket-qr.svg" alt="Ticket code 14-0603-C1-F12">` (as in `ticket.html`).
