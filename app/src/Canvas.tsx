// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Infinite canvas: tools (select, hand, board, title, note), pan and zoom, multi-select, group move, snap guides, boards (iframes) with labels and sizes, notes. PLAN.md section 5.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";

import { stickyBg } from "./drawing";
import { Icon } from "./icons";
import type { Board, BoardItem, Note, ScreenSource, Tool, View } from "./types";
import { strings } from "./strings";

// PLAN said 10%, but allow down to 4% to fit all 98 boards (about 17,700 tall) on one screen
export const MIN_ZOOM = 0.04;
export const MAX_ZOOM = 4;
/** Below this zoom, show an empty frame instead of the iframe (PLAN.md section 9) */
export const IFRAME_MIN_ZOOM = 0.25;
/** ...unless the board itself is this big on screen (CSS px, long side): then only a few boards fit and a thumbnail would look soft */
export const LIVE_MIN_SCREEN_PX = 640;
/** Thumbnail resolutions the server renders (long side, device px). A board asks for the smallest one that covers it on screen */
export const THUMB_SIZES = [600, 1200, 2400];
export const thumbSize = (screenPx: number) => THUMB_SIZES.find((s) => s >= screenPx) ?? THUMB_SIZES[THUMB_SIZES.length - 1];
const SNAP_PX = 6;
/** The editor's boards: served by the canvas server, with zoomed-out thumbnails */
export const SERVER_SCREENS: ScreenSource = { url: (f) => `/screens/${f}`, thumbs: true };

export type Rect = { x: number; y: number; w: number; h: number };
export type ContextTarget = { type: "board"; file: string } | { type: "note"; id: string } | { type: "canvas"; x: number; y: number };
type Guide = { axis: "x" | "y"; at: number; from: number; to: number };
type Gesture = null | { kind: "pan"; sx: number; sy: number; vx: number; vy: number } | { kind: "marquee" | "draw"; sx: number; sy: number; additive: boolean; moved: boolean };

type Props = {
  board: Board;
  files: string[];
  view: View;
  setView: (v: View | ((v: View) => View)) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  visibleBoards: string[];
  visibleNotes: string[];
  selected: string[];
  selectedNotes: string[];
  editFile: string | null;
  /** Board playing in place (the iframe is interactive) */
  playing?: string | null;
  reloadKeys: Record<string, number>;
  onSelect: (files: string[], mode: "replace" | "toggle" | "add") => void;
  onSelectNote: (id: string | null, add?: boolean) => void;
  /** Marquee result: boards and notes inside the rectangle (additive with Shift) */
  onMarquee: (hit: { boards: string[]; notes: string[]; shapes: string[] }, additive: boolean) => void;
  onMoveBoards: (patches: Record<string, Partial<BoardItem>>, done: boolean) => void;
  onMoveNote: (id: string, patch: Partial<Note>, done: boolean) => void;
  onDeleteNote: (id: string) => void;
  onPlay: (f: string) => void;
  onEdit: (f: string | null) => void;
  onRename: (f: string) => void;
  onCreateBoard: (r: Rect) => void;
  onCreateNote: (kind: Note["kind"], at: { x: number; y: number }) => void;
  onContext: (t: ContextTarget, e: { clientX: number; clientY: number }) => void;
  renderBoardOverlay?: (f: string) => ReactNode;
  /** Tags stacked above a board's title (who changed it); not drawn while the label is too small to show the title */
  renderBoardTags?: (f: string) => ReactNode;
  /** Buttons that stay visible in a board's label row (Use this), before Edit */
  renderBoardButtons?: (f: string) => ReactNode;
  /** Colour of the ring around a board an agent is writing right now */
  boardRing?: (f: string) => string | null;
  /** Things drawn over boards (shapes) — world coordinates */
  worldLayer?: ReactNode;
  iframeRef?: (f: string, el: HTMLIFrameElement | null) => void;
  onSize?: (s: { w: number; h: number }) => void;
  /** View-only (exported viewer): dragging pans, a press selects, nothing moves, resizes or edits */
  readOnly?: boolean;
  screens?: ScreenSource;
};

