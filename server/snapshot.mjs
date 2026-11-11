// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// git snapshots instead of versions: commits only the design folder (author from git config) and lists recent snapshots.
// No restore (use git directly). Commits only the design folder path so other staged files are not mixed in.
// Outside a git repository a snapshot is a folder copy in <design dir>/.easel/snapshots/ (kind "copy").
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { copySnapshot, listSnapshotCopies } from "./copies.mjs";
import { readBody, sendJson } from "./index.mjs";

export function git(cwd, args) {
  return new Promise((resolve) => {
    const p = spawn("git", args, { cwd, windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve({ code: -1, out, err: e.message }));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

async function repoOf(dir) {
  const r = await git(dir, ["rev-parse", "--show-toplevel"]);
  return r.code === 0 ? r.out.trim() : null;
}

export function snapshotRoutes() {
  return [
    [
      "GET",
      "/api/me",
      async (req, res, url, ctx) => {
        const r = await git(ctx.dir, ["config", "user.name"]);
        sendJson(res, 200, { name: r.code === 0 ? r.out.trim() : process.env.USER ?? "" });
      },
    ],
    [
      "GET",
      "/api/snapshots",
      async (req, res, url, ctx) => {
        const root = await repoOf(ctx.dir);
        const copies = await listSnapshotCopies(ctx.dir);
        if (!root) return sendJson(res, 200, { git: false, snapshots: copies.slice(0, 15), changed: 0 });
        const rel = path.relative(root, await fs.realpath(ctx.dir)) || "."; // resolve links like /var → /private/var before comparing
        const log = await git(root, ["log", "-n", "15", "--format=%h%x09%an%x09%ar%x09%s%x09%aI", "--", rel]);
        const st = await git(root, ["status", "--porcelain", "--", rel]);
        const branch = (await git(root, ["branch", "--show-current"])).out.trim();
        sendJson(res, 200, {
          git: true,
          branch,
          changed: st.out.split("\n").filter(Boolean).length,
          snapshots: [
            ...log.out.split("\n").filter(Boolean).map((l) => {
              const [hash, author, when, subject, at] = l.split("\t");
              return { hash, author, when, subject, at, kind: "git" };
            }),
            ...copies,
          ]
            .sort((a, b) => new Date(b.at) - new Date(a.at))
            .slice(0, 15),
        });
      },
    ],
    [
      "POST",
      "/api/snapshot",
      async (req, res, url, ctx) => {
        const b = await readBody(req);
        const root = await repoOf(ctx.dir);
        const msg = String(b.message ?? "").trim() || `design: snapshot ${new Date().toLocaleString("en-US")}`;
        if (!root) {
          const me = await git(ctx.dir, ["config", "user.name"]);
          const { name } = await copySnapshot(ctx.dir, { message: msg, author: me.code === 0 ? me.out.trim() : process.env.USER ?? "" });
          return sendJson(res, 200, { ok: true, kind: "copy", hash: name, path: `.easel/snapshots/${name}`, message: msg });
        }
        const rel = path.relative(root, await fs.realpath(ctx.dir)) || "."; // resolve links like /var → /private/var before comparing
        const add = await git(root, ["add", "--", rel]);
        if (add.code !== 0) return sendJson(res, 500, { error: add.err.trim() || "git add failed" });
        const diff = await git(root, ["diff", "--cached", "--quiet", "--", rel]);
        if (diff.code === 0) return sendJson(res, 200, { ok: true, nothing: true });
        // Commit only the design folder path (other staged changes stay as they are). Hooks still run
        const c = await git(root, ["commit", "-m", msg, "--", rel]);
        if (c.code !== 0) return sendJson(res, 500, { error: (c.err || c.out).trim().split("\n").slice(-3).join("\n") || "git commit failed" });
        const hash = (await git(root, ["rev-parse", "--short", "HEAD"])).out.trim();
        sendJson(res, 200, { ok: true, kind: "git", hash, message: msg });
      },
    ],
  ];
}
