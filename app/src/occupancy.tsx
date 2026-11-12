// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Who is on which board: labels above a board ("Codex is editing…", "You · editing", "Claude Code · done 13:52"), the arrow from an
// original to its fork, and picking one version — "Use this one" for a fork, "Use this" for a variant — with its confirm popover.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { authorColor } from "./activity";
import { browserId } from "./api";
import { Icon } from "./icons";
import { strings } from "./strings";
import type { Board, BoardItem } from "./types";

/** One holder of a board, as the server sends it (ServerEvent "occupancy") */
export type Holder = { key: string; kind: "agent" | "person"; by?: string; person?: string; client?: string; state: "editing" | "done"; since: number; doneAt?: number };
export type Occupancy = Record<string, Holder[]>;

const isYou = (h: Holder) => h.kind === "person" && h.client === browserId;
/** Colour of a holder: the agent's author colour; people in the selection colour (you) or their own author colour */
export const holderColor = (h: Holder) => (isYou(h) ? "var(--select)" : h.kind === "person" ? authorColor({ person: h.person ?? "" }) : authorColor({ by: h.by }));
const holderName = (h: Holder) => h.by ?? h.person ?? strings.occupancy.someone;

/** Agents editing a board right now (the ones "Use this" waits for) */
export const writersOn = (occ: Occupancy, f: string) => (occ[f] ?? []).filter((h) => h.kind === "agent" && h.state === "editing");

/** The labels above one board: who is editing it, then who finished */
export function OccTags({ list }: { list: Holder[] }) {
  return (
    <>
      {list.map((h) => {
        const you = isYou(h);
        const text = you ? strings.occupancy.you : h.state === "done" ? strings.occupancy.done(holderName(h), strings.occupancy.clock(h.doneAt ?? Date.now())) : h.kind === "person" ? strings.occupancy.personEditing(holderName(h)) : strings.occupancy.editing(holderName(h));
        return (
          <span key={h.key} className={`occ-tag ${you ? "you" : ""} ${h.state === "done" ? "done" : ""}`} data-occ={h.key} title={text}>
            {h.state === "editing" && h.kind === "agent" ? <span className="ring" style={{ ["--c" as string]: holderColor(h) }} aria-hidden="true" /> : <span className="idot" style={{ background: holderColor(h) }} aria-hidden="true" />}
            <span className="act-tag-text">{text}</span>
          </span>
        );
      })}
    </>
  );
}

/** Board list: the dot of whoever is editing the board (the first one) */
export function listDot(occ: Occupancy, f: string) {
  const h = (occ[f] ?? []).find((x) => x.state === "editing");
  return h ? { color: holderColor(h), label: isYou(h) ? strings.occupancy.youListDot : strings.occupancy.listDot(holderName(h)) } : null;
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

/** The button in the row above a variant (Use this) or a fork and its original (Use this one); waits while a writer is still on either */
export function UseButton({ file, group, busy, open, onOpen }: { file: string; group: Group; busy: Holder | null; open: boolean; onOpen: () => void }) {
  const label = group.kind === "variant" ? strings.occupancy.useThis : strings.occupancy.useThisOne;
  return (
    <button
      className={`icon-btn sm edit-pill use-btn ${busy ? "" : "ready"} ${open ? "pressed" : ""}`}
      data-use={file}
      aria-disabled={busy ? true : undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={busy ? strings.occupancy.waitFor(holderName(busy)) : group.kind === "variant" ? strings.occupancy.useThisTitle : strings.occupancy.useThisOneTitle}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onOpen();
      }}
    >
      <Icon name="check" size={14} />
      <span className="edit-pill-label">{label}</span>
    </button>
  );
}

/** The confirm under a Use this button: what happens to the original and the others; Apply (filled) and Keep all / Keep both */
export function UseConfirm(p: { file: string; group: Group; board: Board; busy: boolean; onApply: () => void; onKeepAll: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; arrow: number } | null>(null);
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
        : [s.confirmFork(t(g.chosen), o), s.confirmForkBody(o)];
  // Follows its button as the canvas moves; the arrow points at the button
  useLayoutEffect(() => {
    const a = anchor();
    if (!a) return void p.onClose();
    const r = a.getBoundingClientRect();
    const w = ref.current?.offsetWidth ?? 290;
    const x = Math.max(8, Math.min(r.right + 24 - w, window.innerWidth - w - 8));
    const h = ref.current?.offsetHeight ?? 120;
    const y = Math.max(8, Math.min(r.bottom + 10, window.innerHeight - h - 8));
    const arrow = Math.max(12, Math.min(w - 24, r.left + r.width / 2 - x - 6));
    if (!pos || Math.abs(pos.x - x) > 0.5 || Math.abs(pos.y - y) > 0.5 || pos.arrow !== arrow) setPos({ x, y, arrow });
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
      className="menu confirm"
      role="dialog"
      aria-label={title}
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, ["--arrow" as string]: `${pos?.arrow ?? 0}px` }}
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
        <button className="primary" disabled={p.busy} onClick={p.onApply}>
          {s.apply}
        </button>
        <button disabled={p.busy} onClick={p.onKeepAll}>
          {g.kind === "variant" ? s.keepAll : s.keepBoth}
        </button>
      </div>
    </div>
  );
}

