// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Who is on which board: labels above a board ("Codex is editing…", "You · editing", "Claude Code · done 13:52"), the arrow and the
// caption for each block of forks of an original, and picking one version — "Use this one" for a fork, "Use this" for a variant —
// with its confirm popover.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { whoIcon } from "./activity";
import { browserId } from "./api";
import { Icon } from "./icons";
import { blocks, bounds, captionTexts, chooseCaption, firstOf } from "./forkBlocks";
import { strings } from "./strings";
import type { Board, BoardItem } from "./types";

/** One holder of a board, as the server sends it (ServerEvent "occupancy") */
export type Holder = { key: string; kind: "agent" | "person"; by?: string; person?: string; client?: string; state: "editing" | "done"; since: number; doneAt?: number };
export type Occupancy = Record<string, Holder[]>;

const isYou = (h: Holder) => h.kind === "person" && h.client === browserId;
const holderName = (h: Holder) => h.by ?? h.person ?? strings.occupancy.someone;

/** Agents editing a board right now (the ones "Use this" waits for) */
export const writersOn = (occ: Occupancy, f: string) => (occ[f] ?? []).filter((h) => h.kind === "agent" && h.state === "editing");

/** The labels above one board: who is editing it, then who finished. You: the blue dot (selected by you); an agent at work: the 12px
 * waiting ring; anyone else: their glyph (who reads without colour) */
export function OccTags({ list }: { list: Holder[] }) {
  return (
    <>
      {list.map((h) => {
        const you = isYou(h);
        const text = you ? strings.occupancy.you : h.state === "done" ? strings.occupancy.done(holderName(h), strings.occupancy.clock(h.doneAt ?? Date.now())) : h.kind === "person" ? strings.occupancy.personEditing(holderName(h)) : strings.occupancy.editing(holderName(h));
        return (
          <span key={h.key} className={`occ-tag ${you ? "you" : ""} ${h.state === "done" ? "done" : ""}`} data-occ={h.key} title={text}>
            {you ? <span className="idot" aria-hidden="true" /> : h.state === "editing" && h.kind === "agent" ? <span className="spinner" aria-hidden="true" /> : <Icon name={whoIcon(h.kind === "agent" ? { by: h.by ?? "" } : { person: h.person ?? "" })} size={16} />}
            <span className="act-tag-text">{text}</span>
          </span>
        );
      })}
    </>
  );
}

/** Board list: a dot while someone is editing the board (the first one): blue for you, ink for anyone else (the name is its label) */
export function listDot(occ: Occupancy, f: string) {
  const h = (occ[f] ?? []).find((x) => x.state === "editing");
  return h ? { color: isYou(h) ? "var(--select)" : "var(--text)", label: isYou(h) ? strings.occupancy.youListDot : strings.occupancy.listDot(holderName(h)) } : null;
}

/** The versions "Use this" picks between (mirrors choiceGroup in server/forks.mjs) */
export type Group = { original: string; kind: "variant" | "fork"; chosen: string; alts: string[] };
export function choiceGroup(board: Board, file: string): Group | null {
  const it = board.boards[file];
  if (!it) return null;
  const linked = (o: string, kind: string) => Object.keys(board.boards).filter((f) => f !== o && board.boards[f].origin?.of === o && board.boards[f].origin?.kind === kind);
  if (it.origin?.of && board.boards[it.origin.of]) return { original: it.origin.of, kind: it.origin.kind, chosen: file, alts: linked(it.origin.of, it.origin.kind) };
  const alts = linked(file, "fork");
  return alts.length ? { original: file, kind: "fork", chosen: file, alts } : null;
}
/** Who "Use this" waits for: the first agent still editing one of the versions */
export const busyIn = (occ: Occupancy, g: Group) => [g.original, ...g.alts].flatMap((f) => writersOn(occ, f))[0] ?? null;
/** "Variant 2: bold CTA" → "Variant 2" for the toast */
export const shortTitle = (t: string) => t.replace(/:.*$/, "");

/**
 * The button in the row above a variant (Use this) or a fork and its original (Use this one); waits while a writer is still on either.
 * In a compact label (zoomed out) it is the check alone, named by its title and aria-label
 */
export function UseButton({ file, group, busy, open, onOpen, compact = false }: { file: string; group: Group; busy: Holder | null; open: boolean; onOpen: () => void; compact?: boolean }) {
  const label = group.kind === "variant" ? strings.occupancy.useThis : strings.occupancy.useThisOne;
  return (
    <button
      className={`icon-btn sm use-btn ${busy ? "" : "ready"} ${open ? "pressed" : ""} ${compact ? "icon-only" : ""}`}
      data-use={file}
      aria-disabled={busy ? true : undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={compact ? label : undefined}
      title={busy ? strings.occupancy.waitFor(holderName(busy)) : compact ? label : group.kind === "variant" ? strings.occupancy.useThisTitle : strings.occupancy.useThisOneTitle(group.alts.length)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onOpen();
      }}
    >
      <Icon name="check" size={14} />
      {!compact && <span className="use-label">{label}</span>}
    </button>
  );
}

