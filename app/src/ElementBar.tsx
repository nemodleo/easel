// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// The small toolbar over a selected element (Text · Fill · Radius · Spacing · Ask AI · Comment) with its popovers, the Fill picker
// (tokens first, then a custom hex) it shares with the Properties panel, and the breadcrumb board › parents › element.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type ReactNode } from "react";

import { designNumber, designSpacing, designWeight, fillProp, hexOf, matchToken, placeBar, stepNumber, stepSpacing, tokenRef, type Box, type TokenColor } from "./directSelect";
import { themeColors, type Tokens } from "./ds";
import { Icon, type IconName } from "./icons";
import type { Selection } from "./types";
import { strings } from "./strings";

type Pop = "text" | "fill" | "radius" | "spacing";
const S = strings.select;
const D = strings.design;

/** Registered token colours only: with no tokens.json there is no palette to offer (same rule as the token check) */
export const tokenColors = (t: Tokens | null): TokenColor[] => (t?.registered ? themeColors(t) : []);

/** Custom properties a board defines on :root / html / body (its own token variables), name → value */
export function boardVars(doc: Document | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!doc?.documentElement) return out; // none yet, or the board is between two loads
  const take = (st: CSSStyleDeclaration) => {
    for (let i = 0; i < st.length; i++) if (st[i].startsWith("--")) out[st[i]] = st.getPropertyValue(st[i]).trim();
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a stylesheet from another origin
    }
    for (const r of Array.from(rules ?? [])) {
      const sr = r as CSSStyleRule;
      if (sr.selectorText && sr.style && /(^|,)\s*(:root|html|body)\s*(,|$)/.test(sr.selectorText)) take(sr.style);
    }
  }
  take(doc.documentElement.style);
  return out;
}

/** Which CSS property a fill writes: the text colour, or the background (the shorthand when the element already uses it) */
export function fillCss(sel: Selection, inline: Record<string, string>) {
  const prop = fillProp(sel.kind, sel.styles["background-color"]);
  if (prop === "color") return { prop, css: "color", value: inline.color || sel.styles.color || "" };
  const css = inline.background != null ? "background" : "background-color";
  return { prop, css, value: inline.background || inline["background-color"] || sel.styles["background-color"] || "" };
}

/** Fill: tokens first (swatches with names), then Custom… with a colour picker and a hex field */
export function FillPicker(p: { title: string; value: string; colors: TokenColor[]; vars: Record<string, string>; onPick: (css: string) => void; autoFocus?: boolean }) {
  const now = matchToken(p.value, p.colors);
  const hex = hexOf(p.value) ?? (now ? hexOf(now.value) : null) ?? "";
  const [text, setText] = useState(hex);
  useEffect(() => setText(hex), [hex]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (p.autoFocus) ref.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, []);
  const commitHex = () => {
    const h = hexOf(text.startsWith("#") ? text : `#${text}`);
    if (h && h !== hex) p.onPick(h);
    else setText(hex);
  };
  return (
    <div className="fill-picker" ref={ref}>
      <div className="pop-top">
        <strong>{p.title}</strong>
        <span className="muted">{now ? S.tokenNow(now.name) : hex || D.none}</span>
      </div>
      {p.colors.length > 0 && (
        <>
          <span className="pop-h">{S.tokens}</span>
          <div className="tok-row" role="group" aria-label={S.tokens}>
            {p.colors.map((c) => (
              <button key={c.name} className={`tok ${now?.name === c.name ? "on" : ""}`} aria-pressed={now?.name === c.name} title={`${c.name} ${hexOf(c.value) ?? c.value}`} onClick={() => p.onPick(tokenRef(c, p.vars))}>
                <i style={{ background: c.value }} />
                <span>{c.name}</span>
              </button>
            ))}
          </div>
          <div className="pop-sep" />
        </>
      )}
      <div className="custom-row">
        <span>{S.custom}</span>
      </div>
      <div className="hex">
        <input type="color" className="sw" aria-label={S.picker} value={(hexOf(text) ?? (hex || "#000000")).toLowerCase()} onChange={(e) => setText(e.target.value.toUpperCase())} onBlur={commitHex} />
        <input
          className="num"
          aria-label={S.hex}
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") commitHex();
          }}
        />
      </div>
    </div>
  );
}

