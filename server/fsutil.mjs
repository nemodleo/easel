// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Atomic writes: write to a temp file (.dc-tmp-*) in the same folder, then rename over the original.
// If the server dies mid-write, the original holds either the old or the new content. The watcher ignores files starting with a dot.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function writeAtomic(file, text) {
  const tmp = path.join(path.dirname(file), `.dc-tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  try {
    await fs.writeFile(tmp, text, "utf8");
    // Preserve the original file's permissions
    const st = await fs.stat(file).catch(() => null);
    if (st) await fs.chmod(tmp, st.mode & 0o777);
    await renameRetry(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/** On Windows, watchers/antivirus may briefly hold the file so rename fails with EPERM/EBUSY → wait a bit and retry */
async function renameRetry(from, to, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      return await fs.rename(from, to);
    } catch (e) {
      if (i >= tries - 1 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 30 * (i + 1)));
    }
  }
}

/** Repo root: two levels up for docs/design, otherwise (temp folders in tests) the folder itself */
export const rootOf = (dir) => (dir.endsWith(path.join("docs", "design")) ? path.resolve(dir, "../..") : dir);

/** Canvas name: the project folder (relay for /x/relay/docs/design), else the design folder's own name */
export const projectName = (dir) => path.basename(rootOf(dir));

/** <title> of an HTML file, trimmed and unescaped; null when missing or empty */
export function htmlTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html ?? ""));
  const t = m?.[1]
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " })[e])
    .replace(/\s+/g, " ")
    .trim();
  return t ? t.slice(0, 120) : null;
}

/** OS path (\\ or /) → / path for URLs and board.json */
export const toPosix = (rel, sep = path.sep) => rel.split(sep).join("/");
