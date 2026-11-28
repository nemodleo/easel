// AI-generated with Claude Code, 2026-11-27
// The canvas view (pan and zoom) in a small store instead of React state at the top of the app: a wheel step re-renders only
// what subscribes to it (the canvas, the minimap, the zoom row), not the whole app with its panels.
import { useRef, useSyncExternalStore } from "react";

import type { View } from "./types";

export type ViewStore = {
  get: () => View;
  set: (v: View | ((v: View) => View)) => void;
  subscribe: (fn: () => void) => () => void;
};

export function createViewStore(initial: View): ViewStore {
  let view = initial;
  const subs = new Set<() => void>();
  return {
    get: () => view,
    set(v) {
      const next = typeof v === "function" ? v(view) : v;
      if (next === view || (next.x === view.x && next.y === view.y && next.zoom === view.zoom)) return;
      view = next;
      for (const fn of [...subs]) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** One store for the component's lifetime */
export function useViewStore(initial: View): ViewStore {
  const ref = useRef<ViewStore | null>(null);
  if (!ref.current) ref.current = createViewStore(initial);
  return ref.current;
}

/** The whole view: the component re-renders on every pan and zoom step */
export function useView(store: ViewStore): View {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** A value derived from the view (a primitive, or null): the component re-renders only when it changes */
export function useViewValue<T extends string | number | boolean | null>(store: ViewStore, pick: (v: View) => T): T {
  const get = () => pick(store.get());
  return useSyncExternalStore(store.subscribe, get, get);
}

/** The whole view while `on`, else null: the component follows the view only while it needs to */
export function useViewWhen(store: ViewStore, on: boolean): View | null {
  const get = () => (on ? store.get() : null);
  return useSyncExternalStore(store.subscribe, get, get);
}
