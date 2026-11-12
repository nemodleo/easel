// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Properties panel in design words: Fill (with contrast), Text (font, size, weight, colour), Corner radius, Padding, Gap; the CSS name shows
// on hover and focus. Every other property stays under "More (CSS)". Changing a value sends setStyle/setAttr (one undo step each).
import { useEffect, useState, type ReactNode } from "react";

import { contrast, offToken, type Tokens } from "./ds";
import { cssFont, cssSpacing, designFont, designNumber, designSpacing, designWeight, hexOf, matchToken, type TokenColor } from "./directSelect";
import { fillCss, FillPicker, tokenColors } from "./ElementBar";
import type { Selection } from "./types";
import { strings } from "./strings";
import { Collapsible } from "./ui";

const D = strings.design;

/** Everything the panel showed before that has no design word yet: kept under More (CSS) */
const FIELDS: { prop: string; label: string; options?: string[]; color?: boolean }[] = [
  { prop: "width", label: strings.properties.fields.width },
  { prop: "height", label: strings.properties.fields.height },
  { prop: "margin", label: "margin" },
  { prop: "color", label: strings.properties.fields.color, color: true },
  { prop: "background", label: strings.properties.fields.background, color: true },
  { prop: "display", label: "display", options: ["", "block", "flex", "grid", "inline-flex", "none"] },
  { prop: "flex-direction", label: strings.properties.fields.flexDirection, options: ["", "row", "column"] },
  { prop: "align-items", label: strings.properties.fields.alignItems, options: ["", "flex-start", "center", "flex-end", "stretch", "baseline"] },
  { prop: "justify-content", label: strings.properties.fields.justifyContent, options: ["", "flex-start", "center", "flex-end", "space-between"] },
  { prop: "flex-wrap", label: strings.properties.fields.flexWrap, options: ["", "nowrap", "wrap"] },
  { prop: "flex-grow", label: strings.properties.fields.flexGrow, options: ["", "0", "1"] },
  { prop: "align-self", label: strings.properties.fields.alignSelf, options: ["", "auto", "flex-start", "center", "flex-end", "stretch"] },
  { prop: "line-height", label: strings.properties.fields.lineHeight },
  { prop: "text-align", label: strings.properties.fields.textAlign, options: ["", "left", "center", "right"] },
  { prop: "border", label: strings.properties.fields.border },
  { prop: "box-shadow", label: strings.properties.fields.boxShadow },
  { prop: "opacity", label: strings.properties.fields.opacity },
];

/** grid-template-columns/rows → track count. N for repeat(N, …), otherwise the number of tracks */
export function gridCount(v: string | undefined): number | null {
  if (!v || v === "none") return null;
  const m = v.match(/^\s*repeat\(\s*(\d+)\s*,/);
  if (m) return Number(m[1]);
  let depth = 0;
  let n = 0;
  let inTok = false;
  for (const ch of v) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) inTok = false;
    else if (!inTok) {
      inTok = true;
      n++;
    }
  }
  return n || null;
}
export const gridValue = (n: number) => `repeat(${n}, minmax(0, 1fr))`;

const ALIGN = [
  { dir: "left", label: strings.properties.alignButtons.left, glyph: "⇤" },
  { dir: "hcenter", label: strings.properties.alignButtons.hcenter, glyph: "↔" },
  { dir: "right", label: strings.properties.alignButtons.right, glyph: "⇥" },
  { dir: "top", label: strings.properties.alignButtons.top, glyph: "⤒" },
  { dir: "vcenter", label: strings.properties.alignButtons.vcenter, glyph: "↕" },
  { dir: "bottom", label: strings.properties.alignButtons.bottom, glyph: "⤓" },
] as const;
export type AlignDir = (typeof ALIGN)[number]["dir"];

const ATTRS: Record<string, string[]> = { a: ["href"], img: ["src", "alt"], input: ["placeholder"], button: ["aria-label"] };