/** − value + with token values first; Enter or blur writes a typed value */
function Stepper(p: { label: string; css: string; value: string; placeholder?: string; chips?: number[]; onStep: (dir: 1 | -1) => void; onCommit: (text: string) => void }) {
  const [v, setV] = useState(p.value);
  useEffect(() => setV(p.value), [p.value]);
  const commit = () => v.trim() !== p.value.trim() && p.onCommit(v.trim());
  return (
    <div className="pop-field">
      <span className="pop-h" title={p.css}>{p.label}</span>
      {p.chips && p.chips.length > 0 && (
        <span className="chips-row">
          {p.chips.map((c) => (
            <button key={c} className={`tchip ${designNumber(p.value || p.placeholder) === String(c) ? "on" : ""}`} onClick={() => p.onCommit(String(c))}>
              {c}
            </button>
          ))}
        </span>
      )}
      <span className="stepper">
        <button className="icon-btn sm" aria-label={S.decrease(p.label)} onClick={() => p.onStep(-1)}>
          <Icon name="minus" size={14} />
        </button>
        <input
          aria-label={p.label}
          title={p.css}
          value={v}
          placeholder={p.placeholder}
          onChange={(e) => setV(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") commit();
          }}
        />
        <button className="icon-btn sm" aria-label={S.increase(p.label)} onClick={() => p.onStep(1)}>
          <Icon name="plus" size={14} />
        </button>
      </span>
    </div>
  );
}

/** px for a typed number; a value with its own unit is written as is */
const px = (t: string) => (/^-?\d+(?:\.\d+)?$/.test(t) ? `${Number(t)}px` : t);

