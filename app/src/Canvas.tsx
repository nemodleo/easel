// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Infinite canvas: tools (select, hand, board, title, note), pan and zoom, multi-select, group move, snap guides, boards (iframes) with labels and sizes, notes. PLAN.md section 5.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";

import { isDrag } from "./directSelect";
import { stickyBg } from "./drawing";
import { Icon } from "./icons";
import type { Board, BoardItem, Note, ScreenSource, Tool, View } from "./types";
import { scrollInside } from "./useElementSelect";
import { strings } from "./strings";
import { useView, type ViewStore } from "./viewStore";

// PLAN said 10%, but allow down to 4% to fit all 98 boards (about 17,700 tall) on one screen
export const MIN_ZOOM = 0.04;
export const MAX_ZOOM = 4;
/** Below this zoom, show an empty frame instead of the iframe (PLAN.md section 9) */
export const IFRAME_MIN_ZOOM = 0.25;
/** ...unless the board itself is this big on screen (CSS px, long side): then only a few boards fit and a thumbnail would look soft */
export const LIVE_MIN_SCREEN_PX = 640;
/** Below this zoom the labels of forks and their originals are one 24px row (compact): rows of forks placed 120px apart leave it room
 * from 23% up, a full label (title and a tag row, 56px) only from 47%. Other boards keep their tags */
export const COMPACT_LABEL_ZOOM = 0.5;
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
  /** The view (pan and zoom): only the canvas follows it, the rest of the app does not re-render on a wheel step */
  view: ViewStore;
  tool: Tool;
  setTool: (t: Tool) => void;
  visibleBoards: string[];
  visibleNotes: string[];
  selected: string[];
  selectedNotes: string[];
  /** Board this tab has an element selected on (always drawn live) */
  editFile: string | null;
  /** Board whose text is being edited in place: its iframe takes the pointer so the caret can be placed */
  typing?: string | null;
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
  /** A click on a live board (select tool): select the element under the pointer. add: Shift-click on the board already in element selection; double: edit its text */
  onPickElement?: (f: string, at: { clientX: number; clientY: number }, how: { add: boolean; double: boolean }) => void;
  /** Pointer over a live board with no button down (hover outline); null when it leaves */
  onHoverElement?: (f: string | null, at?: { clientX: number; clientY: number }) => void;
  /** Shift-drag on the board in element selection: a rectangle (client px) that selects the elements inside it when done */
  onElementMarquee?: (f: string, r: Rect | null, done: boolean) => void;
  /** Right-click on a live board: true when it opened the element's menu (else the board's menu opens) */
  onElementContext?: (f: string, at: { clientX: number; clientY: number }) => boolean;
  onRename: (f: string) => void;
  onCreateBoard: (r: Rect) => void;
  onCreateNote: (kind: Note["kind"], at: { x: number; y: number }) => void;
  onContext: (t: ContextTarget, e: { clientX: number; clientY: number }) => void;
  renderBoardOverlay?: (f: string, zoom: number) => ReactNode;
  /** Tags stacked above a board's title (who changed it); not drawn while the label is too small to show the title, or compact */
  renderBoardTags?: (f: string) => ReactNode;
  /** Buttons that stay visible in a board's label row (Use this), before Play; compact: the label is one row (zoomed out) */
  renderBoardButtons?: (f: string, compact: boolean) => ReactNode;
  /** Colour of the ring around a board an agent is writing right now */
  boardRing?: (f: string) => string | null;
  /** Things drawn over boards (shapes) — world coordinates; drawn again when the zoom or the function changes */
  worldLayer?: (zoom: number) => ReactNode;
  /** Things drawn under notes and boards (the fork arrows) — world coordinates */
  underLayer?: (zoom: number) => ReactNode;
  iframeRef?: (f: string, el: HTMLIFrameElement | null) => void;
  onSize?: (s: { w: number; h: number }) => void;
  /** View-only (exported viewer): dragging pans, a press selects, nothing moves, resizes or edits */
  readOnly?: boolean;
  screens?: ScreenSource;
};

