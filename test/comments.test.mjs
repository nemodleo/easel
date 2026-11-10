// AI-generated with Claude Code, 2026-11-10, reviewed by Hyun Park
// Comments: concurrent writes from several clients all land in comments.json
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { TOOL_ROOT } from "../server/args.mjs";
import { createServer } from "../server/index.mjs";
import { extraRoutes } from "../server/routes.mjs";

const freePort = () =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });

test("20 concurrent POST /api/comments keep all 20", { skip: !existsSync(path.join(TOOL_ROOT, "dist/index.html")) && "needs an app build (npm run build)" }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-comments-"));
  await fs.mkdir(path.join(dir, "screens"));
  await fs.writeFile(path.join(dir, "screens/a.html"), "<!doctype html><title>A</title>");
  const port = await freePort();
  const app = await createServer({ dir, port, dev: false, extraRoutes });
  try {
    const post = (body) => fetch(`http://127.0.0.1:${port}/api/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    const made = await Promise.all(Array.from({ length: 20 }, (_, i) => post({ file: "a.html", text: `c${i}`, author: i % 2 ? "one" : "two" })));
    const stored = JSON.parse(await fs.readFile(path.join(dir, "comments.json"), "utf8")).comments;
    assert.equal(stored.length, 20);
    assert.deepEqual(new Set(stored.map((c) => c.id)), new Set(made.map((m) => m.comment.id)));
    // Replies racing on the same comment are all kept too
    await Promise.all(Array.from({ length: 10 }, (_, i) => post({ action: "reply", id: made[0].comment.id, text: `r${i}` })));
    const after = JSON.parse(await fs.readFile(path.join(dir, "comments.json"), "utf8")).comments;
    assert.equal(after.find((c) => c.id === made[0].comment.id).replies.length, 10);
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
