// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Toolbar Share: export a view-only copy (web folder or one .html, PDF, PNG) of the whole canvas, this page or the selected boards.
// The result stays in the popover with Reveal and a deploy command; the footer shows the same export as a CLI line.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { api } from "./api";
import { Icon, type IconName } from "./icons";
import { strings } from "./strings";
import type { Page } from "./types";
import { useToast } from "./ui";

type Scope = "all" | "page" | "boards";
type Kind = "web" | "single" | "pdf" | "png";
type Info = { project: string; out: string; single: string; dirFlag: string; deploy: string; browser: { ok: boolean; reason?: string } };
type Result = { kind: Kind; outRel: string; mainRel: string; files: number; bytes: number; skipped: { ref: string; from: string; reason: string }[]; deploy?: string };

const WIDTH = 384;
const shellQuote = (s: string) => (/^[\w./@:,=+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
export const formatBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The same export from the terminal (npx easel-canvas export …), shown under the rows */
export function cliLine(o: { dirFlag?: string; scope: Scope; page?: Page; pages: Page[]; boards: string[]; single: boolean }) {
  const parts = ["npx easel-canvas export"];
  if (o.dirFlag) parts.push(o.dirFlag);
  // Page names read better than ids; an id only when two pages share a name
  if (o.scope === "page" && o.page) parts.push(`--page ${shellQuote(o.pages.filter((p) => p.name === o.page!.name).length > 1 ? o.page.id : o.page.name)}`);
  if (o.scope === "boards" && o.boards.length) parts.push(`--boards ${shellQuote(o.boards.join(","))}`);
  if (o.single) parts.push("--single-file");
  return parts.join(" ");
}

export function ShareButton({ pages, currentPage, selected }: { pages: Page[]; currentPage: string | null; selected: string[] }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("all");
  const [single, setSingle] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [results, setResults] = useState<Partial<Record<Kind, Result>>>({});
  const [errors, setErrors] = useState<Partial<Record<Kind, string>>>({});
  const [pos, setPos] = useState({ left: 0, top: 0, width: WIDTH });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const page = pages.find((p) => p.id === currentPage) ?? pages[0];
  // A scope that no longer applies falls back to the whole canvas
  const sc: Scope = scope === "boards" && !selected.length ? "all" : scope === "page" && !pages.length ? "all" : scope;
  const body = { scope: sc, page: sc === "page" ? page?.id : undefined, boards: sc === "boards" ? selected : undefined };

  const close = (focus = true) => {
    setOpen(false);
    if (focus) btnRef.current?.focus();
  };
  const toggle = () => {
    if (open) return close();
    setScope(selected.length ? "boards" : "all");
    setOpen(true);
  };

  // Place under the button, right-aligned, kept inside the window on narrow screens
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current!.getBoundingClientRect();
      const width = Math.min(WIDTH, window.innerWidth - 16);
      setPos({ width, top: r.bottom + 8, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  // Focus moves into the popover; a press outside closes it
  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector<HTMLElement>(".seg [aria-checked='true']")?.focus();
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) close(false);
    };
    // Esc closes wherever the focus is (a toast or the canvas may have taken it)
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  useEffect(() => {
    if (open && !info) api.get<Info>("/api/export").then(setInfo, () => {});
  }, [open]);
  // The single file's size, measured before saving
  const sizeKey = JSON.stringify(body);
  useEffect(() => {
    if (!open || !single) return;
    let live = true;
    setSize(null);
    api.post<{ bytes: number }>("/api/export/estimate", body).then((r) => live && setSize(r.bytes), () => {});
    return () => {
      live = false;
    };
  }, [open, single, sizeKey]);

  const run = async (kind: Kind) => {
    // Not disabled while busy: a disabled button drops the focus out of the popover
    if (busy) return;
    setBusy(kind);
    setErrors((e) => ({ ...e, [kind]: undefined }));
    try {
      const r = await api.post<Result>("/api/export", { ...body, format: kind === "pdf" || kind === "png" ? kind : "web", singleFile: kind === "single" });
      setResults((x) => ({ ...x, [kind]: r }));
      if (kind === "single") setSize(r.bytes);
    } catch (e) {
      setErrors((x) => ({ ...x, [kind]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };
  const reveal = () => api.post("/api/export/reveal", {}).catch((e) => toast({ tone: "error", text: (e as Error).message }));
  const copyDeploy = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      toast({ tone: "ok", text: strings.share.copied(cmd) });
    } catch {
      toast({ tone: "error", text: strings.share.copyFailed });
    }
  };

  const first: Kind = single ? "single" : "web";
  const res = results[first];
  const noBrowser = info && !info.browser.ok ? info.browser.reason ?? "" : null;
  const project = info?.project ?? "";
  const shown = (r: Result) => `${project ? project + "/" : ""}${r.mainRel.endsWith("/") || r.kind === "web" ? r.outRel : r.mainRel}`;
  const name = info?.single ?? `${project}-canvas.html`;

  const resultLine = (r: Result, opts: { deploy?: boolean; hint?: boolean }) => (
    <span className="result" role="status">
      <span className="r-line">
        <Icon name="check" size={14} />
        <code>{r.kind === "single" ? r.mainRel.split("/").pop() : shown(r)}</code> {r.kind === "single" ? strings.share.saved : strings.share.exported}
      </span>
      <span className="r-acts">
        <button className="link" title={strings.share.revealTitle} onClick={() => void reveal()}>
          {strings.share.reveal}
        </button>
        {opts.deploy && r.deploy && (
          <button className="link" title={strings.share.copyDeployTitle(r.deploy)} onClick={() => void copyDeploy(r.deploy!)}>
            {strings.share.copyDeploy}
          </button>
        )}
      </span>
      {opts.hint && <span className="r-hint">{strings.share.attachHint}</span>}
      {r.skipped.length > 0 && (
        <span className="r-hint" title={r.skipped.map((s) => `${s.ref} (${s.from}): ${s.reason}`).join("\n")}>
          {strings.share.skipped(r.skipped.length)}
        </span>
      )}
    </span>
  );
  const row = (kind: "pdf" | "png", icon: IconName, title: string, hint: string) => (
    <div className="out-row">
      <span className="out-ic">
        <Icon name={icon} />
      </span>
      <span className="out-text">
        <strong>{title}</strong>
        <span>{noBrowser ? `${strings.share.unavailable} ${noBrowser}` : hint}</span>
      </span>
      <button disabled={!!noBrowser} aria-busy={busy === kind} onClick={() => void run(kind)}>
        {busy === kind ? strings.share.working : strings.share.export}
      </button>
      {errors[kind] && <span className="out-err" role="alert">{errors[kind]}</span>}
      {results[kind] && !errors[kind] && resultLine(results[kind]!, {})}
    </div>
  );

  return (
    <div className="share-wrap">
      <button ref={btnRef} className={`share-btn ${open ? "on" : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-label={strings.share.button} title={strings.share.buttonTitle} onClick={toggle}>
        <Icon name="share" size={16} /> <span className="share-label">{strings.share.button}</span>
      </button>
      {open && (
        <div
          ref={popRef}
          className="share-pop"
          role="dialog"
          aria-label={strings.share.title}
          style={{ left: pos.left, top: pos.top, width: pos.width }}
          onKeyDown={(e) => {
            // Keys stay in the popover (Space, arrows and Delete mean something on the canvas)
            e.stopPropagation();
          }}
        >
          <h4>{strings.share.title}</h4>
          <div className="seg" role="radiogroup" aria-label={strings.share.scope}>
            <button role="radio" aria-checked={sc === "all"} className={sc === "all" ? "on" : ""} onClick={() => setScope("all")}>
              {strings.share.whole}
            </button>
            <button role="radio" aria-checked={sc === "page"} className={sc === "page" ? "on" : ""} disabled={!pages.length} title={pages.length ? page?.name : strings.share.pageNone} onClick={() => setScope("page")}>
              {strings.share.page}
            </button>
            {selected.length > 0 && (
              <button role="radio" aria-checked={sc === "boards"} className={sc === "boards" ? "on" : ""} onClick={() => setScope("boards")}>
                {strings.share.selected(selected.length)}
              </button>
            )}
          </div>
          <div className="out">
            <div className="out-row first">
              <span className="out-ic">
                <Icon name={single ? "file" : "folder"} />
              </span>
              <span className="out-text">
                <strong>{single ? strings.share.singleTitle : strings.share.webTitle}</strong>
                <span>
                  {single ? (
                    <>
                      <code>{name}</code>
                      {strings.share.singleHint(size == null ? strings.share.measuring : formatBytes(size))}
                    </>
                  ) : (
                    strings.share.webHint
                  )}
                </span>
                <label className="switch-row">
                  <button type="button" role="switch" aria-checked={single} className={`switch ${single ? "on" : ""}`} onClick={() => setSingle((v) => !v)} />
                  <span>{strings.share.singleSwitch}</span>
                </label>
              </span>
              <button className="primary" aria-busy={busy === first} onClick={() => void run(first)}>
                {busy === first ? strings.share.working : single ? strings.share.save : strings.share.export}
              </button>
              {errors[first] && <span className="out-err" role="alert">{errors[first]}</span>}
              {res && !errors[first] && resultLine(res, { deploy: !single, hint: single })}
            </div>
            {row("pdf", "pdf", strings.share.pdfTitle, strings.share.pdfHint)}
            {row("png", "image", strings.share.pngTitle, strings.share.pngHint)}
          </div>
          <div className="pop-foot">
            {single && <span>{strings.share.largeFiles}</span>}
            <span>
              {strings.share.sameAs} <code>{cliLine({ dirFlag: info?.dirFlag, scope: sc, page, pages, boards: selected, single })}</code>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
