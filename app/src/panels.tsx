// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Left panel (pages, board list, search), minimap, board options, single-board focus view.
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";

import type { Rect } from "./Canvas";
import { Icon } from "./icons";
import type { Board, BoardItem, Page, View } from "./types";
import { strings } from "./strings";

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
  onAddPage: () => void;
  onPageMenu: (id: string, e: { clientX: number; clientY: number }) => void;
  onMovePage?: (id: string, index: number) => void;
  onPick: (file: string, add: boolean) => void;
  onBoardMenu: (file: string, e: { clientX: number; clientY: number }) => void;
  header?: React.ReactNode;
  onGroupMenu?: (key: string, files: string[], e: { clientX: number; clientY: number }) => void;
  onGroupRename?: (key: string) => void;
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
    return (
      <li key={f}>
        <button className={`row ${p.selected.includes(f) ? "on" : ""}`} onClick={(e) => p.onPick(f, e.shiftKey || e.metaKey)} onContextMenu={(e) => { e.preventDefault(); p.onBoardMenu(f, e); }} title={f}>
          <Icon name="board" size={14} />
          <span className="row-text">{b.title ?? f}</span>
          {p.missing.includes(f) && <Icon name="warn" size={14} className="warn-icon" aria-label={strings.boardList.fileMissing} />}
        </button>
      </li>
    );
  };
  return (
    <aside className="left" aria-label={strings.boardList.aria}>
      {p.header}
      <section className="left-pages">
        <div className="sec-head">
          <span>{strings.boardList.pages}</span>
          <button className="icon-btn sm" aria-label={strings.boardList.addPage} title={strings.boardList.addPage} onClick={p.onAddPage}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        {p.pages.length === 0 ? (
          <p className="empty">{strings.boardList.singlePage}</p>
        ) : (
          <ul role="tablist" aria-label={strings.boardList.pages}>
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
                <button role="tab" title={strings.boardList.pageTabTitle} aria-selected={pg.id === p.currentPage} className={`row ${pg.id === p.currentPage ? "on" : ""} ${overPage === i && dragPage !== pg.id ? "drop-before" : ""}`} onClick={() => p.onPage(pg.id)} onContextMenu={(e) => { e.preventDefault(); p.onPageMenu(pg.id, e); }}>
                  <Icon name="page" size={14} />
                  <span className="row-text">{pg.name}</span>
                  <span className="row-count">{Object.values(p.board.boards).filter((b) => (b.page ?? firstPage) === pg.id).length}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="left-boards">
        <div className="sec-head">
          <span>{strings.boardList.boards(list.length)}</span>
        </div>
        <label className="search">
          <Icon name="search" size={14} />
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
          <p className="empty">{q ? strings.boardList.noMatch(q) : strings.boardList.emptyPage}</p>
        ) : groups ? (
          <ul className="board-list">
            {groups.map((g) => {
              const open = !closed[g.key] || g.files.some((f) => p.selected.includes(f));
              return (
                <li key={g.key} className={`group ${open ? "open" : ""}`}>
                  <div className="row group-head" role="button" tabIndex={0} aria-expanded={open} title={strings.boardList.groupTitle(g.files.length)} onClick={() => toggleGroup(g.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(g.key); } }} onDoubleClick={() => g.key && p.onGroupRename?.(g.key)} onContextMenu={(e) => { if (!p.onGroupMenu) return; e.preventDefault(); p.onGroupMenu(g.key, g.files, e); }}>
                    <Icon name="chevronRight" size={14} className="chev" />
                    <span className="row-text">{(g.key && p.board.groupNames?.[g.key]) || g.label}</span>
                    <span className="row-count">{g.files.length}</span>
                    {p.onGroupMenu && (
                      <button className="icon-btn sm group-more" aria-label={strings.boardList.groupMenu} title={strings.boardList.groupMenu} onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); p.onGroupMenu!(g.key, g.files, { clientX: r.left, clientY: r.bottom + 4 }); }}>
                        <Icon name="more" size={14} />
                      </button>
                    )}
                  </div>
                  {open && <ul>{g.files.map(row)}</ul>}
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="board-list">{list.map(row)}</ul>
        )}
      </section>
    </aside>
  );
});