export function Canvas(p: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [space, setSpace] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [draft, setDraft] = useState<Rect | null>(null); // Board drawing or selection marquee
  const draftRef = useRef<Rect | null>(null);
  const gesture = useRef<Gesture>(null);

  useLayoutEffect(() => {
    const el = rootRef.current!;
    const ro = new ResizeObserver(() => {
      const s = { w: el.clientWidth, h: el.clientHeight };
      setSize(s);
      p.onSize?.(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // will-change only while the view moves: kept on, Chromium holds the old raster scale and boards stay blurry after a zoom
  const moved = useRef(false);
  useEffect(() => {
    const el = worldRef.current;
    if (!el) return;
    if (!moved.current) {
      moved.current = true;
      return;
    }
    el.style.willChange = "transform";
    const t = setTimeout(() => (el.style.willChange = ""), 200);
    return () => clearTimeout(t);
  }, [p.view.x, p.view.y, p.view.zoom]);

  // Wheel: with ⌘/Ctrl (including trackpad pinch) zoom around the cursor, otherwise pan
  useEffect(() => {
    const el = rootRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey) {
        p.setView((v) => {
          const z = clamp(v.zoom * Math.exp(-e.deltaY * 0.01), MIN_ZOOM, MAX_ZOOM);
          const wx = (mx - v.x) / v.zoom;
          const wy = (my - v.y) / v.zoom;
          return { zoom: z, x: mx - wx * z, y: my - wy * z };
        });
      } else {
        p.setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [p.setView]);

  // Holding Space switches to the hand tool
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e) && !e.repeat) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const { view } = p;
  const toWorld = (cx: number, cy: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.zoom, y: (cy - r.top - view.y) / view.zoom };
  };
  const setDraftBoth = (r: Rect | null) => {
    draftRef.current = r;
    setDraft(r);
  };

  const panning = space || p.tool === "hand" || !!p.readOnly;
  const screens = p.screens ?? SERVER_SCREENS;
  const onBgDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && e.button !== 1) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (e.button === 1 || panning) {
      gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    if (e.button !== 0) return;
    const w = toWorld(e.clientX, e.clientY);
    if (p.tool === "title" || p.tool === "sticky") {
      p.onCreateNote(p.tool, { x: Math.round(w.x), y: Math.round(w.y) });
      p.setTool("select");
      return;
    }
    gesture.current = { kind: p.tool === "board" ? "draw" : "marquee", sx: w.x, sy: w.y, additive: e.shiftKey, moved: false };
  };
  const onBgMove = (e: RPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pan") {
      p.setView((v) => ({ ...v, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy }));
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    const r = { x: Math.min(g.sx, w.x), y: Math.min(g.sy, w.y), w: Math.abs(w.x - g.sx), h: Math.abs(w.y - g.sy) };
    if ((r.w + r.h) * view.zoom > 4) g.moved = true;
    if (g.moved) setDraftBoth(r);
  };
  const onBgUp = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    // View-only: a click (no drag) on the background clears the selection
    if (g?.kind === "pan" && p.readOnly && Math.abs(e.clientX - g.sx) + Math.abs(e.clientY - g.sy) < 4) p.onSelect([], "replace");
    if (!g || g.kind === "pan") return;
    const r = draftRef.current;
    setDraftBoth(null);
    if (g.kind === "draw") {
      const w = toWorld(e.clientX, e.clientY);
      // A click without dragging uses the default 390×844 size
      p.onCreateBoard(g.moved && r && r.w > 20 && r.h > 20 ? roundRect(r) : { x: Math.round(w.x), y: Math.round(w.y), w: 390, h: 844 });
      p.setTool("select");
      return;
    }
    if (!g.moved || !r) {
      if (!g.additive) {
        p.onSelect([], "replace");
        p.onSelectNote(null);
      }
      return;
    }
    const boards = p.visibleBoards.filter((f) => intersects(p.board.boards[f], r));
    // Notes size themselves in the DOM, so measure them on screen and map back to world coordinates
    const notes = p.visibleNotes.filter((id) => {
      const el = rootRef.current?.querySelector(`[data-note="${id}"]`);
      if (!el) return false;
      const b = el.getBoundingClientRect();
      const a = toWorld(b.left, b.top);
      const c = toWorld(b.right, b.bottom);
      return intersects({ x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y }, r);
    });
    const shapes = Object.entries(p.board.shapes ?? {}).filter(([, s]) => intersects({ x: s.x, y: s.y, w: Math.max(1, s.w), h: Math.max(1, s.h) }, r)).map(([id]) => id);
    p.onMarquee({ boards, notes, shapes }, g.additive);
  };

  /* ---------- Move selected boards together + snapping ---------- */
  const groupDrag = useRef<null | { sx: number; sy: number; origins: Record<string, { x: number; y: number }>; moved: boolean }>(null);
  const startGroupDrag = (e: RPointerEvent, file: string) => {
    const sel = p.selected.includes(file) ? p.selected : [file];
    const origins: Record<string, { x: number; y: number }> = {};
    for (const f of sel) origins[f] = { x: p.board.boards[f].x, y: p.board.boards[f].y };
    groupDrag.current = { sx: e.clientX, sy: e.clientY, origins, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const moveGroupDrag = (e: RPointerEvent, done = false) => {
    const g = groupDrag.current;
    if (!g) return;
    let dx = (e.clientX - g.sx) / view.zoom;
    let dy = (e.clientY - g.sy) / view.zoom;
    if (!g.moved && Math.abs(dx) + Math.abs(dy) < 3 / view.zoom) return;
    g.moved = true;
    const files = Object.keys(g.origins);
    // Snap: align the moving group's left/center/right (top/middle/bottom) to the same lines on other boards (hold Alt to disable)
    const moving = files.map((f) => ({ ...p.board.boards[f], x: g.origins[f].x + dx, y: g.origins[f].y + dy }));
    const box = bounds(moving);
    const others = p.visibleBoards.filter((f) => !files.includes(f)).map((f) => p.board.boards[f]);
    const th = SNAP_PX / view.zoom;
    const gs: Guide[] = [];
    if (!e.altKey) {
      const sx = snap1([box.x, box.x + box.w / 2, box.x + box.w], others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w]), th);
      const sy = snap1([box.y, box.y + box.h / 2, box.y + box.h], others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h]), th);
      if (sx) {
        dx += sx.d;
        const near = others.filter((o) => [o.x, o.x + o.w / 2, o.x + o.w].some((v) => Math.abs(v - sx.at) < 0.5));
        gs.push({ axis: "x", at: sx.at, from: Math.min(box.y + (sy?.d ?? 0), ...near.map((o) => o.y)), to: Math.max(box.y + box.h + (sy?.d ?? 0), ...near.map((o) => o.y + o.h)) });
      }
      if (sy) {
        dy += sy.d;
        const near = others.filter((o) => [o.y, o.y + o.h / 2, o.y + o.h].some((v) => Math.abs(v - sy.at) < 0.5));
        gs.push({ axis: "y", at: sy.at, from: Math.min(box.x + (sx?.d ?? 0), ...near.map((o) => o.x)), to: Math.max(box.x + box.w + (sx?.d ?? 0), ...near.map((o) => o.x + o.w)) });
      }
    }
    setGuides(done ? [] : gs);
    const patches: Record<string, Partial<BoardItem>> = {};
    for (const f of files) patches[f] = { x: Math.round(g.origins[f].x + dx), y: Math.round(g.origins[f].y + dy) };
    p.onMoveBoards(patches, done);
  };
  const endGroupDrag = (e: RPointerEvent) => {
    const g = groupDrag.current;
    if (g?.moved) moveGroupDrag(e, true);
    groupDrag.current = null;
    setGuides([]);
  };

  const vw = size.w / view.zoom;
  const vh = size.h / view.zoom;
  const vx = -view.x / view.zoom;
  const vy = -view.y / view.zoom;
  const inView = (b: Rect) => b.x + b.w > vx - 200 && b.x < vx + vw + 200 && b.y + b.h > vy - 200 && b.y < vy + vh + 200;
  const startPanCapture = (e: RPointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  };

  return (
    <div
      ref={rootRef}
      className={`canvas tool-${panning ? "hand" : p.tool} ${p.editFile ? "editing" : ""}`}
      onPointerDown={onBgDown}
      onPointerMove={onBgMove}
      onPointerUp={onBgUp}
      onAuxClick={(e) => e.preventDefault()}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        const w = toWorld(e.clientX, e.clientY);
        p.onContext({ type: "canvas", x: Math.round(w.x), y: Math.round(w.y) }, e);
      }}
      role="application"
      aria-label={strings.canvas.aria}
    >
      <div ref={worldRef} className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        {p.visibleNotes.map((id) => (
          <NoteView
            key={id}
            note={p.board.notes[id]}
            zoom={view.zoom}
            id={id}
            selected={p.selectedNotes.includes(id)}
            readOnly={p.readOnly}
            onSelect={(add) => p.onSelectNote(id, add)}
            onMove={(patch, done) => p.onMoveNote(id, patch, done)}
            onDelete={() => p.onDeleteNote(id)}
            onContext={(e) => p.onContext({ type: "note", id }, e)}
          />
        ))}
        {p.visibleBoards.map((f) => {
          const b = p.board.boards[f];
          const live = inView(b) && (!screens.thumbs || view.zoom >= IFRAME_MIN_ZOOM || Math.max(b.w, b.h) * view.zoom >= LIVE_MIN_SCREEN_PX || p.editFile === f);
          const selected = p.selected.includes(f);
          return (
            <BoardView
              key={f}
              file={f}
              item={b}
              exists={p.files.includes(f)}
              zoom={view.zoom}
              live={live}
              selected={selected}
              single={selected && p.selected.length === 1 && !p.readOnly}
              readOnly={p.readOnly}
              screens={screens}
              editing={p.editFile === f}
              playing={p.playing === f}
              near={inView(b)}
              reloadKey={p.reloadKeys[f] ?? 0}
              onPointerDownLabel={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                if (p.readOnly) {
                  p.onSelect([f], "replace");
                  return startPanCapture(e);
                }
                if (e.shiftKey) {
                  p.onSelect([f], "toggle");
                  return;
                }
                if (!selected) p.onSelect([f], "replace");
                startGroupDrag(e, f);
              }}
              onPointerMoveLabel={(e) => (p.readOnly ? onBgMove(e) : moveGroupDrag(e))}
              onPointerUpLabel={(e) => (p.readOnly ? void (gesture.current = null) : endGroupDrag(e))}
              onResize={(patch, done) => p.onMoveBoards({ [f]: patch }, done)}
              onPlay={() => p.onPlay(f)}
              onEdit={() => p.onEdit(p.editFile === f ? null : f)}
              onRename={() => p.onRename(f)}
              onContext={(e) => p.onContext({ type: "board", file: f }, e)}
              overlay={p.renderBoardOverlay?.(f)}
              tags={b.w * view.zoom >= 48 && p.playing !== f ? p.renderBoardTags?.(f) : null}
              buttons={p.readOnly ? null : p.renderBoardButtons?.(f)}
              ring={p.boardRing?.(f) ?? null}
              iframeRef={(el) => p.iframeRef?.(f, el)}
            />
          );
        })}
        {p.worldLayer}
        {guides.map((g, i) =>
          g.axis === "x" ? (
            <div key={i} className="guide" style={{ left: g.at, top: g.from, width: 1 / view.zoom, height: g.to - g.from }} />
          ) : (
            <div key={i} className="guide" style={{ left: g.from, top: g.at, height: 1 / view.zoom, width: g.to - g.from }} />
          ),
        )}
        {draft && (
          <div className={p.tool === "board" ? "draft-board" : "marquee"} style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h, borderWidth: 1 / view.zoom }}>
            {p.tool === "board" && <span style={{ transform: `scale(${1 / view.zoom})` }}>{Math.round(draft.w)} × {Math.round(draft.h)}</span>}
          </div>
        )}
      </div>
      {space && <div className="pan-capture" onPointerDown={startPanCapture} onPointerMove={onBgMove} onPointerUp={() => (gesture.current = null)} />}
    </div>
  );
}

