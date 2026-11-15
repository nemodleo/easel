// AI-generated with Claude Code, 2026-11-15, reviewed by Hyun Park
// Builds docs/design/assets/easel.css (the stylesheet Easel's own design boards use) from app/src/style.css: same rules, dark keyed off a .dark class, no OS-driven dark, no entrance motion.
// Run it (`npm run design:css`) after changing app/src/style.css, so the boards in docs/design keep matching the app.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = `${root}app/src/style.css`;
const out = `${root}docs/design/assets/easel.css`;

let css = fs.readFileSync(src, "utf8");
const lines = css.split("\n");
// drop the first line (the app file's own header) and the prefers-color-scheme block
const start = lines.findIndex((l) => l.startsWith("@media (prefers-color-scheme: dark)"));
if (start < 0) throw new Error("no dark media block");
let end = start;
for (let depth = 0, i = start; i < lines.length; i++) {
  depth += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
  if (depth === 0) { end = i; break; }
}
lines.splice(start, end - start + 1);
css = lines.slice(1).join("\n");
const darkSel = ':root[data-theme="dark"] {';
if (!css.includes(darkSel)) throw new Error("no data-theme dark block");
css = css.replace(darkSel, ':root[data-theme="dark"], .dark {\n  color: var(--text); /* the board sets dark on body and .app, below :root, so the text colour is taken again here */');
const head = `/* Easel chrome for the design boards: a mirror of app/src/style.css as of 2026-11-15 (direction A, Open canvas).
   Built from that file with the same class names, so a board is the app's own markup drawn still. Differences, all for still boards:
   - Dark is the .dark class on body and .app (the app also follows the system setting; a board keeps the theme it was drawn in).
   - No entrance motion at the end of the file: a board is one frame, so menus, popovers and toasts are drawn already in place.
   When app/src/style.css changes, rebuild this file from it rather than editing both. */
`;
const tail = `
/* ---------------------------------------------------------------- Boards only: one frame, so nothing is on its way in or out */
.entering, .toast, .menu.pop, .leaving { animation: none; }
`;
const result = head + css.replace(/\s+$/, "\n") + tail;
fs.writeFileSync(out, result);
console.log(`docs/design/assets/easel.css: ${Buffer.byteLength(result)} bytes`);
