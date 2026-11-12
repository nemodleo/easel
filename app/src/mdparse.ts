// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Small markdown parser for agent answers in the chat: paragraphs, headings, fenced code, lists (one nested level), bold/italic,
// inline code and http(s) links. Pure and total: any text, including half-streamed text (an open fence or list), parses without throwing.

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "a"; href: string; c: Inline[] }
  | { t: "br" };
export type Item = { c: Inline[]; sub?: List };
export type List = { t: "ul" | "ol"; start: number; items: Item[] };
export type Block = { t: "p"; c: Inline[] } | { t: "h"; level: number; c: Inline[] } | { t: "code"; lang: string; v: string; open: boolean } | { t: "hr" } | List;

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w#+.-]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;

/** Only absolute http(s) links become links; anything else (javascript:, data:, relative) stays text */
export const safeHref = (u: string) => (/^https?:\/\/[^\s<>"]+$/i.test(u) ? u : null);

export function parseMarkdown(src: string): Block[] {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", c: parseInline(para.join("\n")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const mark = fence[1];
      const body: string[] = [];
      let open = true;
      for (i++; i < lines.length; i++) {
        if (new RegExp(`^ {0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`).test(lines[i])) {
          open = false;
          break;
        }
        body.push(lines[i]);
      }
      out.push({ t: "code", lang: fence[2] ?? "", v: body.join("\n"), open });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      out.push({ t: "h", level: h[1].length, c: parseInline(h[2]) });
      continue;
    }
    if (HR.test(line) && !para.length) {
      out.push({ t: "hr" });
      continue;
    }
    if (ITEM.test(line) && (!para.length || !/^\s/.test(line))) {
      flush();
      i = parseList(lines, i, out) - 1;
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

const kindOf = (marker: string): "ul" | "ol" => (/\d/.test(marker) ? "ol" : "ul");

/** A list from line i (nested items one level deep); returns the index of the first line after it */
function parseList(lines: string[], i: number, out: Block[]): number {
  const first = ITEM.exec(lines[i])!;
  const baseIndent = first[1].length;
  const list: List = { t: kindOf(first[2]), start: kindOf(first[2]) === "ol" ? parseInt(first[2], 10) : 1, items: [] };
  const texts: string[][] = [];
  const subs: { list: List; texts: string[][] }[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      // A blank line ends the list unless another item follows
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (next && ITEM.test(next) && ITEM.exec(next)![1].length >= baseIndent) continue;
      break;
    }
    const m = ITEM.exec(line);
    if (m && m[1].length <= baseIndent + 1) {
      if (kindOf(m[2]) !== list.t) break;
      list.items.push({ c: [] });
      texts.push([m[3]]);
      subs.push({ list: { t: "ul", start: 1, items: [] }, texts: [] });
      continue;
    }
    if (!list.items.length) break;
    const sub = subs[subs.length - 1];
    if (m) {
      // Deeper item: one nested level (anything deeper joins it)
      if (!sub.list.items.length) sub.list = { t: kindOf(m[2]), start: kindOf(m[2]) === "ol" ? parseInt(m[2], 10) : 1, items: [] };
      sub.list.items.push({ c: [] });
      sub.texts.push([m[3]]);
      continue;
    }
    if (!/^\s/.test(line) && !lines[i - 1]?.trim()) break;
    // Continuation of the last item (or the last nested item)
    (sub.texts.length ? sub.texts[sub.texts.length - 1] : texts[texts.length - 1]).push(line.trim());
  }
  list.items.forEach((it, k) => {
    it.c = parseInline(texts[k].join("\n"));
    const s = subs[k];
    if (s.list.items.length) {
      s.list.items.forEach((x, j) => (x.c = parseInline(s.texts[j].join("\n"))));
      it.sub = s.list;
    }
  });
  out.push(list);
  return i;
}

/** Inline spans: `code`, **bold**, *italic* or _italic_, [label](http…), bare http(s) URLs, backslash escapes, line breaks */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const push = (x: Inline) => {
    if (text) out.push({ t: "text", v: text });
    text = "";
    out.push(x);
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && /[\\`*_[\]()#+\-.!>~|]/.test(s[i + 1])) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      push({ t: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      let n = 1;
      while (s[i + n] === "`") n++;
      const tick = "`".repeat(n);
      const end = s.indexOf(tick, i + n);
      if (end > i) {
        const v = s.slice(i + n, end);
        push({ t: "code", v: v.length > 2 && v.startsWith(" ") && v.endsWith(" ") ? v.slice(1, -1) : v });
        i = end + n;
        continue;
      }
      text += tick;
      i += n;
      continue;
    }
    if ((ch === "*" || ch === "_") && s[i + 1] === ch) {
      const end = s.indexOf(ch + ch, i + 2);
      if (end > i + 2 && s[i + 2] !== " ") {
        push({ t: "b", c: parseInline(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    } else if (ch === "*" || ch === "_") {
      // _ only at word edges, so snake_case stays text
      const okStart = ch === "*" || !/\w/.test(s[i - 1] ?? "");
      let end = -1;
      for (let k = i + 1; k < s.length; k++) if (s[k] === ch && s[k + 1] !== ch && s[k - 1] !== " " && (ch === "*" || !/\w/.test(s[k + 1] ?? ""))) {
        end = k;
        break;
      }
      if (okStart && end > i + 1 && s[i + 1] !== " " && !s.slice(i + 1, end).includes("\n")) {
        push({ t: "i", c: parseInline(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[([^\]\n]*)\]\(([^)\s]*)\)/.exec(s.slice(i));
      if (m) {
        const href = safeHref(m[2]);
        const c = parseInline(m[1]);
        if (href) push({ t: "a", href, c });
        else for (const x of c) x.t === "text" ? (text += x.v) : push(x);
        i += m[0].length;
        continue;
      }
    }
    if ((ch === "h" || ch === "H") && !/\w/.test(s[i - 1] ?? "")) {
      const m = /^https?:\/\/[^\s<>"`]+/i.exec(s.slice(i));
      if (m) {
        const url = m[0].replace(/[.,;:!?)\]'"]+$/, "");
        push({ t: "a", href: url, c: [{ t: "text", v: url }] });
        i += url.length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  if (text) out.push({ t: "text", v: text });
  return out;
}