function BoardView(props: {
  file: string;
  item: BoardItem;
  exists: boolean;
  zoom: number;
  live: boolean;
  selected: boolean;
  single: boolean;
  editing: boolean;
  playing?: boolean;
  near?: boolean;
  reloadKey: number;
  onPointerDownLabel: (e: RPointerEvent) => void;
  onPointerMoveLabel: (e: RPointerEvent) => void;
  onPointerUpLabel: (e: RPointerEvent) => void;
  onResize: (patch: Partial<BoardItem>, done: boolean) => void;
  onPlay: () => void;
  onEdit: () => void;
  onRename: () => void;
  onContext: (e: RMouseEvent) => void;
  overlay?: ReactNode;
  tags?: ReactNode;
  buttons?: ReactNode;
  ring?: string | null;
  iframeRef: (el: HTMLIFrameElement | null) => void;
  readOnly?: boolean;
  screens: ScreenSource;
}) {
  const { item: b, zoom } = props;
  const resize = useDrag(zoom);
  const title = b.title ?? props.file;
  const ctx = (e: RMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    props.onContext(e);
  };
  const stop = (e: RPointerEvent) => e.stopPropagation();
  return (
    <div
      className={`board ${props.selected ? "selected" : ""} ${props.editing ? "editing" : ""} ${props.playing ? "playing" : ""} ${b.frameless ? "frameless" : ""} ${b.is_interactive ? "interactive" : ""} ${props.ring ? "held" : ""}`}
      style={{ left: b.x, top: b.y, width: b.w, height: b.h, ...(props.ring ? { ["--ring" as string]: props.ring } : {}) }}
      data-file={props.file}
      role="group"
      aria-label={strings.canvas.board(title, !!props.selected, !!props.editing, !!props.playing)}
    >
      <div
        className={`board-label ${b.w * zoom < 48 ? "tiny" : ""} ${props.tags ? "tagged" : ""}`}
        style={{ transform: `scale(${1 / zoom})`, width: b.w * zoom }}
        onPointerDown={props.onPointerDownLabel}
        onPointerMove={props.onPointerMoveLabel}
        onPointerUp={props.onPointerUpLabel}
        onContextMenu={ctx}
        title={`${title} · ${props.file}`}
      >
        {props.tags}
        <span className="lab-row">
          {b.is_interactive && <span className="dot" aria-label={strings.canvas.interactive} />}
          <span
            className="board-title"
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!props.readOnly) props.onRename();
            }}
          >
            {title}
          </span>
          {b.w * zoom >= 160 && title !== props.file && <span className="board-file">{props.file}</span>}
          {b.w * zoom >= 110 && (
            <span className={`board-btns ${props.buttons ? "pinned" : ""}`}>
              {props.buttons}
              {b.is_interactive && (
                <button className="icon-btn sm" aria-label="Play" title="Play" onPointerDown={stop} onClick={(e) => { e.stopPropagation(); props.onPlay(); }}>
                  <Icon name="play" size={14} />
                </button>
              )}
              {!props.readOnly && <button className={`icon-btn sm edit-pill ${props.editing ? "on" : ""}`} aria-label={strings.canvas.editMode} title={strings.canvas.editTitle} onPointerDown={stop} onClick={(e) => { e.stopPropagation(); props.onEdit(); }}>
                <Icon name="edit" size={14} />
                {b.w * zoom >= 150 && <span className="edit-pill-label">{strings.canvas.editPill}</span>}
              </button>}
            </span>
          )}
        </span>
      </div>
      <div
        className="board-frame"
        style={{ borderRadius: b.radius ?? 0 }}
        onDoubleClick={(e) => {
          if (!props.editing && !props.readOnly) {
            e.stopPropagation();
            props.onEdit();
          }
        }}
        onPointerDown={(e) => {
          // Press on the frame selects, and a drag from there moves the board (same as the label)
          if (e.button === 0 && !props.editing && !props.playing) props.onPointerDownLabel(e);
        }}
        onPointerMove={(e) => !props.editing && !props.playing && props.onPointerMoveLabel(e)}
        onPointerUp={(e) => !props.editing && !props.playing && props.onPointerUpLabel(e)}
        onContextMenu={(e) => !props.editing && !props.playing && ctx(e)}
      >
        {!props.exists ? (
          <div className="board-missing">{strings.canvas.fileMissing(props.file)}</div>
        ) : props.live ? (
          <LiveFrame reloadKey={props.reloadKey} iframeRef={props.iframeRef} src={props.screens.url(props.file)} html={props.screens.html?.(props.file)} title={title} editing={props.editing || !!props.playing} />
        ) : (
          <div className={`board-placeholder ${props.near ? "loading" : "far"}`} style={{ fontSize: Math.min(64, 14 / zoom) }}>
            {props.near && props.screens.thumbs && <Thumb file={props.file} v={props.reloadKey} px={thumbSize(Math.max(b.w, b.h) * zoom * (window.devicePixelRatio || 1))} />}
            <span className="ph-title" data-hint={props.near ? "" : strings.canvas.notLoaded}>{title}</span>
            {props.near && <span className="ph-bar" style={{ height: 3 / Math.max(zoom, 0.05) }} aria-hidden="true" />}
          </div>
        )}
        {props.playing && <div className="playing-badge" style={{ transform: `scale(${1 / Math.max(zoom, 0.25)})` }}>{strings.canvas.playing}</div>}
        {props.overlay}
      </div>
      {props.single && (
        <div
          className="board-resize"
          role="slider"
          aria-label={strings.canvas.boardSize}
          aria-valuetext={`${b.w} × ${b.h}`}
          style={{ width: 12 / zoom, height: 12 / zoom, right: -6 / zoom, bottom: -6 / zoom, borderWidth: 1.5 / zoom }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            resize.start(e, { x: b.w, y: b.h }, (d, done) => props.onResize({ w: clamp(Math.round(d.x), 40, 8000), h: clamp(Math.round(d.y), 40, 8000) }, done));
          }}
          onPointerMove={resize.move}
          onPointerUp={resize.end}
        />
      )}
    </div>
  );
}