export function Canvas(p: Props) {
  const view = useView(p.view);
  const setView = p.view.set;
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
    const measure = () => {
      const s = { w: el.clientWidth, h: el.clientHeight };
      // A hidden container (a collapsed pane, display: none) measures 0: keep the last real size. Taken as the view, 0 × 0 marks
      // every board out of view and unloads them all, and a hidden page gets no new ResizeObserver callback until it renders again
      if (!s.w || !s.h) return;
      setSize((o) => (o.w === s.w && o.h === s.h ? o : s));
      p.onSize?.(s);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    document.addEventListener("visibilitychange", measure);
    return () => {
      ro.disconnect();
      document.removeEventListener("visibilitychange", measure);
    };
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
  }, [view.x, view.y, view.zoom]);

  // Wheel: with ⌘/Ctrl (including trackpad pinch) zoom around the cursor, otherwise pan
  useEffect(() => {
    const el = rootRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey) {
        setView((v) => {
          const z = clamp(v.zoom * Math.exp(-e.deltaY * 0.01), MIN_ZOOM, MAX_ZOOM);
          const wx = (mx - v.x) / v.zoom;
          const wy = (my - v.y) / v.zoom;
          return { zoom: z, x: mx - wx * z, y: my - wy * z };
        });
      } else {
        // Over the board that has an element selected, the wheel scrolls the board's own content first (what Edit mode used to allow)
        const frame = (e.target as Element | null)?.closest?.(".board-frame[data-inside]")?.querySelector("iframe") ?? null;
        if (scrollInside(frame, e.clientX, e.clientY, e.deltaX, e.deltaY)) return;
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setView]);

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
      setView((v) => ({ ...v, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy }));
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
    if (!g.moved && !isDrag(e.clientX - g.sx, e.clientY - g.sy)) return;
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

  /* ---------- A press on a board: drag moves it, a click selects the element under the pointer ---------- */
  const press = useRef<null | { file: string; kind: "board" | "label" | "elements"; sx: number; sy: number; moved: boolean }>(null);
  const picking = !!p.onPickElement && !p.readOnly && !panning && p.tool === "select";
  const pressBoard = (e: RPointerEvent, f: string, from: "frame" | "label", live: boolean) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // View-only, and the hand tool (or Space): a press pans; view-only also selects the board
    if (p.readOnly || panning) {
      if (p.readOnly) p.onSelect([f], "replace");
      return startPanCapture(e);
    }
    const selected = p.selected.includes(f);
    p.onHoverElement?.(null);
    // Shift on the board already in element selection: click adds an element, drag draws a rectangle over elements
    if (from === "frame" && picking && live && e.shiftKey && p.editFile === f) {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      press.current = { file: f, kind: "elements", sx: e.clientX, sy: e.clientY, moved: false };
      return;
    }
    if (e.shiftKey) return p.onSelect([f], "toggle");
    if (!selected) p.onSelect([f], "replace");
    startGroupDrag(e, f);
    press.current = { file: f, kind: from === "frame" && picking && live ? "board" : "label", sx: e.clientX, sy: e.clientY, moved: false };
  };
  const elRect = (pr: { sx: number; sy: number }, e: { clientX: number; clientY: number }): Rect => ({ x: Math.min(pr.sx, e.clientX), y: Math.min(pr.sy, e.clientY), w: Math.abs(e.clientX - pr.sx), h: Math.abs(e.clientY - pr.sy) });
  const moveBoardPress = (e: RPointerEvent, f: string, live: boolean) => {
    if (p.readOnly || gesture.current?.kind === "pan") return onBgMove(e);
    // A press whose release never arrived (lost outside the window): forget it rather than drag with no button down
    if (press.current && e.buttons === 0) {
      press.current = null;
      groupDrag.current = null;
    }
    const pr = press.current;
    if (!pr) {
      // Hover: the outline of the element under the pointer (no button down)
      if (e.buttons === 0 && picking && live) p.onHoverElement?.(f, e);
      return;
    }
    if (pr.kind === "elements") {
      if (!pr.moved && !isDrag(e.clientX - pr.sx, e.clientY - pr.sy)) return;
      pr.moved = true;
      p.onElementMarquee?.(pr.file, elRect(pr, e), false);
      return;
    }
    moveGroupDrag(e);
  };
  const releaseBoard = (e: RPointerEvent, f: string) => {
    if (p.readOnly || gesture.current?.kind === "pan") return void (gesture.current = null);
    const pr = press.current;
    press.current = null;
    if (pr?.kind === "elements") {
      if (pr.moved) p.onElementMarquee?.(pr.file, elRect(pr, e), true);
      else p.onPickElement?.(f, e, { add: true, double: false });
      return;
    }
    const moved = !!groupDrag.current?.moved;
    endGroupDrag(e);
    if (!pr || moved) return;
    // A click: on a live board it selects the element under the pointer; on the title row it selects the board itself
    if (pr.kind === "board") p.onPickElement?.(f, e, { add: false, double: false });
    else if (pr.kind === "label" && p.editFile === f) p.onSelect([f], "replace");
  };

  // The fork scene: forks, and originals with a fork on this page. Their labels go compact when zoomed out; every other board keeps its tags
  const shownBoards = new Set(p.visibleBoards);
  const forkScene = new Set<string>();
  for (const f of p.visibleBoards) {
    const o = p.board.boards[f]?.origin;
    if (o?.kind !== "fork") continue;
    forkScene.add(f);
    if (shownBoards.has(o.of)) forkScene.add(o.of);
  }
  // Boards and notes get one stable set of handlers that call this render's functions, so a board whose own props did not change
  // is not rendered again when the view moves or another board is dragged
  const latest = useRef({ p, pressBoard, moveBoardPress, releaseBoard, picking });
  latest.current = { p, pressBoard, moveBoardPress, releaseBoard, picking };
  const h = useMemo<ItemHandlers>(() => {
    const l = () => latest.current;
    return {
      press: (e, f, from, live) => l().pressBoard(e, f, from, live),
      pressMove: (e, f, live) => l().moveBoardPress(e, f, live),
      release: (e, f) => l().releaseBoard(e, f),
      leave: () => !press.current && l().p.onHoverElement?.(null),
      doubleClickFrame: (e, f) => l().p.onPickElement?.(f, e, { add: false, double: true }),
      contextFrame: (e, f, live) => l().picking && live && !!l().p.onElementContext?.(f, e),
      resize: (f, patch, done) => l().p.onMoveBoards({ [f]: patch }, done),
      play: (f) => l().p.onPlay(f),
      rename: (f) => l().p.onRename(f),
      context: (f, e) => l().p.onContext({ type: "board", file: f }, e),
      iframeRef: (f, el) => l().p.iframeRef?.(f, el),
      selectNote: (id, add) => l().p.onSelectNote(id, add),
      moveNote: (id, patch, done) => l().p.onMoveNote(id, patch, done),
      deleteNote: (id) => l().p.onDeleteNote(id),
      contextNote: (id, e) => l().p.onContext({ type: "note", id }, e),
    };
  }, []);
  const fileSet = useMemo(() => new Set(p.files), [p.files]);
  // A board's overlay is drawn again only when the app rendered (a new function) or the zoom changed, not on every pan step
  const overlays = useRef<{ fn?: Props["renderBoardOverlay"]; zoom: number; of: Map<string, ReactNode> }>({ zoom: 0, of: new Map() });
  if (overlays.current.fn !== p.renderBoardOverlay || overlays.current.zoom !== view.zoom) overlays.current = { fn: p.renderBoardOverlay, zoom: view.zoom, of: new Map() };
  const overlayOf = (f: string) => {
    const o = overlays.current.of;
    if (!o.has(f)) o.set(f, p.renderBoardOverlay?.(f, view.zoom));
    return o.get(f);
  };
  const underLayer = useMemo(() => p.underLayer?.(view.zoom), [p.underLayer, view.zoom]);
  const worldLayer = useMemo(() => p.worldLayer?.(view.zoom), [p.worldLayer, view.zoom]);
  return (
    <div
      ref={rootRef}
      className={`canvas tool-${panning ? "hand" : p.tool}`}
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
        {underLayer}
        {p.visibleNotes.map((id) => (
          <NoteView
            key={id}
            note={p.board.notes[id]}
            zoom={view.zoom}
            id={id}
            selected={p.selectedNotes.includes(id)}
            readOnly={p.readOnly}
            h={h}
          />
        ))}
        {p.visibleBoards.map((f) => {
          const b = p.board.boards[f];
          // The board being played, edited or typed in is always live, whatever the zoom or the measured view says: Play on a thumbnail
          // (a tall board fitted below 25%) or on a placeholder (a view measured while the pane was hidden) shows an empty board
          const pinned = p.playing === f || p.editFile === f || p.typing === f;
          const near = pinned || inView(b);
          const live = pinned || (near && (!screens.thumbs || view.zoom >= IFRAME_MIN_ZOOM || Math.max(b.w, b.h) * view.zoom >= LIVE_MIN_SCREEN_PX));
          const selected = p.selected.includes(f);
          return (
            <BoardView
              key={f}
              file={f}
              item={b}
              exists={fileSet.has(f)}
              zoom={view.zoom}
              live={live}
              selected={selected}
              single={selected && p.selected.length === 1 && !p.readOnly}
              readOnly={p.readOnly}
              screens={screens}
              editing={p.editFile === f}
              typing={p.typing === f}
              playing={p.playing === f}
              near={near}
              reloadKey={p.reloadKeys[f] ?? 0}
              pickable={picking && live}
              h={h}
              overlay={overlayOf(f)}
              compact={b.w * view.zoom >= 48 && view.zoom < COMPACT_LABEL_ZOOM && forkScene.has(f)}
              forkScene={forkScene.has(f)}
              tags={b.w * view.zoom >= 48 && !(view.zoom < COMPACT_LABEL_ZOOM && forkScene.has(f)) && p.playing !== f ? p.renderBoardTags?.(f) : null}
              buttons={p.readOnly ? null : p.renderBoardButtons?.(f, view.zoom < COMPACT_LABEL_ZOOM && forkScene.has(f))}
              ring={p.boardRing?.(f) ?? null}
            />
          );
        })}
        {worldLayer}
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

/** What boards and notes call back with; one object for the canvas's lifetime */
type ItemHandlers = {
  press: (e: RPointerEvent, f: string, from: "frame" | "label", live: boolean) => void;
  pressMove: (e: RPointerEvent, f: string, live: boolean) => void;
  release: (e: RPointerEvent, f: string) => void;
  leave: () => void;
  doubleClickFrame: (e: RMouseEvent, f: string) => void;
  /** True when the right-click opened an element's menu */
  contextFrame: (e: RMouseEvent, f: string, live: boolean) => boolean;
  resize: (f: string, patch: Partial<BoardItem>, done: boolean) => void;
  play: (f: string) => void;
  rename: (f: string) => void;
  context: (f: string, e: RMouseEvent) => void;
  iframeRef: (f: string, el: HTMLIFrameElement | null) => void;
  selectNote: (id: string, add: boolean) => void;
  moveNote: (id: string, patch: Partial<Note>, done: boolean) => void;
  deleteNote: (id: string) => void;
  contextNote: (id: string, e: RMouseEvent) => void;
};

/** Rendered again only when one of its own props changes (memo): the canvas renders on every pan and zoom step */
const BoardView = memo(function BoardView(props: {
  file: string;
  item: BoardItem;
  exists: boolean;
  zoom: number;
  live: boolean;
  selected: boolean;
  single: boolean;
  editing: boolean;
  typing?: boolean;
  playing?: boolean;
  near?: boolean;
  /** Zoomed out in the fork scene: the label is one row */
  compact?: boolean;
  /** A fork or the original of one: its tags stay in one row */
  forkScene?: boolean;
  reloadKey: number;
  /** A click on the frame picks the element under the pointer (select tool, live board) */
  pickable: boolean;
  h: ItemHandlers;
  overlay?: ReactNode;
  tags?: ReactNode;
  buttons?: ReactNode;
  ring?: string | null;
  readOnly?: boolean;
  screens: ScreenSource;
}) {
  const { item: b, zoom, file, h, live } = props;
  const resize = useDrag(zoom);
  const title = b.title ?? props.file;
  const tiny = b.w * zoom < 48;
  const compact = !tiny && !!props.compact;
  // A fork's label: zoomed out it shows its agent (a spinner while an agent writes it); its whole story is the label's tooltip
  const fork = b.origin?.kind === "fork" && b.origin.by ? b.origin : null;
  const story = fork ? strings.occupancy.forked(strings.occupancy.clock(Date.parse(fork.at ?? "") || Date.now()), fork.by!, fork.while ?? strings.occupancy.someone) : null;
  const ctx = (e: RMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    h.context(file, e);
  };
  const stop = (e: RPointerEvent) => e.stopPropagation();
  // ▶ on every board: always shown with Show Play button (is_interactive), otherwise while the board is selected or hovered (CSS).
  // While the board plays it stops it. Playing is viewing: nothing is written to board.json
  const playBtn = b.w * zoom >= 110 && (
    <button
      className={`icon-btn sm board-play ${b.is_interactive ? "always" : ""} ${props.playing ? "pressed" : ""}`}
      aria-label={props.playing ? strings.canvas.stopPlay : strings.canvas.play}
      title={props.playing ? strings.canvas.stopPlayTitle : strings.canvas.playTitle}
      onPointerDown={stop}
      onClick={(e) => {
        e.stopPropagation();
        h.play(file);
      }}
    >
      <Icon name={props.playing ? "stop" : "play"} size={14} />
    </button>
  );
  return (
    <div
      className={`board ${props.selected ? "selected" : ""} ${props.editing ? "editing" : ""} ${props.playing ? "playing" : ""} ${b.frameless ? "frameless" : ""} ${b.is_interactive ? "interactive" : ""} ${props.ring ? "held" : ""}`}
      style={{ left: b.x, top: b.y, width: b.w, height: b.h, ...(props.ring ? { ["--ring" as string]: props.ring } : {}) }}
      data-file={props.file}
      role="group"
      aria-label={strings.canvas.board(title, !!props.selected, !!props.editing, !!props.playing)}
      aria-description={story ?? undefined}
    >
      <div
        className={`board-label ${tiny ? "tiny" : ""} ${compact ? "compact" : ""} ${props.tags ? "tagged" : ""} ${props.forkScene ? "fork-scene" : ""}`}
        style={{ transform: `scale(${1 / zoom})`, width: b.w * zoom }}
        onPointerDown={(e) => h.press(e, file, "label", live)}
        onPointerMove={(e) => h.pressMove(e, file, live)}
        onPointerUp={(e) => h.release(e, file)}
        onContextMenu={ctx}
        title={`${title} · ${props.file}${story ? `\n${story}` : ""}`}
      >
        {props.tags}
        <span className="lab-row">
          {b.is_interactive && <span className="dot" aria-label={strings.canvas.interactive} />}
          {compact && fork ? (
            <span className={`occ-tag fork-who ${props.ring ? "" : "done"}`} onDoubleClick={(e) => e.stopPropagation()}>
              {props.ring ? <span className="spinner" aria-hidden="true" /> : <Icon name="comment" size={16} />}
              <span className="act-tag-text">{fork.by}</span>
            </span>
          ) : (
            <span
              className="board-title"
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!props.readOnly) h.rename(file);
              }}
            >
              {title}
            </span>
          )}
          {b.w * zoom >= 160 && title !== props.file && !(compact && fork) && <span className="board-file">{props.file}</span>}
          {compact && props.selected && (props.buttons || playBtn) && (
            <span className="board-btns pinned">
              {props.buttons}
              {playBtn}
            </span>
          )}
          {!compact && b.w * zoom >= 110 && (
            <span className={`board-btns ${props.buttons ? "pinned" : ""}`}>
              {props.buttons}
              {playBtn}
            </span>
          )}
        </span>
      </div>
      <div
        className="board-frame"
        data-inside={props.editing && !props.readOnly ? "" : undefined}
        style={{ borderRadius: b.radius ?? 0 }}
        onDoubleClick={(e) => {
          if (props.playing || props.typing || !props.pickable) return;
          e.stopPropagation();
          h.doubleClickFrame(e, file);
        }}
        // A press on the frame selects the board; dragging moves it, a click selects the element under the pointer (the iframe never takes the pointer)
        onPointerDown={(e) => !props.playing && !props.typing && h.press(e, file, "frame", live)}
        onPointerMove={(e) => !props.playing && !props.typing && h.pressMove(e, file, live)}
        onPointerUp={(e) => !props.playing && !props.typing && h.release(e, file)}
        onPointerLeave={h.leave}
        onContextMenu={(e) => {
          if (props.playing || props.typing) return;
          if (h.contextFrame(e, file, live)) {
            e.preventDefault();
            e.stopPropagation();
          } else ctx(e);
        }}
      >
        {!props.exists ? (
          <div className="board-missing">{strings.canvas.fileMissing(props.file)}</div>
        ) : props.live ? (
          <LiveFrame reloadKey={props.reloadKey} iframeRef={(el) => h.iframeRef(file, el)} src={props.screens.url(props.file)} html={props.screens.html?.(props.file)} title={title} interactive={!!props.playing || !!props.typing} />
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
            resize.start(e, { x: b.w, y: b.h }, (d, done) => h.resize(file, { w: clamp(Math.round(d.x), 40, 8000), h: clamp(Math.round(d.y), 40, 8000) }, done));
          }}
          onPointerMove={resize.move}
          onPointerUp={resize.end}
        />
      )}
    </div>
  );
});

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
function LiveFrame(props: { src: string; html?: string; title: string; reloadKey: number; interactive: boolean; iframeRef: (el: HTMLIFrameElement | null) => void }) {
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
      style={{ pointerEvents: props.interactive ? "auto" : "none" }}
    />
  );
}

