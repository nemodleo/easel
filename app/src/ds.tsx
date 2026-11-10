// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Design system: token registration and themes, off-token checks, accessibility checks (touch targets, contrast, labels), board tweaks.
import { useEffect, useState } from "react";

import { api } from "./api";
import { pathOf } from "./editor";
import { Icon } from "./icons";
import { strings } from "./strings";

export type Tokens = {
  version: 1;
  active: string;
  themes: Record<string, Record<string, string>>;
  fontSizes: number[];
  fontWeights: number[];
  radii: number[];
  spacing: number[];
  fontFamily: string;
  minTarget: number;
  registered?: boolean;
};
export type LintItem = { line: number; path?: string; prop: string; value: string; message: string };

export function useTokens(version: number) {
  const [t, setT] = useState<Tokens | null>(null);
  useEffect(() => {
    api.get<Tokens>("/api/tokens").then(setT).catch(() => {});
  }, [version]);
  return t;
}
export const themeColors = (t: Tokens | null) => Object.entries(t?.themes[t.active] ?? {}).map(([name, value]) => ({ name, value }));

/* ---------- Color and contrast ---------- */
export function parseColor(c: string): [number, number, number, number] | null {
  const s = c.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((x) => x + x).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\s*\)$/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 1 : Number(m[4])];
  if (s === "transparent") return [0, 0, 0, 0];
  return null;
}
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export function contrast(fg: string, bg: string) {
  const a = parseColor(fg);
  const b = parseColor(bg);
  if (!a || !b) return null;
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
export const toHex = (c: string) => {
  const p = parseColor(c);
  return p && p[3] === 1 ? "#" + p.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, "0")).join("").toUpperCase() : null;
};

/** Whether a single property value is off tokens (⚠ in the Properties panel) */
export function offToken(prop: string, value: string, t: Tokens | null): string | null {
  if (!t?.registered || !value) return null; // no tokens.json: checks are off
  const colors = new Set(themeColors(t).map((c) => toHex(c.value)));
  if (/^(color|background|background-color|border-color)$/.test(prop)) {
    const hex = toHex(value);
    if (hex && !colors.has(hex)) return strings.checks.colorNotInTokens;
  }
  const px = [...value.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  if (prop === "font-size" && px.some((n) => !t.fontSizes.includes(n))) return strings.checks.tokenFontSizes(t.fontSizes.join("·"));
  if (prop === "border-radius" && px.some((n) => !t.radii.includes(n) && n < 999)) return strings.checks.tokenRadii(t.radii.join("·"));
  if (/^(gap|padding|margin)/.test(prop) && px.some((n) => n % 4 !== 0)) return strings.checks.notMultipleOf4;
  if (prop === "font-weight" && /^\d+$/.test(value) && !t.fontWeights.includes(Number(value))) return strings.checks.tokenWeights(t.fontWeights.join("·"));
  return null;
}

/* ---------- Accessibility checks (iframe document) ---------- */
export type A11yItem = { path: string; kind: "target" | "contrast" | "label"; message: string };
export function checkA11y(doc: Document, minTarget = 48): A11yItem[] {
  const win = doc.defaultView!;
  const out: A11yItem[] = [];
  const bgOf = (el: Element | null): string => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = win.getComputedStyle(n);
      const c = parseColor(cs.backgroundColor);
      if (cs.backgroundImage !== "none") return "";
      if (c && c[3] > 0.5) return cs.backgroundColor;
    }
    return "rgb(255,255,255)";
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = win.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const interactive = doc.body.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [onclick]");
  for (const el of Array.from(interactive)) {
    if (!visible(el)) continue;
    const p = pathOf(el);
    if (p == null) continue;
    const r = el.getBoundingClientRect();
    if (r.width < minTarget && r.height < minTarget) out.push({ path: p, kind: "target", message: strings.checks.smallTarget(el.tagName.toLowerCase(), Math.round(r.width), Math.round(r.height), minTarget) });
    const name = (el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || (el as HTMLElement).innerText || el.querySelector("img[alt]")?.getAttribute("alt") || "").trim();
    const labelled = el.getAttribute("aria-labelledby") || (el.id && doc.querySelector(`label[for="${el.id}"]`)) || el.closest("label");
    if (!name && !labelled) out.push({ path: p, kind: "label", message: strings.checks.noName(el.tagName.toLowerCase()) });
  }
  for (const img of Array.from(doc.body.querySelectorAll("img"))) {
    if (!img.hasAttribute("alt") && visible(img)) {
      const p = pathOf(img);
      if (p != null) out.push({ path: p, kind: "label", message: strings.checks.noAlt });
    }
  }
  // Text contrast: elements that directly contain text
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const el = t.parentElement;
    if (!el || seen.has(el) || !t.textContent?.trim() || /^(SCRIPT|STYLE)$/.test(el.tagName) || !visible(el)) continue;
    seen.add(el);
    const cs = win.getComputedStyle(el);
    const bg = bgOf(el);
    if (!bg) continue; // Skip text over images
    const ratio = contrast(cs.color, bg);
    if (ratio == null) continue;
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      const p = pathOf(el);
      if (p != null) out.push({ path: p, kind: "contrast", message: strings.checks.lowContrast(ratio.toFixed(2), need, t.textContent.trim().slice(0, 16)) });
    }
  }
  return out;
}