/** When the file changes, reload the same iframe and restore the scroll position (PLAN.md section 5, live updates) */
/** Zoomed-out preview: a thumbnail made by the server (may take a few seconds at first). A sharper one replaces it only once loaded */
function Thumb({ file, v, px }: { file: string; v: number; px: number }) {
  const [failed, setFailed] = useState(false);
  // Never step down: zooming out keeps the sharper image already loaded
  const [want, setWant] = useState(px);
  useEffect(() => setWant((w) => Math.max(w, px)), [px]);
  const src = `/api/thumb?f=${encodeURIComponent(file)}&v=${v}&px=${want}`;
  const [shown, setShown] = useState<string | null>(null);
  const shownRef = useRef<string | null>(null);
  useEffect(() => {
    if (src === shownRef.current) return;
    const img = new Image();
    img.onload = () => setShown((shownRef.current = src));
    // A failed upgrade keeps the image already shown
    img.onerror = () => !shownRef.current && setFailed(true);
    img.src = src;
    return () => {
      img.onload = img.onerror = null;
    };
  }, [src]);
  if (failed || !shown) return null;
  return (
    <img
      className="board-thumb"
      src={shown}
      alt=""
      decoding="async"
      draggable={false}
      onLoad={(e) => {
        e.currentTarget.classList.add("loaded");
        e.currentTarget.parentElement?.classList.remove("loading");
      }}
    />
  );
}

