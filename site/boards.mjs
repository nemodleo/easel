// Draws the built site onto Easel's own design canvas (docs/design): the site's real markup and stylesheet from site/dist, with
// the scripts left out, as three boards — the page at 1440, the phone's first screen and its second (How it happened) at 390.
// The boards show the stills the page starts with (the live answer frames and the embedded canvas need the page's script).
// Usage: npm run site && node site/boards.mjs   (Playwright measures the page height and where section 2 starts on a phone)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SITE);
const DIST = path.join(SITE, "dist");
const DESIGN = path.join(ROOT, "docs", "design");
const ASSETS = path.join(DESIGN, "assets", "site");
const SCREENS = path.join(DESIGN, "screens");

let html = await fs.readFile(path.join(DIST, "index.html"), "utf8");
const used = new Set();
html = html
  .replace(/<script[\s\S]*?<\/script>\n?/g, "")
  .replace('<html lang="en">', '<html lang="en" class="js">')
  .replace(/<link rel="(icon|canonical)"[^>]*>\n?/g, "")
  .replace('href="style.css"', 'href="../assets/site/style.css"')
  .replace(/ loading="lazy"/g, "")
  .replace(/src="(media|run\/stills)\/([^"]+)"/g, (m, dir, f) => {
    used.add(path.join(dir, f));
    return `src="../assets/site/${f}"`;
  })
  // the first app's panel shows; the switch hides the others, as the script does
  .replace(/ data-later/g, " hidden")
  .replace(/<div class="embed" data-embed="[^"]*">/, '<div class="embed">');
await fs.rm(ASSETS, { recursive: true, force: true });
await fs.mkdir(ASSETS, { recursive: true });
await fs.copyFile(path.join(DIST, "style.css"), path.join(ASSETS, "style.css"));
for (const f of used) await fs.copyFile(path.join(DIST, f), path.join(ASSETS, path.basename(f)));

const stamp = new Date().toISOString().slice(0, 10);
const board = (title, w, h, extra) =>
  html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>\n<meta name="board-size" content="${w}x${h}">`)
    .replace(
      "</head>",
      `<style>\n/* Drawn from the built site (site/dist, ${stamp}) by site/boards.mjs; edit the site, not this file. */\nhtml,body{width:${w}px;height:${h}px;overflow:hidden}html{scroll-behavior:auto}${extra ?? ""}\n</style>\n</head>`,
    );

// Measure on a page with the board's own markup
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const tmp = path.join(SCREENS, "site-page.html");
await fs.writeFile(tmp, board("Site · page 1440", 1440, 900));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
await page.addStyleTag({ content: "html,body{height:auto!important;overflow:visible!important}" });
const fullH = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
const phoneFile = path.join(SCREENS, "site-phone.html");
await fs.writeFile(phoneFile, board("Site · phone, first screen", 390, 844));
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(pathToFileURL(phoneFile).href, { waitUntil: "load" });
await phone.addStyleTag({ content: "html,body{height:auto!important;overflow:visible!important}" });
const runTop = await phone.evaluate(() => Math.round(document.getElementById("run").getBoundingClientRect().top + scrollY));
await browser.close();

await fs.writeFile(tmp, board("Site · page 1440", 1440, fullH));
await fs.writeFile(path.join(SCREENS, "site-phone.html"), board("Site · phone, first screen", 390, 844));
await fs.writeFile(path.join(SCREENS, "site-phone-2.html"), board("Site · phone, how it happened", 390, 844, `body{position:relative;top:-${runTop}px;height:auto}`));
console.log(`Boards: site-page.html 1440×${fullH}, site-phone.html 390×844, site-phone-2.html 390×844 (from ${runTop}px) · assets/site/ ${used.size + 1} files`);
