// AI-generated with Claude Code, 2026-11-27
// The app's own edits shown in place: when /api/edit returns a proven patch (server/livePatch.mjs) and the board shows exactly the
// version the edit started from, the patch goes into the live board and the watcher's echo of that write does not reload it.
// Which version a board shows: the content hash the server wrote into the page it served (data-dc-src on the probe script), moved on
// by each patch applied here. Every decision compares content hashes; nothing depends on timing.
import { elementAt } from "./editor";

export type LivePatch = { path: string; tag: string; attrs?: [string, string | null][]; inner?: string }[];
/** What /api/edit answers: base and hash are the file's content hashes before and after the edit */
export type EditResult = { changed?: boolean; base?: string; hash?: string; live?: LivePatch; forked?: boolean };

const probeOf = (doc: Document | null | undefined) => doc?.querySelector<HTMLScriptElement>("script[data-dc-probe]") ?? null;

/** The document of a board frame when it shows that board's own page, fully loaded (not mid-reload, not navigated away in Play) */
function boardDoc(frame: HTMLIFrameElement | null | undefined, file: string): Document | null {
  const doc = frame?.isConnected ? frame.contentDocument : null;
  if (!doc || doc.readyState !== "complete" || !doc.body) return null;
  try {
    if (decodeURIComponent(doc.location.pathname) !== `/screens/${file}`) return null;
  } catch {
    return null;
  }
  return doc;
}

/** The content hash of the version a board shows, or null when unknown (or its DOM was changed by something else, e.g. a tweak preview) */
export function shownHash(frame: HTMLIFrameElement | null | undefined, file: string): string | null {
  const p = probeOf(boardDoc(frame, file));
  if (!p || p.hasAttribute("data-dc-dirty")) return null;
  return p.getAttribute("data-dc-src");
}
/** Whether the board's DOM was patched in place since it loaded */
export const isPatched = (frame: HTMLIFrameElement | null | undefined, file: string) => !!probeOf(boardDoc(frame, file))?.hasAttribute("data-dc-patched");
/** The app changed the board's DOM without a matching file (a tweak preview): its shown version is unknown until it reloads */
export const markDirty = (doc: Document) => probeOf(doc)?.setAttribute("data-dc-dirty", "");

/** Puts an edit's patch into the live board when the board shows exactly the edit's starting version. True when applied */
export function applyLive(frame: HTMLIFrameElement | null | undefined, file: string, r: EditResult): boolean {
  if (!r.live?.length || !r.base || !r.hash || r.forked) return false;
  const doc = boardDoc(frame, file);
  if (!doc || shownHash(frame, file) !== r.base) return false;
  const els = r.live.map((it) => elementAt(doc, it.path));
  // Same elements as the server's: a board whose DOM no longer matches its file paths reloads instead
  if (els.some((el, i) => !el || el === doc.body || el.localName !== r.live![i].tag || el.namespaceURI !== "http://www.w3.org/1999/xhtml")) return false;
  r.live.forEach((it, i) => {
    const el = els[i]!;
    for (const [name, value] of it.attrs ?? []) {
      if (value == null) el.removeAttribute(name);
      else el.setAttribute(name, value);
    }
    if (it.inner != null) el.innerHTML = it.inner;
  });
  const p = probeOf(doc)!;
  p.setAttribute("data-dc-src", r.hash);
  p.setAttribute("data-dc-patched", "");
  frame!.dispatchEvent(new CustomEvent("dc-patched"));
  return true;
}

export type EchoDecision = "queue" | "keep" | "check" | "reload";
export type BoardView = { shown: string | null; patched: boolean };

/**
 * Per board: edits of this tab still waiting for their answer (an echo that arrives first waits for it), and the versions its patched
 * board has stood for since it loaded. An echo of one of those older versions is a write that a later own write already followed:
 * "check" asks the server for the file's hash now and decides on that (current: true), which never waits for another echo.
 */
export function createEcho() {
  const pending = new Map<string, number>();
  const queued = new Map<string, (string | undefined)[]>();
  const seen = new Map<string, Set<string>>();
  return {
    begin(file: string) {
      pending.set(file, (pending.get(file) ?? 0) + 1);
    },
    /** The edit was answered: echoes that waited for it, to decide now */
    end(file: string): (string | undefined)[] {
      const n = (pending.get(file) ?? 1) - 1;
      if (n > 0) {
        pending.set(file, n);
        return [];
      }
      pending.delete(file);
      const q = queued.get(file) ?? [];
      queued.delete(file);
      return q;
    },
    /** A patch moved the board from base to hash */
    patched(file: string, base: string, hash: string) {
      const s = seen.get(file) ?? new Set<string>();
      s.add(base).add(hash);
      seen.set(file, s);
    },
    /** The board reloads: what it showed before no longer matters */
    reset(file: string) {
      seen.delete(file);
    },
    /** hash: the file's content in the echo (none for an embedding board's redraw); current: the hash is the file as it is now */
    decide(file: string, hash: string | undefined, view: BoardView, current = false): EchoDecision {
      if (pending.get(file)) {
        queued.set(file, [...(queued.get(file) ?? []), hash]);
        return "queue";
      }
      if (!hash) return "reload";
      if (current) return hash === view.shown ? "keep" : "reload";
      if (!view.patched || !view.shown) return "reload";
      if (hash === view.shown) return "keep";
      return seen.get(file)?.has(hash) ? "check" : "reload";
    },
  };
}
