// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Who changed what: tags above boards someone else changed (who by glyph and name, seen state per browser), the tag popover (the change,
// Before / After, Undo), the outline of the changed elements, and the History menu over the dock ("Go back to here").
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, browserId } from "./api";
import { elementAt, rectOf, type Rect } from "./editor";
import { Icon, type IconName } from "./icons";
import { strings } from "./strings";

export type Who = { by?: string; person?: string; outside?: boolean };
export type Change = { kind: string; count: number; tag?: string; cls?: string; from?: string; to?: string; more?: boolean; paths: string[] };
export type Tag = Who & { key: string; steps: string[]; count: number; at: number; newBoard: boolean; change: Change | null; paths: string[]; run: string | null };
export type Step = Who & { id: string; name: string; label: string; at: number; mine: boolean; run?: string; undone?: boolean; now?: boolean };
export type Activity = { boot: string; steps: Step[]; tags: Record<string, Tag[]> };

/** A seen tag fades; a day after it was seen it goes */
const SEEN_FOR = 24 * 60 * 60 * 1000;
const seenKey = (canvas: string) => `design-canvas:seen:${canvas}`;

/** Who made a change reads from a glyph and the name, never from colour: an agent's speech mark, a person, a file changed on disk */
export const whoIcon = (w: Who): IconName => (w.by ? "comment" : w.person || !w.outside ? "person" : "file");
/** Display name: the agent, the person's name sent by their browser, "Outside Easel", or (API calls without one) this person */
export const whoName = (w: Who, me: string) => w.by ?? w.person ?? (w.outside ? strings.activity.outside : me);