/* ---------------- Minimap ---------------- */
export function Minimap({ rects, selected, view, size, onJump }: { rects: (Rect & { file: string })[]; selected: string[]; view: View; size: { w: number; h: number }; onJump: (x: number, y: number) => void }) {
  const W = 200;
  const H = 130;
  const box = useMemo(() => {
    if (!rects.length) return { x: 0, y: 0, w: 1, h: 1 };
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
  }, [rects]);
  const s = Math.min(W / box.w, H / box.h);
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
      className={`minimap ${rects.length > 30 ? "many" : ""}`}
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
          <rect key={r.file} x={(r.x - box.x) * s + ox} y={(r.y - box.y) * s + oy} width={Math.max(1, r.w * s)} height={Math.max(1, r.h * s)} className={selected.includes(r.file) ? "mm-sel" : "mm-board"} />
        ))}
        <rect x={vp.x} y={vp.y} width={vp.w} height={vp.h} className="mm-view" />
      </svg>
    </div>
  );
}

/* ---------------- Board options ---------------- */
export function BoardOptions(p: {
  file: string;
  item: BoardItem;
  pages: Page[];
  isLaunch: boolean;
  onPatch: (patch: Partial<BoardItem>) => void;
  onRename: () => void;
  onRenameFile: () => void;
  onFocus: () => void;
  onFront: () => void;
  onBack: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onLaunch: (on: boolean) => void;
}) {
  const b = p.item;
  const num = (k: "x" | "y" | "w" | "h" | "radius", label: string, min?: number, max?: number) => (
    <NumField key={k + p.file + (b[k] ?? "")} label={label} value={b[k] ?? 0} min={min} max={max} onCommit={(v) => p.onPatch({ [k]: v })} />
  );
  return (
    <section className="board-opts" aria-label={strings.boardOptions.aria}>
      <div className="sec-head">
        <span>{strings.boardOptions.heading}</span>
      </div>
      <button className="title-btn" onClick={p.onRename} title={strings.boardOptions.renameTitle}>
        <strong>{b.title ?? p.file}</strong>
        <Icon name="edit" size={14} />
      </button>
      <button className="link file-btn" onClick={p.onRenameFile} title={strings.boardOptions.renameFileTitle}>
        {p.file}
      </button>
      <div className="grid2">
        {num("x", "X")}
        {num("y", "Y")}
        {num("w", strings.boardOptions.width, 40, 8000)}
        {num("h", strings.boardOptions.height, 40, 8000)}
        {num("radius", strings.boardOptions.radius, 0, 200)}
      </div>
      <label className="check">
        <input type="checkbox" checked={!!b.is_interactive} onChange={(e) => p.onPatch({ is_interactive: e.target.checked || undefined })} />
        {strings.boardOptions.interactive}
      </label>
      <label className="check">
        <input type="checkbox" checked={!!b.frameless} onChange={(e) => p.onPatch({ frameless: e.target.checked || undefined })} />
        {strings.boardOptions.frameless}
      </label>
      <label className="check">
        <input type="checkbox" checked={b.expand === "fill"} onChange={(e) => p.onPatch({ expand: e.target.checked ? "fill" : undefined })} />
        {strings.boardOptions.fill}
      </label>
      <label className="check">
        <input type="checkbox" checked={p.isLaunch} onChange={(e) => p.onLaunch(e.target.checked)} />
        {strings.boardOptions.launch}
      </label>
      {p.pages.length > 0 && (
        <label className="field-row">
          <span>{strings.boardOptions.page}</span>
          <select value={b.page ?? p.pages[0].id} onChange={(e) => p.onPatch({ page: e.target.value })}>
            {p.pages.map((pg) => (
              <option key={pg.id} value={pg.id}>
                {pg.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="btn-row">
        <button className="icon-btn" aria-label={strings.boardOptions.focus} title={strings.boardOptions.focusTitle} onClick={p.onFocus}><Icon name="focus" /></button>
        <button className="icon-btn" aria-label={strings.boardOptions.front} title={strings.boardOptions.frontTitle} onClick={p.onFront}><Icon name="front" /></button>
        <button className="icon-btn" aria-label={strings.boardOptions.back} title={strings.boardOptions.backTitle} onClick={p.onBack}><Icon name="back" /></button>
        <button className="icon-btn" aria-label={strings.boardOptions.duplicate} title={strings.boardOptions.duplicateTitle} onClick={p.onDuplicate}><Icon name="copy" /></button>
        <button className="icon-btn danger" aria-label={strings.boardOptions.delete} title={strings.boardOptions.deleteTitle} onClick={p.onDelete}><Icon name="trash" /></button>
      </div>
    </section>
  );
}

function NumField({ label, value, min, max, onCommit }: { label: string; value: number; min?: number; max?: number; onCommit: (v: number) => void }) {
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
      <span>{label}</span>
      <input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => {
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