export function Properties(props: {
  selection: Selection;
  inline: Record<string, string>;
  attrs: Record<string, string>;
  onStyle: (prop: string, value: string) => void;
  onAttr: (name: string, value: string | null) => void;
  onWrap: (display: "flex" | "grid") => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canWrap: boolean;
  onAlign: (dir: AlignDir) => void;
  onReplaceImage: (() => void) | null;
  tokens: Tokens | null;
  /** Actual background color behind the element, for text contrast */
  bg: string;
  /** Custom properties the board defines (a token is written as its variable) */
  vars: Record<string, string>;
}) {
  const s = props.selection;
  const attrNames = ATTRS[s.tag] ?? [];
  const colors = tokenColors(props.tokens);
  const fill = fillCss(s, props.inline);
  const hasText = !!s.text.trim();
  const [open, setOpen] = useState<"fill" | "color" | null>(null);
  useEffect(() => setOpen(null), [s.file, s.path]);
  const k = s.path + s.hash;
  const warn = (prop: string) => offToken(prop, props.inline[prop] ?? "", props.tokens);
  // Contrast under Fill: the text on this fill, or this text colour on what is behind it
  const word = (c: string) => {
    const h = hexOf(c);
    return h === "#FFFFFF" ? D.white : h === "#000000" ? D.black : (matchToken(c, colors)?.name ?? h ?? c);
  };
  const ownBg = hexOf(s.styles["background-color"]);
  const ratio = hasText ? (fill.prop === "background" ? contrast(s.styles.color ?? "", ownBg ?? props.bg) : contrast(s.styles.color ?? "", props.bg)) : null;
  const contrastLine =
    ratio == null ? null : fill.prop === "background" ? D.contrastWith(ratio.toFixed(1), word(s.styles.color ?? ""), D.grade(ratio)) : D.contrastOn(ratio.toFixed(1), word(props.bg), D.grade(ratio));
  const weights = [...new Set([...(props.tokens?.registered ? props.tokens.fontWeights : []), 100, 200, 300, 400, 500, 600, 700, 800, 900])].sort((a, b) => a - b);
  return (
    <section className="props">
      <h3>{strings.properties.title}</h3>
      <div className="pg">
        <div className="pg-h prow-h" title={fill.css}>
          {D.fill} <code>{fill.css}</code>
        </div>
        <Swatch value={fill.value} computed={fill.prop === "color" ? s.styles.color : s.styles["background-color"]} colors={colors} css={fill.css} label={D.fill} open={open === "fill"} onToggle={() => setOpen((o) => (o === "fill" ? null : "fill"))} />
        {open === "fill" && <FillPicker title={D.fill} value={fill.value} colors={colors} vars={props.vars} onPick={(css) => props.onStyle(fill.css, css)} />}
        {contrastLine && (
          <div className={`contrast ${ratio! >= 4.5 ? "ok" : ratio! >= 3 ? "mid" : "bad"}`} title={strings.properties.contrastTitle}>
            {contrastLine}
          </div>
        )}
      </div>
      {hasText && (
        <div className="pg">
          <div className="pg-h">{D.text}</div>
          <Row word={D.font} css="font-family">
            <DesignInput key={"ff" + k} label={D.font} value={designFont(props.inline["font-family"])} placeholder={designFont(s.styles["font-family"])} onCommit={(t) => props.onStyle("font-family", t ? cssFont(t) : "")} />
          </Row>
          <Row word={D.size} css="font-size" warn={warn("font-size")}>
            <DesignInput key={"fs" + k} label={D.size} value={designNumber(props.inline["font-size"])} placeholder={designNumber(s.styles["font-size"])} onCommit={(t) => props.onStyle("font-size", pxOf(t))} />
          </Row>
          <Row word={D.weight} css="font-weight" warn={warn("font-weight")}>
            <select key={"fw" + k} aria-label={D.weight} defaultValue={props.inline["font-weight"] ?? ""} onChange={(e) => props.onStyle("font-weight", e.target.value)}>
              <option value="">{D.inherited(designWeight(s.styles["font-weight"], D.weights))}</option>
              {weights.map((w) => (
                <option key={w} value={String(w)}>
                  {designWeight(w, D.weights)}
                </option>
              ))}
            </select>
          </Row>
          {fill.prop === "background" && (
            <>
              <Row word={D.color} css="color">
                <Swatch value={props.inline.color ?? ""} computed={s.styles.color} colors={colors} css="color" label={D.color} open={open === "color"} onToggle={() => setOpen((o) => (o === "color" ? null : "color"))} />
              </Row>
              {open === "color" && <FillPicker title={D.color} value={props.inline.color || s.styles.color || ""} colors={colors} vars={props.vars} onPick={(css) => props.onStyle("color", css)} />}
            </>
          )}
        </div>
      )}
      <div className="pg">
        <Row word={D.cornerRadius} css="border-radius" heading warn={warn("border-radius")}>
          <DesignInput key={"br" + k} label={D.cornerRadius} value={designNumber(props.inline["border-radius"])} placeholder={designNumber(s.styles["border-radius"])} onCommit={(t) => props.onStyle("border-radius", pxOf(t))} />
        </Row>
        <Row word={D.padding} css="padding" heading warn={warn("padding")}>
          <DesignInput key={"pd" + k} label={D.padding} value={designSpacing(props.inline.padding)} placeholder={designSpacing(s.styles.padding)} onCommit={(t) => props.onStyle("padding", cssSpacing(t))} />
        </Row>
        <Row word={D.gap} css="gap" heading warn={warn("gap")}>
          <DesignInput key={"gp" + k} label={D.gap} value={designNumber(props.inline.gap)} placeholder={designNumber(s.styles.gap === "normal" ? "" : s.styles.gap)} onCommit={(t) => props.onStyle("gap", pxOf(t))} />
        </Row>
      </div>
      <div className="align-row" role="group" aria-label={strings.properties.align}>
        {ALIGN.map((a) => (
          <button key={a.dir} className="icon-btn sm" aria-label={a.label} title={a.label} onClick={() => props.onAlign(a.dir)}>
            <span className="glyph">{a.glyph}</span>
          </button>
        ))}
      </div>
      {props.onReplaceImage && (
        <button onClick={props.onReplaceImage}>
          {strings.properties.replaceImage}
        </button>
      )}
      <div className="row">
        <button onClick={() => props.onWrap("flex")} disabled={!props.canWrap} title={strings.properties.wrapTitle}>
          {strings.properties.wrapFlex}
        </button>
        <button onClick={() => props.onWrap("grid")} disabled={!props.canWrap}>
          {strings.properties.wrapGrid}
        </button>
      </div>
      <div className="row">
        <button onClick={props.onDuplicate}>{strings.properties.duplicate}</button>
        <button onClick={props.onDelete}>{strings.properties.delete}</button>
      </div>
      <Collapsible id="more-css" title={D.more}>
        <div className="more-css">
          {FIELDS.map((f) => (
            <Field
              key={f.prop + k}
              label={f.label}
              value={props.inline[f.prop] ?? (f.prop === "background" ? props.inline["background-color"] ?? "" : "")}
              placeholder={s.styles[f.prop === "background" ? "background-color" : f.prop] ?? ""}
              options={f.options}
              color={f.color}
              swatches={f.color ? colors : undefined}
              warn={offToken(f.prop, props.inline[f.prop] ?? (f.prop === "background" ? props.inline["background-color"] ?? "" : ""), props.tokens)}
              ratio={f.prop === "color" ? contrast(props.inline.color || s.styles.color || "", props.bg) : null}
              onCommit={(v) => props.onStyle(f.prop, v)}
            />
          ))}
          {(props.inline.display ?? s.styles.display ?? "").includes("grid") &&
            (["grid-template-columns", "grid-template-rows"] as const).map((prop) => (
              <Field
                key={prop + k}
                label={prop.endsWith("columns") ? strings.properties.columns : strings.properties.rows}
                value={String(gridCount(props.inline[prop]) ?? "")}
                placeholder={String(gridCount(s.styles[prop]) ?? "")}
                onCommit={(v) => props.onStyle(prop, /^\d+$/.test(v) && Number(v) > 0 ? gridValue(Math.min(24, Number(v))) : v)}
              />
            ))}
          {attrNames.map((n) => (
            <Field key={n + k} label={n} value={props.attrs[n] ?? ""} placeholder="" onCommit={(v) => props.onAttr(n, v === "" ? null : v)} />
          ))}
        </div>
      </Collapsible>
    </section>
  );
}

