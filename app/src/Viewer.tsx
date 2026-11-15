// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// View-only canvas for a Share › Export copy: pages, zoom, Play, the board list, comments and notes read-only, the export stamp.
// Direction A with the editing taken out: the left card is the project, its pages and boards; the right card the comments; the
// navigation card; a dock with what this copy is (View only, when, which commit) and Play, the one orange. Pins are ink, the open one
// blue. Reuses the editor's Canvas (readOnly), LeftPanel, Minimap, ShapesLayer and Play. It never calls the server.
import { useEffect, useMemo, useRef, useState } from "react";

import { Canvas, clamp, fitView, MAX_ZOOM, MIN_ZOOM } from "./Canvas";
import { ShapesLayer } from "./drawing";
import { elementAt, rectOf } from "./editor";
import { Icon } from "./icons";
import type { Comment } from "./Inspector";
import { LeftPanel, Minimap } from "./panels";
import { Play } from "./Play";
import { strings } from "./strings";
import type { ExportData, Note, ScreenSource, View } from "./types";
import { useCentred } from "./ui";

export const EASEL_URL = "https://github.com/nemodleo/easel";
const encodePath = (f: string) => f.split("/").map(encodeURIComponent).join("/");
const noteRect = (n: Note) => ({ x: n.x, y: n.y, w: n.w ?? n.maxW ?? 400, h: n.kind === "title" ? 90 : 200 });
const NARROW = "(max-width: 1000px)";