/** The confirm under a Use this button: what happens to the original and the others; Apply and Keep all / Keep both. It hangs 8px
 * under the button, right edges in line, on the shared menu surface; Apply is grey (the orange stays on Ask AI) */
export function UseConfirm(p: { file: string; group: Group; board: Board; busy: boolean; onApply: () => void; onKeepAll: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const anchor = () => document.querySelector<HTMLElement>(`[data-use="${CSS.escape(p.file)}"]`);
  const t = (f: string) => p.board.boards[f]?.title ?? f;
  const g = p.group;
  const o = t(g.original);
  const s = strings.occupancy;
  const [title, body] =
    g.kind === "variant"
      ? [s.confirmVariant(t(g.chosen), o), s.confirmVariantBody(o, g.alts.length - 1)]
      : g.chosen === g.original
        ? [s.confirmKeep(o), s.confirmKeepBody(g.alts.map(t).join(", "), g.alts.length)]
        : [s.confirmFork(t(g.chosen), o), s.confirmForkBody(o, g.alts.length - 1)];
  // Follows its button as the canvas moves (whole pixels)
  useLayoutEffect(() => {
    const a = anchor();
    if (!a) return void p.onClose();
    const r = a.getBoundingClientRect();
    const w = ref.current?.offsetWidth ?? 288;
    const x = Math.round(Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)));
    const h = ref.current?.offsetHeight ?? 120;
    const y = Math.round(Math.max(8, Math.min(r.bottom + 8, window.innerHeight - h - 8)));
    if (!pos || pos.x !== x || pos.y !== y) setPos({ x, y });
  });
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const close = (e: Event) => {
      const n = e.target as Node;
      if (ref.current?.contains(n) || anchor()?.contains(n)) return;
      p.onClose();
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [p.file]);
  return (
    <div
      ref={ref}
      className="menu confirm entering"
      role="dialog"
      aria-label={title}
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          p.onClose();
          anchor()?.focus();
        }
      }}
    >
      <p className="c-title">{title}</p>
      <p className="c-body">{body}</p>
      <div className="btn-row">
        <button className="btn oc-strong" disabled={p.busy} onClick={p.onApply}>
          {s.apply}
        </button>
        <button className="btn oc-plain" disabled={p.busy} onClick={p.onKeepAll}>
          {g.kind === "variant" || g.alts.length > 1 ? s.keepAll : s.keepBoth}
        </button>
      </div>
    </div>
  );
}

/**
 * The forks of each original as blocks (forkBlocks.ts): per block one dashed arrow from the original to the block's first fork, and one
 * caption under the block, "3 forks of Empty day · made while Claude Code was editing" (world coordinates). A fork dragged away from
 * its block is a block of its own, with its own arrow and "Fork of Empty day".
 */
export function ForkLinks({ board, files, zoom }: { board: Board; files: string[]; zoom: number }) {
  const shown = new Set(files);
  const forksOf = new Map<string, (BoardItem & { f: string })[]>();
  for (const f of files) {
    const o = board.boards[f].origin;
    if (o?.kind === "fork" && shown.has(o.of) && board.boards[o.of]) forksOf.set(o.of, [...(forksOf.get(o.of) ?? []), { ...board.boards[f], f }]);
  }
  if (!forksOf.size) return null;
  return (
    <>
      {[...forksOf].flatMap(([of, forks]) => blocks(forks).map((bl) => <ForkBlock key={bl.map((b) => b.f).join(" ")} of={of} from={board.boards[of]} forks={bl} zoom={Math.max(zoom, 0.05)} board={board} />))}
    </>
  );
}