/** Inline HTML (single-file export) goes in srcdoc: the same origin as the viewer, as /screens/ is for the editor, so pins can find elements */
function LiveFrame(props: { src: string; html?: string; title: string; reloadKey: number; editing: boolean; iframeRef: (el: HTMLIFrameElement | null) => void }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    const win = el?.contentWindow;
    if (!el || !win) return;
    const doc = win.document;
    const scrolls: [number, number, number][] = [];
    doc.querySelectorAll<HTMLElement>("*").forEach((n, i) => {
      if (n.scrollTop || n.scrollLeft) scrolls.push([i, n.scrollTop, n.scrollLeft]);
    });
    const sx = win.scrollX;
    const sy = win.scrollY;
    const onLoad = () => {
      el.removeEventListener("load", onLoad);
      const w = el.contentWindow!;
      w.scrollTo(sx, sy);
      const all = w.document.querySelectorAll<HTMLElement>("*");
      for (const [i, t, l] of scrolls) {
        const n = all[i];
        if (n) {
          n.scrollTop = t;
          n.scrollLeft = l;
        }
      }
      el.dispatchEvent(new CustomEvent("dc-reloaded"));
    };
    el.addEventListener("load", onLoad);
    win.location.reload();
  }, [props.reloadKey]);
  return (
    <iframe
      ref={(el) => {
        ref.current = el;
        props.iframeRef(el);
      }}
      src={props.html == null ? props.src : undefined}
      srcDoc={props.html ?? undefined}
      title={props.title}
      style={{ pointerEvents: props.editing ? "auto" : "none" }}
    />
  );
}

