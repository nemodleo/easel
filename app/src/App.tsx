// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// App shell: board.json state, toolbar, left (pages, boards) and right (inspector) panels, context menus, a single undo history. PLAN.md section 5.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, clientId, connectEvents, type ServerEvent } from "./api";
import { Canvas, clamp, fitView, isTyping, MAX_ZOOM, MIN_ZOOM, type ContextTarget, type Rect } from "./Canvas";
import { AssetGrid, AssetPicker, uploadAssets, type Asset } from "./assets";
import { ChatPanel, type Attach, type ChatEvent } from "./chat";
import { CheckList, checkA11y, readTweaks, TokenPanel, TweaksPanel, useTokens, type A11yItem, type LintItem, type Tokens } from "./ds";
import { GuidesEditor, GuidesOverlay, MAX_NOTES, NoteOptions, ShapeDrawer, ShapeOptions, ShapesLayer } from "./drawing";
import { alignOps, EditHandles, type DropPlan } from "./elementDrag";
import { elementAt, inlineStyles, pathOf, rectOf } from "./editor";
import { Icon, type IconName } from "./icons";
import { Inspector, type Comment } from "./Inspector";
import { Layers } from "./Layers";
import { BoardOptions, FocusView, LeftPanel, Minimap } from "./panels";
import { Play } from "./Play";
import { Properties } from "./Properties";
import { ContextMenu, Dialog, useDialog, useToast, type MenuItem, type MenuState, Collapsible } from "./ui";
import { useEditMode } from "./useEditMode";
import type { Board, BoardItem, BoardResponse, LayoutGuide, Note, Shape, ShapeKind, Tool, View } from "./types";
import { strings } from "./strings";

const DRAFT_SAVE_DELAY = 400;
const mod = navigator.platform.includes("Mac") ? "⌘" : "Ctrl+";

type Saved = { view?: View; page?: string | null; left?: boolean; minimap?: boolean };
const stateKey = (title: string) => `design-canvas:${title}`;
function loadSaved(title: string): Saved {
  try {
    return JSON.parse(localStorage.getItem(stateKey(title)) ?? "{}");
  } catch {
    return {};
  }
}

type BoardError = { kind: string; message: string; line?: number };
const TEMPLATES = [
  { id: "blank", label: strings.templates.blank, size: "390×844", w: 390, h: 844 },
  { id: "mobile", label: strings.templates.mobile, size: "390×844", w: 390, h: 844 },
  { id: "desktop", label: strings.templates.desktop, size: "1440×900", w: 1440, h: 900 },
  { id: "doc", label: strings.templates.doc, size: "800×1000", w: 800, h: 1000 },
] as const;

const TOOLS: { id: Tool; icon: IconName; label: string; hint: string; key: string }[] = [
  { id: "select", icon: "select", label: strings.tools.select, hint: strings.toolHints.select, key: "V" },
  { id: "hand", icon: "hand", label: strings.tools.hand, hint: strings.toolHints.hand, key: "H" },
  { id: "board", icon: "board", label: strings.tools.board, hint: strings.toolHints.board, key: "B" },
  { id: "title", icon: "title", label: strings.tools.title, hint: strings.toolHints.title, key: "T" },
  { id: "sticky", icon: "sticky", label: strings.tools.sticky, hint: strings.toolHints.sticky, key: "N" },
  { id: "rect", icon: "rect", label: strings.tools.rect, hint: strings.toolHints.rect, key: "R" },
  { id: "oval", icon: "oval", label: strings.tools.oval, hint: strings.toolHints.oval, key: "O" },
  { id: "line", icon: "line", label: strings.tools.line, hint: strings.toolHints.line, key: "L" },
  { id: "arrow", icon: "arrow", label: strings.tools.arrow, hint: strings.toolHints.arrow, key: "A" },
  { id: "pen", icon: "pen", label: strings.tools.pen, hint: strings.toolHints.pen, key: "P" },
];
const SHAPE_TOOLS: Tool[] = ["rect", "oval", "line", "arrow", "pen"];
type Theme = "system" | "light" | "dark";

