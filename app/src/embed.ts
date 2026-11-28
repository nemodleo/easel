// AI-generated with Claude Code, 2026-11-17, reviewed by Hyun Park
// Embedding a view-only copy in another page (index.html?embed…): the options read from the URL, and the clear area the opening
// view fits into. Pure functions, so the export's tests can run them without a browser.

export type DockAlign = "left" | "center" | "right";
export type Inset = { top: number; right: number; bottom: number; left: number };
export type EmbedOptions = {
  /** No board list and no comments card; the zoom row joins the dock; the wheel stays with the host page until a click */
  embed: boolean;
  /** Boards (by file) and notes (by id) the opening view and Fit all frame; empty = everything on the page */
  fit: string[];
  /** CSS px the clear area keeps from each edge of the frame. Negative values reach past an edge, so boards run off it on purpose */
  inset: Inset;
  /** Where the dock sits along the bottom edge */
  dock: DockAlign;
};

const ZERO: Inset = { top: 0, right: 0, bottom: 0, left: 0 };
const MAX_INSET = 4000;

/**
 * "?embed&fit=a.html,b.html&inset=24,-200,0,640&dock=left" → options. inset follows CSS: one to four numbers, top right bottom left.
 * Anything unreadable falls back to the default, and without "embed" every option is ignored (the export stays as it was).
 */
export function parseEmbed(search: string): EmbedOptions {
  const q = new URLSearchParams(search);
  const embed = q.has("embed") && !/^(0|false|no)$/i.test(q.get("embed") ?? "");
  if (!embed) return { embed: false, fit: [], inset: ZERO, dock: "center" };
  const fit = (q.get("fit") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  const dock = q.get("dock");
  return { embed, fit, inset: parseInset(q.get("inset")), dock: dock === "left" || dock === "right" ? dock : "center" };
}

export function parseInset(v: string | null): Inset {
  if (!v) return ZERO;
  const n = v.split(/[\s,]+/).filter(Boolean).map(Number);
  if (!n.length || n.length > 4 || n.some((x) => !Number.isFinite(x))) return ZERO;
  const c = n.map((x) => Math.max(-MAX_INSET, Math.min(MAX_INSET, Math.round(x))));
  const [top, right = top, bottom = top, left = right] = c;
  return { top, right, bottom, left };
}

/** The rectangle of the frame the opening view fits into: the frame less the insets (never thinner than 100px) */
export function embedArea(size: { w: number; h: number }, inset: Inset) {
  const x = inset.left;
  const y = inset.top;
  return { x, y, w: Math.max(100, size.w - inset.left - inset.right), h: Math.max(100, size.h - inset.top - inset.bottom) };
}

/** A fitted view moved so the framed rectangles start at the area's top-left corner (the fit's own padding kept) */
export function alignStart(view: { x: number; y: number; zoom: number }, rects: { x: number; y: number; w: number; h: number }[], area: { x: number; y: number; w: number; h: number }, pad = 60) {
  const p = Math.min(pad, area.w * 0.08, area.h * 0.08);
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  return { zoom: view.zoom, x: Math.round(area.x + p - minX * view.zoom), y: Math.round(area.y + p - minY * view.zoom) };
}
