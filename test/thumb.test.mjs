// AI-generated with Claude Code, 2026-11-06, reviewed by Hyun Park
// Thumbnail sizes (#8) and the shared screenshot browser coming back after it dies (#7)
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { cachedBrowser, closeBrowser, newPage, thumbPx } from "../server/routes.mjs";

after(() => closeBrowser());

test("thumbPx snaps to the next size up, defaults to 600 and caps at 2400", () => {
  assert.equal(thumbPx(null), 600);
  assert.equal(thumbPx("abc"), 600);
  assert.equal(thumbPx("1"), 600);
  assert.equal(thumbPx("600"), 600);
  assert.equal(thumbPx("601"), 1200);
  assert.equal(thumbPx("2400"), 2400);
  assert.equal(thumbPx("99999"), 2400);
});

test("newPage launches a fresh browser after the cached one exits", async (t) => {
  const p1 = await newPage().catch(() => null);
  if (!p1) return t.skip("no Chromium for playwright");
  await p1.close();
  const b1 = await cachedBrowser();
  assert.ok(b1?.isConnected());
  await b1.close(); // the browser goes away behind the server's back
  const p2 = await newPage();
  try {
    assert.equal(await p2.evaluate(() => 1 + 1), 2);
    const b2 = await cachedBrowser();
    assert.notEqual(b2, b1);
    assert.ok(b2.isConnected());
  } finally {
    await p2.close();
  }
});