export function ElementBar(p: {
  anchor: Box;
  bounds: { w: number; h: number; top?: number };
  selection: Selection;
  inline: Record<string, string>;
  tokens: Tokens | null;
  vars: Record<string, string>;
  onStyle: (prop: string, value: string) => void;
  onAskAi: () => void;
  onComment: () => void;
}) {
  const s = p.selection;
  const barRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 420, h: 36 });
  const [pop, setPop] = useState<Pop | null>(null);
  const [popAt, setPopAt] = useState<{ x: number; y: number } | null>(null);
  const [focus, setFocus] = useState(0);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  // Optimistic values while the board reloads after each step (each step is its own undo step)
  const [local, setLocal] = useState<Record<string, string>>({});
  useEffect(() => setLocal({}), [s.hash, s.path, s.file]);
  const cur = (prop: string) => local[prop] ?? p.inline[prop] ?? s.styles[prop] ?? "";
  const set = (prop: string, value: string) => {
    setLocal((l) => ({ ...l, [prop]: value }));
    p.onStyle(prop, value);
  };
  useLayoutEffect(() => {
    const el = barRef.current;
    if (el && (Math.abs(el.offsetWidth - size.w) > 0.5 || Math.abs(el.offsetHeight - size.h) > 0.5)) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  });
  const at = placeBar(p.anchor, size, p.bounds);
  // The popover opens on the side away from the element, under (or over) the button that opened it, inside the bounds
  useLayoutEffect(() => {
    if (!pop) return setPopAt(null);
    const el = popRef.current;
    const b = btns.current[ITEMS.findIndex((i) => i.pop === pop)];
    if (!el || !b || !barRef.current) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.max(8, Math.min(at.x + b.offsetLeft, p.bounds.w - w - 8));
    let y = at.below ? at.y + size.h + 6 : at.y - h - 6;
    if (y < 8 || y + h > p.bounds.h - 8) y = at.below ? at.y - h - 6 : at.y + size.h + 6;
    y = Math.max(8, Math.min(y, p.bounds.h - h - 8));
    if (!popAt || Math.abs(popAt.x - x) > 0.5 || Math.abs(popAt.y - y) > 0.5) setPopAt({ x, y });
  });
  // A press anywhere else closes the popover
  useEffect(() => {
    if (!pop) return;
    const close = (e: PointerEvent) => {
      const n = e.target as Node;
      if (popRef.current?.contains(n) || barRef.current?.contains(n)) return;
      setPop(null);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [pop]);

  const colors = tokenColors(p.tokens);
  const hasText = !!s.text.trim();
  const fill = fillCss(s, p.inline);
  const fillNow = local[fill.css] ?? fill.value;
  const fillHex = hexOf(fillNow) ?? hexOf(matchToken(fillNow, colors)?.value) ?? null;
  type Item = { id: string; label: string; icon?: IconName; pop?: Pop; disabled?: boolean; title?: string; cls?: string; run?: () => void };
  const ITEMS: Item[] = [
    { id: "text", label: S.text, icon: "title", pop: "text", disabled: !hasText, title: hasText ? S.text : S.textOff },
    { id: "fill", label: S.fill, pop: "fill", title: `${S.fill} (${fill.css})` },
    { id: "radius", label: S.radius, icon: "radius", pop: "radius", title: `${D.cornerRadius} (border-radius)` },
    { id: "spacing", label: S.spacing, icon: "spacing", pop: "spacing", title: `${D.padding} · ${D.gap}` },
    { id: "ask", label: S.askAi, icon: "comment", cls: "accent", title: S.askAiTitle, run: p.onAskAi },
    { id: "comment", label: S.comment, icon: "comment", title: S.commentTitle, run: p.onComment },
  ];
  const enabled = ITEMS.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
  const tab = enabled.includes(focus) ? focus : enabled[0];
  const toggle = (it: Item) => (it.pop ? setPop((cur) => (cur === it.pop ? null : it.pop!)) : it.run?.());
  const closePop = () => {
    const i = ITEMS.findIndex((x) => x.pop === pop);
    setPop(null);
    btns.current[i]?.focus();
  };
  // Keys inside the toolbar and its popovers stay here (the canvas would otherwise move or delete the element); Esc closes a popover first
  const onKey = (e: RKeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      if (pop) {
        e.preventDefault();
        e.stopPropagation();
        closePop();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey) return;
    if (/^(Arrow|Home$|End$|Enter$| $|Delete$|Backspace$)/.test(e.key)) e.stopPropagation();
  };
  const onBarKey = (e: RKeyboardEvent) => {
    const i = enabled.indexOf(tab);
    const go = (n: number) => {
      e.preventDefault();
      const next = enabled[(n + enabled.length) % enabled.length];
      setFocus(next);
      btns.current[next]?.focus();
    };
    if (e.key === "ArrowRight") go(i + 1);
    else if (e.key === "ArrowLeft") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(enabled.length - 1);
  };

  const sizes = p.tokens?.registered ? p.tokens.fontSizes : [];
  const weights = [...new Set([...(p.tokens?.registered ? p.tokens.fontWeights : []), 400, 500, 600, 700])].sort((a, b) => a - b);
  const radii = p.tokens?.registered ? p.tokens.radii.filter((n) => n < 999) : [];
  const spacing = p.tokens?.registered ? p.tokens.spacing.filter((n) => n <= 64) : [];
  let body: ReactNode = null;
  if (pop === "text")
    body = (
      <>
        <Stepper label={D.size} css="font-size" value={designNumber(cur("font-size"))} chips={sizes} onStep={(d) => set("font-size", `${stepNumber(cur("font-size"), d, 1, 1)}px`)} onCommit={(t) => set("font-size", px(t))} />
        <label className="pop-field">
          <span className="pop-h" title="font-weight">{D.weight}</span>
          <select value={String(Number(cur("font-weight")) || "")} onChange={(e) => set("font-weight", e.target.value)}>
            {weights.map((w) => (
              <option key={w} value={String(w)}>
                {designWeight(w, D.weights)}
              </option>
            ))}
          </select>
        </label>
      </>
    );
  else if (pop === "fill") body = <FillPicker title={S.fill} value={fillNow} colors={colors} vars={p.vars} autoFocus onPick={(css) => set(fill.css, css)} />;
  else if (pop === "radius") body = <Stepper label={D.cornerRadius} css="border-radius" value={designNumber(cur("border-radius"))} chips={radii} onStep={(d) => set("border-radius", `${stepNumber(cur("border-radius"), d)}px`)} onCommit={(t) => set("border-radius", px(t))} />;
  else if (pop === "spacing")
    body = (
      <>
        <Stepper label={D.padding} css="padding" value={designSpacing(cur("padding"))} chips={spacing} onStep={(d) => set("padding", stepSpacing(cur("padding"), d))} onCommit={(t) => set("padding", t.replace(/·/g, " ").trim().split(/\s+/).map(px).join(" "))} />
        <Stepper label={D.gap} css="gap" value={designNumber(cur("gap") === "normal" ? "0px" : cur("gap"))} chips={spacing} onStep={(d) => set("gap", `${stepNumber(cur("gap"), d, 4)}px`)} onCommit={(t) => set("gap", px(t))} />
      </>
    );

  return (
    <>
      <div ref={barRef} className="etb" role="toolbar" aria-label={S.toolbar} aria-orientation="horizontal" style={{ left: at.x, top: at.y }} onKeyDown={(e) => { onKey(e); onBarKey(e); }} onPointerDown={(e) => e.stopPropagation()}>
        {ITEMS.map((it, i) => (
          <span key={it.id} className="etb-item">
            {it.id === "ask" && <span className="sep" aria-hidden="true" />}
            <button
              ref={(el) => void (btns.current[i] = el)}
              className={`${it.cls ?? ""} ${pop && pop === it.pop ? "on" : ""}`}
              tabIndex={i === tab ? 0 : -1}
              disabled={it.disabled}
              title={it.title}
              aria-label={it.id === "fill" ? S.fill : undefined}
              aria-haspopup={it.pop ? "dialog" : undefined}
              aria-expanded={it.pop ? pop === it.pop : undefined}
              onFocus={() => setFocus(i)}
              onClick={() => toggle(it)}
            >
              {it.id === "fill" ? <span className="sw" style={{ background: fillHex ?? "transparent" }} /> : <Icon name={it.icon!} size={14} />}
              {it.id !== "fill" && it.label}
              {(it.id === "text" || it.id === "fill") && <Icon name="chevronDown" size={14} />}
            </button>
          </span>
        ))}
      </div>
      {pop && (
        <div ref={popRef} className="menu pop" role="dialog" aria-label={ITEMS.find((i) => i.pop === pop)?.label} style={popAt ? { left: popAt.x, top: popAt.y } : { visibility: "hidden", left: 0, top: 0 }} onKeyDown={onKey} onPointerDown={(e) => e.stopPropagation()}>
          {body}
        </div>
      )}
    </>
  );
}

/** Onboarding 1 · Welcome › Card › Button "Get started": the board part selects the board, a parent selects that parent */
export function Crumbs(p: { board: string; parents: { path: string; name: string }[]; skipped: boolean; current: string; title?: string; onBoard: () => void; onPath: (path: string) => void }) {
  return (
    <nav className="crumb" aria-label={strings.inspector.crumbs}>
      <button className="link" title={strings.inspector.crumbBoard} onClick={p.onBoard}>
        {p.board}
      </button>
      {p.skipped && (
        <>
          <span aria-hidden="true">›</span>
          <span>…</span>
        </>
      )}
      {p.parents.map((x) => (
        <span key={x.path} className="crumb-step">
          <span aria-hidden="true">›</span>
          <button className="link" title={strings.inspector.crumbParent(x.name)} onClick={() => p.onPath(x.path)}>
            {x.name}
          </button>
        </span>
      ))}
      <span aria-hidden="true">›</span>
      <b aria-current="true" title={p.title}>
        {p.current}
      </b>
    </nav>
  );
}