/* ---------- Left 'Tokens' tab: registration and themes ---------- */
export function TokenPanel({ tokens, onSave }: { tokens: Tokens; onSave: (t: Tokens, label: string) => void }) {
  const [t, setT] = useState(tokens);
  useEffect(() => setT(tokens), [tokens]);
  const colors = t.themes[t.active] ?? {};
  const dirty = JSON.stringify(t) !== JSON.stringify(tokens) || !tokens.registered;
  const setColors = (c: Record<string, string>) => setT({ ...t, themes: { ...t.themes, [t.active]: c } });
  const list = (k: "fontSizes" | "radii" | "spacing" | "fontWeights", label: string) => (
    <label className="field-row tok-list">
      <span>{label}</span>
      <input defaultValue={t[k].join(", ")} key={t[k].join()} aria-label={label} onBlur={(e) => setT({ ...t, [k]: e.target.value.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n)) })} />
    </label>
  );
  return (
    <div className="tokens">
      <label className="upload small">
        <Icon name="plus" size={14} /> {strings.tokens.import}
        <input
          type="file"
          hidden
          accept=".json,application/json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              setT(importTokens(JSON.parse(await f.text()), t));
            } catch (err) {
              alert(strings.tokens.importFailed((err as Error).message));
            }
          }}
        />
      </label>
      <div className="sec-head">
        <span>{strings.tokens.theme}</span>
        <button
          className="icon-btn sm"
          aria-label={strings.tokens.addTheme}
          title={strings.tokens.addTheme}
          onClick={() => {
            let name: string = strings.tokens.newTheme;
            for (let i = 2; t.themes[name]; i++) name = strings.tokens.newThemeN(i);
            setT({ ...t, themes: { ...t.themes, [name]: { ...colors } }, active: name });
          }}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="theme-row">
        <select value={t.active} onChange={(e) => setT({ ...t, active: e.target.value })} aria-label={strings.tokens.activeTheme}>
          {Object.keys(t.themes).map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <input
          key={t.active}
          defaultValue={t.active}
          aria-label={strings.tokens.themeName}
          onBlur={(e) => {
            const n = e.target.value.trim();
            if (!n || n === t.active || t.themes[n]) return;
            const { [t.active]: cur, ...rest } = t.themes;
            setT({ ...t, themes: { ...rest, [n]: cur }, active: n });
          }}
        />
      </div>
      <div className="sec-head">
        <span>{strings.tokens.colors(Object.keys(colors).length)}</span>
        <button className="icon-btn sm" aria-label={strings.tokens.addColor} title={strings.tokens.addColor} onClick={() => setColors({ ...colors, [strings.tokens.colorN(Object.keys(colors).length + 1)]: "#111111" })}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <ul className="tok-colors">
        {Object.entries(colors).map(([name, value]) => (
          <li key={name}>
            <input type="color" value={toHex(value)?.toLowerCase() ?? "#000000"} aria-label={strings.tokens.colorOf(name)} onChange={(e) => setColors({ ...colors, [name]: e.target.value.toUpperCase() })} />
            <input
              defaultValue={name}
              aria-label={strings.tokens.colorName}
              onBlur={(e) => {
                const n = e.target.value.trim();
                if (!n || n === name || colors[n]) return;
                setColors(Object.fromEntries(Object.entries(colors).map(([k, v]) => (k === name ? [n, v] : [k, v]))));
              }}
            />
            <code>{value}</code>
            <button className="icon-btn sm danger" aria-label={strings.tokens.remove(name)} onClick={() => setColors(Object.fromEntries(Object.entries(colors).filter(([k]) => k !== name)))}>
              <Icon name="close" size={12} />
            </button>
          </li>
        ))}
      </ul>
      {list("fontSizes", strings.tokens.fontSizes)}
      {list("fontWeights", strings.tokens.fontWeights)}
      {list("radii", strings.tokens.radii)}
      {list("spacing", strings.tokens.spacing)}
      <label className="field-row tok-list">
        <span>{strings.tokens.touchTarget}</span>
        <input type="number" value={t.minTarget} onChange={(e) => setT({ ...t, minTarget: Number(e.target.value) || 48 })} aria-label={strings.tokens.minTouchTarget} />
      </label>
      <button disabled={!dirty} title={strings.tokens.saveTitle} onClick={() => onSave(t, tokens.registered ? strings.history.saveTokens : strings.history.registerTokens)}>
        {tokens.registered ? strings.tokens.save : strings.tokens.register}
      </button>
      <p className="muted small">
        {tokens.registered ? strings.tokens.registeredHint : strings.tokens.defaultHint}
      </p>
    </div>
  );
}

