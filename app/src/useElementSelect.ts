// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Element selection on one board (no Edit mode): the selected paths and their rects, the selection reported to the server, kept
// across reloads of the board and scrolling inside it. Clicks reach it from the canvas (the iframe itself never takes pointer events).
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import { computedStyles, elementAt, pathOf, rectOf, type Rect } from "./editor";
import type { Selection } from "./types";
import { strings } from "./strings";

export type SelectState = {
  paths: string[];
  rects: Rect[];
  selection: Selection | null;
  error: string | null;
};
const EMPTY: SelectState = { paths: [], rects: [], selection: null, error: null };

export function useElementSelect(file: string | null, getFrame: (f: string) => HTMLIFrameElement | null) {
  const [state, setState] = useState<SelectState>(EMPTY);
  const pathsRef = useRef<string[]>([]);
  pathsRef.current = state.paths;

  /** Recompute rects from selected paths (after scroll or reload) */
  const refresh = useCallback(() => {
    if (!file) return;
    const doc = getFrame(file)?.contentDocument;
    if (!doc) return;
    setState((s) => {
      const els = s.paths.map((p) => elementAt(doc, p));
      if (els.some((e) => !e)) return { ...s, paths: [], rects: [], selection: null, error: strings.editMode.fileChanged };
      return { ...s, rects: els.map((e) => rectOf(e!)) };
    });
  }, [file, getFrame]);

  const select = useCallback(
    async (paths: string[]) => {
      if (!file) return;
      const doc = getFrame(file)?.contentDocument;
      const els = doc ? paths.map((p) => elementAt(doc, p)) : [];
      if (!doc || !paths.length || els.some((e) => !e)) {
        setState((s) => ({ ...s, paths: [], rects: [], selection: null }));
        await api.put("/api/selection", { file: null }).catch(() => {});
        return;
      }
      const primary = paths[paths.length - 1];
      setState((s) => ({ ...s, paths, rects: els.map((e) => rectOf(e!)), error: null }));
      try {
        const { selection } = await api.put<{ selection: Selection }>("/api/selection", {
          file,
          path: primary,
          paths,
          styles: computedStyles(elementAt(doc, primary)!),
          ...kindLabel(elementAt(doc, primary)!),
        });
        setState((s) => (s.paths === paths || s.paths.join() === paths.join() ? { ...s, selection } : s));
      } catch (e) {
        setState((s) => ({ ...s, selection: null, error: String((e as Error).message) }));
      }
    },
    [file, getFrame],
  );

  // A new board (or none): start empty; with none, the server's selection goes too (agents read it)
  const first = useRef(true);
  useEffect(() => {
    setState(EMPTY);
    if (first.current) first.current = false;
    else if (!file) void api.put("/api/selection", { file: null }).catch(() => {});
  }, [file]);

  // Follow the board: scrolling inside it moves the rects, a reload (file changed) reselects the same paths to get new hashes.
  // Keys pressed while focus is inside the board (after editing a text) still reach the app's shortcuts.
  useEffect(() => {
    if (!file) return;
    const frame = getFrame(file);
    if (!frame) return;
    let detach = () => {};
    const attach = () => {
      detach();
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (!doc || !win) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.isComposing || (e.target as HTMLElement)?.isContentEditable) return;
        window.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey }));
        if (/^(Arrow|Delete|Backspace|Tab|Enter|Escape)/.test(e.key) || ((e.metaKey || e.ctrlKey) && /^[zydcvg]$/i.test(e.key))) e.preventDefault();
      };
      const onScroll = () => refresh();
      doc.addEventListener("keydown", onKey, true);
      win.addEventListener("scroll", onScroll, true);
      detach = () => {
        doc.removeEventListener("keydown", onKey, true);
        win.removeEventListener("scroll", onScroll, true);
      };
    };
    const onLoad = () => {
      attach();
      if (pathsRef.current.length) void select(pathsRef.current);
    };
    if (frame.contentDocument?.readyState === "complete") attach();
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      detach();
    };
  }, [file, getFrame, select, refresh]);

  return { state, select, refresh, setError: (error: string | null) => setState((s) => ({ ...s, error })) };
}

/** The element under a point on the canvas (client px), found in the board's own document; never the page itself */
export function elementUnder(frame: HTMLIFrameElement | null | undefined, clientX: number, clientY: number): { el: Element; path: string } | null {
  const doc = frame?.contentDocument;
  if (!frame || !doc?.body) return null;
  const r = frame.getBoundingClientRect();
  const k = r.width / (frame.offsetWidth || r.width) || 1;
  const t = doc.elementFromPoint((clientX - r.left) / k, (clientY - r.top) / k);
  if (!t || t === doc.body || t === doc.documentElement) return null;
  const path = pathOf(t);
  return path == null ? null : { el: t, path };
}

/**
 * Scroll the board's own content under a point on the canvas (client px) by a wheel delta given in screen px: the nearest scrollable
 * ancestor of the element there that can still move that way, else the page. False when nothing can scroll (the canvas pans instead).
 */
export function scrollInside(frame: HTMLIFrameElement | null | undefined, clientX: number, clientY: number, dx: number, dy: number): boolean {
  const doc = frame?.contentDocument;
  const win = frame?.contentWindow;
  if (!frame || !doc?.body || !win) return false;
  const r = frame.getBoundingClientRect();
  const k = r.width / (frame.offsetWidth || r.width) || 1;
  const page = doc.scrollingElement ?? doc.documentElement;
  const room = (el: Element) => {
    const o = el === page ? null : win.getComputedStyle(el);
    const y = (!o || /auto|scroll/.test(o.overflowY)) && (dy < 0 ? el.scrollTop > 0 : dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    const x = (!o || /auto|scroll/.test(o.overflowX)) && (dx < 0 ? el.scrollLeft > 0 : dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    return y || x;
  };
  let el: Element | null = doc.elementFromPoint((clientX - r.left) / k, (clientY - r.top) / k);
  while (el && el !== page && el !== doc.body && !room(el)) el = el.parentElement;
  const target = el && el !== doc.body && room(el) ? el : room(page) ? page : null;
  if (!target) return false;
  target.scrollBy(dx / k, dy / k);
  return true;
}

/** Outermost elements fully inside a rectangle given in the board's own coordinates (element marquee) */
export function elementsInside(doc: Document, r: Rect): string[] {
  const inside = (el: Element) => {
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && b.left >= r.x && b.top >= r.y && b.right <= r.x + r.w && b.bottom <= r.y + r.h;
  };
  const hits: string[] = [];
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (/^(script|style|template)$/i.test(c.tagName)) continue;
      if (inside(c)) {
        const p = pathOf(c);
        if (p != null) hits.push(p);
      } else walk(c);
    }
  };
  walk(doc.body);
  return hits;
}

/** Element kind and human-readable name (kind and label for MCP get_selection) */
export function kindLabel(el: Element) {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  const kind =
    tag === "img" || tag === "picture" || (el as HTMLElement).style?.backgroundImage?.includes("url(")
      ? "image"
      : tag === "button" || role === "button"
        ? "button"
        : tag === "a"
          ? "link"
          : /^(input|textarea|select)$/.test(tag)
            ? "input"
            : tag === "svg"
              ? "icon"
              : !el.children.length && el.textContent?.trim()
                ? "text"
                : "container";
  const label = (el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("placeholder") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
  return { kind, label };
}
