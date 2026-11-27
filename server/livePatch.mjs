// AI-generated with Claude Code, 2026-11-27
// Live patches: for an edit the app made, the exact DOM change that turns the board as it was loaded (before) into what a reload of
// the new source (after) would show, or null when that cannot be proven. The tab that made the edit applies it to the live board and
// skips the reload when the watcher's echo carries the same content hash (see app/src/livePatch.ts).
// Proof: the patch is replayed on parse5's tree of before (attributes set as setAttribute does, inner HTML parsed as innerHTML does,
// i.e. HTML fragment parsing in the element's context) and the result must serialize exactly like parse5's tree of after.
import crypto from "node:crypto";

import { parse, parseFragment, serialize } from "parse5";

import { elementChildren, findBody, isElement } from "./html.mjs";

/** Content hash of a whole board file: sent with file-changed, written into the served page (data-dc-src) and returned by /api/edit */
export const contentHash = (text) => crypto.createHash("sha1").update(text).digest("hex");

const HTML_NS = "http://www.w3.org/1999/xhtml";
/** Ops whose result can be patched in place; everything else (move, delete, insert, wrap, duplicate, tweaks) reloads */
const LIVE_OPS = new Set(["setText", "setStyle", "setAttr"]);
/** Inner HTML set by innerHTML differs from a page parse here (leading newline dropped by the parser, raw text, foster parenting) */
const NO_INNER = new Set("pre listing textarea title style script xmp iframe noembed noframes noscript plaintext template table tbody thead tfoot tr colgroup select option optgroup frameset head html body".split(" "));
/** Attributes that act only while the page loads, or that the person may have changed by using the board: a reload shows them anew */
const NO_ATTR = /^(on|autofocus$|value$|checked$|selected$|is$|xmlns)/i;
/** Script types that never run (data blocks) */
const DATA_SCRIPT = /^(application\/(ld\+)?json|text\/(template|plain|markdown|x-template))$/i;

/** A page whose own scripts or load-time handlers run could have changed its DOM since it loaded: only a reload shows it right */
function runsScripts(node) {
  if (isElement(node)) {
    if (node.tagName === "script") {
      const type = node.attrs.find((a) => a.name === "type")?.value?.trim() ?? "";
      if (!DATA_SCRIPT.test(type)) return true;
    }
    if (node.attrs.some((a) => /^on/i.test(a.name))) return true;
  }
  for (const c of node.childNodes ?? []) if (runsScripts(c)) return true;
  if (node.content && runsScripts(node.content)) return true;
  return false;
}

/** The element at path, the way the browser's children walk finds it (never through <template> content), or null */
function at(doc, path) {
  let node = findBody(doc);
  if (!node) return null;
  if (path === "" || path == null) return null; // body itself: its attributes reach the page's scripts and the probe; keep the reload
  for (const part of String(path).split("/")) {
    if (node.tagName === "template") return null;
    node = elementChildren(node)[Number(part)];
    if (!node) return null;
  }
  return node;
}

/** Ops of one request, flattened (batch → its ops) */
const opsOf = (req) => (req.op === "batch" ? (Array.isArray(req.ops) ? req.ops : []) : [req]);

/**
 * before, after: the board source before and after the edit; req: the /api/edit body.
 * → [{ path, tag, attrs?: [[name, value | null]], inner?: string }] or null (reload instead)
 */
export function livePatch(before, after, req) {
  const ops = opsOf(req);
  if (!ops.length || ops.some((o) => !LIVE_OPS.has(o?.op))) return null;
  const a = parse(after, { sourceCodeLocationInfo: true });
  const b = parse(before);
  if (runsScripts(a) || runsScripts(b)) return null;
  const paths = [...new Set(ops.map((o) => String(o.path ?? "")))];
  const patch = [];
  for (const p of paths) {
    const na = at(a, p);
    const nb = at(b, p);
    if (!na || !nb || na.tagName !== nb.tagName || na.namespaceURI !== HTML_NS) return null;
    const item = { path: p, tag: na.tagName };
    // Attributes: new values in after's order, then removals
    const attrs = [];
    for (const x of na.attrs) {
      const old = nb.attrs.find((y) => y.name === x.name && !y.namespace);
      if (old?.value !== x.value) attrs.push([x.name, x.value]);
    }
    for (const y of nb.attrs) if (!na.attrs.some((x) => x.name === y.name)) attrs.push([y.name, null]);
    if ([...na.attrs, ...nb.attrs].some((x) => x.namespace || x.prefix) && attrs.length) return null;
    if (attrs.some(([n]) => NO_ATTR.test(n))) return null;
    if (attrs.length) item.attrs = attrs;
    if (ops.some((o) => o.op === "setText" && String(o.path ?? "") === p)) {
      const st = na.sourceCodeLocation?.startTag;
      const et = na.sourceCodeLocation?.endTag;
      if (!st || !et || NO_INNER.has(na.tagName)) return null;
      item.inner = after.slice(st.endOffset, et.startOffset);
    }
    if (item.attrs || item.inner != null) patch.push(item);
  }
  if (!patch.length) return null;
  // Replay on before's tree and compare with after's: anything else that changed (or a parse difference) means reload
  for (const item of patch) {
    const node = at(b, item.path);
    for (const [name, value] of item.attrs ?? []) {
      const i = node.attrs.findIndex((x) => x.name === name);
      if (value == null) {
        if (i >= 0) node.attrs.splice(i, 1);
      } else if (i >= 0) node.attrs[i] = { ...node.attrs[i], value };
      else node.attrs.push({ name, value });
    }
    if (item.inner != null) {
      const frag = parseFragment(node, item.inner);
      node.childNodes = frag.childNodes;
      for (const c of node.childNodes) c.parentNode = node;
    }
  }
  return serialize(b) === serialize(parse(after)) ? patch : null;
}
