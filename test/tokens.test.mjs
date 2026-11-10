// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Off-token value lint and tweaks value updates
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { applyEdit } from "../server/edit.mjs";
import { DEFAULT_TOKENS, lintHtml, readTokens, tokenRoutes, tokensForAgent, toHex } from "../server/tokens.mjs";
import { ko } from "./fixtures/ko-strings.mjs";

test("color normalization: #abc, #aabbcc, rgb; translucent colors are not checked", () => {
  assert.equal(toHex("#c94f0c"), "#C94F0C");
  assert.equal(toHex("#fff"), "#FFFFFF");
  assert.equal(toHex("rgb(17, 17, 17)"), "#111111");
  assert.equal(toHex("rgba(255,255,255,0.82)"), null);
});

test("lint: off-token color, font size, radius and non-4px spacing, with path and line", () => {
  const html = `<!doctype html><html><head><style>
.a{color:#123456;font-size:13px}
.b{color:#111111;font-size:17px}
</style></head><body>
<div style="gap:10px;border-radius:16px">
  <p style="color:#C94F0C;font-size:15px;border-radius:12px">x</p>
</div>
</body></html>`;
  const w = lintHtml(html, DEFAULT_TOKENS);
  const msgs = w.map((x) => `${x.path ?? "-"}@${x.line}:${x.prop}=${x.value}`);
  assert.deepEqual(msgs.sort(), ["-@2:color=#123456", "-@2:font-size=13px", "0/0@6:border-radius=12px", "0@5:gap=10px"].sort());
});

test("setTweaks: changes only value and keeps the other keys", () => {
  const html = `<html><head><script type="application/json" id="board-tweaks">{"dense":{"type":"boolean","value":false,"var":"--dense","label":${JSON.stringify(ko.denseLabel)}}}</script></head><body></body></html>`;
  const out = applyEdit(html, { op: "setTweaks", values: { dense: true, nope: 1 } });
  const json = JSON.parse(out.match(/id="board-tweaks">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(json, { dense: { type: "boolean", value: true, var: "--dense", label: ko.denseLabel } });
});

/** Calls one GET route of tokenRoutes() with a minimal ctx and returns the JSON body */
async function get(dir, p) {
  const url = new URL(p, "http://x");
  const [, , handler] = tokenRoutes().find((r) => r[0] === "GET" && r[1] === url.pathname);
  const ctx = { dir, store: { screensDir: path.join(dir, "screens"), listScreenFiles: async () => ["a.html"] } };
  let body;
  const res = { writeHead() {}, end: (t) => (body = JSON.parse(t)) };
  await handler({}, res, url, ctx);
  return body;
}

test("no tokens.json: check_tokens finds nothing, get_tokens gives no palette; registered projects unchanged", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dc-tokens-"));
  try {
    await fs.mkdir(path.join(dir, "screens"));
    await fs.writeFile(path.join(dir, "screens/a.html"), `<body><p style="color:#123456;font-size:13px">x</p></body>`);
    assert.equal((await readTokens(dir)).registered, false);
    const lint = await get(dir, "/api/lint");
    assert.equal(lint.registered, false);
    assert.deepEqual(lint.files, {});
    assert.match(lint.note, /No design tokens are registered/);
    const agent = await get(dir, "/api/tokens?agent=1");
    assert.equal(agent.registered, false);
    assert.equal(agent.themes, undefined);
    assert.doesNotMatch(JSON.stringify(agent), /C94F0C|Pretendard/);
    // The app's Tokens tab still gets the starter values to register from
    assert.equal((await get(dir, "/api/tokens")).themes.Default.Accent, "#C94F0C");

    await fs.writeFile(path.join(dir, "tokens.json"), JSON.stringify({ active: "Default", themes: { Default: { Text: "#111111" } } }));
    const lint2 = await get(dir, "/api/lint");
    assert.equal(lint2.registered, true);
    assert.deepEqual(lint2.files["a.html"].map((w) => w.prop).sort(), ["color", "font-size"]);
    const agent2 = await get(dir, "/api/tokens?agent=1");
    assert.equal(agent2.registered, true);
    assert.deepEqual(agent2.themes, { Default: { Text: "#111111" } });
    assert.deepEqual(tokensForAgent(await readTokens(dir)), agent2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
