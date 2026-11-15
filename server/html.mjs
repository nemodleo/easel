// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Finds element paths, source ranges and hashes in the source HTML. PLAN.md ch. 3.
// Path: starting from the children of <body>, indexes counting element children only, joined with "/". Same rule as the browser DOM.
import crypto from "node:crypto";

import { parse } from "parse5";

export function parseHtml(html) {
  return parse(html, { sourceCodeLocationInfo: true });
}

export const isElement = (n) => !!n && typeof n.tagName === "string";
export const elementChildren = (n) => (n.tagName === "template" && n.content ? n.content.childNodes : n.childNodes ?? []).filter(isElement);

export function findBody(doc) {
  const html = doc.childNodes.find((n) => n.tagName === "html");
  return html?.childNodes.find((n) => n.tagName === "body") ?? null;
}

/** "0/1/3" → element node (null if none) */
export function nodeAtPath(doc, path) {
  let node = findBody(doc);
  if (!node) return null;
  if (path === "" || path == null) return node;
  for (const part of String(path).split("/")) {
    const i = Number(part);
    if (!Number.isInteger(i) || i < 0) return null;
    node = elementChildren(node)[i];
    if (!node) return null;
  }
  return node;
}

/** Source range of the element [start, end) */
export function rangeOf(node) {
  const loc = node.sourceCodeLocation;
  if (!loc) return null;
  return { start: loc.startOffset, end: loc.endOffset, loc };
}

export const hashText = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

/** Element info for a path: source outerHTML, hash, tag, text */
export function inspect(html, path) {
  const doc = parseHtml(html);
  const node = nodeAtPath(doc, path);
  if (!node || node.tagName === "body") return null;
  const r = rangeOf(node);
  if (!r) return null;
  const source = html.slice(r.start, r.end);
  return { node, doc, source, hash: hashText(source), tag: node.tagName, text: textOf(node).replace(/\s+/g, " ").trim(), range: r };
}

export function textOf(node) {
  if (node.nodeName === "#text") return node.value;
  if (node.tagName === "script" || node.tagName === "style") return "";
  return (node.childNodes ?? []).map(textOf).join("");
}

// Block elements read as separate words in a label: "Meditate" + "10 min" is "Meditate 10 min", not "Meditate10 min"
const BLOCK = new Set("address article aside blockquote dd div dl dt figcaption figure footer form h1 h2 h3 h4 h5 h6 header li main nav ol p pre section table td th tr ul".split(" "));

/** Text for showing an element by name (layers list): like textOf, with a space between block children */
export function labelOf(node) {
  if (node.nodeName === "#text") return node.value;
  if (node.tagName === "script" || node.tagName === "style") return "";
  return (node.childNodes ?? []).map((c) => (BLOCK.has(c.tagName) ? ` ${labelOf(c)} ` : labelOf(c))).join("");
}

/** Tree for the layers list (depth-limited) */
export function outline(html, maxDepth = 12) {
  const doc = parseHtml(html);
  const body = findBody(doc);
  const walk = (node, path, depth) =>
    elementChildren(node).map((c, i) => {
      const p = path ? `${path}/${i}` : String(i);
      const cls = c.attrs?.find((a) => a.name === "class")?.value;
      const text = labelOf(c).replace(/\s+/g, " ").trim().slice(0, 40);
      return {
        path: p,
        tag: c.tagName,
        cls: cls ? cls.split(/\s+/)[0] : undefined,
        text,
        children: depth < maxDepth ? walk(c, p, depth + 1) : [],
      };
    });
  return body ? walk(body, "", 0) : [];
}