/** Activity from the server plus this browser's seen state. Reload on history changes; the clock ticks so relative times update */
export function useActivity(canvas: string | null) {
  const [data, setData] = useState<Activity | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [seen, setSeen] = useState<Record<string, number>>({});
  const timer = useRef<number | null>(null);
  const reload = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.get<Activity>(`/api/activity?client=${encodeURIComponent(browserId)}`).then(setData).catch(() => {});
    }, 120);
  }, []);
  useEffect(() => {
    reload();
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, [reload]);
  // Seen state: per canvas, keyed by server session and step id (step ids restart with the server, so other sessions are dropped)
  useEffect(() => {
    if (!canvas || !data) return;
    try {
      const all = JSON.parse(localStorage.getItem(seenKey(canvas)) ?? "{}") as Record<string, number>;
      const mine = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(`${data.boot}:`)));
      setSeen(mine);
      if (Object.keys(mine).length !== Object.keys(all).length) localStorage.setItem(seenKey(canvas), JSON.stringify(mine));
    } catch {
      /* private mode: seen state lasts until reload */
    }
  }, [canvas, data?.boot]);
  const markSeen = useCallback(
    (ids: string[]) => {
      if (!data || !ids.length) return;
      setSeen((cur) => {
        const fresh = ids.filter((id) => !cur[`${data.boot}:${id}`]);
        if (!fresh.length) return cur;
        const next = { ...cur, ...Object.fromEntries(fresh.map((id) => [`${data.boot}:${id}`, Date.now()])) };
        try {
          if (canvas) localStorage.setItem(seenKey(canvas), JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [data, canvas],
  );
  /** fresh: some step not seen yet; seen: all seen (faded); gone: seen over a day ago */
  const stateOf = useCallback(
    (t: Tag): "fresh" | "seen" | "gone" => {
      if (!data) return "fresh";
      const at = t.steps.map((id) => seen[`${data.boot}:${id}`]);
      if (at.some((x) => !x)) return "fresh";
      return now - Math.max(...at) > SEEN_FOR ? "gone" : "seen";
    },
    [data, seen, now],
  );
  /** Tags to show on a board, newest first */
  const tagsOf = useCallback((file: string) => (data?.tags[file] ?? []).filter((t) => stateOf(t) !== "gone"), [data, stateOf]);
  return { data, now, reload, markSeen, stateOf, tagsOf };
}
export type ActivityApi = ReturnType<typeof useActivity>;

/** The tags above one board's title: who · when · how many changes; a faded one has been seen. lead: drawn first in the same row (who is on the board now) */
export function BoardTags({ file, act, me, onOpen, lead }: { file: string; act: ActivityApi; me: string; onOpen: (file: string, key: string) => void; lead?: ReactNode }) {
  const tags = act.tagsOf(file);
  if (!tags.length && !lead) return null;
  return (
    <span className="act-tags" role="group" aria-label={tags.length ? strings.activity.tagsAria(tags.reduce((n, t) => n + t.count, 0)) : strings.occupancy.tagsAria}>
      {lead}
      {tags.map((t) => {
        const text = strings.activity.tag(whoName(t, me), strings.activity.ago(act.now - t.at), t.count, t.newBoard);
        return (
          <button
            key={t.key}
            className={`act-tag ${act.stateOf(t) === "seen" ? "seen" : ""}`}
            data-tag={`${file}|${t.key}`}
            title={strings.activity.tagTitle(text)}
            aria-haspopup="dialog"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(file, t.key);
            }}
          >
            <Icon name={whoIcon(t)} size={16} />
            <span className="act-tag-text">{text}</span>
          </button>
        );
      })}
    </span>
  );
}

/** The change in words: a text change as "old" → "new", else its kind; several steps as a count */
function ChangeLine({ tag }: { tag: Tag }) {
  const c = tag.change;
  if (tag.count > 1) return <div className="callout-diff">{strings.activity.changes(tag.count)}</div>;
  if (c?.kind === "text")
    return (
      <div className="callout-diff">
        <span className="diff-old">{strings.activity.quote(c.from ?? "")}</span> {strings.activity.arrow} <span className="diff-new">{strings.activity.quote(c.to ?? "")}</span>
      </div>
    );
  return <div className="callout-diff">{c ? strings.activity.change(c) : strings.activity.change({ kind: "", count: 1 })}</div>;
}

/** Popover anchored under a tag (screen space, follows the tag as the canvas moves); closes on Esc, outside press, or when the tag goes */
export function TagPopover(p: {
  file: string;
  tag: Tag;
  me: string;
  now: number;
  conflict: string[] | null;
  busy: boolean;
  onCompare: () => void;
  onUndo: (mode?: "rest" | "all") => void;
  onCancelConflict: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const anchor = () => document.querySelector<HTMLElement>(`[data-tag="${CSS.escape(`${p.file}|${p.tag.key}`)}"]`);
  // After every render: the canvas may have moved
  useLayoutEffect(() => {
    const a = anchor();
    if (!a) return void p.onClose();
    const r = a.getBoundingClientRect();
    const w = ref.current?.offsetWidth ?? 280;
    const h = ref.current?.offsetHeight ?? 140;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const y = r.bottom + 8 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 8) : r.bottom + 8;
    if (!pos || Math.abs(pos.x - x) > 0.5 || Math.abs(pos.y - y) > 0.5) setPos({ x, y });
  });
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const close = (e: Event) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor()?.contains(t) || (t instanceof Element && t.closest(".dialog-backdrop"))) return;
      p.onClose();
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [p.file, p.tag.key]);
  const who = whoName(p.tag, p.me);
  return (
    <div
      ref={ref}
      className="callout"
      role="dialog"
      aria-label={strings.activity.popAria(who)}
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          p.onClose();
          anchor()?.focus();
        }
      }}
    >
      <div className="callout-top">
        <Icon name={whoIcon(p.tag)} size={16} />
        {who} <span className="muted">· {strings.activity.agoLong(p.now - p.tag.at)}</span>
        <button className="icon-btn sm callout-x" aria-label={strings.activity.close} title={strings.activity.close} onClick={p.onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <ChangeLine tag={p.tag} />
      <div className="callout-actions">
        <button onClick={p.onCompare}>
          <Icon name="compare" size={14} /> {strings.activity.beforeAfter}
        </button>
        <button disabled={p.busy} title={strings.activity.undoTitle(p.tag.steps.length)} onClick={() => p.onUndo()}>
          <Icon name="undo" size={14} /> {strings.activity.undo}
        </button>
      </div>
      {p.conflict && (
        <div className="rr-conflict" role="alert">
          <p>{strings.activity.conflict(p.conflict.join(", "))}</p>
          <div className="btn-row">
            <button onClick={() => p.onUndo("rest")}>{strings.activity.undoRest}</button>
            <button className="danger" onClick={() => p.onUndo("all")}>
              {strings.activity.undoAll}
            </button>
            <button onClick={p.onCancelConflict}>{strings.activity.cancel}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Outline of the changed elements, dashed and set off from them (apart from your own solid blue selection), inside a board's overlay
 * (board coordinates); follows reloads of the frame */
export function ChangeOutline({ frame, paths, zoom }: { frame: HTMLIFrameElement | null; paths: string[]; zoom: number }) {
  const [rects, setRects] = useState<Rect[]>([]);
  const key = paths.join(",");
  useEffect(() => {
    if (!frame) return setRects([]);
    const measure = () => {
      const doc = frame.isConnected ? frame.contentDocument : null;
      if (!doc?.body) return setRects([]);
      setRects(paths.map((p) => elementAt(doc, p)).filter((el): el is Element => !!el && el !== doc.body).map(rectOf));
    };
    measure();
    const t = window.setTimeout(measure, 300); // after the frame's own layout settles (fonts, images)
    frame.addEventListener("load", measure);
    frame.addEventListener("dc-reloaded", measure);
    return () => {
      window.clearTimeout(t);
      frame.removeEventListener("load", measure);
      frame.removeEventListener("dc-reloaded", measure);
    };
  }, [frame, key]);
  const px = 1 / Math.max(zoom, 0.05);
  return (
    <>
      {rects.map((r, i) => (
        <div key={i} className="box change-outline" style={{ left: r.x, top: r.y, width: r.w, height: r.h, ["--px" as string]: `${px}px` }} />
      ))}
    </>
  );
}

/** History · newest first: who (glyph and name), what, when; the current position is "Now"; the row under the pointer or the focus
 * offers "Go back to here". It rises 8px above the dock, its right edge on the dock's right edge (the dock's menus all rise from it) */
export function HistoryMenu(p: { steps: Step[]; me: string; now: number; anchor: DOMRect | null; busy: boolean; onGo: (s: Step) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const nowIdx = Math.max(0, p.steps.findIndex((s) => s.now));
  const [active, setActive] = useState(nowIdx);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  // On open, and again when Now moves (fresh history arrived, or a step was gone back to): focus follows it
  const nowId = p.steps[nowIdx]?.id;
  useEffect(() => {
    rows.current[nowIdx]?.focus();
    setActive(nowIdx);
  }, [nowId]);
  useEffect(() => {
    const close = (e: Event) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || (t instanceof Element && t.closest(".caret-btn"))) return;
      p.onClose();
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [p.onClose]);
  const move = (i: number) => {
    const n = Math.max(0, Math.min(p.steps.length - 1, i));
    setActive(n);
    rows.current[n]?.focus();
  };
  const style = useMemo(() => {
    const dock = document.querySelector(".oc-dock")?.getBoundingClientRect() ?? p.anchor;
    const w = Math.min(448, window.innerWidth - 16);
    if (!dock) return { left: 8, bottom: 76, width: w };
    const bottom = Math.round(window.innerHeight - dock.top + 8);
    return { left: Math.round(Math.max(8, Math.min(dock.right - w, window.innerWidth - w - 8))), bottom, width: w, maxHeight: Math.round(window.innerHeight - bottom - 8) };
  }, [p.anchor]);
  return (
    <div
      ref={ref}
      className="menu oc-hist entering"
      role="menu"
      aria-label={strings.activity.historyTitle}
      style={style}
      onKeyDown={(e) => {
        // The canvas shortcuts listen on window: keys the menu uses stop here (Enter still clicks the focused row)
        if (["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(e.key)) e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          p.onClose();
          document.querySelector<HTMLElement>(".caret-btn")?.focus();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          move(active + (e.key === "ArrowDown" ? 1 : -1));
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          move(e.key === "Home" ? 0 : p.steps.length - 1);
        }
      }}
    >
      <div className="oc-menu-h">{strings.activity.historyTitle}</div>
      {!p.steps.length && <p className="hist-empty">{strings.activity.historyEmpty}</p>}
      <div className="hist-rows">
        {p.steps.map((s, i) => {
          const who = whoName(s, p.me);
          const ago = strings.activity.ago(p.now - s.at);
          return (
            <button
              key={s.id}
              ref={(el) => void (rows.current[i] = el)}
              role="menuitem"
              className={`menu-item oc-hrow ${s.now ? "now" : ""} ${s.undone ? "past" : ""} ${active === i ? "active" : ""}`}
              aria-label={(s.now ? strings.activity.nowAria : s.undone ? strings.activity.undoneAria : strings.activity.goBackAria)(s.name, who, ago)}
              aria-current={s.now ? "step" : undefined}
              title={s.label}
              aria-disabled={p.busy || undefined}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => !s.now && !p.busy && p.onGo(s)}
            >
              <span className="oc-now-dot" aria-hidden="true" />
              <span className="oc-who">
                <Icon name={whoIcon(s)} size={16} />
                <span>{who}</span>
              </span>
              <span className="oc-what">{s.name}</span>
              {s.now ? <span className="oc-mark">{strings.activity.now}</span> : active === i ? <span className="oc-mark go">{strings.activity.goBack}</span> : <span />}
              <span className="oc-when">{ago}</span>
            </button>
          );
        })}
      </div>
      <div className="menu-foot">
        <span>{strings.activity.historyFoot}</span>
      </div>
    </div>
  );
}
