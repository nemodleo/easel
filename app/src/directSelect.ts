// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Pure helpers for selecting and editing elements without a mode: click vs drag, toolbar placement, breadcrumb paths, design words
// for CSS values ("Bold · 700", "12 · 16", "System UI"), and token colours (matching a value, writing a CSS variable reference). No imports.

export type Box = { x: number; y: number; w: number; h: number };
export type TokenColor = { name: string; value: string };

/** Screen pixels a press may travel and still count as a click (more moves the board) */
export const CLICK_SLOP = 3;
export const isDrag = (dx: number, dy: number, slop = CLICK_SLOP) => Math.abs(dx) + Math.abs(dy) >= slop;

/** Where the element toolbar goes: centred over the element with room for the move handle, flipped below when there is no room above
 * (bounds.top is the board's top edge: the bar never covers the board's title row and what sits on it), kept inside the bounds */
export function placeBar(target: Box, bar: { w: number; h: number }, bounds: { w: number; h: number; top?: number }, gapAbove = 28, gapBelow = 12, pad = 8) {
  const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), Math.max(a, b));
  const above = target.y - gapAbove - bar.h;
  const below = above < Math.max(pad, bounds.top ?? pad);
  const y = clamp(below ? target.y + target.h + gapBelow : above, pad, bounds.h - bar.h - pad);
  const x = clamp(target.x + target.w / 2 - bar.w / 2, pad, bounds.w - bar.w - pad);
  return { x: Math.round(x), y: Math.round(y), below };
}

/** Ancestors shown between the board and the element: none for a top-level element, otherwise the nearest `max` (more → skipped) */
export function crumbPaths(path: string, max = 2): { paths: string[]; skipped: boolean } {
  const parts = path.split("/");
  const all = parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"));
  return { paths: all.slice(-max), skipped: all.length > max };
}

/** "15px" → "15"; anything that is not plain px stays as written */
export function designNumber(v: string | undefined | null): string {
  const s = (v ?? "").trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)px$/);
  return m ? String(Number(m[1])) : s;
}
/** "12px 16px" → "12 · 16" */
export const designSpacing = (v: string | undefined | null) =>
  (v ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(designNumber)
    .join(" · ");
/** "12 · 16" or "12 16" → "12px 16px"; values with their own unit (1em, auto) are kept */
export function cssSpacing(s: string): string {
  const parts = s.replace(/·/g, " ").trim().split(/\s+/).filter(Boolean);
  return parts.map((p) => (/^-?\d+(?:\.\d+)?$/.test(p) ? `${Number(p)}px` : p)).join(" ");
}
/** "Bold · 700"; an unknown weight is just the number */
export function designWeight(w: string | number | undefined | null, names: Record<number, string>): string {
  const n = Number(w);
  if (!w || !Number.isFinite(n)) return String(w ?? "");
  return names[n] ? `${names[n]} · ${n}` : String(n);
}
const SYSTEM_FAMILIES = /^(system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif)$/i;
/** The first family in a font stack, as a person would say it: "System UI", "Inter" */
export function designFont(family: string | undefined | null): string {
  const first = (family ?? "").split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
  if (SYSTEM_FAMILIES.test(first)) return "System UI";
  return first;
}
/** What a font name typed in the panel writes: "System UI" → system-ui, a name with spaces is quoted */
export function cssFont(name: string): string {
  const s = name.trim();
  if (/^system ui$/i.test(s)) return "system-ui";
  if (s.includes(",") || /^["'].*["']$/.test(s) || !/\s/.test(s)) return s;
  return `"${s}"`;
}

/** #RGB, #RRGGBB, rgb(), rgba() with full alpha → #RRGGBB; anything else (translucent, var(), keywords) → null */
export function hexOf(v: string | undefined | null): string | null {
  const s = (v ?? "").trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    if (h.length === 8 && h.slice(6) !== "ff") return null;
    return "#" + h.slice(0, 6).toUpperCase();
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] != null && parseFloat(m[4]) < (m[4].endsWith("%") ? 100 : 1)) return null;
    return "#" + [m[1], m[2], m[3]].map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  return null;
}

/** "Blue soft" → "blue-soft": the CSS variable name a token is written as */
export const tokenSlug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "token";

/** The token a colour value stands for: var(--slug…) by name, otherwise by the same hex */
export function matchToken(value: string | undefined | null, colors: TokenColor[]): TokenColor | null {
  const v = (value ?? "").trim();
  const ref = v.match(/^var\(\s*--([a-z0-9-]+)/i);
  if (ref) {
    const hit = colors.find((c) => tokenSlug(c.name) === ref[1].toLowerCase());
    if (hit) return hit;
    const fallback = v.match(/,\s*([^)]+)\)\s*$/)?.[1];
    return fallback ? matchToken(fallback, colors) : null;
  }
  const hex = hexOf(v);
  return hex ? (colors.find((c) => hexOf(c.value) === hex) ?? null) : null;
}

/**
 * What choosing a token writes: the board's own variable when it already defines one for this token (same name, or the same colour),
 * else var(--slug, #HEX) so the board still renders before it defines the variable. vars: custom properties the board defines → value.
 */
export function tokenRef(token: TokenColor, vars: Record<string, string>): string {
  const slug = tokenSlug(token.name);
  if (vars[`--${slug}`] != null) return `var(--${slug})`;
  const hex = hexOf(token.value);
  const same = Object.keys(vars).find((k) => hex && hexOf(vars[k]) === hex);
  if (same) return `var(${same})`;
  return `var(--${slug}, ${hex ?? token.value})`;
}

/** Which property Fill changes: the text colour of a text element on a clear background, else the background */
export const fillProp = (kind: string | undefined, background: string | undefined): "color" | "background" =>
  kind === "text" && hexOf(background) == null ? "color" : "background";

/** Stepper: the next value in the direction (a step of `step`), never below `min` */
export function stepNumber(cur: string, dir: 1 | -1, step = 1, min = 0) {
  const n = parseFloat(cur);
  const base = Number.isFinite(n) ? n : 0;
  return Math.max(min, Math.round((base + dir * step) * 100) / 100);
}

/** Padding stepped as a whole: every side moves by the step ("12px 16px" + 4 → "16px 20px") */
export function stepSpacing(cur: string, dir: 1 | -1, step = 4) {
  const parts = (cur || "0px").trim().split(/\s+/);
  return parts.map((p) => `${stepNumber(p, dir, step)}px`).join(" ");
}