/** The dashed arrow from an original to each of its forks, with "Forked 14:02 — Codex started while Claude Code was editing" (world coordinates) */
export function ForkLinks({ board, files, zoom }: { board: Board; files: string[]; zoom: number }) {
  const shown = new Set(files);
  const links = files.flatMap((f) => {
    const b = board.boards[f];
    const o = b.origin;
    return o?.kind === "fork" && shown.has(o.of) && board.boards[o.of] ? [{ f, from: board.boards[o.of], to: b, origin: o }] : [];
  });
  if (!links.length) return null;
  return (
    <>
      {links.map((l) => (
        <ForkLink key={l.f} {...l} board={board} zoom={Math.max(zoom, 0.05)} />
      ))}
    </>
  );
}

function ForkLink({ f, from, to, origin, board, zoom }: { f: string; from: BoardItem; to: BoardItem; origin: NonNullable<BoardItem["origin"]>; board: Board; zoom: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const cap = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);
  const pts = route(from, to);
  const straight = pts.length === 2;
  const a = pts[0];
  const c = pts[pts.length - 1];
  const len = Math.hypot(c.x - a.x, c.y - a.y);
  // The caption keeps its screen size (11px text, at most 260px wide) and fits between the boards when it can
  const w = Math.max(140, Math.min(260, len * zoom - 16));
  const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 + 10 / zoom };
  // Under a straight arrow, as long as nothing sits there; with notes or a board between the two (or an arrow around the side) it goes under the fork
  useLayoutEffect(() => {
    const o = ref.current?.getBoundingClientRect();
    if (!o) return;
    const h = cap.current?.getBoundingClientRect().height ?? 32;
    const l = o.left + mid.x * zoom - w / 2;
    const t = o.top + mid.y * zoom;
    const hit = [...document.querySelectorAll(".canvas .note, .canvas .board-frame")].some((el) => {
      const r = el.getBoundingClientRect();
      return r.left < l + w && r.right > l && r.top < t + h && r.bottom > t;
    });
    setBelow(!straight || hit);
  }, [board, zoom, w, mid.x, mid.y, straight]);
  if (len < 4) return null;
  const sw = 1.5 / zoom;
  const p = pts[pts.length - 2];
  const ang = Math.atan2(c.y - p.y, c.x - p.x);
  const head = 6 / zoom;
  const x0 = Math.min(...pts.map((q) => q.x)) - head;
  const y0 = Math.min(...pts.map((q) => q.y)) - head;
  const text = strings.occupancy.forked(strings.occupancy.clock(Date.parse(origin.at ?? "") || Date.now()), origin.by ?? strings.occupancy.someone, origin.while ?? strings.occupancy.someone);
  const at = below
    ? { left: to.x, top: to.y + to.h + 10 / zoom, width: Math.max(140, Math.min(260, to.w * zoom)), transform: `scale(${1 / zoom})`, transformOrigin: "0 0" }
    : { left: mid.x, top: mid.y, width: w, transform: `translateX(-50%) scale(${1 / zoom})`, transformOrigin: "50% 0" };
  return (
    <div ref={ref} className="fork-link" data-fork={f} aria-label={text} role="img">
      <svg className="fork-svg" style={{ left: x0, top: y0, width: Math.max(...pts.map((q) => q.x)) + head - x0, height: Math.max(...pts.map((q) => q.y)) + head - y0 }} aria-hidden="true">
        <g transform={`translate(${-x0} ${-y0})`}>
          <path d={pts.map((q, i) => `${i ? "L" : "M"}${q.x} ${q.y}`).join("")} strokeWidth={sw} strokeDasharray={`${4 * sw} ${4 * sw}`} />
          <path d={`M${c.x - head * Math.cos(ang - 0.6)} ${c.y - head * Math.sin(ang - 0.6)}L${c.x} ${c.y}L${c.x - head * Math.cos(ang + 0.6)} ${c.y - head * Math.sin(ang + 0.6)}`} strokeWidth={sw} />
        </g>
      </svg>
      <div ref={cap} className={`fork-caption ${below ? "below" : ""}`} style={at}>
        <span>{text}</span>
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
