// AI-generated with Claude Code, 2026-11-15, reviewed by Hyun Park
// New-version notice: version order, the command per install, when the registry is asked, and that it stays silent
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { checkUpdate, isNewer, updateCommand } from "../server/update.mjs";

test("isNewer: x.y.z order, pre-releases never offered", () => {
  assert.equal(isNewer("0.3.0", "0.2.0"), true);
  assert.equal(isNewer("0.10.0", "0.9.9"), true);
  assert.equal(isNewer("1.0.0", "0.99.0"), true);
  assert.equal(isNewer("0.2.0", "0.2.0"), false);
  assert.equal(isNewer("0.1.1", "0.2.0"), false);
  assert.equal(isNewer("0.3.0-beta.1", "0.2.0"), false);
  assert.equal(isNewer("0.2.0", "0.2.0-beta.1"), true);
});

test("updateCommand: npx cache, a project's node_modules, a global install", () => {
  assert.equal(updateCommand("/Users/a/.npm/_npx/1f2e3d/node_modules/easel-canvas"), "npx easel-canvas@latest");
  assert.equal(updateCommand("/Users/a/code/app/node_modules/easel-canvas"), "npm i -D easel-canvas@latest");
  assert.equal(updateCommand("/opt/homebrew/lib/node_modules/easel-canvas"), "npm i -g easel-canvas@latest");
  assert.equal(updateCommand("C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\easel-canvas".split("\\").join(path.sep)), "npm i -g easel-canvas@latest");
  assert.equal(updateCommand("/Users/a/somewhere/easel"), "npx easel-canvas@latest");
});

async function setup() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "easel-update-"));
  const root = path.join(home, ".npm/_npx/abc/node_modules/easel-canvas"); // an npx install: no app/ sources
  await fs.mkdir(root, { recursive: true });
  let calls = 0;
  const reply = { status: 200, body: { version: "0.3.0" } };
  const fetchImpl = async () => (calls++, { ok: reply.status === 200, json: async () => reply.body });
  return { home, root, fetchImpl, reply, calls: () => calls };
}

test("checkUpdate: a newer version with its command, asked once a day", async () => {
  const s = await setup();
  const opts = { current: "0.2.0", env: {}, root: s.root, home: s.home, fetchImpl: s.fetchImpl };
  assert.deepEqual(await checkUpdate({ ...opts, now: 1000 }), { current: "0.2.0", latest: "0.3.0", command: "npx easel-canvas@latest" });
  assert.equal(s.calls(), 1);
  await checkUpdate({ ...opts, now: 1000 + 60 * 60 * 1000 });
  assert.equal(s.calls(), 1, "an hour later the cached answer is used");
  await checkUpdate({ ...opts, now: 1000 + 25 * 60 * 60 * 1000 });
  assert.equal(s.calls(), 2, "a day later it asks again");
  assert.equal(await checkUpdate({ ...opts, current: "0.3.0", now: 1000 }), null, "up to date: nothing");
});

test("checkUpdate: silent when it cannot or should not ask", async () => {
  const s = await setup();
  const opts = { current: "0.2.0", root: s.root, home: s.home, now: 1000 };
  assert.equal(await checkUpdate({ ...opts, env: { EASEL_NO_UPDATE_CHECK: "1" }, fetchImpl: s.fetchImpl }), null);
  assert.equal(await checkUpdate({ ...opts, env: { CI: "true" }, fetchImpl: s.fetchImpl }), null);
  const src = path.join(s.home, "checkout");
  await fs.mkdir(path.join(src, "app"), { recursive: true });
  assert.equal(await checkUpdate({ ...opts, env: {}, root: src, fetchImpl: s.fetchImpl }), null, "a source checkout updates with git");
  assert.equal(s.calls(), 0, "none of these asked the registry");
  assert.equal(await checkUpdate({ ...opts, env: {}, fetchImpl: async () => { throw new Error("offline"); } }), null);
  s.reply.status = 500;
  assert.equal(await checkUpdate({ ...opts, env: {}, fetchImpl: s.fetchImpl }), null);
  s.reply.status = 200;
  s.reply.body = { nope: true };
  assert.equal(await checkUpdate({ ...opts, env: {}, fetchImpl: s.fetchImpl }), null, "an odd answer is ignored");
});