function ForkBlock({ of, from, forks, zoom, board }: { of: string; from: BoardItem; forks: (BoardItem & { f: string })[]; zoom: number; board: Board }) {
  const ref = useRef<HTMLDivElement>(null);
  const cap = useRef<HTMLSpanElement>(null);
  const first = firstOf(forks);
  const box = bounds(forks);
  const n = forks.length;
  const title = from.title ?? of;
  const texts = captionTexts(n, title, forks.map((b) => b.origin?.while), strings.occupancy);
  // One line that keeps its screen size (12px): the long text when it fits the block's width, else the medium one (which may run past
  // the block's right edge), else the short one, each only where no board, label or note is in the way; hidden when all three are.
  // Measured when the zoom, the block, its texts or the board change (a moved board or note), not while the canvas pans
  const [text, setText] = useState<string | null>(texts.medium);
  const at = { left: box.x, top: box.y + box.h + 10 / zoom, transform: `scale(${1 / zoom})`, transformOrigin: "0 0" };
  useLayoutEffect(() => {
    const el = cap.current;
    const o = ref.current?.getBoundingClientRect();
    if (!el || !o) return;
    const ctx = document.createElement("canvas").getContext("2d");
    const cs = getComputedStyle(el);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    if (ctx) ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const h = parseFloat(cs.lineHeight) || 16;
    const l = o.left + box.x * zoom;
    const top = o.top + (box.y + box.h) * zoom + 10;
    const obstacles = [...document.querySelectorAll(".canvas .note, .canvas .board-frame, .canvas .board-label")].map((e) => e.getBoundingClientRect());
    const next = chooseCaption(
      texts,
      box.w * zoom,
      (x) => (ctx ? ctx.measureText(x).width : x.length * 7) + pad,
      (w) => obstacles.some((r) => r.left < l + w && r.right > l && r.top < top + h && r.bottom > top),
    );
    if (next !== text) setText(next);
  }, [zoom, box.x, box.y, box.w, box.h, texts.long, texts.medium, texts.short, board]);
  const pts = route(from, first);
  const c = pts[pts.length - 1];
  const a = pts[0];
  if (Math.hypot(c.x - a.x, c.y - a.y) < 4) return null;
  const sw = 1.5 / zoom;
  const p = pts[pts.length - 2];
  const ang = Math.atan2(c.y - p.y, c.x - p.x);
  const head = 6 / zoom;
  const x0 = Math.min(...pts.map((q) => q.x)) - head;
  const y0 = Math.min(...pts.map((q) => q.y)) - head;
  return (
    <div ref={ref} className="fork-link" data-fork={first.f} data-forks={forks.map((b) => b.f).join(" ")} aria-label={texts.long ?? texts.medium} role="img">
      <svg className="fork-svg" style={{ left: x0, top: y0, width: Math.max(...pts.map((q) => q.x)) + head - x0, height: Math.max(...pts.map((q) => q.y)) + head - y0 }} aria-hidden="true">
        <g transform={`translate(${-x0} ${-y0})`}>
          <path d={pts.map((q, i) => `${i ? "L" : "M"}${q.x} ${q.y}`).join("")} strokeWidth={sw} strokeDasharray={`${4 * sw} ${4 * sw}`} />
          <path d={`M${c.x - head * Math.cos(ang - 0.6)} ${c.y - head * Math.sin(ang - 0.6)}L${c.x} ${c.y}L${c.x - head * Math.cos(ang + 0.6)} ${c.y - head * Math.sin(ang + 0.6)}`} strokeWidth={sw} />
        </g>
      </svg>
      <div className="fork-caption" style={{ ...at, visibility: text ? undefined : "hidden" }} aria-hidden="true">
        <span ref={cap}>{text ?? texts.short}</span>
      </div>
    </div>
  );
}

/**
 * The arrow's path. Side by side: straight between the facing edges, a little below the tops. One under the other: around the left side,
 * through the gap between columns, so it stays off the labels above the lower board. Anything else: straight between the nearer edges.
 */
function route(o: BoardItem, f: BoardItem) {
  const y = Math.max(o.y, f.y) + Math.min(48, Math.min(o.h, f.h) / 4);
  const sideBySide = y < Math.min(o.y + o.h, f.y + f.h);
  if (sideBySide && f.x >= o.x + o.w) return [{ x: o.x + o.w + 8, y }, { x: f.x - 8, y }];
  if (sideBySide && f.x + f.w <= o.x) return [{ x: o.x - 8, y }, { x: f.x + f.w + 8, y }];
  const inset = (b: BoardItem) => Math.min(48, b.h / 4);
  if (f.x < o.x + o.w && f.x + f.w > o.x) {
    const gx = Math.min(o.x, f.x) - 40;
    const down = f.y >= o.y;
    const yo = down ? o.y + o.h - inset(o) : o.y + inset(o);
    const yf = down ? f.y + inset(f) : f.y + f.h - inset(f);
    return [{ x: o.x - 8, y: yo }, { x: gx, y: yo }, { x: gx, y: yf }, { x: f.x - 8, y: yf }];
  }
  const oc = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
  const fc = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
  return f.y >= o.y + o.h ? [{ x: oc.x, y: o.y + o.h + 8 }, { x: fc.x, y: f.y - 8 }] : [{ x: oc.x, y: o.y - 8 }, { x: fc.x, y: f.y + f.h + 8 }];
}