function NoteView(props: { id: string; note: Note; zoom: number; selected: boolean; readOnly?: boolean; onSelect: (add: boolean) => void; onMove: (patch: Partial<Note>, done: boolean) => void; onDelete: () => void; onContext: (e: RMouseEvent) => void }) {
  const { note: n } = props;
  const drag = useDrag(props.zoom);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      const r = document.createRange();
      r.selectNodeContents(ref.current);
      const s = getSelection();
      s?.removeAllRanges();
      s?.addRange(r);
    }
  }, [editing]);
  const composing = useRef(false);
  const blurPending = useRef(false);
  const commitText = (el: HTMLDivElement) => {
    setEditing(false);
    const text = el.innerText;
    if (text !== n.text) props.onMove({ text }, true);
  };
  // Title: shrink text past maxW/maxH (minimum 12px)
  const base = n.size ?? (n.kind === "title" ? 72 : 22);
  const [fs, setFs] = useState(base);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || n.kind !== "title" || editing) return setFs(base);
    let f = base;
    el.style.fontSize = `${f}px`;
    const maxW = n.maxW ?? 4000;
    const maxH = n.maxH || Infinity;
    for (let i = 0; i < 40 && f > 12 && (el.scrollWidth > maxW + 1 || el.scrollHeight > maxH + 1); i++) {
      f = Math.max(12, Math.floor(f * 0.92));
      el.style.fontSize = `${f}px`;
    }
    setFs(f);
  }, [n.text, base, n.maxW, n.maxH, n.kind, editing]);
  const resize = useDrag(props.zoom);
  const style =
    n.kind === "title"
      ? { left: n.x, top: n.y, maxWidth: n.maxW ?? 4000, maxHeight: n.maxH || undefined }
      : { left: n.x, top: n.y, width: n.w ?? 320, height: n.h || undefined, background: stickyBg(n.color) };
  const textStyle = { fontSize: fs, fontWeight: n.bold ?? n.kind === "title" ? 700 : 400, fontStyle: n.italic ? "italic" : undefined };
  // Zoomed far out, a title stays readable: it never drops below ~12px on screen
  if (n.kind === "title" && fs * props.zoom < 12) Object.assign(style, { transform: `scale(${12 / (fs * props.zoom)})`, transformOrigin: "0 0" });
  return (
    <div
      className={`note note-${n.kind} ${props.selected ? "selected" : ""} ${props.readOnly ? "read-only" : ""}`}
      data-note={props.id}
      style={style}
      onPointerDown={(e) => {
        if (editing || e.button !== 0 || props.readOnly) return;
        e.stopPropagation();
        if (e.shiftKey) props.onSelect(true);
        else if (!props.selected) props.onSelect(false);
        drag.start(e, { x: n.x, y: n.y }, (d, done) => props.onMove({ x: Math.round(d.x), y: Math.round(d.y) }, done));
      }}
      onPointerMove={drag.move}
      onPointerUp={drag.end}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!props.readOnly) setEditing(true);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (props.readOnly) return;
        props.onSelect(false);
        props.onContext(e);
      }}
    >
      <div
        ref={ref}
        className="note-text"
        style={textStyle}
        contentEditable={editing}
        suppressContentEditableWarning
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={(e) => {
          composing.current = false;
          if (blurPending.current) {
            blurPending.current = false;
            commitText(e.currentTarget as HTMLDivElement);
          }
        }}
        onBlur={(e) => {
          // If focus leaves during IME composition, save after composition ends
          if (composing.current) blurPending.current = true;
          else commitText(e.currentTarget as HTMLDivElement);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape") (e.currentTarget as HTMLDivElement).blur();
        }}
      >
        {n.text}
      </div>
      {props.selected && props.zoom >= 0.2 && !editing && (
        <div
          className="note-resize"
          role="slider"
          aria-label={n.kind === "title" ? strings.canvas.titleMaxWidth : strings.canvas.stickySize}
          style={{ width: 12 / props.zoom, height: 12 / props.zoom, right: -6 / props.zoom, bottom: -6 / props.zoom, borderWidth: 1.5 / props.zoom }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const el = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            const w0 = el.width / props.zoom;
            const h0 = el.height / props.zoom;
            resize.start(e, { x: w0, y: h0 }, (d, done) =>
              props.onMove(n.kind === "title" ? { maxW: Math.max(80, Math.round(d.x)) } : { w: Math.max(80, Math.round(d.x)), h: Math.max(60, Math.round(d.y)) }, done),
            );
          }}
          onPointerMove={resize.move}
          onPointerUp={resize.end}
        />
      )}
      {props.selected && !editing && props.zoom >= 0.2 && (
        <button className="note-del icon-btn" aria-label={strings.canvas.deleteNote} style={{ transform: `scale(${1 / props.zoom})` }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); props.onDelete(); }}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

