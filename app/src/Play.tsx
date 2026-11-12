// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Play: try a board full screen and move between screens via <a href="scr-02.html"> links. PLAN.md section 5.
// The exported viewer plays too: screens from relative URLs, or inline HTML (single file) where Play follows links itself.
import { useEffect, useRef, useState } from "react";

import { SERVER_SCREENS } from "./Canvas";
import type { Board, ScreenSource } from "./types";
import { strings } from "./strings";

/** Inline screens resolve links against a made-up origin, so "../x.html" and "/x.html" land on board file names */
const VIRTUAL = "https://screens.invalid/";
const encodePath = (f: string) => f.split("/").map(encodeURIComponent).join("/");

export function Play({ board, file, onClose, onLocate, screens = SERVER_SCREENS }: { board: Board; file: string; onClose: () => void; onLocate: (f: string) => void; screens?: ScreenSource }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [current, setCurrent] = useState(file);
  // Inline screens navigate by swapping srcdoc; this is their back/forward history
  const [hist, setHist] = useState({ list: [file], i: 0 });
  const inline = !!screens.html;
  const shown = inline ? hist.list[hist.i] : current;
  const item = board.boards[shown] ?? board.boards[file];
  const go = (f: string) => setHist((h) => ({ list: [...h.list.slice(0, h.i + 1), f], i: h.i + 1 }));
  const step = (d: -1 | 1) => {
    if (inline) return setHist((h) => ({ ...h, i: Math.max(0, Math.min(h.list.length - 1, h.i + d)) }));
    try {
      if (d < 0) ref.current?.contentWindow?.history.back();
      else ref.current?.contentWindow?.history.forward();
    } catch {
      /* a file:// copy keeps each screen in its own origin */
    }
  };

  // Follow navigation inside the iframe to update title and size (links are relative, so they stay within screens/)
  const onLoad = () => {
    let doc: Document | null = null;
    try {
      doc = ref.current?.contentDocument ?? null;
    } catch {
      /* cross-origin (file://): no link handling, the iframe navigates on its own */
    }
    doc?.addEventListener("click", (e) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      if (inline) {
        const u = new URL(a.getAttribute("href") ?? "", VIRTUAL + encodePath(shown));
        if (u.href.startsWith(VIRTUAL)) {
          const f = decodeURIComponent(u.pathname.slice(1));
          if (f === shown && u.hash) return; // in-page anchor
          e.preventDefault();
          if (screens.html?.(f) != null) go(f);
          return;
        }
        e.preventDefault();
        window.open(u.href, "_blank", "noopener");
        return;
      }
      // Open cross-origin links in a new tab
      const u = new URL(a.href, doc!.baseURI);
      if (u.origin !== location.origin) {
        e.preventDefault();
        window.open(u.href, "_blank", "noopener");
      }
    });
    if (inline) return;
    try {
      const base = new URL(screens.url(""), location.href).href;
      const href = ref.current?.contentWindow?.location.href ?? "";
      if (href.startsWith(base)) setCurrent(decodeURIComponent(href.slice(base.length).split(/[?#]/)[0]));
    } catch {
      /* cross-origin */
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="play" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="play-bar">
        <button onClick={() => step(-1)} title={strings.play.back} disabled={inline && hist.i === 0}>
          ←
        </button>
        <button onClick={() => step(1)} title={strings.play.forward} disabled={inline && hist.i >= hist.list.length - 1}>
          →
        </button>
        <strong>{item?.title ?? shown}</strong>
        <span className="muted">{shown}</span>
        <div className="spacer" />
        <button
          onClick={() => {
            onLocate(shown);
            onClose();
          }}
        >
          {strings.play.viewOnCanvas}
        </button>
        <button onClick={onClose} title={strings.play.closeTitle}>
          {strings.play.close}
        </button>
      </div>
      <iframe
        ref={ref}
        className="play-frame"
        src={inline ? undefined : screens.url(file)}
        srcDoc={inline ? screens.html?.(shown) : undefined}
        title="Play"
        onLoad={onLoad}
        style={{ width: Math.min(item?.w ?? 390, window.innerWidth - 32) }}
      />
    </div>
  );
}
