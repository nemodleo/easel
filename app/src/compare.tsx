// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Before / After of boards side by side: before is a run's pre-run copy (GET /api/chat/run-file), after is the live screen.
// Reusable: pass the boards, each with how it changed, and the run whose copy is "before".
import { useEffect, useRef, useState } from "react";

import { Icon } from "./icons";
import { strings } from "./strings";

export type CompareBoard = { file: string; kind: "changed" | "added" | "removed"; title: string; w: number; h: number };

/** One side: the screen at its board size, scaled down to fit the pane */
function Pane({ label, src, empty, w, h }: { label: string; src: string | null; empty: string; w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth - 16) / w, (el.clientHeight - 16) / h));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);
  return (
    <figure className="cmp-pane">
      <figcaption>{label}</figcaption>
      <div className="cmp-stage" ref={ref}>
        {src ? (
          <div className="cmp-frame" style={{ width: w * scale, height: h * scale }}>
            {scale > 0 && <iframe title={label} src={src} style={{ width: w, height: h, transform: `scale(${scale})` }} />}
          </div>
        ) : (
          <p className="muted">{empty}</p>
        )}
      </div>
    </figure>
  );
}

export function Compare({ runId, boards, onClose }: { runId: string; boards: CompareBoard[]; onClose: () => void }) {
  const [i, setI] = useState(() => Math.max(0, boards.findIndex((b) => b.kind === "changed")));
  const b = boards[i];
  if (!b) return null;
  const enc = (f: string) => f.split("/").map(encodeURIComponent).join("/");
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog cmp" role="dialog" aria-modal="true" aria-label={strings.compare.title(b.title)} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="cmp-head">
          <h2>{strings.compare.title(b.title)}</h2>
          <button className="icon-btn sm" aria-label={strings.compare.close} title={strings.compare.close} autoFocus onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        {boards.length > 1 && (
          <div className="chips" role="tablist" aria-label={strings.compare.boards}>
            {boards.map((x, k) => (
              <button key={x.file} role="tab" aria-selected={k === i} className={`chip cmp-tab ${k === i ? "on" : ""}`} onClick={() => setI(k)}>
                {x.kind === "added" ? strings.chat.chipNew(x.title) : x.title}
              </button>
            ))}
          </div>
        )}
        <div className="cmp-panes">
          <Pane key={`b-${b.file}`} label={strings.compare.before} src={b.kind === "added" ? null : `/api/chat/run-file?id=${encodeURIComponent(runId)}&f=${encodeURIComponent(`screens/${b.file}`)}`} empty={strings.compare.notBefore} w={b.w} h={b.h} />
          <Pane key={`a-${b.file}`} label={strings.compare.after} src={b.kind === "removed" ? null : `/screens/${enc(b.file)}`} empty={strings.compare.notAfter} w={b.w} h={b.h} />
        </div>
      </div>
    </div>
  );
}