/** Pointer drag: start value + (delta / zoom) */
function useDrag(zoom: number) {
  const s = useRef<{ sx: number; sy: number; ox: number; oy: number; cb: (d: { x: number; y: number }, done: boolean) => void; moved: boolean } | null>(null);
  return {
    start(e: RPointerEvent, origin: { x: number; y: number }, cb: (d: { x: number; y: number }, done: boolean) => void) {
      s.current = { sx: e.clientX, sy: e.clientY, ox: origin.x, oy: origin.y, cb, moved: false };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    move(e: RPointerEvent) {
      const d = s.current;
      if (!d) return;
      const dx = (e.clientX - d.sx) / zoom;
      const dy = (e.clientY - d.sy) / zoom;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2 / zoom) return;
      d.moved = true;
      d.cb({ x: d.ox + dx, y: d.oy + dy }, false);
    },
    end(e: RPointerEvent) {
      const d = s.current;
      s.current = null;
      if (!d || !d.moved) return;
      d.cb({ x: d.ox + (e.clientX - d.sx) / zoom, y: d.oy + (e.clientY - d.sy) / zoom }, true);
    },
  };
}

function snap1(edges: number[], targets: number[], th: number) {
  let best: { d: number; at: number } | null = null;
  for (const e of edges)
    for (const t of targets) {
      const d = t - e;
      if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
    }
  return best;
}
const bounds = (rs: Rect[]) => {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const roundRect = (r: Rect) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

export function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === "INPUT") return !/^(checkbox|radio|button|range|color)$/.test((t as HTMLInputElement).type);
  return t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName);
}

/** Fit a group of boards and notes to the view */
export function fitView(rects: Rect[], size: { w: number; h: number }, pad = 60): View {
  if (!rects.length) return { x: 0, y: 0, zoom: 1 };
  if (size.w < 100 || size.h < 100) size = { w: window.innerWidth, h: Math.max(200, window.innerHeight - 48) };
  pad = Math.min(pad, size.w * 0.08, size.h * 0.08);
  const b = bounds(rects);
  const zoom = clamp(Math.min((size.w - pad * 2) / b.w, (size.h - pad * 2) / b.h), MIN_ZOOM, MAX_ZOOM);
  return { zoom, x: pad - b.x * zoom + (size.w - pad * 2 - b.w * zoom) / 2, y: pad - b.y * zoom + (size.h - pad * 2 - b.h * zoom) / 2 };
}
