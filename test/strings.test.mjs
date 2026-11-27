// AI-generated with Claude Code, 2026-11-27
// Korean UI (#1), app/src/strings.ts: ko has exactly en's keys, every function takes the same arguments and gives text in both
// languages, Korean copy has no exclamation marks, particles follow the word before them, and the language pick prefers the
// View menu's choice, then the browser (ko-* → Korean, everything else, en-* included → English)
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import ts from "typescript";

import { TOOL_ROOT } from "../server/args.mjs";

let m, tmp;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dc-str-"));
  const src = await fs.readFile(path.join(TOOL_ROOT, "app/src/strings.ts"), "utf8");
  await fs.writeFile(path.join(tmp, "strings.mjs"), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  m = await import(path.join(tmp, "strings.mjs"));
});
after(() => tmp && fs.rm(tmp, { recursive: true, force: true }));

/** Every leaf as [path, value] */
function leaves(o, p = "") {
  if (typeof o !== "object" || o === null) return [[p, o]];
  return Object.entries(o).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k));
}
/** Call a string function with sample arguments, by its parameter count: numbers first, words when it needs text */
const call = (fn, sample) => {
  try {
    return fn(...Array.from({ length: fn.length }, () => sample));
  } catch {
    return fn(...Array.from({ length: fn.length }, () => `w${sample}`));
  }
};

test("ko has the same keys as en, the same kinds of value, and functions with the same number of arguments", () => {
  const { en, ko } = m.languages;
  const e = new Map(leaves(en));
  const k = new Map(leaves(ko));
  assert.deepEqual([...k.keys()].sort(), [...e.keys()].sort());
  for (const [p, v] of e) {
    assert.equal(typeof k.get(p), typeof v, p);
    if (typeof v === "function") assert.equal(k.get(p).length, v.length, `${p} arguments`);
  }
});

test("every function gives text in both languages, for one and for many", () => {
  for (const [name, lang] of Object.entries(m.languages))
    for (const [p, v] of leaves(lang)) {
      if (typeof v !== "function") continue;
      for (const sample of [1, 3]) {
        const out = p === "activity.change" ? v({ kind: "added", count: sample }) : p === "inspector.kindName" ? v("button") : call(v, sample);
        assert.equal(typeof out, "string", `${name} ${p}`);
        assert.doesNotMatch(out, /undefined|\[object/, `${name} ${p}`);
      }
    }
});

test("Korean copy: no exclamation marks, product and agent names stay in English", () => {
  const { ko } = m.languages;
  for (const [p, v] of leaves(ko)) if (typeof v === "string") assert.doesNotMatch(v, /!/, p);
  assert.equal(ko.app.title, "Easel");
  assert.match(ko.chat.noPause.codex, /^Codex exec/);
  assert.equal(ko.menu.undo, "실행 취소");
  assert.equal(ko.share.button, "공유");
  assert.equal(ko.tabs.properties, "속성");
  assert.equal(ko.tabs.boards, "보드");
});

test("Korean counts put the number after the noun, with no plural forms", () => {
  const { ko, en } = m.languages;
  assert.equal(en.toast.boardsDeleted(1), "Deleted 1 board");
  assert.equal(en.toast.boardsDeleted(3), "Deleted 3 boards");
  assert.equal(ko.toast.boardsDeleted(1), "보드 1개를 삭제했어요");
  assert.equal(ko.toast.boardsDeleted(3), "보드 3개를 삭제했어요");
  assert.equal(ko.menu.snapshotStatus("main", 2), "스냅샷 · main · 바뀐 파일 2개");
  assert.equal(ko.activity.tag("Claude Code", "2분", 1, true), "Claude Code · 2분 · 새 보드");
});

test("Korean particles follow the last sound of the word before them", () => {
  const { ko } = m.languages;
  assert.equal(ko.occupancy.waitFor("민수"), "민수가 편집을 마칠 때까지 기다려요");
  assert.equal(ko.occupancy.waitFor("지현"), "지현이 편집을 마칠 때까지 기다려요");
  assert.equal(ko.toast.duplicated("scr-02-copy.html"), "scr-02-copy.html로 복제했어요", "l: 로");
  assert.equal(ko.toast.wrapped("grid"), "grid로 감쌌어요");
  assert.equal(ko.chat.switchTo("Claude Code"), "Claude Code로 바꾸기");
  assert.equal(ko.chat.sendNeedsInstall("Gemini CLI"), "보내려면 Gemini CLI를 설치해요");
  assert.equal(ko.toast.pngExported("scr-32.png"), "scr-32.png를 내려받았어요");
  assert.equal(ko.update.out("0.3.0"), "Easel 0.3.0이 나왔어요", "0 is 영");
  assert.equal(ko.update.out("0.3.2"), "Easel 0.3.2가 나왔어요", "2 is 이");
  assert.equal(ko.toast.copiedElement("div", "⌘"), "<div>를 복사했어요. 다른 보드를 편집하면서 ⌘V로 붙여 넣어요");
  assert.equal(ko.toast.imageReplaced("사진.png"), "이미지를 사진.png로 바꿨어요");
  assert.equal(ko.toast.uploaded("…"), "…을(를) 올렸어요", "unreadable: both forms");
});

test("pickLang: the saved choice first, then ko-* is Korean, en-* and anything else English", () => {
  const { pickLang } = m;
  assert.equal(pickLang(null, "en-US"), "en");
  assert.equal(pickLang(null, "en-GB"), "en");
  assert.equal(pickLang(null, "en"), "en");
  assert.equal(pickLang(null, "ko"), "ko");
  assert.equal(pickLang(null, "ko-KR"), "ko");
  assert.equal(pickLang(null, "KO-kr"), "ko");
  assert.equal(pickLang(null, "kok"), "en", "Konkani is not Korean");
  assert.equal(pickLang(null, "ja-JP"), "en");
  assert.equal(pickLang(null, undefined), "en");
  assert.equal(pickLang("en", "ko-KR"), "en", "the View menu's choice wins");
  assert.equal(pickLang("ko", "en-US"), "ko");
  assert.equal(pickLang("fr", "en-US"), "en", "an unknown saved value is ignored");
});

test("outside a browser (tests, the server) the strings are English", () => {
  assert.equal(m.lang, "en");
  assert.equal(m.strings, m.languages.en);
  assert.equal(m.LANG_KEY, "design-canvas:lang");
  assert.deepEqual(m.LANGUAGES.map((l) => l.name), ["English", "한국어"]);
});