/** Import: our tokens.json format, or simple variable JSON like {name: "#hex"} or {color:{name:{value}}} */
export function importTokens(j: unknown, base: Tokens): Tokens {
  const o = j as Record<string, unknown>;
  if (o && typeof o === "object" && o.themes && typeof o.themes === "object") return { ...base, ...(o as Partial<Tokens>), active: (o.active as string) ?? Object.keys(o.themes as object)[0] } as Tokens;
  const colors: Record<string, string> = {};
  const walk = (x: unknown, name: string) => {
    if (typeof x === "string" && /^#|^rgb/i.test(x)) colors[name] = x.toUpperCase();
    else if (x && typeof x === "object") {
      const v = (x as Record<string, unknown>).value ?? (x as Record<string, unknown>).$value;
      if (typeof v === "string") walk(v, name);
      else for (const [k, c] of Object.entries(x)) walk(c, name ? `${name} ${k}` : k);
    }
  };
  walk(j, "");
  if (!Object.keys(colors).length) throw new Error(strings.tokens.noColors);
  return { ...base, themes: { ...base.themes, [strings.tokens.importedTheme]: colors }, active: strings.tokens.importedTheme };
}

/* ---------- Right: check results (tokens, accessibility) ---------- */
export function CheckList({ title, items, empty, onPick, onAskAI }: { title: string; items: { path?: string; message: string; line?: number }[] | null; empty: string; onPick: (path: string) => void; onAskAI?: () => void }) {
  return (
    <section className="board-opts" aria-label={title}>
      <div className="sec-head">
        <span>
          {title} {items ? items.length : ""}
        </span>
        {onAskAI && items && items.length > 0 && (
          <button className="link" onClick={onAskAI}>
            {strings.checks.askFix}
          </button>
        )}
      </div>
      {items == null ? (
        <p className="muted small">{strings.checks.notVisible}</p>
      ) : items.length === 0 ? (
        <p className="ok-line">
          <Icon name="check" size={14} /> {empty}
        </p>
      ) : (
        <ul className="check-list">
          {items.slice(0, 30).map((it, i) => (
            <li key={i}>
              <button className="check-item" disabled={!it.path} onClick={() => it.path && onPick(it.path)} title={it.path ? strings.checks.pickInEdit(it.path) : strings.checks.line(it.line)}>
                <Icon name="warn" size={12} />
                <span>{it.message}</span>
                <code>{it.path ?? strings.checks.line(it.line)}</code>
              </button>
            </li>
          ))}
          {items.length > 30 && <li className="muted small">{strings.checks.more(items.length - 30)}</li>}
        </ul>
      )}
    </section>
  );
}

/** Token check when no tokens.json exists: says the checks are off and leads to the Tokens tab */
export function TokenCheckOff({ onSetUp }: { onSetUp: () => void }) {
  return (
    <section className="board-opts" aria-label={strings.checks.tokensOffTitle}>
      <div className="tc-off">
        <Icon name="info" size={14} />
        <div>
          <strong>{strings.checks.tokensOffTitle}</strong>
          <p className="muted small">{strings.checks.tokensOffBody}</p>
        </div>
      </div>
      <button onClick={onSetUp}>{strings.checks.setUpTokens}</button>
    </section>
  );
}

/* ---------- Tweaks: <script type="application/json" id="board-tweaks"> ---------- */
export type Tweak = { type: "color" | "number" | "boolean" | "enum"; value: string | number | boolean; var?: string; label?: string; min?: number; max?: number; step?: number; unit?: string; options?: string[] };
export function readTweaks(doc: Document | null | undefined): Record<string, Tweak> | null {
  const el = doc?.getElementById("board-tweaks");
  if (!el) return null;
  try {
    return JSON.parse(el.textContent ?? "");
  } catch {
    return null;
  }
}
export function applyTweak(doc: Document, key: string, t: Tweak) {
  const v = t.type === "boolean" ? (t.value ? "1" : "0") : String(t.value) + (t.type === "number" && t.unit ? t.unit : "");
  if (t.var) doc.documentElement.style.setProperty(t.var, v);
  doc.documentElement.setAttribute(`data-tweak-${key}`, t.type === "boolean" ? (t.value ? "on" : "off") : String(t.value));
}
export function TweaksPanel({ doc, onSave }: { doc: Document | null; onSave: (values: Record<string, Tweak["value"]>) => Promise<void> }) {
  const [tw, setTw] = useState<Record<string, Tweak> | null>(() => readTweaks(doc));
  const [orig, setOrig] = useState<string>(() => JSON.stringify(readTweaks(doc)));
  useEffect(() => {
    const t = readTweaks(doc);
    setTw(t);
    setOrig(JSON.stringify(t));
  }, [doc]);
  if (!tw) return null;
  const set = (k: string, value: Tweak["value"]) => {
    const next = { ...tw, [k]: { ...tw[k], value } };
    setTw(next);
    if (doc) applyTweak(doc, k, next[k]);
  };
  const dirty = JSON.stringify(tw) !== orig;
  return (
    <section className="board-opts" aria-label="Tweaks">
      <div className="sec-head">
        <span>Tweaks</span>
      </div>
      {Object.entries(tw).map(([k, t]) => (
        <label key={k} className={t.type === "boolean" ? "check" : "field-row"}>
          {t.type === "boolean" ? (
            <>
              <input type="checkbox" checked={!!t.value} onChange={(e) => set(k, e.target.checked)} />
              {t.label ?? k}
            </>
          ) : (
            <>
              <span>{t.label ?? k}</span>
              {t.type === "color" ? (
                <input type="color" value={String(t.value)} onChange={(e) => set(k, e.target.value.toUpperCase())} aria-label={t.label ?? k} />
              ) : t.type === "enum" ? (
                <select value={String(t.value)} onChange={(e) => set(k, e.target.value)} aria-label={t.label ?? k}>
                  {(t.options ?? []).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <span className="tw-num">
                  <input type="range" min={t.min ?? 0} max={t.max ?? 100} step={t.step ?? 1} value={Number(t.value)} onChange={(e) => set(k, Number(e.target.value))} aria-label={t.label ?? k} />
                  <code>
                    {String(t.value)}
                    {t.unit ?? ""}
                  </code>
                </span>
              )}
            </>
          )}
        </label>
      ))}
      <div className="btn-row">
        <button
          disabled={!dirty}
          onClick={() => {
            const o = JSON.parse(orig) as Record<string, Tweak>;
            setTw(o);
            if (doc) for (const [k, t] of Object.entries(o)) applyTweak(doc, k, t);
          }}
        >
          {strings.tweaks.revert}
        </button>
        <button className="primary" disabled={!dirty} onClick={() => void onSave(Object.fromEntries(Object.entries(tw).map(([k, t]) => [k, t.value]))).then(() => setOrig(JSON.stringify(tw)))}>
          {strings.tweaks.save}
        </button>
      </div>
      <p className="muted small">{strings.tweaks.hint}</p>
    </section>
  );
}
