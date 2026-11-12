// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// One set of line icons (24 grid, 1.75 stroke). Generic shapes only; no copied brand icons.
import type { SVGProps } from "react";

const P: Record<string, string> = {
  select: "M5 3l13 8-6 1.5L9.5 19z",
  hand: "M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5V5a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V13a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3.3 14a1.5 1.5 0 0 1 2.4-1.8L8 15",
  board: "M4 5h16v14H4zM4 9h16",
  title: "M5 6h14M12 6v13M9 19h6",
  sticky: "M5 4h14v10l-5 6H5zM14 20v-6h5",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  play: "M8 5l11 7-11 7z",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  copy: "M8 8h11v11H8zM5 16V5h11",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  focus: "M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5M9 9h6v6H9z",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  comment: "M4 5h16v11H9l-5 4z",
  front: "M8 8h12v12H8zM4 4h12v4M4 4v12h4",
  back: "M4 4h12v12H4zM8 16v4h12V8h-4",
  page: "M6 3h9l4 4v14H6zM15 3v4h4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  panel: "M4 5h16v14H4zM15 5v14",
  check: "M5 12l5 5 9-10",
  warn: "M12 4l9 16H3zM12 10v4M12 17h.01",
  info: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 11v5M12 8h.01",
  rect: "M4 6h16v12H4z",
  oval: "M12 19c4.4 0 8-3.1 8-7s-3.6-7-8-7-8 3.1-8 7 3.6 7 8 7z",
  line: "M5 19L19 5",
  arrow: "M5 19L19 5M10 5h9v9",
  pen: "M4 20l1-4L16.5 4.5l3 3L8 19zM14 7l3 3",
  image: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01",
  grid: "M4 4h16v16H4zM4 12h16M12 4v16",
  system: "M4 5h16v11H4zM9 20h6M12 16v4",
  share: "M12 15V4M8 8l4-4 4 4M5 13v6h14v-6",
  folder: "M4 6h6l2 2h8v11H4z",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  pdf: "M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h4",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={P[name]} />
    </svg>
  );
}