/** A typed number is px; anything with its own unit (or empty, which removes the value) is written as is */
const pxOf = (t: string) => (/^-?\d+(?:\.\d+)?$/.test(t.trim()) ? `${Number(t)}px` : t.trim());

/** One row: the design word, with the CSS name beside it on hover and on keyboard focus (title for the pointer too) */
function Row(p: { word: string; css: string; heading?: boolean; warn?: string | null; children: ReactNode }) {
  return (
    <label className="prow" title={p.css}>
      <span className={p.heading ? "pg-h" : ""}>
        {p.word} <code>{p.css}</code>
        {p.warn && (
          <span className="tok-warn" title={p.warn} aria-label={strings.properties.offToken(p.warn)}>
            ⚠
          </span>
        )}
      </span>
      {p.children}
    </label>
  );
}

/** A value in design form (15, 12 · 16, System UI); the computed value shows as the placeholder. Enter or blur writes it, Esc puts it back */
function DesignInput(p: { label: string; value: string; placeholder: string; onCommit: (text: string) => void }) {
  const [v, setV] = useState(p.value);
  useEffect(() => setV(p.value), [p.value]);
  const commit = () => v.trim() !== p.value.trim() && p.onCommit(v.trim());
  return (
    <input
      className="num"
      aria-label={p.label}
      value={v}
      placeholder={p.placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(p.value);
          e.stopPropagation();
        }
      }}
    />
  );
}

