// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Elements inside a board: paths, rects and styles in the (same-origin) iframe. PLAN.md sections 3 and 5.

/** Joins element-child indexes with "/", starting from <body>'s children (same rule as the server's parse5) */
export function pathOf(el: Element): string | null {
  const doc = el.ownerDocument;
  const parts: number[] = [];
  let n: Element | null = el;
  while (n && n !== doc.body) {
    const parent: Element | null = n.parentElement;
    if (!parent) return null;
    parts.unshift(Array.prototype.indexOf.call(parent.children, n));
    n = parent;
  }
  return n === doc.body ? parts.join("/") : null;
}

export function elementAt(doc: Document, path: string): Element | null {
  let n: Element | null = doc.body;
  if (!path) return n;
  for (const p of path.split("/")) {
    n = n?.children[Number(p)] ?? null;
    if (!n) return null;
  }
  return n;
}

export type Rect = { x: number; y: number; w: number; h: number };

/** Rect inside the iframe document (board coordinates = iframe CSS px) */
export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export const STYLE_PROPS = [
  "width",
  "height",
  "padding",
  "margin",
  "gap",
  "font-family",
  "font-size",
  "font-weight",
  "color",
  "background-color",
  "border-radius",
  "display",
  "flex-direction",
  "align-items",
  "justify-content",
  "line-height",
  "text-align",
  "border",
  "box-shadow",
  "opacity",
  "flex-wrap",
  "flex-grow",
  "align-self",
  "grid-template-columns",
  "grid-template-rows",
  "position",
  "background-image",
] as const;

export function computedStyles(el: Element): Record<string, string> {
  const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const p of STYLE_PROPS) out[p] = cs.getPropertyValue(p);
  return out;
}

/** Declarations in the style attribute */
export function inlineStyles(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const s = (el as HTMLElement).style;
  if (!s) return out;
  for (let i = 0; i < s.length; i++) out[s[i]] = s.getPropertyValue(s[i]);
  return out;
}

/** One line to paste to the agent: scr-32.html 1/2/0 "Send inquiry" (button) */
export function describe(file: string, path: string, tag: string, text: string) {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 40);
  return `${file} ${path} ${t ? `"${t}" ` : ""}(${tag})`;
}
