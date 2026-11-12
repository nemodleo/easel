// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// board.json format (PLAN.md section 2)

export type BoardItem = {
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
  page?: string;
  autoPlaced?: boolean;
  /** Corner radius in px */
  radius?: number;
  /** Without the frame (shadow and label) */
  frameless?: boolean;
  /** Interactive board: blue marker and Play button */
  is_interactive?: boolean;
  /** Page-style: fills the window in focus view and scrolls */
  expand?: "fill";
  /** Made from another board: a variant (the chat's "Make N variants") or a fork (a second agent wrote while another was editing) */
  origin?: { kind: "variant" | "fork"; of: string; by?: string; while?: string; at?: string };
};

export type Launch = { view: "canvas" | "focused"; file?: string; page?: string };

export type Tool = "select" | "hand" | "board" | "title" | "sticky" | "rect" | "oval" | "line" | "arrow" | "pen";

export type Note = {
  kind: "title" | "sticky";
  x: number;
  y: number;
  text: string;
  w?: number;
  /** Sticky note height (scrolls on overflow) */
  h?: number;
  maxW?: number;
  /** Title: shrink text when it overflows */
  maxH?: number;
  page?: string;
  /** Sticky note color name (STICKY_COLORS) */
  color?: string;
  /** Font size in px */
  size?: number;
  bold?: boolean;
  italic?: boolean;
};

export type ShapeKind = "rect" | "oval" | "line" | "arrow" | "pen" | "image";
export type Shape = {
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** line, arrow, pen: points relative to the box's top-left */
  points?: [number, number][];
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  /** Stacking order (higher is on top) */
  z?: number;
  /** image: ../assets/name */
  src?: string;
  page?: string;
};

/** Layout guide (up to 6 per board, shown only on the canvas) */
export type LayoutGuide = {
  type: "columns" | "rows" | "grid";
  count: number;
  gutter: number;
  margin: number;
  align: "stretch" | "start" | "center" | "end";
  /** Track size when not stretch; cell size for grid */
  size: number;
  color: string;
  hidden?: boolean;
};

export type Page = { id: string; name: string };

export type Board = {
  version: 1;
  title: string;
  pages: Page[];
  boards: Record<string, BoardItem>;
  order: string[];
  notes: Record<string, Note>;
  shapes?: Record<string, Shape>;
  guides?: Record<string, LayoutGuide[]>;
  launch?: Launch;
  /** Display names for file-prefix groups in the board list (SCR → "Screens") */
  groupNames?: Record<string, string>;
};

export type BoardResponse = { board: Board; files: string[]; missing: string[]; dir: string };

export type View = { x: number; y: number; zoom: number };

/** Selected element (path rules in PLAN.md section 3) */
export type Selection = {
  file: string;
  path: string;
  paths?: string[];
  tag: string;
  text: string;
  outerHTML: string;
  hash: string;
  styles: Record<string, string>;
  inlineStyle: Record<string, string>;
  /** Human-readable kind (text, button, link, image, input, icon, container) and label from the server */
  kind?: string;
  label?: string;
  rect?: { x: number; y: number; w: number; h: number };
};

/** Where board iframes load from: the server (/screens/…) in the editor; relative URLs or inline HTML in an exported viewer */
export type ScreenSource = {
  url: (file: string) => string;
  /** Inline HTML per board (single-file export): frames use srcdoc and Play follows links itself */
  html?: (file: string) => string | undefined;
  /** Zoomed-out thumbnails from the server (/api/thumb); without them boards stay live while in view */
  thumbs?: boolean;
};

/** A view-only export, written by server/export.mjs as window.EASEL_EXPORT */
export type ExportData = {
  version: 1;
  title: string;
  stamp: { at: string; repo?: string; commit?: string };
  board: Board;
  files: string[];
  comments: import("./Inspector").Comment[];
  /** Single file only: each board's HTML with its assets inlined */
  screens?: Record<string, string>;
};