/** The colour as a swatch with its token name ("Blue  #2B59C3"); opens the Fill picker below */
function Swatch(p: { value: string; computed?: string; colors: TokenColor[]; css: string; label: string; open: boolean; onToggle: () => void }) {
  const shown = p.value || p.computed || "";
  const tok = matchToken(shown, p.colors);
  const hex = hexOf(shown) ?? hexOf(p.computed) ?? (tok ? hexOf(tok.value) : null);
  return (
    <button className={`fillv ${p.open ? "on" : ""}`} aria-expanded={p.open} aria-label={D.openFill(p.label)} title={p.css} onClick={(e) => { e.preventDefault(); p.onToggle(); }}>
      <span className="sw" style={{ background: hex ?? "transparent" }} />
      <span className="fillv-name">{tok?.name ?? hex ?? D.none}</span>
      {tok && hex && <span className="muted">{hex}</span>}
    </button>
  );
}

function Field(p: {
  label: string;
  value: string;
  placeholder: string;
  options?: string[];
  color?: boolean;
  swatches?: { name: string; value: string }[];
  chips?: string[];
  warn?: string | null;
  ratio?: number | null;
  onCommit: (v: string) => void;
}) {
  const [v, setV] = useState(p.value);
  useEffect(() => setV(p.value), [p.value]);
  const commit = (next = v) => {
    if (next.trim() !== p.value.trim()) p.onCommit(next.trim());
  };
  return (
    <label className="field">
      <span>
        {p.label}
        {p.warn && (
          <span className="tok-warn" title={p.warn} aria-label={strings.properties.offToken(p.warn)}>
            {" "}⚠
          </span>
        )}
      </span>
      {p.options ? (
        <select
          value={v}
          onChange={(e) => {
            setV(e.target.value);
            commit(e.target.value);
          }}
        >
          {p.options.map((o) => (
            <option key={o} value={o}>
              {o || `(${p.placeholder || strings.properties.none})`}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={v}
          placeholder={p.placeholder}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setV(p.value);
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
      )}
      {p.ratio != null && (
        <span className={`ratio ${p.ratio >= 4.5 ? "ok" : p.ratio >= 3 ? "mid" : "bad"}`} title={strings.properties.contrastTitle}>
          {strings.properties.contrast} {p.ratio.toFixed(2)}:1 · {p.ratio >= 7 ? "AAA" : p.ratio >= 4.5 ? "AA" : p.ratio >= 3 ? strings.properties.largeTextOnly : strings.properties.tooLow}
        </span>
      )}
      {p.chips && (
        <span className="chips-row">
          {p.chips.map((c) => (
            <button
              key={c}
              className={`tchip ${v === c ? "on" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                setV(c);
                commit(c);
              }}
            >
              {c.replace("px", "")}
            </button>
          ))}
        </span>
      )}
      {p.color && (
        <span className="swatches">
          {(p.swatches ?? []).map((c) => (
            <button
              key={c.value}
              className={`swatch ${v.toUpperCase() === c.value ? "on" : ""}`}
              title={`${c.name} ${c.value}`}
              style={{ background: c.value }}
              onClick={(e) => {
                e.preventDefault();
                setV(c.value);
                commit(c.value);
              }}
            />
          ))}
        </span>
      )}
    </label>
  );
}
