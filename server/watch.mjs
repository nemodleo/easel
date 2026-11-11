// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Design folder watcher: when HTML changes, notify so only that board is redrawn; new files are auto-placed in board.json. PLAN.md ch. 7 M2.
// Changes the app did not make (agents' own file tools, editors) are handed to the undo history, which records them as steps.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import chokidar from "chokidar";

import { createDeps } from "./deps.mjs";
import { toPosix } from "./fsutil.mjs";

export function watchDesign({ dir, store, broadcast, history }) {
  const screensDir = store.screensDir;
  const watcher = chokidar.watch([screensDir, store.boardPath], {
    ignoreInitial: true,
    // Ignore iCloud placeholders (.icloud) and hidden files (PLAN.md ch. 9)
    ignored: (p) => {
      const base = path.basename(p);
      return base.startsWith(".") || base.endsWith(".icloud");
    },
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
  });

  const deps = createDeps(screensDir);
  // On an outside rename (same content deleted then created), move the board position/title to the new name
  const hashes = new Map(); // file → content sha1
  const removed = []; // { file, hash, at }
  const sha = (t) => crypto.createHash("sha1").update(t).digest("hex");
  store.listScreenFiles().then(async (files) => {
    for (const f of files) hashes.set(f, sha(await fs.readFile(path.join(screensDir, f), "utf8").catch(() => "")));
  });
  store.listScreenFiles().then((files) => deps.init(files));
  let syncTimer = null;
  const scheduleSync = () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        const { added } = await store.syncBoard();
        broadcast({ type: "board-changed", source: added ? "server:auto-place" : "server:files" });
      } catch (e) {
        console.error("board sync failed", e);
      }
    }, 150);
  };

  async function followRename(from, to) {
    await store.exclusive(async () => {
      const board = await store.readBoard();
      if (!board.boards[from]) return;
      if (board.boards[to] && !board.boards[to].autoPlaced) return; // already moved if the rename came from the app
      const old = board.boards[from];
      board.boards[to] = { ...old, ...(old.title === from.replace(/\.html$/, "") ? { title: to.replace(/\.html$/, "") } : {}) };
      delete board.boards[from];
      board.order = board.order.filter((f) => f !== to).map((f) => (f === from ? to : f));
      await store.writeBoard(board);
    });
    broadcast({ type: "board-changed", source: "server:rename" });
  }

  // Compared with the last known content inside exclusive, so an app write still in flight has been recorded first
  const track = (p) =>
    history &&
    store
      .exclusive(() => history.observe([p]))
      .then((step) => step && broadcast({ type: "history-changed" }))
      .catch((e) => console.error("tracking an outside change failed", e));

  watcher.on("all", async (event, abs) => {
    if (abs === store.boardPath) {
      void track(store.boardPath);
      // Do not notify for content this server just wrote (avoids echoing our own saves)
      try {
        const now = await fs.readFile(abs, "utf8");
        if (now === store.lastWritten()) return;
      } catch {
        /* notify if deleted */
      }
      broadcast({ type: "board-changed", source: "server:external" });
      return;
    }
    if (!abs.endsWith(".html")) return;
    const file = toPosix(path.relative(screensDir, abs));
    const kind = event === "add" ? "add" : event === "unlink" ? "unlink" : "change";
    void track(path.join(screensDir, file));
    if (kind === "unlink") {
      deps.remove(file);
      if (hashes.has(file)) removed.push({ file, hash: hashes.get(file), at: Date.now() });
      hashes.delete(file);
    } else {
      await deps.update(file);
      const h = sha(await fs.readFile(abs, "utf8").catch(() => ""));
      hashes.set(file, h);
      if (kind === "add") {
        const i = removed.findIndex((r) => r.hash === h && Date.now() - r.at < 5000);
        if (i >= 0) {
          const [r] = removed.splice(i, 1);
          await followRename(r.file, file).catch((e) => console.error("failed to follow rename", e));
        }
      }
    }
    broadcast({ type: "file-changed", file, kind });
    // Also redraw boards that embed this screen (flow diagrams etc.)
    for (const host of deps.dependents(file)) broadcast({ type: "file-changed", file: host, kind: "change", via: file });
    if (kind !== "change") scheduleSync();
  });

  return () => watcher.close();
}