export function App() {
  const [data, setData] = useState<BoardResponse | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 0.1 });
  const [page, setPage] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  /** Single selected note (options panel, arrow keys); null when none or several */
  const selectedNote = selectedNotes.length === 1 ? selectedNotes[0] : null;
  const setSelectedNote = (id: string | null) => setSelectedNotes(id ? [id] : []);
  const [editFile, setEditFile] = useState<string | null>(null);
  const [playFile, setPlayFile] = useState<string | null>(null);
  const [inlinePlay, setInlinePlay] = useState<string | null>(null);
  const [firstRunHint, setFirstRunHint] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  /** Narrow window (under 1000px): the side panels become drawers over the canvas */
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1000px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1000px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [menu, setMenu] = useState<MenuState>(null);
  const [hist, setHist] = useState({ canUndo: false, canRedo: false, undo: [] as string[], redo: [] as string[] });
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [rightTab, setRightTab] = useState<"inspect" | "chat">("inspect");
  const [chatDraft, setChatDraft] = useState("");
  const [chatAttach, setChatAttach] = useState<Attach>({ comments: [], refs: [] });
  const [errors, setErrors] = useState<Record<string, BoardError[]>>({});
  const chatListeners = useRef(new Set<(id: string, ev: ChatEvent) => void>());
  const chatSubscribe = useCallback((fn: (id: string, ev: ChatEvent) => void) => {
    chatListeners.current.add(fn);
    return () => void chatListeners.current.delete(fn);
  }, []);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(0);
  const [leftTab, setLeftTab] = useState<"boards" | "assets" | "tokens">("boards");
  const [assetsVersion, setAssetsVersion] = useState(0);
  const [picker, setPicker] = useState<null | ((a: Asset) => void)>(null);
  const [selectedShapes, setSelectedShapes] = useState<string[]>([]);
  /** Single selected shape (options panel); null when none or several */
  const selectedShape = selectedShapes.length === 1 ? selectedShapes[0] : null;
  const setSelectedShape = (id: string | null) => setSelectedShapes(id ? [id] : []);
  const [tokensVersion, setTokensVersion] = useState(0);
  const tokens = useTokens(tokensVersion);
  const [author, setAuthor] = useState<string>(() => {
    try {
      return localStorage.getItem("design-canvas:author") ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    if (!author) api.get<{ name: string }>("/api/me").then((r) => r.name && setAuthor(r.name)).catch(() => {});
  }, []);
  const [lint, setLint] = useState<LintItem[] | null>(null);
  const [a11y, setA11y] = useState<A11yItem[] | null>(null);
  const pendingPick = useRef<{ file: string; path: string } | null>(null);
  const [guidesOn, setGuidesOn] = useState(true);
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("design-canvas:theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("design-canvas:theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  /** When we must go to new boards not yet in board.json (e.g. N variants): go once they arrive */
  const [locate, setLocate] = useState<string[] | null>(null);
  const restored = useRef(false);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const [frameTick, setFrameTick] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const ask = useDialog();
  const getFrame = useCallback((f: string) => frames.current.get(f) ?? null, [frameTick]);
  const editRef = useRef<ReturnType<typeof useEditMode> | null>(null);
  const boardRef = useRef<Board | null>(null);
  boardRef.current = board;
  const draftTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.board();
      setData(d);
      setBoard(d.board);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, []);
  const loadComments = useCallback(() => api.get<{ comments: Comment[] }>("/api/comments").then((r) => setComments(r.comments)).catch(() => {}), []);
  const loadHistory = useCallback(() => api.get<typeof hist>("/api/history").then(setHist).catch(() => {}), []);
  const loadErrors = useCallback(() => api.get<{ errors: Record<string, BoardError[]> }>("/api/errors").then((r) => setErrors(r.errors)).catch(() => {}), []);

  useEffect(() => {
    void load();
    void loadComments();
    void loadHistory();
    void loadErrors();
  }, [load, loadComments, loadHistory, loadErrors]);

  // Collect errors inside boards: sent by the script the server injects into screen HTML (start → errors → loaded; later errors arrive immediately)
  useEffect(() => {
    const live = new Map<string, { list: BoardError[]; loaded: boolean; t?: number }>();
    const flush = (file: string) => {
      const st = live.get(file)!;
      window.clearTimeout(st.t);
      st.t = window.setTimeout(() => void api.put("/api/errors", { file, errors: st.list }).catch(() => {}), 200);
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.type !== "dc-error" || typeof d.file !== "string") return;
      if (d.start) return void live.set(d.file, { list: [], loaded: false });
      const st = live.get(d.file) ?? { list: [], loaded: true };
      live.set(d.file, st);
      if (d.loaded) {
        st.loaded = true;
        return flush(d.file);
      }
      if (st.list.length < 20 && !st.list.some((x) => x.message === d.message)) st.list.push({ kind: d.kind, message: d.message, line: d.line });
      if (st.loaded) flush(d.file);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  /* ---------- Save and undo ---------- */
  /** Updates state. With a label it saves right away and records it in undo history. "draft" saves a bit later without a history entry (while typing) */
  const update = useCallback(
    (fn: (b: Board) => Board, label?: string | "draft") => {
      const prev = boardRef.current;
      if (!prev) return;
      const next = fn(prev);
      boardRef.current = next;
      setBoard(next);
      if (!label) return;
      if (draftTimer.current) window.clearTimeout(draftTimer.current);
      const save = () => {
        savingRef.current++;
        return api
          .saveBoard(boardRef.current!, label === "draft" ? undefined : label)
          .catch((e) => toast({ tone: "error", text: strings.toast.saveFailed(e.message) }))
          .finally(() => savingRef.current--);
      };
      if (label === "draft")
        draftTimer.current = window.setTimeout(() => {
          draftTimer.current = null;
          void save();
        }, DRAFT_SAVE_DELAY);
      else void save();
    },
    [toast],
  );

  const undoRedo = useCallback(
    async (dir: "undo" | "redo") => {
      try {
        const r = await api.post<{ label: string | null }>(`/api/history/${dir}`, {});
        if (r.label) toast({ text: strings.toast.undoRedoDone(dir, r.label) });
        else toast({ text: dir === "undo" ? strings.toast.nothingToUndo : strings.toast.nothingToRedo });
        await load();
      } catch (e) {
        toast({ tone: "error", text: String((e as Error).message) });
      }
      void loadHistory();
    },
    [toast, load, loadHistory],
  );
  const undoAction = { label: strings.toast.undoAction, run: () => void undoRedo("undo") };

  /* ---------- HTML editing ---------- */
  const doEdit = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!editFile) return false;
      try {
        await api.post("/api/edit", { file: editFile, ...payload });
        return true;
      } catch (e) {
        editRef.current?.setError(String((e as Error).message));
        toast({ tone: "error", text: String((e as Error).message) });
        return false;
      }
    },
    [editFile, toast],
  );
  /** Double-click: edit a text-only element in place. Enter during IME composition is ignored */
  const onTextEdit = useCallback(
    (el: HTMLElement, path: string) => {
      if (Array.from(el.children).some((c) => c.tagName !== "BR")) {
        editRef.current?.setError(strings.toast.textOnly);
        return;
      }
      const before = el.innerText ?? "";
      el.contentEditable = "true";
      el.focus();
      const doc = el.ownerDocument;
      const r = doc.createRange();
      r.selectNodeContents(el);
      doc.getSelection()?.removeAllRanges();
      doc.getSelection()?.addRange(r);
      let cancelled = false;
      const finish = async () => {
        el.removeEventListener("keydown", onKey);
        el.contentEditable = "false";
        const text = (el.innerText ?? "").replace(/\n$/, "");
        if (cancelled || text === before) {
          if (cancelled) el.innerText = before;
          return;
        }
        const { hash } = await api.get<{ hash: string }>(`/api/element?f=${encodeURIComponent(editFile!)}&path=${encodeURIComponent(path)}`);
        if (!(await doEdit({ op: "setText", path, hash, text }))) el.innerText = before; // Shift+Enter line breaks become <br> in the source
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.isComposing || e.keyCode === 229) return; // Enter during composition only commits the character
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          el.blur();
        } else if (e.key === "Escape") {
          cancelled = true;
          el.blur();
        }
      };
      // If focus leaves during IME composition, wait until composition ends, then save
      let composing = false;
      let blurWhileComposing = false;
      const onStart = () => (composing = true);
      const onEnd = () => {
        composing = false;
        if (blurWhileComposing) done();
      };
      const done = () => {
        el.removeEventListener("compositionstart", onStart);
        el.removeEventListener("compositionend", onEnd);
        el.removeEventListener("blur", onBlur);
        void finish();
      };
      const onBlur = () => {
        if (composing) blurWhileComposing = true;
        else done();
      };
      el.addEventListener("compositionstart", onStart);
      el.addEventListener("compositionend", onEnd);
      el.addEventListener("keydown", onKey);
      el.addEventListener("blur", onBlur);
    },
    [editFile, doEdit],
  );
  const hashOf = (file: string, path: string) => api.get<{ hash: string }>(`/api/element?f=${encodeURIComponent(file)}&path=${encodeURIComponent(path)}`).then((r) => r.hash);
  /** Move element: compute the new path after moving and reselect it */
  const moveElement = async (path: string, plan: DropPlan) => {
    if (!editFile) return;
    const hash = await hashOf(editFile, path);
    if (!(await doEdit({ op: "move", path, hash, ...plan }))) return;
    void editRef.current?.select([movedPath(path, plan.toParentPath, plan.index)]);
    toast({ text: plan.freeze.length ? strings.toast.movedFrozen : strings.toast.moved, action: undoAction });
  };
  /** ⌘C: put the element source on the app clipboard (works across boards) and the system clipboard */
  const copyElement = async () => {
    const sel = edit.state.selection;
    if (!editFile || !sel) return;
    const { source } = await api.get<{ source: string }>(`/api/element?f=${encodeURIComponent(editFile)}&path=${encodeURIComponent(sel.path)}&full=1`);
    try {
      localStorage.setItem("design-canvas:clip", JSON.stringify({ source, file: editFile, path: sel.path, tag: sel.tag }));
    } catch {
      /* ignore */
    }
    await navigator.clipboard?.writeText(source).catch(() => {});
    toast({ tone: "ok", text: strings.toast.copiedElement(sel.tag, mod) });
  };
  /** ⌘V: paste after the selected element (or at the end of body) */
  const pasteElement = async () => {
    if (!editFile) return;
    let clip: { source: string; file: string; tag: string } | null = null;
    try {
      clip = JSON.parse(localStorage.getItem("design-canvas:clip") ?? "null");
    } catch {
      clip = null;
    }
    if (!clip) return toast({ text: strings.toast.nothingCopied });
    const sel = edit.state.selection;
    const path = sel?.file === editFile ? sel.path : "";
    if (await doEdit({ op: "insert", path, hash: path ? sel!.hash : undefined, position: "after", html: clip.source })) {
      toast({ tone: "ok", text: strings.toast.pasted(clip.file, clip.tag), action: undoAction });
      if (path) {
        const parts = path.split("/");
        parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
        setTimeout(() => void editRef.current?.select([parts.join("/")]), 600);
      }
    }
  };
  const replaceImage = (path: string, isImg: boolean) =>
    setPicker(() => async (a: Asset) => {
      setPicker(null);
      if (!editFile) return;
      const hash = await hashOf(editFile, path);
      const ok = isImg ? await doEdit({ op: "setAttr", path, hash, name: "src", value: a.ref }) : await doEdit({ op: "setStyle", path, hash, prop: "background-image", value: `url("${a.ref}")` });
      if (ok) toast({ tone: "ok", text: strings.toast.imageReplaced(a.name), action: undoAction });
    });

  const onElementContext = useCallback((path: string, at: { clientX: number; clientY: number }) => elementMenuRef.current?.(path, at), []);
  const elementMenuRef = useRef<((path: string, at: { clientX: number; clientY: number }) => void) | null>(null);
  const edit = useEditMode(editFile, getFrame, { onTextEdit, onContext: onElementContext });
  editRef.current = edit;

  // Server notifications: redraw only boards whose files changed; reload board.json if it changed externally
  useEffect(
    () =>
      connectEvents((e: ServerEvent) => {
        if (e.type === "file-changed") {
          setReloadKeys((k) => ({ ...k, [e.file]: (k[e.file] ?? 0) + 1 }));
          if (e.kind !== "change") void load();
        } else if (e.type === "board-changed" && e.source !== clientId) void load();
        else if (e.type === "comments-changed") void loadComments();
        else if (e.type === "history-changed") void loadHistory();
        else if (e.type === "errors-changed") void loadErrors();
        else if (e.type === "assets-changed") setAssetsVersion((v) => v + 1);
        else if (e.type === "tokens-changed") setTokensVersion((v) => v + 1);
        else if (e.type === "app-changed") window.location.reload();
        else if (e.type === "chat") for (const fn of chatListeners.current) fn(e.id, e.ev);
      }),
    [load, loadComments, loadHistory, loadErrors],
  );

  /* ---------- Pages and visibility ---------- */
  const pages = board?.pages ?? [];
  const currentPage = pages.find((p) => p.id === page)?.id ?? pages[0]?.id ?? null;
  const onPage = useCallback((item: { page?: string }) => !pages.length || (item.page ?? pages[0].id) === currentPage, [pages, currentPage]);
  // Set: a file listed twice in board.json order must not render two boards with one key (React #185 loop)
  const visibleBoards = useMemo(() => (board ? [...new Set(board.order)].filter((f) => board.boards[f] && onPage(board.boards[f])) : []), [board, onPage]);
  const visibleNotes = useMemo(() => (board ? Object.keys(board.notes).filter((id) => onPage(board.notes[id])) : []), [board, onPage]);
  const size = canvasSize ?? { w: window.innerWidth, h: window.innerHeight - 48 };

  // First run: restore the saved view (zoom, position, page, panels) or fit all. Follows the launch setting if there is one
  useEffect(() => {
    if (restored.current || !board || !canvasSize) return;
    restored.current = true;
    const s = loadSaved(board.title);
    if (window.innerWidth < 1000) setLeftOpen(false);
    else if (s.left != null) setLeftOpen(s.left);
    if (s.minimap != null) setMinimapOpen(s.minimap);
    const launch = board.launch;
    if (launch?.page) setPage(launch.page);
    else if (s.page) setPage(s.page);
    if (launch?.view === "focused" && launch.file && board.boards[launch.file]) setFocusFile(launch.file);
    if (s.view && !launch?.page) setView(s.view);
    else if (!s.view && board.order.length > 0) {
      // True first run: land on the first board at a readable size, not on 98 boards at 4%
      const firstFile = board.order.find((f) => board.boards[f] && onPage(board.boards[f])) ?? board.order[0];
      const first = board.boards[firstFile];
      if (first) {
        const v = fitView([first], canvasSize, 80);
        setView({ ...v, zoom: Math.min(v.zoom, 1) });
        setSelected([firstFile]);
        setFirstRunHint(true);
      } else setView(fitView(Object.values(board.boards), canvasSize));
    } else setView(fitView(Object.values(board.boards), canvasSize));
  }, [board, canvasSize]);
  // Remember view state
  useEffect(() => {
    if (!board || !restored.current) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(stateKey(board.title), JSON.stringify({ view, page: currentPage, left: narrow ? undefined : leftOpen, minimap: minimapOpen } satisfies Saved));
      } catch {
        /* Failing to save does not affect behavior */
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [view, currentPage, leftOpen, minimapOpen, board?.title]);

  // Report canvas state to the server (mode, page, visibleArtboards, selectedArtboards, dirty for MCP get_selection)
  useEffect(() => {
    if (!board) return;
    const t = window.setTimeout(() => {
      const vx = -view.x / view.zoom;
      const vy = -view.y / view.zoom;
      const vw = size.w / view.zoom;
      const vh = size.h / view.zoom;
      const visibleArtboards = focusFile ? [focusFile] : visibleBoards.filter((f) => {
        const b = board.boards[f];
        return b.x < vx + vw && b.x + b.w > vx && b.y < vy + vh && b.y + b.h > vy;
      });
      void api
        .put("/api/context", {
          mode: playFile ? "play" : focusFile ? "focus" : editFile ? "edit" : "canvas",
          page: currentPage,
          pageName: pages.find((p) => p.id === currentPage)?.name ?? null,
          visibleArtboards,
          selectedArtboards: selected,
          dirty: savingRef.current > 0 || !!draftTimer.current,
        })
        .catch(() => {});
    }, 300);
    return () => window.clearTimeout(t);
  }, [view, currentPage, selected, editFile, focusFile, playFile, visibleBoards, size.w, size.h]);

  useEffect(() => {
    if (!locate || !board || !locate.every((f) => board.boards[f])) return;
    setSelected(locate);
    setView(fitView(locate.map((f) => board.boards[f]), size, 80));
    setLocate(null);
  }, [locate, board]);

  const noteRect = (n: Note) => ({ x: n.x, y: n.y, w: n.w ?? n.maxW ?? 400, h: n.kind === "title" ? 90 : 200 });
  const fitAll = () => {
    if (!board) return;
    setView(fitView([...visibleBoards.map((f) => board.boards[f]), ...visibleNotes.map((id) => noteRect(board.notes[id]))], size));
  };
  const goTo = (files: string[]) => {
    if (!board || !files.length) return;
    setView(fitView(files.map((f) => board.boards[f]).filter(Boolean), size, 80));
  };
  const zoomBy = (k: number) =>
    setView((v) => {
      const z = clamp(v.zoom * k, MIN_ZOOM, MAX_ZOOM);
      const cx = size.w / 2;
      const cy = size.h / 2;
      return { zoom: z, x: cx - ((cx - v.x) / v.zoom) * z, y: cy - ((cy - v.y) / v.zoom) * z };
    });
  const zoomTo = (z: number) => zoomBy(z / view.zoom);

  /* ---------- Board actions ---------- */
  useEffect(() => {
    if (!firstRunHint) return;
    // Arm the dismiss only after the page has settled, so load-time events don't eat the hint
    let armed = false;
    const arm = window.setTimeout(() => (armed = true), 1500);
    const off = () => armed && setFirstRunHint(false);
    const t = window.setTimeout(() => setFirstRunHint(false), 15000);
    window.addEventListener("pointerdown", off, true);
    window.addEventListener("keydown", off, true);
    return () => {
      window.clearTimeout(arm);
      window.clearTimeout(t);
      window.removeEventListener("pointerdown", off, true);
      window.removeEventListener("keydown", off, true);
    };
  }, [firstRunHint]);
  const select = (files: string[], m: "replace" | "toggle" | "add" = "replace") => {
    setSelected((cur) => (m === "replace" ? files : m === "add" ? [...new Set([...cur, ...files])] : files.reduce((a, f) => (a.includes(f) ? a.filter((x) => x !== f) : [...a, f]), cur)));
    if (files.length && m === "replace") {
      setSelectedNotes([]);
      setSelectedShapes([]);
    }
  };
  const pageField = () => (pages.length && currentPage ? { page: currentPage } : {});

  const createBoard = async (r: Partial<Rect>, template = "blank") => {
    try {
      const { file } = await api.post<{ file: string }>("/api/boards/create", { ...r, template, ...pageField() });
      await load();
      setSelected([file]);
      setTool("select");
      toast({ tone: "ok", text: strings.toast.boardCreated(file), action: undoAction });
    } catch (e) {
      toast({ tone: "error", text: strings.toast.boardCreateFailed((e as Error).message) });
    }
  };
  const deleteBoards = async (files: string[]) => {
    if (!files.length || !board) return;
    const names = files.map((f) => board.boards[f]?.title ?? f);
    const ok = await ask.confirm({
      title: strings.dialog.deleteBoardsTitle(files.length, names[0]),
      body: strings.dialog.deleteBoardsBody,
      ok: strings.dialog.delete,
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post("/api/boards/delete", { files });
      if (editFile && files.includes(editFile)) setEditFile(null);
      setSelected([]);
      await load();
      toast({ text: strings.toast.boardsDeleted(files.length), action: undoAction });
    } catch (e) {
      toast({ tone: "error", text: String((e as Error).message) });
    }
  };
  const duplicateBoard = async (file: string) => {
    try {
      const r = await api.post<{ file: string }>("/api/boards/duplicate", { file });
      await load();
      setSelected([r.file]);
      toast({ tone: "ok", text: strings.toast.duplicated(r.file), action: undoAction });
    } catch (e) {
      toast({ tone: "error", text: String((e as Error).message) });
    }
  };
  const renameBoard = async (file: string) => {
    const b = boardRef.current?.boards[file];
    if (!b) return;
    const r = await ask.prompt({ title: strings.dialog.renameBoardTitle, label: strings.dialog.name, value: b.title ?? file.replace(/\.html$/, ""), ok: strings.dialog.rename });
    if (!r || r.value.trim() === (b.title ?? "")) return;
    try {
      await api.post("/api/boards/rename", { file, title: r.value.trim() });
      await load();
      toast({ tone: "ok", text: strings.toast.renamed, action: undoAction });
    } catch (e) {
      toast({ tone: "error", text: String((e as Error).message) });
    }
  };
  const renameFile = async (file: string) => {
    const { refs } = await api.get<{ refs: { file: string; count: number }[] }>(`/api/boards/refs?file=${encodeURIComponent(file)}`).catch(() => ({ refs: [] }));
    const r = await ask.prompt({
      title: strings.dialog.renameFileTitle,
      label: strings.dialog.fileName,
      value: file,
      hint: refs.length ? strings.dialog.renameFileRefs(refs.map((x) => x.file).join(", ")) : strings.dialog.renameFileNoRefs,
      ok: strings.dialog.rename,
      extra: refs.length ? { label: strings.dialog.renameFileExtra(refs.reduce((a, x) => a + (x.count ?? 1), 0)), checked: true } : undefined,
    });
    if (!r) return;
    let newFile = r.value.trim();
    if (!newFile.endsWith(".html")) newFile += ".html";
    if (newFile === file) return;
    try {
      await api.post("/api/boards/rename", { file, newFile, updateRefs: r.extra });
      if (editFile === file) setEditFile(newFile);
      setSelected([newFile]);
      await load();
      toast({ tone: "ok", text: strings.toast.fileRenamed(newFile, !!r.extra), action: undoAction });
    } catch (e) {
      toast({ tone: "error", text: String((e as Error).message) });
    }
  };
  /** New board from a template at the center of the view */
  const createFromTemplate = (t: (typeof TEMPLATES)[number]) => {
    const cx = (size.w / 2 - view.x) / view.zoom;
    const cy = (size.h / 2 - view.y) / view.zoom;
    void createBoard({ x: Math.round(cx - t.w / 2), y: Math.round(cy - t.h / 2), w: t.w, h: t.h }, t.id).then(() => setView(fitView([{ x: cx - t.w / 2, y: cy - t.h / 2, w: t.w, h: t.h }], size, 80)));
  };
  const templateMenu = (at: { clientX: number; clientY: number }) =>
    setMenu({ x: at.clientX, y: at.clientY, title: strings.menu.newBoard, items: TEMPLATES.map((t) => ({ label: `${t.label} · ${t.size}`, icon: t.id === "doc" ? ("page" as IconName) : ("board" as IconName), shortcut: t.id === "blank" ? strings.menu.drawWithB : undefined, run: () => createFromTemplate(t) })) });
  /** Open chat (with an optional draft and attachments) */
  const openChat = (draft?: string, files?: string[]) => {
    setRightTab("chat");
    if (files?.length) setSelected(files);
    if (draft != null) setChatDraft(draft);
    setTimeout(() => chatInputRef.current?.focus(), 0);
  };
  const askFix = (files: string[]) =>
    openChat(
      strings.prompts.fixErrors(files.map((f) => `- ${f}: ${(errors[f] ?? [{ message: data?.missing.includes(f) ? strings.menu.fileMissing : strings.prompts.error }])[0].message}`).join("\n")),
      files.filter((f) => board?.boards[f]),
    );

  /** Bring to front (end of order) or send to back (start of order) */
  const reorder = (files: string[], to: "front" | "back") =>
    update((b) => {
      const rest = b.order.filter((f) => !files.includes(f));
      const moved = b.order.filter((f) => files.includes(f));
      return { ...b, order: to === "front" ? [...rest, ...moved] : [...moved, ...rest] };
    }, to === "front" ? strings.history.front : strings.history.back);
  const patchBoard = (file: string, patch: Partial<BoardItem>, label: string = strings.history.boardOptions) =>
    update((b) => {
      const it: BoardItem = { ...b.boards[file], ...patch };
      for (const k of Object.keys(it) as (keyof BoardItem)[]) if (it[k] === undefined) delete it[k];
      return { ...b, boards: { ...b.boards, [file]: it } };
    }, label);
  /** Shift the selected boards and notes together by (dx, dy) */
  const shifted = (b: Board, dx: number, dy: number, files = selected, notes = selectedNotes, shapeIds = selectedShapes): Board => ({
    ...b,
    boards: { ...b.boards, ...Object.fromEntries(files.filter((f) => b.boards[f]).map((f) => [f, { ...b.boards[f], x: b.boards[f].x + dx, y: b.boards[f].y + dy, autoPlaced: undefined }])) },
    notes: { ...b.notes, ...Object.fromEntries(notes.filter((id) => b.notes[id]).map((id) => [id, { ...b.notes[id], x: b.notes[id].x + dx, y: b.notes[id].y + dy }])) },
    shapes: { ...(b.shapes ?? {}), ...Object.fromEntries(shapeIds.filter((id) => b.shapes?.[id]).map((id) => [id, { ...b.shapes![id], x: b.shapes![id].x + dx, y: b.shapes![id].y + dy }])) },
  });
  const nudge = (dx: number, dy: number) => update((b) => shifted(b, dx, dy), selected.length ? strings.history.moveBoard : selectedNotes.length ? strings.history.moveNote : strings.history.moveShape);

  /* ---------- Notes ---------- */
  const newNoteId = () => {
    let id = "";
    do id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    while (boardRef.current?.notes[id]);
    return id;
  };
  const createNote = (kind: Note["kind"], at: { x: number; y: number }) => {
    if (Object.keys(boardRef.current?.notes ?? {}).length >= MAX_NOTES) return toast({ tone: "error", text: strings.toast.notesMax(MAX_NOTES) });
    const id = newNoteId();
    const x = Math.round(at.x);
    const y = Math.round(at.y);
    update(
      (b) => ({
        ...b,
        notes: { ...b.notes, [id]: kind === "title" ? { kind, x, y, text: strings.defaults.newTitle, maxW: 2000, ...pageField() } : { kind, x, y, text: strings.defaults.note, w: 400, ...pageField() } },
      }),
      kind === "title" ? strings.history.addTitle : strings.history.addNote,
    );
    setSelectedNote(id);
    setSelected([]);
    setTool("select");
  };
  const deleteNotes = (ids: string[]) => {
    update((b) => {
      const rest = { ...b.notes };
      for (const id of ids) delete rest[id];
      return { ...b, notes: rest };
    }, strings.history.deleteNote);
    setSelectedNotes([]);
    toast({ text: strings.toast.noteDeleted, action: undoAction });
  };

  /* ---------- Pages ---------- */
  /* ---------- Shapes ---------- */
  const shapes = board?.shapes ?? {};
  const visibleShapes = useMemo(
    () => Object.keys(shapes).filter((id) => onPage(shapes[id])).sort((a, b) => (shapes[a].z ?? 0) - (shapes[b].z ?? 0) || (a < b ? -1 : 1)),
    [shapes, onPage],
  );
  const addShape = (sh: Shape, label: string = strings.history.addShape) => {
    let id = "";
    do id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    while (boardRef.current?.shapes?.[id]);
    const z = Math.max(0, ...Object.values(boardRef.current?.shapes ?? {}).map((x) => x.z ?? 0)) + 1;
    update((b) => ({ ...b, shapes: { ...(b.shapes ?? {}), [id]: { ...sh, z, ...pageField() } } }), label);
    setSelectedShape(id);
    setSelected([]);
    setSelectedNote(null);
    setTool("select");
    return id;
  };
  const patchShape = (id: string, patch: Partial<Shape>, label?: string) => update((b) => ({ ...b, shapes: { ...(b.shapes ?? {}), [id]: { ...b.shapes![id], ...patch } } }), label);
  const deleteShapes = (ids: string[]) => {
    update((b) => {
      const rest = { ...(b.shapes ?? {}) };
      for (const id of ids) delete rest[id];
      return { ...b, shapes: rest };
    }, strings.history.deleteShape);
    setSelectedShapes([]);
    toast({ text: ids.length === 1 ? strings.toast.shapeDeleted : strings.toast.shapesDeleted(ids.length), action: undoAction });
  };
  const shapeZ = (id: string, to: "front" | "back") => {
    const zs = Object.values(boardRef.current?.shapes ?? {}).map((x) => x.z ?? 0);
    patchShape(id, { z: to === "front" ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1 }, to === "front" ? strings.history.shapeFront : strings.history.shapeBack);
  };
  /** Image shape: picked from assets or pasted */
  const addImageShape = (a: { ref: string; url: string }, at?: { x: number; y: number }) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * k) || 300;
      const h = Math.round(img.naturalHeight * k) || 200;
      const c = at ?? { x: (size.w / 2 - view.x) / view.zoom - w / 2, y: (size.h / 2 - view.y) / view.zoom - h / 2 };
      addShape({ kind: "image", x: Math.round(c.x), y: Math.round(c.y), w, h, src: a.ref }, strings.history.addImage);
    };
    img.onerror = () => toast({ tone: "error", text: strings.toast.imageReadFailed });
    img.src = a.url;
  };
  // Images pasted onto the canvas are uploaded as assets and added as image shapes
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (editFile || (e.target as HTMLElement)?.closest?.("input,textarea,[contenteditable=true]")) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      try {
        const [a] = await uploadAssets(files.map((f) => (f.name ? f : new File([f], strings.defaults.pastedImage, { type: f.type }))));
        addImageShape(a);
      } catch (err) {
        toast({ tone: "error", text: String((err as Error).message) });
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  /** Import: HTML becomes a new board (file as is), images become assets plus image shapes */
  const importFiles = async (files: File[], at: { x: number; y: number }) => {
    let x = Math.round(at.x);
    const made: string[] = [];
    for (const f of files) {
      try {
        if (/\.html?$/i.test(f.name)) {
          const html = await f.text();
          const m = html.match(/<meta[^>]+name=["']board-size["'][^>]+content=["'](\d+)x(\d+)/i);
          const w = m ? Number(m[1]) : 390;
          const h = m ? Number(m[2]) : 844;
          const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || f.name.replace(/\.html?$/i, "");
          const file = f.name.toLowerCase().replace(/\.htm$/, ".html").replace(/[^a-z0-9._-]+/g, "-");
          const r = await api.post<{ file: string }>("/api/boards/create", { file, html, title, x, y: Math.round(at.y), w, h, ...pageField() });
          made.push(r.file);
          x += w + 80;
        } else if (f.type.startsWith("image/")) {
          const [a] = await uploadAssets([f]);
          addImageShape(a, { x, y: at.y });
          x += 400;
        } else toast({ tone: "error", text: strings.toast.importOnly(f.name) });
      } catch (e) {
        toast({ tone: "error", text: `${f.name}: ${(e as Error).message}` });
      }
    }
    if (made.length) {
      await load();
      setLocate(made);
      toast({ tone: "ok", text: strings.toast.imported(made.length), action: undoAction });
    }
  };

  /* ---------- Pages (server history) ---------- */
  const renameGroup = async (key: string) => {
    if (!board) return;
    const r = await ask.prompt({ title: strings.dialog.renameGroupTitle, label: strings.dialog.name, value: board.groupNames?.[key] ?? key, ok: strings.dialog.save });
    if (!r?.value.trim()) return;
    update((b) => ({ ...b, groupNames: { ...(b.groupNames ?? {}), [key]: r.value.trim() } }), strings.history.renameGroup);
  };
  const pageApi = async (body: Record<string, unknown>, okText?: string) => {
    try {
      const r = await api.post<{ id?: string }>("/api/pages", body);
      await load();
      if (okText) toast({ tone: "ok", text: okText, action: undoAction });
      return r;
    } catch (e) {
      toast({ tone: "error", text: String((e as Error).message) });
      return null;
    }
  };

  const addPage = async () => {
    if (pages.length >= 40) return toast({ tone: "error", text: strings.toast.pagesMax });
    const r = await ask.prompt({ title: strings.dialog.newPageTitle, label: strings.dialog.name, value: strings.dialog.newPageName(Math.max(pages.length, 1) + 1), ok: strings.dialog.create });
    if (!r?.value.trim()) return;
    const res = await pageApi({ action: "add", name: r.value.trim() });
    if (res?.id) setPage(res.id);
  };
  const renamePage = async (id: string) => {
    const p = pages.find((x) => x.id === id);
    const r = await ask.prompt({ title: strings.dialog.renamePageTitle, label: strings.dialog.name, value: p?.name ?? "", ok: strings.dialog.rename });
    if (!r?.value.trim() || r.value.trim() === p?.name) return;
    await pageApi({ action: "rename", id, name: r.value.trim() });
  };
  const deletePage = async (id: string) => {
    const p = pages.find((x) => x.id === id);
    const n = Object.values(board?.boards ?? {}).filter((b) => (b.page ?? pages[0]?.id) === id).length;
    if (!(await ask.confirm({ title: strings.dialog.deletePageTitle(p?.name ?? ""), body: strings.dialog.deletePageBody(n), ok: strings.dialog.delete, danger: true }))) return;
    if (currentPage === id) setPage(null);
    await pageApi({ action: "delete", id }, strings.toast.pageDeleted);
  };
  const movePage = (id: string, index: number) => void pageApi({ action: "move", id, index });
  const pageMenu = (id: string, at: { clientX: number; clientY: number }) => {
    const i = pages.findIndex((p) => p.id === id);
    setMenu({
      x: at.clientX,
      y: at.clientY,
      title: pages[i]?.name,
      items: [
        { label: strings.menu.rename, icon: "edit", run: () => void renamePage(id) },
        { label: strings.menu.moveUp, icon: "chevronDown", disabled: i <= 0, run: () => movePage(id, i - 1) },
        { label: strings.menu.moveDown, icon: "chevronDown", disabled: i >= pages.length - 1, run: () => movePage(id, i + 1) },
        { label: board?.launch?.page === id ? strings.menu.unsetLaunchPage : strings.menu.setLaunchPage, icon: "page", run: () => update((b) => ({ ...b, launch: { ...(b.launch ?? { view: "canvas" }), page: b.launch?.page === id ? undefined : id } }), strings.history.launchPage) },
        ...(selected.length ? [{ label: strings.menu.moveSelectedToPage(selected.length), icon: "page" as IconName, run: () => update((b) => ({ ...b, boards: { ...b.boards, ...Object.fromEntries(selected.map((f) => [f, { ...b.boards[f], page: id === pages[0]?.id ? undefined : id }])) } }), strings.history.moveToPage) }] : []),
        "sep",
        { label: strings.menu.delete, icon: "trash", danger: true, disabled: pages.length <= 1, run: () => void deletePage(id) },
      ],
    });
  };

  /* ---------- Context menus ---------- */
  const boardMenuItems = (file: string): MenuItem[] => {
    const b = board!.boards[file];
    const files = selected.includes(file) ? selected : [file];
    const many = files.length > 1;
    return [
      { label: editFile === file ? strings.menu.stopEditing : strings.menu.edit, icon: "edit", shortcut: "E", disabled: many, run: () => setEditFile(editFile === file ? null : file) },
      ...(b?.is_interactive
        ? [
            { label: inlinePlay === file ? strings.menu.stopPlay : strings.menu.playInPlace, icon: "play" as IconName, shortcut: "P", disabled: many, run: () => (inlinePlay === file ? stopInline() : setInlinePlay(file)) },
            { label: strings.menu.playFullScreen, icon: "play" as IconName, disabled: many, run: () => setPlayFile(file) },
          ]
        : []),
      { label: strings.menu.askReview, icon: "comment", run: () => openChat(strings.prompts.review, files) },
      { label: strings.menu.focusView, icon: "focus", shortcut: "F", disabled: many, run: () => setFocusFile(file) },
      { label: strings.menu.askAI, icon: "comment", shortcut: `${mod}J`, run: () => openChat(undefined, files) },
      ...(errors[file] || data?.missing.includes(file) ? [{ label: strings.menu.askFixErrors, icon: "warn" as IconName, run: () => askFix([file]) }] : []),
      { label: strings.menu.goToBoard, icon: "fit", shortcut: "⇧2", run: () => goTo(files) },
      "sep",
      { label: strings.menu.rename, icon: "title", shortcut: "F2", disabled: many, run: () => void renameBoard(file) },
      { label: strings.menu.renameFile, icon: "link", disabled: many, run: () => void renameFile(file) },
      { label: strings.menu.duplicate, icon: "copy", shortcut: `${mod}D`, disabled: many, run: () => void duplicateBoard(file) },
      "sep",
      { label: strings.menu.front, icon: "front", shortcut: `${mod}]`, run: () => reorder(files, "front") },
      { label: strings.menu.back, icon: "back", shortcut: `${mod}[`, run: () => reorder(files, "back") },
      "sep",
      { label: many ? strings.menu.deleteBoards(files.length) : strings.menu.delete, icon: "trash", shortcut: "⌫", danger: true, run: () => void deleteBoards(files) },
    ];
  };
  const onContext = (t: ContextTarget, at: { clientX: number; clientY: number }) => {
    if (!board) return;
    if (t.type === "board") {
      if (!selected.includes(t.file)) select([t.file]);
      setMenu({ x: at.clientX, y: at.clientY, title: board.boards[t.file]?.title ?? t.file, items: boardMenuItems(t.file) });
    } else if (t.type === "note") {
      setSelectedNote(t.id);
      setMenu({
        x: at.clientX,
        y: at.clientY,
        title: board.notes[t.id]?.kind === "title" ? strings.menu.title : strings.menu.note,
        items: [
          { label: strings.menu.duplicateInFront, icon: "copy", shortcut: `${mod}D`, run: () => { const n = board.notes[t.id]; const id = newNoteId(); update((b) => ({ ...b, notes: { ...b.notes, [id]: { ...n, x: n.x + 40, y: n.y + 40 } } }), strings.history.duplicateNote); setSelectedNote(id); } },
          "sep",
          { label: strings.menu.delete, icon: "trash", shortcut: "⌫", danger: true, run: () => deleteNotes([t.id]) },
        ],
      });
    } else {
      setMenu({
        x: at.clientX,
        y: at.clientY,
        items: [
          { label: strings.menu.newBoardHere, icon: "board", shortcut: "B", run: () => void createBoard({ x: Math.round(t.x), y: Math.round(t.y), w: 390, h: 844 }) },
          { label: strings.menu.mobileFrameHere, icon: "board", run: () => void createBoard({ x: Math.round(t.x), y: Math.round(t.y) }, "mobile") },
          { label: strings.menu.titleHere, icon: "title", shortcut: "T", run: () => createNote("title", t) },
          { label: strings.menu.noteHere, icon: "sticky", shortcut: "N", run: () => createNote("sticky", t) },
          "sep",
          { label: strings.menu.selectAll, icon: "select", shortcut: `${mod}A`, run: () => select(visibleBoards) },
          { label: strings.menu.fitAll, icon: "fit", shortcut: "⇧1", run: fitAll },
          { label: strings.menu.zoom100, icon: "search", shortcut: `${mod}0`, run: () => zoomTo(1) },
          "sep",
          { label: strings.menu.undo, icon: "undo", shortcut: `${mod}Z`, disabled: !hist.canUndo, run: () => void undoRedo("undo") },
          { label: strings.menu.redo, icon: "redo", shortcut: `⇧${mod}Z`, disabled: !hist.canRedo, run: () => void undoRedo("redo") },
        ],
      });
    }
  };
  // Right-click on an element inside the board being edited
  elementMenuRef.current = (path, at) => {
    if (!editFile) return;
    const getHash = () => api.get<{ hash: string }>(`/api/element?f=${encodeURIComponent(editFile)}&path=${encodeURIComponent(path)}`).then((r) => r.hash);
    const el = frames.current.get(editFile)?.contentDocument ? elementAt(frames.current.get(editFile)!.contentDocument!, path) : null;
    const up = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;
    setMenu({
      x: at.clientX,
      y: at.clientY,
      title: el ? `<${el.tagName.toLowerCase()}>` : strings.menu.element,
      items: [
        { label: strings.menu.editText, icon: "edit", disabled: !el || el.children.length > 0, run: () => el && onTextEdit(el as HTMLElement, path) },
        { label: strings.menu.selectParent, icon: "layers", shortcut: "Esc", disabled: up == null, run: () => up != null && void edit.select([up]) },
        { label: strings.menu.elementToAI, icon: "comment", run: () => openChat() },
        { label: strings.menu.copy, icon: "copy", shortcut: `${mod}C`, run: () => void copyElement() },
        { label: strings.menu.pasteAfter, icon: "copy", shortcut: `${mod}V`, run: () => void pasteElement() },
        ...(el?.tagName === "IMG" ? [{ label: strings.menu.replaceImage, icon: "page" as IconName, run: () => replaceImage(path, true) }] : []),
        { label: strings.menu.copyForAI, icon: "copy", run: () => void navigator.clipboard.writeText(`${editFile} ${path} <${el?.tagName.toLowerCase()}> "${(el?.textContent ?? "").trim().slice(0, 60)}"`).then(() => toast({ tone: "ok", text: strings.toast.copied })) },
        "sep",
        { label: strings.menu.duplicate, icon: "copy", shortcut: `${mod}D`, run: async () => void doEdit({ op: "duplicate", path, hash: await getHash() }) },
        {
          label: strings.menu.delete,
          icon: "trash",
          shortcut: "⌫",
          danger: true,
          run: async () => {
            if (await doEdit({ op: "delete", path, hash: await getHash() })) {
              void edit.select([]);
              toast({ text: strings.toast.elementDeleted, action: undoAction });
            }
          },
        },
      ],
    });
  };

  /** End Play in place: if the user navigated to another screen, go back to the original */
  const stopInline = () => {
    const f = inlinePlay;
    setInlinePlay(null);
    // If focus stays inside the iframe, shortcuts never reach the app
    (document.activeElement as HTMLElement | null)?.blur?.();
    const c = document.querySelector<HTMLElement>(".canvas");
    if (c) {
      c.tabIndex = -1;
      c.focus({ preventScroll: true });
    }
    if (f) setReloadKeys((k) => ({ ...k, [f]: (k[f] ?? 0) + 1 }));
  };
  // During Play in place, also catch Esc pressed inside the iframe (even after navigating)
  useEffect(() => {
    if (!inlinePlay) return;
    const frame = frames.current.get(inlinePlay);
    if (!frame) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stopInlineRef.current();
    let doc: Document | null = null;
    const attach = () => {
      doc?.removeEventListener("keydown", onKey, true);
      doc = frame.contentDocument;
      doc?.addEventListener("keydown", onKey, true);
    };
    attach();
    frame.addEventListener("load", attach);
    return () => {
      frame.removeEventListener("load", attach);
      doc?.removeEventListener("keydown", onKey, true);
    };
  }, [inlinePlay, frameTick]);
  const stopInlineRef = useRef(() => {});
  stopInlineRef.current = stopInline;
  /** ⌘\: hide or show both panels together */
  const [rightOpen, setRightOpen] = useState(() => !window.matchMedia("(max-width: 1000px)").matches);
  const settledRef = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => (settledRef.current = true), 1500);
    return () => clearTimeout(t);
  }, []);
  // Narrow windows: the right drawer opens when the user picks something (not on restore), and only one drawer is open at a time
  useEffect(() => {
    if (narrow && settledRef.current) setRightOpen(true);
  }, [narrow, selected, editFile, rightTab]);
  useEffect(() => {
    if (narrow && leftOpen) setRightOpen(false);
  }, [narrow, leftOpen]);
  useEffect(() => {
    if (narrow && rightOpen) setLeftOpen(false);
  }, [narrow, rightOpen]);
  const toggleUi = () => {
    const hide = leftOpen || rightOpen;
    setLeftOpen(!hide);
    setRightOpen(!hide);
  };
  /** F6: cycle focus between toolbar → left panel → canvas → right panel */
  const cycleFocus = (back: boolean) => {
    const regions = [".toolbar", ".left", ".canvas", ".right"].map((q) => document.querySelector<HTMLElement>(q)).filter(Boolean) as HTMLElement[];
    const cur = regions.findIndex((r) => r.contains(document.activeElement));
    const next = regions[(cur + (back ? -1 : 1) + regions.length) % regions.length];
    const target = next.matches(".canvas") ? next : next.querySelector<HTMLElement>("button:not([disabled]), input, select, textarea, [tabindex]");
    if (next.matches(".canvas")) next.tabIndex = -1;
    (target ?? next).focus();
  };
  const wrapSelected = async (display: "flex" | "grid") => {
    if (!editFile) return;
    const ordered = [...edit.state.paths].sort((a, b) => Number(a.split("/").pop()) - Number(b.split("/").pop()));
    const hashes = await Promise.all(ordered.map((p) => hashOf(editFile, p)));
    if (await doEdit({ op: "wrap", paths: ordered, hashes, display })) {
      void edit.select([ordered[0]]);
      toast({ tone: "ok", text: strings.toast.wrapped(display), action: undoAction });
    }
  };

  /* ---------- Design system, checks, snapshots ---------- */
  const saveTokens = async (t: Tokens, label: string) => {
    try {
      await api.put("/api/tokens", { ...t, label });
      setTokensVersion((v) => v + 1);
      toast({ tone: "ok", text: label === strings.history.changeTheme ? strings.toast.theme(t.active) : strings.toast.tokensSaved, action: undoAction });
    } catch (e) {
      toast({ tone: "error", text: String((e as Error).message) });
    }
  };
  /** Picking from a check list opens that board in edit mode and selects the element */
  const pickPath = (file: string, path: string) => {
    pendingPick.current = { file, path };
    if (editFile !== file) setEditFile(file);
    else void edit.select([path]);
  };
  useEffect(() => {
    const p = pendingPick.current;
    if (!p || editFile !== p.file || !frames.current.get(p.file)?.contentDocument) return;
    const t = window.setTimeout(() => {
      pendingPick.current = null;
      void edit.select([p.path]);
    }, 300);
    return () => window.clearTimeout(t);
  }, [editFile, frameTick]);
  const lintTarget = editFile ?? (selected.length === 1 ? selected[0] : null);
  useEffect(() => {
    if (!lintTarget) return setLint(null);
    api.get<{ files: Record<string, LintItem[]> }>(`/api/lint?f=${encodeURIComponent(lintTarget)}`).then((r) => setLint(r.files[lintTarget] ?? [])).catch(() => setLint(null));
  }, [lintTarget, reloadKeys[lintTarget ?? ""], tokensVersion]);
  useEffect(() => {
    if (!lintTarget) return setA11y(null);
    const run = () => {
      const doc = frames.current.get(lintTarget)?.contentDocument;
      setA11y(doc?.readyState === "complete" ? checkA11y(doc, tokens?.minTarget ?? 48) : null);
    };
    const t = window.setTimeout(run, 600);
    return () => window.clearTimeout(t);
  }, [lintTarget, frameTick, reloadKeys[lintTarget ?? ""], tokens?.minTarget, view.zoom >= 0.25]);
  /** Compact shapes picker for narrow windows */
  /** Under 480px every tool lives in one menu */
  const toolsMenu = (at: { clientX: number; clientY: number }) =>
    setMenu({
      x: at.clientX,
      y: at.clientY,
      title: strings.toolbar.canvasTools,
      items: TOOLS.map((t) => ({ label: t.label, icon: t.icon, shortcut: t.key, check: tool === t.id, run: () => setTool(t.id) })),
    });
  const shapesMenu = (at: { clientX: number; clientY: number }) =>
    setMenu({
      x: at.clientX,
      y: at.clientY,
      title: strings.toolbar.shapes,
      items: [
        ...TOOLS.slice(5).map((t) => ({ label: t.label, icon: t.icon, shortcut: t.key, check: tool === t.id, run: () => setTool(t.id) })),
        "sep" as const,
        { label: strings.toolbar.insertImage, icon: "image" as IconName, run: () => setPicker(() => (a: Asset) => { setPicker(null); addImageShape(a); }) },
      ],
    });

  /** "View" menu: toggles and settings that don't need a toolbar button of their own */
  const viewMenu = (at: { clientX: number; clientY: number }) => {
    const themeNames = tokens ? Object.keys(tokens.themes) : [];
    setMenu({
      x: Math.max(8, at.clientX - 240), // right-aligned under the button; ContextMenu clamps to the window
      y: at.clientY,
      title: strings.toolbar.viewMenu,
      items: [
        { label: strings.toolbar.guides, icon: "grid", shortcut: "⌃G", check: guidesOn, run: () => setGuidesOn((v) => !v) },
        { label: strings.toolbar.minimap, icon: "map", shortcut: "M", check: minimapOpen, run: () => setMinimapOpen((v) => !v) },
        { label: strings.toolbar.leftPanel, icon: "panel", shortcut: `${mod}\\`, check: leftOpen, run: () => setLeftOpen((v) => !v) },
        "sep",
        { label: strings.toolbar.appearance(theme), icon: theme === "system" ? "system" : theme === "light" ? "sun" : "moon", run: () => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system")) },
        ...(themeNames.length > 1
          ? themeNames.map((n) => ({ label: strings.toolbar.themeOption(n), icon: "layers" as IconName, check: tokens!.active === n, run: () => void saveTokens({ ...tokens!, active: n }, strings.history.changeTheme) }))
          : []),
        "sep",
        { label: strings.toolbar.snapshot, icon: "layers", run: () => void snapshotMenu(at) },
      ],
    });
  };

  const snapshotMenu = async (at: { clientX: number; clientY: number }) => {
    const s = await api.get<{ git: boolean; branch?: string; changed: number; snapshots: { hash: string; author: string; when: string; subject: string }[] }>("/api/snapshots").catch(() => null);
    if (!s?.git) return setMenu({ x: at.clientX, y: at.clientY, title: strings.menu.snapshot, items: [{ label: strings.menu.notGit, disabled: true, run: () => {} }] });
    setMenu({
      x: at.clientX,
      y: at.clientY,
      title: strings.menu.snapshotStatus(s.branch ?? "", s.changed),
      items: [
        {
          label: s.changed ? strings.menu.snapshotNow : strings.menu.nothingChanged,
          icon: "check",
          disabled: !s.changed,
          run: async () => {
            const r = await ask.prompt({ title: strings.dialog.snapshotTitle, label: strings.dialog.snapshotLabel, value: strings.dialog.snapshotMessage(new Date().toLocaleDateString("en-CA")), hint: strings.dialog.snapshotHint, ok: strings.dialog.commit });
            if (!r) return;
            try {
              const res = await api.post<{ hash?: string; nothing?: boolean }>("/api/snapshot", { message: r.value });
              toast({ tone: "ok", text: res.nothing ? strings.toast.nothingChanged : strings.toast.snapshot(res.hash ?? "") });
            } catch (e) {
              toast({ tone: "error", text: String((e as Error).message) });
            }
          },
        },
        "sep",
        ...s.snapshots.slice(0, 10).map((x) => ({ label: `${x.hash} ${x.subject.slice(0, 40)} · ${x.when}`, disabled: true, run: () => {} })),
      ],
    });
  };

  /* ---------- Shortcuts ---------- */
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (!board || ask.state || focusFile || playFile) return;
    if (isTyping(e) || e.isComposing) return;
    const cmd = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const one = selected.length === 1 ? selected[0] : null;
    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (cmd && k === "z") return run(() => void undoRedo(e.shiftKey ? "redo" : "undo"));
    if (cmd && k === "y") return run(() => void undoRedo("redo"));
    if (cmd && k === "j") return run(() => (rightTab === "chat" ? setRightTab("inspect") : openChat()));
    if (cmd && k === "k") return run(() => { setLeftOpen(true); setTimeout(() => searchRef.current?.focus(), 0); });
    if (cmd && k === "a" && !editFile) return run(() => select(visibleBoards));
    // ⌘A while editing: all siblings of the selected element (or the board's top-level elements)
    if (cmd && k === "a" && editFile) {
      const doc = frames.current.get(editFile)?.contentDocument;
      const cur = edit.state.selection?.path;
      const parentEl = doc && (cur ? elementAt(doc, cur)?.parentElement : doc.body.firstElementChild);
      const kids = parentEl ? Array.from(parentEl.children).filter((c) => !/^(SCRIPT|STYLE)$/.test(c.tagName)).map((c) => pathOf(c)).filter((x): x is string => x != null) : [];
      return run(() => kids.length && void edit.select(kids));
    }
    if (cmd && k === "c" && editFile && edit.state.selection) return run(() => void copyElement());
    if (cmd && k === "v" && editFile) return run(() => void pasteElement());
    if (cmd && k === "d" && editFile && edit.state.selection) {
      const sel = edit.state.selection;
      return run(() => void doEdit({ op: "duplicate", path: sel.path, hash: sel.hash }));
    }
    if (cmd && k === "d" && one && !editFile) return run(() => void duplicateBoard(one));
    if (cmd && e.key === "]" && selected.length) return run(() => reorder(selected, "front"));
    if (cmd && e.key === "[" && selected.length) return run(() => reorder(selected, "back"));
    if (cmd && e.key === "0") return run(() => zoomTo(1));
    if (cmd && e.key === "1") return run(fitAll);
    if (cmd && (e.key === "=" || e.key === "+")) return run(() => zoomBy(2));
    if (cmd && e.key === "-") return run(() => zoomBy(1 / 2));
    if (cmd && e.key === "\\") return run(() => toggleUi());
    if (e.ctrlKey && !e.metaKey && k === "g") return run(() => setGuidesOn((v) => !v));
    if (cmd && k === "g" && editFile && edit.state.paths.length >= 2) return run(() => void wrapSelected("flex"));
    if (cmd) return;
    if (e.shiftKey && e.code === "Digit1") return run(fitAll);
    if (e.shiftKey && e.code === "Digit2") return run(() => goTo(selected));
    if (e.key === "Escape") {
      if (inlinePlay) return run(() => stopInline());
      if (editFile) return run(() => setEditFile(null));
      if (tool !== "select") return run(() => setTool("select"));
      setSelected([]);
      setSelectedNote(null);
      setSelectedShape(null);
      return;
    }
    if (e.key === "F6") return run(() => cycleFocus(e.shiftKey));
    // Tab: next/previous board when the canvas has focus. Enter: edit (while editing: first child, Shift for parent)
    const ae = document.activeElement as HTMLElement | null;
    const inCanvas = !ae || ae === document.body || !!ae.closest?.(".canvas") || ae.tagName === "IFRAME";
    if (e.key === "Tab" && inCanvas && !editFile && visibleBoards.length) {
      const i = selected.length ? visibleBoards.indexOf(selected[selected.length - 1]) : -1;
      const n = visibleBoards[(i + (e.shiftKey ? -1 : 1) + visibleBoards.length) % visibleBoards.length];
      return run(() => {
        select([n]);
        goTo([n]);
        setAnnounce(strings.app.announceBoard(board.boards[n]?.title ?? n, visibleBoards.indexOf(n) + 1, visibleBoards.length));
      });
    }
    if (e.key === "Enter" && !editFile && selected.length === 1 && inCanvas) return run(() => setEditFile(selected[0]));
    if (e.key === "Enter" && editFile && edit.state.selection) {
      const doc = frames.current.get(editFile)?.contentDocument;
      const el = doc && elementAt(doc, edit.state.selection.path);
      const t = e.shiftKey ? el?.parentElement : el?.firstElementChild;
      const tp = t && t !== doc?.body ? pathOf(t) : null;
      if (tp != null) return run(() => void edit.select([tp]));
      return;
    }
    if (k === "p" && !editFile && !cmd && selected.length === 1 && board.boards[selected[0]]?.is_interactive) return run(() => (inlinePlay === selected[0] ? stopInline() : setInlinePlay(selected[0])));
    if ((e.key === "Delete" || e.key === "Backspace") && selectedShapes.length && !editFile) return run(() => deleteShapes(selectedShapes));
    if (e.key === "Delete" || e.key === "Backspace") {
      if (editFile && edit.state.selection) {
        const sel = edit.state.selection;
        return run(async () => {
          if (await doEdit({ op: "delete", path: sel.path, hash: sel.hash })) {
            void edit.select([]);
            toast({ text: strings.toast.elementDeleted, action: undoAction });
          }
        });
      }
      if (selectedNotes.length || (selected.length && !editFile)) {
        return run(() => {
          if (selectedNotes.length) deleteNotes(selectedNotes);
          if (selected.length && !editFile) void deleteBoards(selected);
        });
      }
      return;
    }
    // Arrows while editing: move selection to sibling, parent or child; Alt+↑↓ reorders among siblings
    if ((e.key.startsWith("Arrow") || e.key === "Tab" || e.key === "Enter") && editFile && edit.state.selection) {
      const sel = edit.state.selection;
      const doc = frames.current.get(editFile)?.contentDocument;
      const el = doc && elementAt(doc, sel.path);
      if (!el) return;
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const parent = sel.path.includes("/") ? sel.path.slice(0, sel.path.lastIndexOf("/")) : "";
        const i = Number(sel.path.split("/").pop());
        const to = e.key === "ArrowUp" ? i - 1 : i + 1;
        if (to < 0 || to >= (el.parentElement?.children.length ?? 0)) return run(() => {});
        return run(() => void moveElement(sel.path, { toParentPath: parent, index: to, freeze: [] }));
      }
      // Tab / Shift+Tab walk siblings, Enter goes into the first child (Esc goes back up to the parent)
      const forward = e.key === "ArrowDown" || e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey);
      const next = forward ? el.nextElementSibling : el.previousElementSibling;
      const target = (e.key === "ArrowLeft" && e.shiftKey) ? el.parentElement : (e.key === "ArrowRight" && e.shiftKey) || e.key === "Enter" ? el.firstElementChild : next;
      if (target && target !== doc.body) {
        const tp = pathOf(target);
        if (tp != null) return run(() => void edit.select([tp]));
      }
      return run(() => {});
    }
    if (e.key.startsWith("Arrow") && (selected.length || selectedNotes.length || selectedShapes.length) && !editFile) {
      const d = e.altKey ? 100 : e.shiftKey ? 10 : 1;
      return run(() => nudge(e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0));
    }
    if (e.key === "F2" && one) return run(() => void renameBoard(one));
    if (k === "f" && one) return run(() => setFocusFile(one));
    if (k === "e" && one) return run(() => setEditFile(editFile === one ? null : one));
    if (k === "m") return run(() => setMinimapOpen((v) => !v));
    const t = TOOLS.find((x) => x.key.toLowerCase() === k);
    if (t && !editFile) return run(() => setTool(t.id));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- Overlays on boards: edit outlines, selection, comment pins ---------- */
  const renderOverlay = (f: string) => {
    const pins = comments.filter((c) => c.file === f && !c.resolved);
    const doc = frames.current.get(f)?.contentDocument;
    const editing = editFile === f;
    const lg = guidesOn ? (board?.guides?.[f] ?? []).filter((g) => !g.hidden) : [];
    if (!editing && !pins.length && !lg.length) return null;
    return (
      <div className="overlay">
        {lg.length > 0 && board && <GuidesOverlay guides={lg} w={board.boards[f].w} h={board.boards[f].h} />}
        {editing && edit.state.hover && !edit.state.paths.includes(edit.state.hover.path) && <Box r={edit.state.hover.rect} cls="hover" />}
        {editing && edit.state.rects.map((r, i) => <Box key={i} r={r} cls="sel" />)}
        {editing && edit.state.marquee && <Box r={edit.state.marquee} cls="marquee-el" />}
        {editing && doc && edit.state.paths.length === 1 && edit.state.rects[0] && (
          <EditHandles
            doc={doc}
            path={edit.state.paths[0]}
            rect={edit.state.rects[0]}
            zoom={view.zoom}
            onMove={(plan) => void moveElement(edit.state.paths[0], plan)}
            onPosition={async (left, top) => {
              const path = edit.state.paths[0];
              const hash = await hashOf(f, path);
              await doEdit({ op: "batch", ops: [{ op: "setStyle", path, hash, prop: "left", value: `${left}px` }, { op: "setStyle", path, hash, prop: "top", value: `${top}px` }] });
            }}
            onResize={async (w, h) => {
              const path = edit.state.paths[0];
              const hash = await hashOf(f, path);
              await doEdit({ op: "batch", ops: [{ op: "setStyle", path, hash, prop: "width", value: `${w}px` }, { op: "setStyle", path, hash, prop: "height", value: `${h}px` }] });
            }}
          />
        )}
        {pins.map((c, i) => {
          const el = doc && c.path ? elementAt(doc, c.path) : null;
          const r = el ? rectOf(el) : null;
          return (
            <div
              key={c.id}
              className="pin"
              title={c.text}
              style={r ? { left: r.x + r.w - 12, top: r.y - 12, transform: `scale(${1 / Math.max(view.zoom, 0.25)})` } : { right: 8, top: 8 + i * 30, transform: `scale(${1 / Math.max(view.zoom, 0.25)})` }}
            >
              {i + 1}
            </div>
          );
        })}
      </div>
    );
  };

  if (!board || !data)
    return (
      <div className="loading" role="status">
        {error ? (
          <>
            <Icon name="warn" /> {strings.app.loadFailed} {error}
            <button onClick={() => void load()}>{strings.app.retry}</button>
          </>
        ) : (
          <>
            <span className="spinner" aria-hidden="true" /> {strings.app.loadingBoards}
          </>
        )}
      </div>
    );

  const one = selected.length === 1 ? selected[0] : null;
  const erroredFiles = [...new Set([...data.missing, ...Object.keys(errors)])];
  const visibleCount = (() => {
    const vx = -view.x / view.zoom, vy = -view.y / view.zoom, vw = size.w / view.zoom, vh = size.h / view.zoom;
    return visibleBoards.filter((f) => { const b = board.boards[f]; return b.x < vx + vw && b.x + b.w > vx && b.y < vy + vh && b.y + b.h > vy; }).length;
  })();
  const leftTabs = (
    <div className="left-tabs" role="tablist" aria-label={strings.tabs.left}>
      <button role="tab" aria-selected={leftTab === "boards"} className={leftTab === "boards" ? "on" : ""} onClick={() => setLeftTab("boards")}>
        {strings.tabs.boards}
      </button>
      <button role="tab" aria-selected={leftTab === "assets"} className={leftTab === "assets" ? "on" : ""} onClick={() => setLeftTab("assets")}>
        {strings.tabs.assets}
      </button>
      <button role="tab" aria-selected={leftTab === "tokens"} className={leftTab === "tokens" ? "on" : ""} onClick={() => setLeftTab("tokens")}>
        {strings.tabs.tokens}
      </button>
    </div>
  );
  const rects = visibleBoards.map((f) => ({ file: f, ...board.boards[f] }));

  return (
    <div className="app">
      <header className="toolbar" role="toolbar" aria-label={strings.toolbar.aria}>
        <div className="tb-zone tb-left">
          <button className={`icon-btn ${leftOpen ? "on" : ""}`} aria-label={strings.toolbar.leftPanel} aria-pressed={leftOpen} title={strings.toolbar.leftPanelTitle(mod)} onClick={() => setLeftOpen((v) => !v)}>
            <Icon name="panel" style={{ transform: "scaleX(-1)" }} />
          </button>
          <button className="icon-btn tb-tools-compact" aria-label={strings.toolbar.canvasTools} aria-haspopup="menu" title={strings.toolbar.canvasTools} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); toolsMenu({ clientX: r.left, clientY: r.bottom + 4 }); }}>
            <Icon name={TOOLS.find((t) => t.id === tool)?.icon ?? "select"} />
            <Icon name="chevronDown" size={12} />
          </button>
          <div className="tool-group tb-tools-full" role="radiogroup" aria-label={strings.toolbar.canvasTools}>
            {TOOLS.slice(0, 5).map((t) => (
              <button key={t.id} role="radio" aria-checked={tool === t.id} aria-label={strings.toolbar.tool(t.label, t.key)} title={strings.toolbar.tool(t.hint, t.key)} className={`icon-btn ${tool === t.id ? "on" : ""}`} disabled={!!editFile && t.id !== "select" && t.id !== "hand"} onClick={() => setTool(t.id)}>
                <Icon name={t.icon} />
              </button>
            ))}
          </div>
          <button className={`icon-btn tb-shapes-compact ${SHAPE_TOOLS.includes(tool) ? "on" : ""}`} aria-label={strings.toolbar.shapes} aria-haspopup="menu" title={strings.toolbar.shapes} disabled={!!editFile} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); shapesMenu({ clientX: r.left, clientY: r.bottom + 4 }); }}>
            <Icon name={TOOLS.find((t) => t.id === tool && SHAPE_TOOLS.includes(t.id))?.icon ?? "rect"} />
            <Icon name="chevronDown" size={12} />
          </button>
          <div className="tool-group tb-shapes-full" role="radiogroup" aria-label={strings.toolbar.shapes}>
            {TOOLS.slice(5).map((t) => (
              <button key={t.id} role="radio" aria-checked={tool === t.id} aria-label={strings.toolbar.tool(t.label, t.key)} title={strings.toolbar.shapeToolTitle(t.hint, t.key)} className={`icon-btn ${tool === t.id ? "on" : ""}`} disabled={!!editFile} onClick={() => setTool(t.id)}>
                <Icon name={t.icon} />
              </button>
            ))}
            <button className="icon-btn" aria-label={strings.toolbar.insertImage} title={strings.toolbar.insertImageTitle} disabled={!!editFile} onClick={() => setPicker(() => (a: Asset) => { setPicker(null); addImageShape(a); })}>
              <Icon name="image" />
            </button>
          </div>
          <div className="tool-group">
            <button className="icon-btn" aria-label={strings.toolbar.undo} title={strings.toolbar.undoTitle(hist.undo.length ? hist.undo[hist.undo.length - 1] : undefined, mod)} disabled={!hist.canUndo} onClick={() => void undoRedo("undo")}>
              <Icon name="undo" />
            </button>
            <button className="icon-btn" aria-label={strings.toolbar.redo} title={strings.toolbar.redoTitle(hist.redo.length ? hist.redo[hist.redo.length - 1] : undefined, mod)} disabled={!hist.canRedo} onClick={() => void undoRedo("redo")}>
              <Icon name="redo" />
            </button>
          </div>
          <button className="new-board" aria-haspopup="menu" title={strings.toolbar.newBoardTitle} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); templateMenu({ clientX: r.left, clientY: r.bottom + 4 }); }}>
            <Icon name="plus" size={16} /> <span className="tb-label">{strings.toolbar.newBoard}</span> <Icon name="chevronDown" size={14} />
          </button>
        </div>
        <div className="tb-zone tb-center">
          {editFile ? (
            <span className="editing-chip">
              <Icon name="edit" size={14} /> {strings.toolbar.editing(board.boards[editFile]?.title ?? editFile)}
              <button className="icon-btn sm" aria-label={strings.toolbar.stopEditing} title={strings.toolbar.stopEditingTitle} onClick={() => setEditFile(null)}>
                <Icon name="close" size={14} />
              </button>
            </span>
          ) : (
            <strong className="app-title" title={board.title}>{board.title}</strong>
          )}
        {erroredFiles.length > 0 && (
          <button
            className="err-chip"
            aria-haspopup="menu"
            title={strings.toolbar.erroredBoards}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({
                x: r.left,
                y: r.bottom + 4,
                title: strings.toolbar.erroredBoardsN(erroredFiles.length),
                items: [
                  ...erroredFiles.slice(0, 12).map((f) => ({ label: `${board.boards[f]?.title ?? f} — ${(errors[f]?.[0]?.message ?? strings.menu.fileMissing).slice(0, 40)}`, icon: "warn" as IconName, run: () => { select([f]); goTo([f]); } })),
                  "sep" as const,
                  { label: strings.menu.askFixAll, icon: "comment" as IconName, run: () => askFix(erroredFiles) },
                  ...(data.missing.length
                    ? [
                        {
                          label: strings.menu.cleanMissing(data.missing.length),
                          icon: "trash" as IconName,
                          danger: true,
                          run: () => {
                            update((b) => {
                              const boards = { ...b.boards };
                              for (const f of data.missing) delete boards[f];
                              return { ...b, boards, order: b.order.filter((f) => !data.missing.includes(f)) };
                            }, strings.history.cleanMissing);
                            toast({ text: strings.toast.cleanedUp(data.missing.length), action: undoAction });
                          },
                        },
                      ]
                    : []),
                ],
              });
            }}
          >
            <Icon name="warn" size={14} /> {strings.toolbar.errors(erroredFiles.length)}
          </button>
        )}
          {error && <span className="warn">{error}</span>}
        </div>
        <div className="tb-zone tb-right">
          <div className="tool-group">
            <button className="icon-btn" aria-label={strings.toolbar.zoomOut} title={strings.toolbar.zoomOutTitle(mod)} onClick={() => zoomBy(1 / 2)}>
              <span className="glyph">−</span>
            </button>
            <button className="zoom" aria-label={strings.toolbar.zoom100} title={strings.toolbar.zoom100Title(mod)} onClick={() => zoomTo(1)}>
              {Math.round(view.zoom * 100)}%
            </button>
            <button className="icon-btn" aria-label={strings.toolbar.zoomIn} title={strings.toolbar.zoomInTitle(mod)} onClick={() => zoomBy(2)}>
              <Icon name="plus" />
            </button>
            <button className="icon-btn" aria-label={strings.toolbar.fitAll} title={strings.toolbar.fitAllTitle} onClick={fitAll}>
              <Icon name="fit" />
            </button>
          </div>
          <div className="tool-group">
            <button className={`ask-ai ${rightTab === "chat" ? "on" : ""}`} aria-label={strings.toolbar.aiChat} aria-pressed={rightTab === "chat"} title={strings.toolbar.aiChatTitle(mod)} onClick={() => (rightTab === "chat" ? setRightTab("inspect") : openChat())}>
              <Icon name="comment" size={16} /> <span className="ask-ai-label">{strings.toolbar.askAi}</span>
            </button>
            <button className="icon-btn" aria-label={strings.toolbar.viewMenu} aria-haspopup="menu" title={strings.toolbar.viewMenuTitle} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); viewMenu({ clientX: r.right, clientY: r.bottom + 4 }); }}>
              <Icon name="more" />
            </button>
          </div>
        </div>
      </header>
      <div className="main">
        {leftOpen && (
          leftTab === "tokens" ? (
            <aside className="left" aria-label={strings.app.tokensAside}>
              {leftTabs}
              {tokens ? <TokenPanel tokens={tokens} onSave={(t, label) => void saveTokens(t, label)} /> : <p className="empty">{strings.app.loading}</p>}
            </aside>
          ) : leftTab === "assets" ? (
            <aside className="left" aria-label={strings.app.assetsAside}>
              {leftTabs}
              <AssetGrid version={assetsVersion} onError={(m) => toast({ tone: "error", text: m })} onUploaded={(a) => toast({ tone: "ok", text: strings.toast.uploaded(a.map((x) => x.name).join(", ")) })} />
            </aside>
          ) : (
          <LeftPanel
            header={leftTabs}
            ref={searchRef}
            board={board}
            pages={pages}
            currentPage={currentPage}
            selected={selected}
            missing={erroredFiles}
            onPage={setPage}
            onAddPage={() => void addPage()}
            onPageMenu={pageMenu}
            onMovePage={movePage}
            onPick={(f, add) => {
              const b = board.boards[f];
              if (pages.length && b && (b.page ?? pages[0].id) !== currentPage) setPage(b.page ?? pages[0].id);
              select([f], add ? "toggle" : "replace");
              if (!add) goTo([f]);
              if (narrow && !add) setLeftOpen(false);
            }}
            onGroupRename={(key) => void renameGroup(key)}
            onGroupMenu={(key, files, at) =>
              setMenu({
                x: at.clientX,
                y: at.clientY,
                title: (key && board.groupNames?.[key]) || key || strings.boardList.otherGroup,
                items: [
                  ...(key
                    ? [{
                        label: strings.menu.renameGroup,
                        icon: "title" as IconName,
                        run: () => void renameGroup(key),
                      }]
                    : []),
                  {
                    label: strings.menu.pageFromGroup,
                    icon: "page" as IconName,
                    run: async () => {
                      // With no pages yet, the rest of the boards need a page of their own first
                      if (!pages.length && !(await pageApi({ action: "add", name: strings.boardList.mainPage }))) return;
                      const res = await pageApi({ action: "add", name: (key && board.groupNames?.[key]) || key || strings.boardList.otherGroup });
                      if (!res?.id) return;
                      update((b) => ({ ...b, boards: { ...b.boards, ...Object.fromEntries(files.filter((f) => b.boards[f]).map((f) => [f, { ...b.boards[f], page: res.id }])) } }), strings.history.pageFromGroup);
                      setPage(res.id);
                    },
                  },
                ],
              })
            }
            onBoardMenu={(f, at) => {
              if (!selected.includes(f)) select([f]);
              setMenu({ x: at.clientX, y: at.clientY, title: board.boards[f]?.title ?? f, items: boardMenuItems(f) });
            }}
          />
          )
        )}
        <div
          className="canvas-wrap"
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) e.preventDefault();
          }}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer.files);
            if (!files.length) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const at = { x: (e.clientX - r.left - view.x) / view.zoom, y: (e.clientY - r.top - view.y) / view.zoom };
            void importFiles(files, at);
          }}
        >
          <Canvas
            board={board}
            files={data.files}
            view={view}
            setView={setView}
            tool={tool}
            setTool={setTool}
            visibleBoards={visibleBoards}
            visibleNotes={visibleNotes}
            selected={selected}
            selectedNotes={selectedNotes}
            editFile={editFile}
            reloadKeys={reloadKeys}
            onSelect={select}
            onSelectNote={(id, add) => {
              if (!id) return setSelectedNotes([]);
              setSelectedNotes((cur) => (add ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]));
              if (!add) {
                setSelected([]);
                setSelectedShapes([]);
              }
            }}
            onMarquee={(hit, additive) => {
              setSelected((cur) => (additive ? [...new Set([...cur, ...hit.boards])] : hit.boards));
              setSelectedNotes((cur) => (additive ? [...new Set([...cur, ...hit.notes])] : hit.notes));
              setSelectedShapes((cur) => (additive ? [...new Set([...cur, ...hit.shapes])] : hit.shapes));
            }}
            onMoveBoards={(patches, done) =>
              update(
                (b) => {
                  const entries = Object.entries(patches);
                  const isMove = entries.length > 0 && entries.every(([, p]) => p.w == null && p.h == null && p.x != null && p.y != null);
                  // A move of selected boards carries the selected notes along by the same amount
                  const [f0, p0] = entries[0] ?? [];
                  const dx = isMove && f0 && b.boards[f0] ? p0!.x! - b.boards[f0].x : 0;
                  const dy = isMove && f0 && b.boards[f0] ? p0!.y! - b.boards[f0].y : 0;
                  const base = isMove && selectedNotes.length && entries.every(([f]) => selected.includes(f)) ? shifted(b, dx, dy, [], selectedNotes) : b;
                  return { ...base, boards: { ...base.boards, ...Object.fromEntries(entries.map(([f, p]) => [f, { ...base.boards[f], ...p, autoPlaced: undefined }])) } };
                },
                done ? (Object.values(patches).some((p) => p.w != null) ? strings.history.resizeBoard : strings.history.moveBoard) : undefined,
              )
            }
            onMoveNote={(id, patch, done) =>
              update((b) => {
                const cur = b.notes[id];
                // Dragging one note of a multi-selection moves the others by the same amount
                const dx = patch.x != null ? patch.x - cur.x : 0;
                const dy = patch.y != null ? patch.y - cur.y : 0;
                const inGroup = (dx || dy) && !("text" in patch) && selectedNotes.includes(id);
                const base = inGroup ? shifted(b, dx, dy, selected, selectedNotes.filter((k) => k !== id)) : b;
                return { ...base, notes: { ...base.notes, [id]: { ...cur, ...patch } } };
              }, done ? ("text" in patch ? strings.history.editNote : strings.history.moveNote) : undefined)
            }
            onDeleteNote={(id) => deleteNotes([id])}
            onPlay={(f) => (inlinePlay === f ? stopInline() : setInlinePlay(f))}
            playing={inlinePlay}
            onEdit={(f) => {
              setEditFile(f);
              if (f) setSelected([f]);
            }}
            onRename={(f) => void renameBoard(f)}
            onCreateBoard={(r) => void createBoard(r)}
            onCreateNote={createNote}
            onContext={onContext}
            onSize={setCanvasSize}
            renderBoardOverlay={renderOverlay}
            worldLayer={
              <ShapesLayer
                shapes={shapes}
                ids={visibleShapes}
                zoom={view.zoom}
                selected={selectedShapes}
                interactive={tool === "select" && !editFile}
                onSelect={(id, add) => {
                  setSelectedShapes((cur) => (add ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : cur.includes(id) ? cur : [id]));
                  if (!add) {
                    setSelected([]);
                    setSelectedNotes([]);
                  }
                }}
                onChange={(id, patch, done) =>
                  update((b) => {
                    const cur = b.shapes?.[id];
                    if (!cur) return b;
                    // Dragging one selected shape moves the rest of the selection along
                    const dx = patch.x != null ? patch.x - cur.x : 0;
                    const dy = patch.y != null ? patch.y - cur.y : 0;
                    const inGroup = (dx || dy) && patch.w == null && selectedShapes.includes(id);
                    const base = inGroup ? shifted(b, dx, dy, selected, selectedNotes, selectedShapes.filter((k) => k !== id)) : b;
                    return { ...base, shapes: { ...(base.shapes ?? {}), [id]: { ...cur, ...patch } } };
                  }, done ? (patch.w != null ? strings.history.resizeShape : strings.history.moveShape) : undefined)
                }
                onContext={(id, at) =>
                  setMenu({
                    x: at.clientX,
                    y: at.clientY,
                    title: strings.menu.shape,
                    items: [
                      { label: strings.menu.front, icon: "front", shortcut: `${mod}]`, run: () => shapeZ(id, "front") },
                      { label: strings.menu.back, icon: "back", shortcut: `${mod}[`, run: () => shapeZ(id, "back") },
                      "sep",
                      { label: strings.menu.delete, icon: "trash", shortcut: "⌫", danger: true, run: () => deleteShapes([id]) },
                    ],
                  })
                }
              />
            }
            iframeRef={(f, el) => {
              // The ref callback is called again with null → el on every render. Update only for a genuinely new iframe
              if (el && frames.current.get(f) !== el) {
                frames.current.set(f, el);
                setFrameTick((t) => t + 1);
              }
            }}
          />
          {SHAPE_TOOLS.includes(tool) && !editFile && <ShapeDrawer tool={tool as ShapeKind} view={view} onDone={(sh) => addShape(sh)} />}
          {firstRunHint && visibleBoards.length > 0 && (
            <div className="first-run" role="status">
              <div className="first-run-line"><Icon name="edit" size={16} /> {strings.app.firstRunEdit}</div>
              <div className="first-run-line"><Icon name="comment" size={16} /> {strings.app.firstRunAi(mod)}</div>
            </div>
          )}
          {visibleBoards.length === 0 && visibleNotes.length === 0 && visibleShapes.length === 0 && (
            <div className="canvas-empty">
              <Icon name="board" size={32} />
              <p>{strings.app.emptyPage}</p>
              <button className="primary" onClick={() => setTool("board")}>
                {strings.app.drawBoard} <kbd>B</kbd>
              </button>
            </div>
          )}
          {minimapOpen && rects.length > 0 && (
            <Minimap rects={rects} selected={selected} view={view} size={size} onJump={(x, y) => setView((v) => ({ ...v, x: size.w / 2 - x * v.zoom, y: size.h / 2 - y * v.zoom }))} />
          )}
        </div>
        {narrow && leftOpen && <div className="drawer-backdrop" onPointerDown={() => setLeftOpen(false)} />}
        <div className="right" hidden={!rightOpen}>
          <div className="right-tabs" role="tablist" aria-label={strings.tabs.right}>
            <button role="tab" aria-selected={rightTab === "inspect"} className={rightTab === "inspect" ? "on" : ""} onClick={() => setRightTab("inspect")}>
              {strings.tabs.properties}
            </button>
            <button role="tab" aria-selected={rightTab === "chat"} className={rightTab === "chat" ? "on" : ""} onClick={() => openChat()}>
              {strings.tabs.ai} <kbd>{mod}J</kbd>
            </button>
            {narrow && (
              <button className="icon-btn sm right-close" aria-label={strings.tabs.closePanel} title={strings.tabs.closePanel} onClick={() => setRightOpen(false)}>
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          <div className="chat-wrap" hidden={rightTab !== "chat"}>
            <ChatPanel
              selection={editFile && edit.state.selection?.file === editFile ? edit.state.selection : null}
              boards={editFile ? [editFile] : selected}
              visibleCount={visibleCount}
              titleOf={(f) => board.boards[f]?.title ?? f}
              attach={chatAttach}
              setAttach={setChatAttach}
              draft={chatDraft}
              setDraft={setChatDraft}
              subscribe={chatSubscribe}
              onLocate={setLocate}
              inputRef={chatInputRef}
            />
          </div>
          {rightTab === "inspect" && (
        <Inspector
          onAskAi={() => openChat()}
          author={author || strings.app.defaultAuthor}
          onAuthor={async () => {
            const r = await ask.prompt({ title: strings.dialog.authorTitle, label: strings.dialog.name, value: author, ok: strings.dialog.save });
            if (!r?.value.trim()) return;
            setAuthor(r.value.trim());
            try {
              localStorage.setItem("design-canvas:author", r.value.trim());
            } catch {
              /* ignore */
            }
          }}
          onAskAI={(c) => {
            setChatAttach((a) => ({ ...a, comments: a.comments.some((x) => x.id === c.id) ? a.comments : [...a.comments, { id: c.id, text: c.text, file: c.file }] }));
            openChat(chatDraft || strings.prompts.fixComment, [c.file]);
          }}
          file={editFile ?? one}
          editing={!!editFile}
          selection={edit.state.selection}
          multi={edit.state.paths.length}
          error={edit.state.error}
          comments={comments}
          onSelectPath={(p) => editFile && void edit.select([p])}
        >
          {!editFile && selectedShape && shapes[selectedShape] && (
            <ShapeOptions shape={shapes[selectedShape]} onPatch={(pt) => patchShape(selectedShape, pt, strings.history.shapeStyle)} onDelete={() => deleteShapes([selectedShape])} onFront={() => shapeZ(selectedShape, "front")} onBack={() => shapeZ(selectedShape, "back")} />
          )}
          {!editFile && selectedNote && board.notes[selectedNote] && (
            <NoteOptions
              note={board.notes[selectedNote]}
              onPatch={(pt) =>
                update((b) => {
                  const n: Note = { ...b.notes[selectedNote], ...pt };
                  for (const k of Object.keys(n) as (keyof Note)[]) if (n[k] === undefined) delete n[k];
                  return { ...b, notes: { ...b.notes, [selectedNote]: n } };
                }, strings.history.noteStyle)
              }
              onDelete={() => deleteNotes([selectedNote])}
            />
          )}
          {!editFile && one && board.boards[one] && (
            <BoardOptions
              file={one}
              item={board.boards[one]}
              pages={pages}
              isLaunch={board.launch?.view === "focused" && board.launch.file === one}
              onPatch={(patch) => patchBoard(one, patch)}
              onRename={() => void renameBoard(one)}
              onRenameFile={() => void renameFile(one)}
              onFocus={() => setFocusFile(one)}
              onFront={() => reorder([one], "front")}
              onBack={() => reorder([one], "back")}
              onDuplicate={() => void duplicateBoard(one)}
              onDelete={() => void deleteBoards([one])}
              onLaunch={(on) => update((b) => ({ ...b, launch: on ? { view: "focused", file: one } : { view: "canvas" } }), strings.history.launchScreen)}
            />
          )}
          {!editFile && one && board.boards[one] && readTweaks(frames.current.get(one)?.contentDocument) && (
            <Collapsible id="tweaks" title={strings.sections.tweaks}>
              <TweaksPanel
              key={`${one}-${reloadKeys[one] ?? 0}-${frameTick}`}
              doc={readTweaks(frames.current.get(one)?.contentDocument) ? frames.current.get(one)!.contentDocument : null}
              onSave={async (values) => {
                try {
                  await api.post("/api/edit", { file: one, op: "setTweaks", values });
                  toast({ tone: "ok", text: strings.toast.tweaksSaved, action: undoAction });
                } catch (e) {
                  toast({ tone: "error", text: String((e as Error).message) });
                }
              }}
            />
            </Collapsible>
          )}
          {lintTarget && board.boards[lintTarget] && (
            <>
              <Collapsible id="token-check" title={strings.sections.tokenCheck} count={lint?.length ?? 0}>
                <CheckList title={strings.checks.tokenCheck(tokens?.active ?? "")} items={lint} empty={strings.checks.noOffToken} onPick={(p) => pickPath(lintTarget, p)} onAskAI={() => openChat(strings.prompts.fixTokens((lint ?? []).slice(0, 12).map((x) => `- ${x.path ?? strings.prompts.line + x.line}: ${x.message}`).join("\n")), [lintTarget])} />
              </Collapsible>
              <Collapsible id="a11y" title={strings.sections.a11y} count={a11y?.length ?? 0}>
                <CheckList title={strings.checks.a11y} items={a11y} empty={strings.checks.a11yOk} onPick={(p) => pickPath(lintTarget, p)} onAskAI={() => openChat(strings.prompts.fixA11y((a11y ?? []).slice(0, 12).map((x) => `- ${x.path}: ${x.message}`).join("\n")), [lintTarget])} />
              </Collapsible>
            </>
          )}
          {!editFile && one && board.boards[one] && (
            <Collapsible id="guides" title={strings.sections.guides} count={(board.guides?.[one] ?? []).length}>
              <GuidesEditor
              guides={board.guides?.[one] ?? []}
              onChange={(g: LayoutGuide[], label) => update((b) => ({ ...b, guides: { ...(b.guides ?? {}), [one]: g } }), label)}
            />
            </Collapsible>
          )}
          {!editFile && selectedShapes.length > 1 && (
            <section className="board-opts">
              <div className="sec-head">
                <span>{strings.shapes.selectedN(selectedShapes.length)}</span>
              </div>
              <div className="btn-row">
                <button className="icon-btn danger" aria-label={strings.shapes.deleteAll} title={strings.shapes.deleteAll} onClick={() => deleteShapes(selectedShapes)}><Icon name="trash" /></button>
              </div>
            </section>
          )}
          {!editFile && selectedNotes.length > 1 && (
            <section className="board-opts">
              <div className="sec-head">
                <span>{strings.notes.selectedN(selectedNotes.length)}</span>
              </div>
              <div className="btn-row">
                <button className="icon-btn danger" aria-label={strings.notes.deleteAll} title={strings.notes.deleteAll} onClick={() => deleteNotes(selectedNotes)}><Icon name="trash" /></button>
              </div>
            </section>
          )}
          {!editFile && selected.length > 1 && (
            <section className="board-opts">
              <div className="sec-head">
                <span>{strings.boardOptions.selectedN(selected.length)}</span>
              </div>
              <div className="btn-row">
                <button className="icon-btn" aria-label={strings.boardOptions.front} title={strings.boardOptions.frontTitleMod(mod)} onClick={() => reorder(selected, "front")}><Icon name="front" /></button>
                <button className="icon-btn" aria-label={strings.boardOptions.back} title={strings.boardOptions.backTitleMod(mod)} onClick={() => reorder(selected, "back")}><Icon name="back" /></button>
                <button className="icon-btn" aria-label={strings.boardOptions.goToSelected} title={strings.boardOptions.goToSelectedTitle} onClick={() => goTo(selected)}><Icon name="fit" /></button>
                <button className="icon-btn danger" aria-label={strings.boardOptions.delete} title={strings.boardOptions.deleteTitleKey} onClick={() => void deleteBoards(selected)}><Icon name="trash" /></button>
              </div>
            </section>
          )}
          {editFile && edit.state.selection && edit.state.selection.file === editFile && (() => {
            const sel = edit.state.selection;
            const el = frames.current.get(editFile)?.contentDocument ? elementAt(frames.current.get(editFile)!.contentDocument!, sel.path) : null;
            const attrs: Record<string, string> = {};
            if (el) for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
            const paths = edit.state.paths;
            return (
              <Properties
                tokens={tokens}
                bg={(() => {
                  let n: Element | null = el;
                  const w = el?.ownerDocument.defaultView;
                  for (; n && w; n = n.parentElement) {
                    const c = w.getComputedStyle(n).backgroundColor;
                    if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
                  }
                  return "rgb(255, 255, 255)";
                })()}
                onAlign={async (dir) => {
                  const d = frames.current.get(editFile)?.contentDocument;
                  const ops = d && alignOps(d, sel.path, sel.hash, dir);
                  if (!ops) return toast({ text: strings.toast.blockFlow });
                  await doEdit({ op: "batch", ops });
                }}
                onReplaceImage={sel.tag === "img" || /url\(/.test(sel.styles["background-image"] ?? "") ? () => replaceImage(sel.path, sel.tag === "img") : null}
                selection={sel}
                inline={el ? inlineStyles(el) : {}}
                attrs={attrs}
                canWrap={paths.length >= 2}
                onStyle={(prop, value) => void doEdit({ op: "setStyle", path: sel.path, hash: sel.hash, prop, value })}
                onAttr={(name, value) => void doEdit({ op: "setAttr", path: sel.path, hash: sel.hash, name, value })}
                onDuplicate={() => void doEdit({ op: "duplicate", path: sel.path, hash: sel.hash })}
                onDelete={async () => {
                  if (await doEdit({ op: "delete", path: sel.path, hash: sel.hash })) void edit.select([]);
                }}
                onWrap={async (display) => {
                  const ordered = [...paths].sort((a, b) => Number(a.split("/").pop()) - Number(b.split("/").pop()));
                  const hashes = await Promise.all(ordered.map((p) => api.get<{ hash: string }>(`/api/element?f=${encodeURIComponent(editFile)}&path=${encodeURIComponent(p)}`).then((r) => r.hash)));
                  if (await doEdit({ op: "wrap", paths: ordered, hashes, display })) void edit.select([ordered[0]]);
                }}
              />
            );
          })()}
          {editFile && (
            <Layers
              file={editFile}
              version={reloadKeys[editFile] ?? 0}
              selected={edit.state.paths}
              onSelect={(p, add) => {
                const cur = edit.state.paths;
                void edit.select(add ? (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]) : [p]);
              }}
              onMove={async (path, toParentPath, index) => {
                const { hash } = await api.get<{ hash: string }>(`/api/element?f=${encodeURIComponent(editFile)}&path=${encodeURIComponent(path)}`);
                if (await doEdit({ op: "move", path, hash, toParentPath, index })) {
                  void edit.select([toParentPath ? `${toParentPath}/${index}` : String(index)]);
                }
              }}
            />
          )}
        </Inspector>
          )}
        </div>
      </div>
      {playFile && (
        <Play
          board={board}
          file={playFile}
          onClose={() => setPlayFile(null)}
          onLocate={(f) => {
            setSelected([f]);
            goTo([f]);
          }}
        />
      )}
      {focusFile && board.boards[focusFile] && (
        <FocusView
          board={board}
          file={focusFile}
          onClose={() => {
            setSelected([focusFile]);
            setFocusFile(null);
          }}
          onNav={setFocusFile}
        />
      )}
      <AssetPicker open={!!picker} version={assetsVersion} onClose={() => setPicker(null)} onPick={(a) => picker?.(a)} onError={(m) => toast({ tone: "error", text: m })} />
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      <Dialog state={ask.state} onClose={ask.close} />
    </div>
  );
}

/** Element path after a move: index within the same parent; ancestor indexes after the cut position shift down by one */
export function movedPath(from: string, toParent: string, index: number) {
  const f = from.split("/").map(Number);
  const t = toParent === "" ? [] : toParent.split("/").map(Number);
  // If the target parent path passes under a later sibling of the cut element, decrement that step's index
  const depth = f.length - 1;
  if (t.length > depth && t.slice(0, depth).every((v, i) => v === f[i]) && t[depth] > f[depth]) t[depth]--;
  return [...t, index].join("/");
}

function Box({ r, cls }: { r: { x: number; y: number; w: number; h: number }; cls: string }) {
  return <div className={`box ${cls}`} style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />;
}