const NoteView = memo(function NoteView(props: { id: string; note: Note; zoom: number; selected: boolean; readOnly?: boolean; h: ItemHandlers }) {
  const { note: n, h, id } = props;
  const onMove = (patch: Partial<Note>, done: boolean) => h.moveNote(id, patch, done);
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
    if (text !== n.text) onMove({ text }, true);
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
        if (e.shiftKey) h.selectNote(id, true);
        else if (!props.selected) h.selectNote(id, false);
        drag.start(e, { x: n.x, y: n.y }, (d, done) => onMove({ x: Math.round(d.x), y: Math.round(d.y) }, done));
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
        h.selectNote(id, false);
        h.contextNote(id, e);
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
              onMove(n.kind === "title" ? { maxW: Math.max(80, Math.round(d.x)) } : { w: Math.max(80, Math.round(d.x)), h: Math.max(60, Math.round(d.y)) }, done),
            );
          }}
          onPointerMove={resize.move}
          onPointerUp={resize.end}
        />
      )}
      {props.selected && !editing && props.zoom >= 0.2 && (
        <button className="note-del icon-btn" aria-label={strings.canvas.deleteNote} style={{ transform: `scale(${1 / props.zoom})` }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); h.deleteNote(id); }}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
});

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

/** Fit a group of boards and notes to the view; `area` (window pixels) is the part the cards and the dock leave clear */
export function fitView(rects: Rect[], size: { w: number; h: number }, pad = 60, area?: Rect): View {
  if (!rects.length) return { x: 0, y: 0, zoom: 1 };
  if (size.w < 100 || size.h < 100) size = { w: window.innerWidth, h: Math.max(200, window.innerHeight) };
  const a = area && area.w >= 100 && area.h >= 100 ? area : { x: 0, y: 0, w: size.w, h: size.h };
  pad = Math.min(pad, a.w * 0.08, a.h * 0.08);
  const b = bounds(rects);
  const zoom = clamp(Math.min((a.w - pad * 2) / b.w, (a.h - pad * 2) / b.h), MIN_ZOOM, MAX_ZOOM);
  return { zoom, x: Math.round(a.x + pad - b.x * zoom + (a.w - pad * 2 - b.w * zoom) / 2), y: Math.round(a.y + pad - b.y * zoom + (a.h - pad * 2 - b.h * zoom) / 2) };
}
