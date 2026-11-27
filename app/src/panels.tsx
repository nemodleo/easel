// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Left card (pages, board list, search), minimap, board properties, single-board focus view.
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";

import type { Rect } from "./Canvas";
import { Icon } from "./icons";
import type { Board, BoardItem, Page, View } from "./types";
import { strings } from "./strings";
import { useView, type ViewStore } from "./viewStore";

/* ---------------- Left panel ---------------- */
const GROUP_MIN = 12;
/** "scr-01-home.html" → "SCR"; files without a letter prefix fall into the "Other" group */
const prefixOf = (f: string) => /^([a-z]+)[-_]/i.exec(f)?.[1].toUpperCase() ?? "";
export const LeftPanel = forwardRef<HTMLInputElement, {
  board: Board;
  pages: Page[];
  currentPage: string | null;
  selected: string[];
  missing: string[];
  onPage: (id: string) => void;
  /** Without these the list is view-only (the exported viewer): no add button, no menus */
  onAddPage?: () => void;
  onPageMenu?: (id: string, e: { clientX: number; clientY: number }) => void;
  onMovePage?: (id: string, index: number) => void;
  onPick: (file: string, add: boolean) => void;
  onBoardMenu?: (file: string, e: { clientX: number; clientY: number }) => void;
  header?: React.ReactNode;
  /** The viewer shows pages as tabs in its bar instead */
  showPages?: boolean;
  footer?: React.ReactNode;
  onGroupMenu?: (key: string, files: string[], e: { clientX: number; clientY: number }) => void;
  onGroupRename?: (key: string) => void;
  /** The dot of whoever is editing a board now, in their colour */
  dotOf?: (file: string) => { color: string; label: string } | null;
  /** The surface: the editor's left card (oc-card oc-left …) or the viewer's panel (left) */
  className?: string;
  style?: React.CSSProperties;
}>(function LeftPanel(p, searchRef) {
  const [q, setQ] = useState("");
  const [dragPage, setDragPage] = useState<string | null>(null);
  const [overPage, setOverPage] = useState<number | null>(null);
  const firstPage = p.pages[0]?.id;
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return [...new Set(p.board.order)].filter((f) => {
      const b = p.board.boards[f];
      if (!b) return false;
      if (k) return f.toLowerCase().includes(k) || (b.title ?? "").toLowerCase().includes(k);
      return !p.pages.length || (b.page ?? firstPage) === p.currentPage;
    });
  }, [q, p.board, p.pages, p.currentPage, firstPage]);
  // Long lists group by file-name prefix (scr-01 → SCR); groups remember whether they are collapsed
  const groups = useMemo(() => {
    if (q.trim() || list.length < GROUP_MIN) return null;
    const by = new Map<string, string[]>();
    for (const f of list) {
      const k = prefixOf(f);
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(f);
    }
    const keys = [...by.keys()].filter((k) => k && by.get(k)!.length >= 2);
    if (keys.length < 2) return null;
    const other = list.filter((f) => !keys.includes(prefixOf(f)));
    return [...keys.map((k) => ({ key: k, label: k, files: by.get(k)! })), ...(other.length ? [{ key: "", label: strings.boardList.otherGroup, files: other }] : [])];
  }, [list, q]);
  const [closed, setClosed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("design-canvas:groups-closed") ?? "{}");
    } catch {
      return {};
    }
  });
  const toggleGroup = (k: string) =>
    setClosed((c) => {
      const next = { ...c, [k]: !c[k] };
      try {
        localStorage.setItem("design-canvas:groups-closed", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  const row = (f: string) => {
    const b = p.board.boards[f];
    // Title first; the file name at the right in mono when it says something the title does not
    const file = !!b.title && b.title !== f.replace(/\.html$/, "");
    const d = p.dotOf?.(f);
    return (
      <li key={f}>
        <button className={`row oc-row ${p.selected.includes(f) ? "on" : ""}`} aria-current={p.selected.includes(f) || undefined} onClick={(e) => p.onPick(f, e.shiftKey || e.metaKey)} onContextMenu={(e) => { if (!p.onBoardMenu) return; e.preventDefault(); p.onBoardMenu(f, e); }} title={f}>
          <span className="row-title">{b.title ?? f}</span>
          {p.missing.includes(f) && <Icon name="warn" size={14} className="warn-icon" aria-label={strings.boardList.fileMissing} />}
          {d && <span className="idot occ-dot" style={{ background: d.color }} role="img" aria-label={d.label} title={d.label} />}
          {file && <span className="row-file">{f}</span>}
        </button>
      </li>
    );
  };
  return (
    <aside className={p.className ?? "left"} style={p.style} aria-label={strings.boardList.aria}>
      {p.header}
      {p.showPages !== false && <section className="left-pages">
        <div className="oc-sec">
          <span>{strings.boardList.pages}</span>
          {p.onAddPage && (
            <button className="icon-btn oc-ib" aria-label={strings.boardList.addPage} title={strings.boardList.addPage} onClick={p.onAddPage}>
              <Icon name="plus" size={16} />
            </button>
          )}
        </div>
        {p.pages.length === 0 ? (
          <p className="oc-empty">{strings.boardList.singlePage}</p>
        ) : (
          <ul className="oc-list" role="tablist" aria-label={strings.boardList.pages}>
            {p.pages.map((pg, i) => (
              <li
                key={pg.id}
                draggable={!!p.onMovePage}
                onDragStart={(e) => {
                  setDragPage(pg.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (!dragPage) return;
                  e.preventDefault();
                  setOverPage(i);
                }}
                onDragEnd={() => {
                  setDragPage(null);
                  setOverPage(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = p.pages.findIndex((x) => x.id === dragPage);
                  if (dragPage && from !== i) p.onMovePage?.(dragPage, i);
                  setDragPage(null);
                  setOverPage(null);
                }}
              >
                <button role="tab" title={strings.boardList.pageTabTitle} aria-selected={pg.id === p.currentPage} className={`row oc-row ${pg.id === p.currentPage ? "on" : ""} ${overPage === i && dragPage !== pg.id ? "drop-before" : ""}`} onClick={() => p.onPage(pg.id)} onContextMenu={(e) => { if (!p.onPageMenu) return; e.preventDefault(); p.onPageMenu(pg.id, e); }}>
                  <span className="row-title">{pg.name}</span>
                  <span className="row-count">{Object.values(p.board.boards).filter((b) => (b.page ?? firstPage) === pg.id).length}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>}
      <section className="left-boards">
        <div className="oc-sec">
          <span>
            {strings.boardList.boardsHead}
            <span className="oc-count">{list.length}</span>
          </span>
        </div>
        <label className="oc-search">
          <Icon name="search" size={16} />
          <input ref={searchRef} value={q} placeholder={strings.boardList.searchPlaceholder} aria-label={strings.boardList.search} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && list[0]) p.onPick(list[0], false);
            if (e.key === "Escape") {
              setQ("");
              (e.target as HTMLInputElement).blur();
            }
          }} />
        </label>
        {list.length === 0 ? (
          <p className="oc-empty">{q ? strings.boardList.noMatch(q) : strings.boardList.emptyPage}</p>
        ) : groups ? (
          <ul className="oc-list board-list">
            {groups.map((g) => {
              const open = !closed[g.key] || g.files.some((f) => p.selected.includes(f));
              return (
                <li key={g.key} className={`group ${open ? "open" : ""}`}>
                  <div className="row oc-row group-head" role="button" tabIndex={0} aria-expanded={open} title={strings.boardList.groupTitle(g.files.length)} onClick={() => toggleGroup(g.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(g.key); } }} onDoubleClick={() => g.key && p.onGroupRename?.(g.key)} onContextMenu={(e) => { if (!p.onGroupMenu) return; e.preventDefault(); p.onGroupMenu(g.key, g.files, e); }}>
                    <Icon name="chevronRight" size={14} className="chev" />
                    <span className="row-title">{(g.key && p.board.groupNames?.[g.key]) || g.label}</span>
                    <span className="row-count">{g.files.length}</span>
                    {p.onGroupMenu && (
                      <button className="icon-btn sm group-more" aria-label={strings.boardList.groupMenu} title={strings.boardList.groupMenu} onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); p.onGroupMenu!(g.key, g.files, { clientX: r.left, clientY: r.bottom + 4 }); }}>
                        <Icon name="more" size={14} />
                      </button>
                    )}
                  </div>
                  {open && <ul className="oc-list oc-sub">{g.files.map(row)}</ul>}
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="oc-list board-list">{list.map(row)}</ul>
        )}
      </section>
      {p.footer}
    </aside>
  );
});

/* ---------------- Minimap ---------------- */
export function Minimap({ rects, selected, view, size, onJump, w: W = 200, h: H = 130, inset = 0, className = "minimap" }: { rects: (Rect & { file: string })[]; selected: string[]; view: View; size: { w: number; h: number }; onJump: (x: number, y: number) => void; w?: number; h?: number; inset?: number; className?: string }) {
  const box = useMemo(() => {
    if (!rects.length) return { x: 0, y: 0, w: 1, h: 1 };
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
  }, [rects]);
  // The boards fit inside the inset; the view outline is drawn from the window, so it may cross the inset but is clipped by the map
  const s = Math.min((W - inset * 2) / box.w, (H - inset * 2) / box.h);
  const ox = (W - box.w * s) / 2;
  const oy = (H - box.h * s) / 2;
  const vp = { x: (-view.x / view.zoom - box.x) * s + ox, y: (-view.y / view.zoom - box.y) * s + oy, w: Math.max(0, (size.w / view.zoom) * s), h: Math.max(0, (size.h / view.zoom) * s) };
  const dragging = useRef(false);
  const jump = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const k = r.width / W; // In narrow windows CSS scales it down
    onJump(((e.clientX - r.left) / k - ox) / s + box.x, ((e.clientY - r.top) / k - oy) / s + box.y);
  };
  return (
    <div
      className={`${className} ${rects.length > 30 ? "many" : ""}`}
      role="img"
      aria-label={strings.minimap.aria}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        jump(e);
      }}
      onPointerMove={(e) => dragging.current && jump(e)}
      onPointerUp={() => (dragging.current = false)}
    >
      <svg width={W} height={H}>
        {rects.map((r) => (
          <rect key={r.file} x={(r.x - box.x) * s + ox} y={(r.y - box.y) * s + oy} width={Math.max(1, r.w * s)} height={Math.max(1, r.h * s)} rx={2} className={selected.includes(r.file) ? "mm-sel" : "mm-board"} />
        ))}
        {/* a 1px outline on the pixel grid: half-pixel edges, whole-pixel size */}
        <rect x={Math.round(vp.x) + 0.5} y={Math.round(vp.y) + 0.5} width={Math.max(0, Math.round(vp.w) - 1)} height={Math.max(0, Math.round(vp.h) - 1)} rx={3} className="mm-view" />
      </svg>
    </div>
  );
}

/* ---------------- Board properties ---------------- */
/** The board's head (file, title with Rename) and its groups: Position and size, Options. Checks, guides and Layers follow in the inspector */
export function BoardOptions(p: {
  file: string;
  item: BoardItem;
  pages: Page[];
  isLaunch: boolean;
  onPatch: (patch: Partial<BoardItem>) => void;
  onRename: () => void;
  onRenameFile: () => void;
  onLaunch: (on: boolean) => void;
}) {
  const b = p.item;
  const O = strings.boardOptions;
  const num = (k: "x" | "y" | "w" | "h" | "radius", label: string, min?: number, max?: number, bare = false) => (
    <NumField key={k + p.file + (b[k] ?? "")} label={label} bare={bare} value={b[k] ?? 0} min={min} max={max} onCommit={(v) => p.onPatch({ [k]: v })} />
  );
  return (
    <>
      <header className="pp-head" aria-label={O.aria}>
        <button className="pp-file" onClick={p.onRenameFile} title={O.renameFileTitle}>
          {p.file}
        </button>
        <h2 className="pp-name">
          <span>{b.title ?? p.file}</span>
          <button className="icon-btn pp-ib" aria-label={strings.menu.rename} title={O.renameTitle} onClick={p.onRename}>
            <Icon name="edit" size={16} />
          </button>
        </h2>
      </header>
      <section className="pp-group">
        <h3 className="pp-group-h">{O.positionAndSize}</h3>
        <div className="pp-row">
          <span className="pp-l">{O.position}</span>
          <span className="pp-two">
            {num("x", "X")}
            {num("y", "Y")}
          </span>
        </div>
        <div className="pp-row">
          <span className="pp-l">{strings.boardOptions.size}</span>
          <span className="pp-two">
            {num("w", O.width, 40, 8000)}
            {num("h", O.height, 40, 8000)}
          </span>
        </div>
        <div className="pp-row">
          <span className="pp-l">{O.radius}</span>
          <span className="pp-two">{num("radius", O.radius, 0, 200, true)}</span>
        </div>
      </section>
      <section className="pp-group">
        <h3 className="pp-group-h">{O.options}</h3>
        <Check on={!!b.is_interactive} label={O.interactive} title={O.interactiveTitle} onChange={(on) => p.onPatch({ is_interactive: on || undefined })} />
        <Check on={!!b.frameless} label={O.frameless} onChange={(on) => p.onPatch({ frameless: on || undefined })} />
        <Check on={b.expand === "fill"} label={O.fill} onChange={(on) => p.onPatch({ expand: on ? "fill" : undefined })} />
        <Check on={p.isLaunch} label={O.launch} onChange={p.onLaunch} />
        {p.pages.length > 0 && (
          <label className="pp-row">
            <span className="pp-l">{O.page}</span>
            <select value={b.page ?? p.pages[0].id} onChange={(e) => p.onPatch({ page: e.target.value })}>
              {p.pages.map((pg) => (
                <option key={pg.id} value={pg.id}>
                  {pg.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
    </>
  );
}

/** The board's actions in the inspector's footer: Focus view, Duplicate, Bring to front, Send to back, then Delete at the right */
export function BoardActions(p: { onFocus: () => void; onDuplicate: () => void; onFront: () => void; onBack: () => void; onDelete: () => void }) {
  const O = strings.boardOptions;
  return (
    <footer className="pp-actions" aria-label={strings.inspector.boardActions}>
      <button className="icon-btn" aria-label={O.focus} title={O.focusTitle} onClick={p.onFocus}><Icon name="focus" /></button>
      <button className="icon-btn" aria-label={O.duplicate} title={O.duplicateTitle} onClick={p.onDuplicate}><Icon name="copy" /></button>
      <button className="icon-btn" aria-label={O.front} title={O.frontTitle} onClick={p.onFront}><Icon name="front" /></button>
      <button className="icon-btn" aria-label={O.back} title={O.backTitle} onClick={p.onBack}><Icon name="back" /></button>
      <button className="icon-btn pp-del" aria-label={O.delete} title={O.deleteTitleKey} onClick={p.onDelete}><Icon name="trash" /></button>
    </footer>
  );
}

/** A checkbox in A: the native box stays for keys and screen readers, the drawn box (the one control with an edge) shows it */
export function Check(p: { on: boolean; label: string; title?: string; onChange: (on: boolean) => void }) {
  return (
    <label className="check" title={p.title}>
      <input type="checkbox" checked={p.on} onChange={(e) => p.onChange(e.target.checked)} />
      <i className={p.on ? "on" : ""} aria-hidden="true">{p.on && <Icon name="check" size={12} />}</i>
      {p.label}
    </label>
  );
}

function NumField({ label, value, min, max, bare, onCommit }: { label: string; value: number; min?: number; max?: number; bare?: boolean; onCommit: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    let n = Math.round(Number(v));
    if (!Number.isFinite(n)) return setV(String(value));
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    if (n !== value) onCommit(n);
    setV(String(n));
  };
  return (
    <label className="num">
      {!bare && <span>{label}</span>}
      <input inputMode="numeric" aria-label={bare ? label : undefined} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const n = Number(v) + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1);
          setV(String(n));
        }
      }} />
    </label>
  );
}

/* ---------------- Single-board focus view ---------------- */
export function FocusView({ board, file, onClose, onNav }: { board: Board; file: string; onClose: () => void; onNav: (f: string) => void }) {
  const b = board.boards[file];
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const list = [...new Set(board.order)].filter((f) => board.boards[f]);
  const i = list.indexOf(file);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && list[i + 1]) onNav(list[i + 1]);
      if (e.key === "ArrowLeft" && list[i - 1]) onNav(list[i - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, onClose, onNav, i, list]);
  useEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el || !b) return;
      setScale(Math.min(1, (el.clientWidth - 48) / b.w, (el.clientHeight - 48) / b.h));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [b]);
  if (!b) return null;
  const fill = b.expand === "fill";
  return (
    <div className="focus" role="dialog" aria-modal="true" aria-label={strings.focus.aria(b.title ?? file)}>
      <div className="focus-bar">
        <button className="icon-btn" aria-label={strings.focus.prev} disabled={!list[i - 1]} onClick={() => onNav(list[i - 1])}><Icon name="chevronRight" style={{ transform: "rotate(180deg)" }} /></button>
        <button className="icon-btn" aria-label={strings.focus.next} disabled={!list[i + 1]} onClick={() => onNav(list[i + 1])}><Icon name="chevronRight" /></button>
        <strong>{b.title ?? file}</strong>
        <span className="muted">{file}{fill ? strings.focus.pageStyle : ` · ${b.w}×${b.h} · ${Math.round(scale * 100)}%`}</span>
        <div className="spacer" />
        <button onClick={onClose}>{strings.focus.close} <kbd>Esc</kbd></button>
      </div>
      <div ref={ref} className={`focus-stage ${fill ? "fill" : ""}`}>
        {fill ? (
          <iframe src={`/screens/${file}`} title={b.title ?? file} className="focus-fill" />
        ) : (
          <div className="focus-frame" style={{ width: b.w * scale, height: b.h * scale, borderRadius: (b.radius ?? 0) * scale }}>
            <iframe src={`/screens/${file}`} title={b.title ?? file} style={{ width: b.w, height: b.h, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** The minimap, following the view store on its own (the app around it does not re-render on a pan step) */
export function MinimapOf({ store, ...p }: { store: ViewStore } & Omit<Parameters<typeof Minimap>[0], "view">) {
  return <Minimap {...p} view={useView(store)} />;
}
