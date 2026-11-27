// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Shared UI: toasts, context menus, in-app prompt and confirm dialogs. Supports keyboard (Esc, Enter, arrows) and aria.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { Icon, type IconName } from "./icons";
import { strings } from "./strings";

/* ---------------- Toasts ---------------- */
export type Toast = {
  id: number;
  text: string;
  tone?: "info" | "ok" | "error";
  action?: { label: string; run: () => void };
  /** An ink dot before the text: news, neither a warning nor an action (the new-version notice) */
  dot?: boolean;
  /** A command shown in mono after the text */
  code?: string;
  /** An × at the end; run is called when it is pressed (the toast closes either way) */
  close?: { label: string; run?: () => void };
  /** How long it stays, in ms (default 3.2s, errors 6s) */
  ms?: number;
};
type ToastApi = (t: Omit<Toast, "id">) => void;
const ToastCtx = createContext<ToastApi>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback<ToastApi>((t) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-3), { ...t, id }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.ms ?? (t.tone === "error" ? 6000 : 3200));
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? "info"}`}>
            {t.tone === "error" ? <Icon name="warn" /> : t.tone === "ok" ? <Icon name="check" /> : null}
            {t.dot && <span className="toast-dot" aria-hidden="true" />}
            <span>{t.text}</span>
            {t.code && <code className="toast-code">{t.code}</code>}
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action!.run();
                  setList((l) => l.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
            {t.close && (
              <button
                className="icon-btn oc-ib toast-close"
                aria-label={t.close.label}
                title={t.close.label}
                onClick={() => {
                  t.close!.run?.();
                  setList((l) => l.filter((x) => x.id !== t.id));
                }}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- Context menu ---------------- */
export type MenuItem = { label: string; icon?: IconName; shortcut?: string; disabled?: boolean; danger?: boolean; /** Toggle state shown as a check mark */ check?: boolean; run: () => void } | "sep";
export type MenuState = {
  x: number;
  y: number;
  items: MenuItem[];
  title?: string;
  /** Extra class on the surface (the View menu's rows) */
  className?: string;
  /** A row of controls under the title (the View menu's zoom row in narrow windows) */
  head?: ReactNode;
  /** Measured from the right edge: the menu's right edge stays there (a menu under a button at the window's right) */
  right?: boolean;
  /** y is the menu's bottom edge: it opens upward (menus from the dock) */
  up?: boolean;
} | null;

export function ContextMenu({ menu, onClose, head }: { menu: MenuState; onClose: () => void; /** Live controls under the title (they follow state while the menu is open) */ head?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(-1);
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = menu.right ? menu.x - r.width : menu.x;
    const y = menu.up ? menu.y - r.height : menu.y;
    setPos({ x: Math.round(Math.max(8, Math.min(x, window.innerWidth - r.width - 8))), y: Math.round(Math.max(8, Math.min(y, window.innerHeight - r.height - 8))) });
    setActive(-1);
    ref.current.focus();
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("blur", onClose);
    };
  }, [menu, onClose]);
  if (!menu) return null;
  const items = menu.items;
  const enabled = items.map((it, i) => (it !== "sep" && !it.disabled ? i : -1)).filter((i) => i >= 0);
  return (
    <div
      ref={ref}
      className={`menu entering ${menu.className ?? ""}`}
      role="menu"
      tabIndex={-1}
      aria-label={menu.title ?? strings.dialog.menu}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const k = enabled.indexOf(active);
          const n = e.key === "ArrowDown" ? enabled[(k + 1) % enabled.length] : enabled[(k - 1 + enabled.length) % enabled.length];
          setActive(n);
        } else if (e.key === "Enter" && active >= 0) {
          const it = items[active];
          if (it !== "sep") {
            onClose();
            it.run();
          }
        }
      }}
    >
      {menu.title && <div className="menu-title">{menu.title}</div>}
      {head ?? menu.head}
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            role={it.check === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={it.check === undefined ? undefined : it.check}
            className={`menu-item ${active === i ? "active" : ""} ${it.danger ? "danger" : ""}`}
            disabled={it.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            <span className="menu-icon">{it.icon && <Icon name={it.icon} size={16} />}</span>
            <span className="menu-label">{it.label}</span>
            {it.check !== undefined && <span className={`menu-check ${it.check ? "on" : ""}`} aria-hidden="true"><Icon name="check" size={14} /></span>}
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}

/* ---------------- Prompt and confirm dialogs ---------------- */
export type DialogState =
  | { kind: "prompt"; title: string; label?: string; value: string; hint?: string; ok: string; extra?: { label: string; checked: boolean }; resolve: (v: { value: string; extra: boolean } | null) => void }
  | { kind: "confirm"; title: string; body: string; ok: string; danger?: boolean; resolve: (ok: boolean) => void }
  | null;

export function Dialog({ state, onClose }: { state: DialogState; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [extra, setExtra] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!state) return;
    if (state.kind === "prompt") {
      setValue(state.value);
      setExtra(state.extra?.checked ?? false);
      setTimeout(() => inputRef.current?.select(), 0);
    } else setTimeout(() => okRef.current?.focus(), 0);
  }, [state]);
  if (!state) return null;
  const cancel = () => {
    if (state.kind === "prompt") state.resolve(null);
    else state.resolve(false);
    onClose();
  };
  const ok = () => {
    if (state.kind === "prompt") state.resolve({ value, extra });
    else state.resolve(true);
    onClose();
  };
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && cancel()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={state.title}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
          if (e.key === "Enter" && !e.nativeEvent.isComposing) ok();
        }}
      >
        <h2>{state.title}</h2>
        {state.kind === "prompt" ? (
          <>
            <label className="dialog-field">
              {state.label && <span>{state.label}</span>}
              <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            {state.hint && <p className="muted">{state.hint}</p>}
            {state.extra && (
              <label className="check">
                <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} />
                {state.extra.label}
              </label>
            )}
          </>
        ) : (
          <p>{state.body}</p>
        )}
        <div className="dialog-actions">
          <button onClick={cancel}>{strings.dialog.cancel}</button>
          <button ref={okRef} className={state.kind === "confirm" && state.danger ? "danger primary" : "primary"} onClick={ok}>
            {state.ok}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Promise-based dialogs: const v = await ask.prompt({...}) */
export function useDialog() {
  const [state, setState] = useState<DialogState>(null);
  const prompt = (o: { title: string; label?: string; value?: string; hint?: string; ok?: string; extra?: { label: string; checked: boolean } }) =>
    new Promise<{ value: string; extra: boolean } | null>((resolve) => setState({ kind: "prompt", value: o.value ?? "", ok: o.ok ?? strings.dialog.ok, ...o, resolve }));
  const confirm = (o: { title: string; body: string; ok?: string; danger?: boolean }) => new Promise<boolean>((resolve) => setState({ kind: "confirm", ok: o.ok ?? strings.dialog.ok, ...o, resolve }));
  return { state, close: () => setState(null), prompt, confirm };
}

/* ---------------- Collapsible section (inspector) ---------------- */
const openKey = (id: string) => `design-canvas:open:${id}`;
/** A fold in the inspector, closed by default and remembered per section. `row`: a row of a group (label, count, chevron at the right:
 * Token check, Accessibility); `head` (default): a group of its own whose head is the toggle (chevron, title, count: Layout guides, More (CSS)) */
export function Collapsible({ id, title, count, defaultOpen = false, right, variant = "head", children }: { id: string; title: string; count?: number | string; defaultOpen?: boolean; right?: ReactNode; variant?: "head" | "row"; children: ReactNode }) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(openKey(id));
      return v == null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(openKey(id), o ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !o;
    });
  };
  const shown = count !== undefined && count !== "";
  const badge = shown && <span className={`collapsible-count ${typeof count === "string" ? "oc-off" : ""}`}>{count}</span>;
  if (variant === "row")
    return (
      <div className={`pp-foldset ${open ? "open" : ""}`}>
        <button className="pp-fold" aria-expanded={open} aria-controls={`sec-${id}`} onClick={toggle}>
          <span className="pp-l">{title}</span>
          <span className="pp-v">
            {badge}
            <Icon name="chevronRight" size={14} className="chev" />
          </span>
        </button>
        {open && (
          <div className="pp-fold-body" id={`sec-${id}`}>
            {children}
          </div>
        )}
      </div>
    );
  return (
    <section className={`pp-group collapsible ${open ? "open" : ""}`}>
      <div className="collapsible-head">
        <button className="pp-fold-h" aria-expanded={open} aria-controls={`sec-${id}`} onClick={toggle}>
          <Icon name="chevronRight" size={14} className="chev" />
          <span className="collapsible-title">{title}</span>
          {badge}
        </button>
        {right && <span className="collapsible-right">{right}</span>}
      </div>
      {open && (
        <div className="pp-fold-body" id={`sec-${id}`}>
          {children}
        </div>
      )}
    </section>
  );
}

/** Whole-pixel chrome: text buttons in a row take their width rounded up, so nothing after them starts on a half pixel */
export function snapWidths(root: HTMLElement | null, sel = "button") {
  if (!root) return;
  const els = Array.from(root.querySelectorAll<HTMLElement>(sel));
  // Callers run this after every render, and a pan or zoom renders the app on each wheel event. Unchanged buttons keep their
  // widths: clearing and measuring them forced a layout of the whole page per button, every frame
  const key = `${window.innerWidth}|${document.fonts?.status}|${els.map((b) => `${b.className}\u0001${b.textContent}`).join("\u0002")}`;
  const last = snapped.get(root);
  if (last && last.key === key && last.els.length === els.length && last.els.every((b, i) => b === els[i])) return;
  // Clear all, measure all, then write: one layout for the row, not one per button
  for (const b of els) b.style.width = "";
  const ws = els.map((b) => b.getBoundingClientRect().width);
  els.forEach((b, i) => {
    if (ws[i] % 1 > 0.01) b.style.width = `${Math.ceil(ws[i])}px`;
  });
  // A hidden row measures 0: measure it again once it shows
  if (ws.some((w) => w === 0)) snapped.delete(root);
  else snapped.set(root, { key, els });
}
const snapped = new WeakMap<HTMLElement, { key: string; els: HTMLElement[] }>();

/** Centred on the window on a whole pixel: measured after layout (a CSS translate of -50% can land on a half pixel) */
export function useCentred(ref: RefObject<HTMLElement | null>, winW: number) {
  const [left, setLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    snapWidths(el);
    const x = Math.max(8, Math.round((winW - el.offsetWidth) / 2));
    if (x !== left) setLeft(x);
  });
  return left;
}