/** "Nov 10, 14:02" */
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function Viewer({ data }: { data: ExportData }) {
  const { board, stamp } = data;
  // One page left after the scope filter reads as no pages: no tabs
  const pages = board.pages.length > 1 ? board.pages : [];
  const firstPage = board.pages[0]?.id;
  const [page, setPage] = useState<string | null>(pages[0]?.id ?? null);
  const onPage = (item: { page?: string }) => !pages.length || (item.page ?? firstPage) === page;
  const visibleBoards = board.order.filter((f) => board.boards[f] && onPage(board.boards[f]));
  const visibleNotes = Object.keys(board.notes).filter((id) => onPage(board.notes[id]));
  const shapes = board.shapes ?? {};
  const visibleShapes = Object.keys(shapes)
    .filter((id) => onPage(shapes[id]))
    .sort((a, b) => (shapes[a].z ?? 0) - (shapes[b].z ?? 0));

  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selected, setSelected] = useState<string[]>([]);
  const [playFile, setPlayFile] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  const [leftOpen, setLeftOpen] = useState(!narrow);
  const [rightOpen, setRightOpen] = useState(!narrow);
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => {
      setNarrow(mq.matches);
      setLeftOpen(!mq.matches);
      setRightOpen(!mq.matches);
    };
    const resize = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    mq.addEventListener("change", on);
    window.addEventListener("resize", resize);
    return () => {
      mq.removeEventListener("change", on);
      window.removeEventListener("resize", resize);
    };
  }, []);
  useEffect(() => {
    document.title = strings.viewer.docTitle(board.title);
  }, [board.title]);

  const screens = useMemo<ScreenSource>(() => ({ url: (f) => `screens/${encodePath(f)}`, html: data.screens ? (f) => data.screens![f] : undefined, thumbs: false }), [data]);

  // Open comments in board order, numbered once for pins and the list
  const comments = useMemo(() => {
    const at = new Map(board.order.map((f, i) => [f, i]));
    return data.comments.filter((c) => !c.resolved && board.boards[c.file]).sort((a, b) => (at.get(a.file) ?? 0) - (at.get(b.file) ?? 0) || a.createdAt.localeCompare(b.createdAt));
  }, [data, board]);
  const number = useMemo(() => new Map(comments.map((c, i) => [c.id, i + 1])), [comments]);
  const pageComments = comments.filter((c) => visibleBoards.includes(c.file));

  /** As in the editor (decision c): boards run under the cards, Fit all and going to a board keep to the clear area between them */
  const inset = narrow ? 8 : 12;
  const hasComments = comments.length > 0;
  const clearArea = () => {
    const x = !narrow && leftOpen ? inset + 240 + inset : 0;
    const right = !narrow && rightOpen && hasComments ? size.w - inset - 288 - inset : size.w;
    const y = narrow ? inset + 48 : 0;
    return { x, y, w: right - x, h: size.h - inset - 48 - 8 - y };
  };
  const fitAll = () => setView(fitView([...visibleBoards.map((f) => board.boards[f]), ...visibleNotes.map((id) => noteRect(board.notes[id]))], size, 60, clearArea()));
  const goTo = (files: string[]) => setView(fitView(files.map((f) => board.boards[f]).filter(Boolean), size, 80, clearArea()));
  const zoomBy = (k: number) =>
    setView((v) => {
      const z = clamp(v.zoom * k, MIN_ZOOM, MAX_ZOOM);
      const a = clearArea();
      const cx = a.x + a.w / 2;
      const cy = a.y + a.h / 2;
      return { zoom: z, x: Math.round(cx - ((cx - v.x) / v.zoom) * z), y: Math.round(cy - ((cy - v.y) / v.zoom) * z) };
    });
  const centreOn = (x: number, y: number) => {
    const a = clearArea();
    setView((v) => ({ ...v, x: Math.round(a.x + a.w / 2 - x * v.zoom), y: Math.round(a.y + a.h / 2 - y * v.zoom) }));
  };
  // Fit once the canvas has a size, and again on every page switch (or go to the board a page switch was made for)
  const sized = size.w > 0;
  const pendingGo = useRef<string[] | null>(null);
  useEffect(() => {
    if (!sized) return;
    if (pendingGo.current) goTo(pendingGo.current);
    else fitAll();
    pendingGo.current = null;
  }, [page, sized]);
  /** Shows a board, switching pages first when it lives on another one */
  const reveal = (f: string) => {
    const b = board.boards[f];
    const pg = b.page ?? firstPage ?? null;
    if (pages.length && pg !== page) {
      pendingGo.current = [f];
      setPage(pg);
    } else goTo([f]);
  };

  // Pins sit on the element they were left on, once that board's frame has loaded
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const [, setTick] = useState(0);
  const pinAt = (c: Comment, i: number) => {
    let doc: Document | null = null;
    try {
      doc = frames.current.get(c.file)?.contentDocument ?? null;
    } catch {
      /* file:// copies keep frames in their own origin: pins stack in the corner */
    }
    const el = doc && c.path ? elementAt(doc, c.path) : null;
    const r = el ? rectOf(el) : null;
    return r ? { x: r.x + r.w - 12, y: r.y - 12 } : { x: board.boards[c.file].w - 32, y: 8 + i * 30 };
  };
  const pinScale = 1 / Math.max(view.zoom, 0.25);
  const openThread = (c: Comment) => {
    reveal(c.file);
    setThread(c.id);
    setSelected([c.file]);
    if (narrow) setRightOpen(false);
  };
  // In narrow windows the cards rest as headers and one opens at a time (they would cover each other)
  const toggleLeft = () => {
    setLeftOpen((v) => !v);
    if (narrow) setRightOpen(false);
  };
  const toggleRight = () => {
    setRightOpen((v) => !v);
    if (narrow) setLeftOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !playFile) setThread(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playFile]);

  const open = thread ? comments.find((c) => c.id === thread) : undefined;
  const openPos = open && visibleBoards.includes(open.file) ? pinAt(open, comments.filter((c) => c.file === open.file).indexOf(open)) : null;
  const playTarget = selected.length === 1 ? selected[0] : visibleBoards[0];
  const rects = visibleBoards.map((f) => ({ file: f, ...board.boards[f] }));

  const stampFull = `${strings.viewer.stamp(when(stamp.at))}${stamp.repo ? ` · ${stamp.repo}${stamp.commit ? `@${stamp.commit}` : ""}` : ""}`;
  const zoomRow = (
    <>
      <button className="icon-btn oc-ib" aria-label={strings.toolbar.zoomOut} title={strings.toolbar.zoomOut} onClick={() => zoomBy(1 / 2)}>
        <Icon name="minus" />
      </button>
      <button className="zoom" aria-label={strings.toolbar.zoom100} title={strings.toolbar.zoom100} onClick={() => zoomBy(1 / view.zoom)}>
        {Math.round(view.zoom * 100)}%
      </button>
      <button className="icon-btn oc-ib" aria-label={strings.toolbar.zoomIn} title={strings.toolbar.zoomIn} onClick={() => zoomBy(2)}>
        <Icon name="plus" />
      </button>
      <button className="icon-btn oc-ib oc-fit" aria-label={strings.toolbar.fitAll} title={strings.toolbar.fitAllTitle} onClick={fitAll}>
        <Icon name="fit" />
      </button>
    </>
  );
  const leftHeader = (
    <>
      <div className="oc-head">
        <strong className="oc-vtitle app-title" title={board.title}>
          {board.title}
        </strong>
        {narrow && (
          <button className={`icon-btn oc-ib ${leftOpen ? "on" : ""}`} aria-label={strings.viewer.boardsPanel} aria-pressed={leftOpen} title={strings.viewer.boardsPanel} onClick={toggleLeft}>
            <Icon name="panel" />
          </button>
        )}
      </div>
      {leftOpen && pages.length > 0 && (
        <div className="oc-tabs" role="tablist" aria-label={strings.viewer.pages}>
          {pages.map((pg) => (
            <button key={pg.id} role="tab" aria-selected={pg.id === page} className={pg.id === page ? "on" : ""} onClick={() => setPage(pg.id)}>
              {pg.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
  // The left card ends under its last row; a long list scrolls inside, above the navigation card (or above the dock)
  const leftMax = win.h - inset - (narrow ? 8 + 48 + 8 : 12 + 160 + 12);

  return (
    <div className={`app viewer oc ${narrow ? "oc-n" : ""} ${win.w <= 760 ? "narrow" : ""}`}>
      <div className="canvas-wrap">
        <Canvas
          board={board}
          files={data.files}
          view={view}
          setView={setView}
          tool="select"
          setTool={() => {}}
          visibleBoards={visibleBoards}
          visibleNotes={visibleNotes}
          selected={selected}
          selectedNotes={[]}
          editFile={null}
          reloadKeys={{}}
          readOnly
          screens={screens}
          onSelect={(files) => {
            setSelected(files);
            if (!files.length) setThread(null);
          }}
          onSelectNote={() => {}}
          onMarquee={() => {}}
          onMoveBoards={() => {}}
          onMoveNote={() => {}}
          onDeleteNote={() => {}}
          onPlay={(f) => setPlayFile(f)}
          onRename={() => {}}
          onCreateBoard={() => {}}
          onCreateNote={() => {}}
          onContext={() => {}}
          onSize={setSize}
          renderBoardOverlay={(f) => {
            const pins = comments.filter((c) => c.file === f);
            if (!pins.length) return null;
            return (
              <div className="overlay">
                {pins.map((c, i) => {
                  const at = pinAt(c, i);
                  return (
                    <button
                      key={c.id}
                      className={`pin ${thread === c.id ? "on" : ""}`}
                      aria-label={strings.viewer.pin(number.get(c.id)!, c.author)}
                      title={c.text}
                      style={{ left: at.x, top: at.y, transform: `scale(${pinScale})` }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setThread(thread === c.id ? null : c.id)}
                    >
                      {number.get(c.id)}
                    </button>
                  );
                })}
              </div>
            );
          }}
          worldLayer={
            <>
              <ShapesLayer shapes={shapes} ids={visibleShapes} zoom={view.zoom} selected={[]} interactive={false} onSelect={() => {}} onChange={() => {}} onContext={() => {}} />
              {open && openPos && (
                <div
                  className="thread"
                  role="dialog"
                  aria-label={strings.viewer.pin(number.get(open.id)!, open.author)}
                  style={{ left: board.boards[open.file].x + openPos.x + 32 * pinScale, top: board.boards[open.file].y + openPos.y, transform: `scale(${1 / view.zoom})` }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <div className="thread-head">
                    <span>{board.boards[open.file].title ?? open.file}</span>
                    <span className="oc-of">{strings.viewer.threadOf(number.get(open.id)!, comments.length)}</span>
                    <button className="icon-btn sm" aria-label={strings.viewer.closeThread} title={strings.viewer.closeThread} onClick={() => setThread(null)}>
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                  <CommentBody c={open} />
                  {(open.replies ?? []).map((r) => (
                    <div key={r.id} className="reply">
                      <CommentBody c={r} />
                    </div>
                  ))}
                </div>
              )}
            </>
          }
          iframeRef={(f, el) => {
            if (!el || frames.current.get(f) === el) return;
            frames.current.set(f, el);
            el.addEventListener("load", () => setTick((t) => t + 1));
          }}
        />
        {visibleBoards.length === 0 && visibleNotes.length === 0 && (
          <div className="canvas-empty">
            <Icon name="board" size={32} />
            <p>{strings.viewer.empty}</p>
          </div>
        )}
      </div>
      {leftOpen ? (
        <LeftPanel
          className="oc-card oc-left"
          style={{ maxHeight: leftMax }}
          header={leftHeader}
          board={board}
          pages={pages}
          currentPage={page}
          selected={selected}
          missing={[]}
          showPages={false}
          onPage={setPage}
          onPick={(f) => {
            setSelected([f]);
            reveal(f);
            if (narrow) setLeftOpen(false);
          }}
          footer={
            <div className="oc-made">
              <a href={EASEL_URL} target="_blank" rel="noopener noreferrer">
                {strings.viewer.madeWith}
              </a>
            </div>
          }
        />
      ) : (
        <aside className="oc-card oc-left is-collapsed" aria-label={strings.boardList.aria}>
          {leftHeader}
        </aside>
      )}
      {!narrow && (
        <nav className="oc-card oc-nav" aria-label={strings.app.navigation}>
          {rects.length > 0 && <Minimap className="oc-map" w={240} h={112} inset={8} rects={rects} selected={selected} view={view} size={size} onJump={centreOn} />}
          <div className="oc-zoom">{zoomRow}</div>
        </nav>
      )}
      {hasComments && (
        <aside className={`oc-card oc-right oc-cards ${rightOpen ? "" : "is-rest"}`} aria-label={strings.viewer.comments} style={{ maxHeight: win.h - inset * 2 }}>
          {narrow ? (
            <button className="oc-chead" aria-expanded={rightOpen} aria-label={strings.viewer.commentsPanel} title={strings.viewer.commentsN(comments.length)} onClick={toggleRight}>
              <Icon name="comment" size={16} />
              <span className="oc-chead-label">{strings.viewer.comments}</span>
              <span className="oc-count">{comments.length}</span>
            </button>
          ) : (
            <div className="oc-chead">
              <span>{strings.viewer.comments}</span>
              <span className="oc-count">{comments.length}</span>
            </div>
          )}
          {rightOpen && (
            <ul className="oc-clist">
              {comments.map((c) => (
                <li key={c.id}>
                  <button className={`c-item ${thread === c.id ? "on" : ""} ${pageComments.includes(c) ? "" : "other-page"}`} aria-current={thread === c.id || undefined} onClick={() => openThread(c)}>
                    <span className={`pin ${thread === c.id ? "on" : ""}`} aria-hidden="true">
                      {number.get(c.id)}
                    </span>
                    <span className="c-body">
                      <span className="where">
                        {board.boards[c.file]?.title ?? c.file}
                        {c.replies?.length ? ` · ${strings.viewer.replies(c.replies.length)}` : ""}
                      </span>
                      <span>
                        <strong>{c.author}</strong> {c.text}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
      <ViewerDock win={win.w} narrow={narrow} stampFull={stampFull} stamp={strings.viewer.stamp(when(stamp.at))} code={stamp.repo ? `${stamp.repo}${stamp.commit ? `@${stamp.commit}` : ""}` : ""} zoomRow={narrow ? zoomRow : null} playDisabled={!playTarget} onPlay={() => playTarget && setPlayFile(playTarget)} />
      {playFile && (
        <Play
          board={board}
          file={playFile}
          screens={screens}
          onClose={() => setPlayFile(null)}
          onLocate={(f) => {
            setSelected([f]);
            reveal(f);
          }}
        />
      )}
    </div>
  );
}

/** The dock of the copy: what it is (View only, when, which commit) and the one thing to do with it, Play. Narrow windows have no
 * navigation card, so the zoom row joins the dock there and the stamp keeps only its eye (the words stay in its title) */
function ViewerDock(p: { win: number; narrow: boolean; stampFull: string; stamp: string; code: string; zoomRow: React.ReactNode; playDisabled: boolean; onPlay: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const left = useCentred(ref, p.win);
  const short = p.win <= 760;
  return (
    <div ref={ref} className="oc-dock oc-vdock" role="toolbar" aria-label={strings.viewer.bar} style={{ left: left ?? undefined, visibility: left == null ? "hidden" : undefined }}>
      <span className="oc-stamp" role="note" aria-label={p.stampFull} title={`${p.stampFull}. ${strings.viewer.stampTitle}`}>
        <Icon name="eye" size={16} />
        {!short && (
          <span className="stamp-text">
            {p.stamp}
            {p.code && (
              <>
                {" · "}
                <code>{p.code}</code>
              </>
            )}
          </span>
        )}
      </span>
      <span className="oc-sep" aria-hidden="true" />
      {p.zoomRow && (
        <>
          <div className="oc-group oc-vzoom">{p.zoomRow}</div>
          <span className="oc-sep" aria-hidden="true" />
        </>
      )}
      <button className="play-btn" title={strings.viewer.playTitle} disabled={p.playDisabled} onClick={p.onPlay}>
        <Icon name="play" size={16} />
        {strings.viewer.play}
      </button>
    </div>
  );
}

function CommentBody({ c }: { c: { author: string; text: string; createdAt: string } }) {
  return (
    <div className="comment">
      <span className="who">
        {c.author} <span className="when">· {when(c.createdAt)}</span>
      </span>
      <span className="c-text">{c.text}</span>
    </div>
  );
}
