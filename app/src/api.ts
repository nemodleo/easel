// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Server API and WebSocket calls. PLAN.md section 4.
import type { Board, BoardResponse } from "./types";

export const clientId = Math.random().toString(36).slice(2);
/** This browser (all its tabs, across reloads): steps it makes are "yours" and do not tag the boards */
export const browserId = (() => {
  try {
    let v = localStorage.getItem("design-canvas:browser");
    if (!v) localStorage.setItem("design-canvas:browser", (v = Math.random().toString(36).slice(2)));
    return v;
  } catch {
    return clientId;
  }
})();
let authorName = "";
/** The person's name sent with every write, so other browsers see who changed a board */
export const setAuthorName = (n: string) => void (authorName = n);
/** URI-encoded: a header takes Latin-1 only, and names can be in any script */
const who = (): Record<string, string> => ({ "X-Easel-Client": browserId, ...(authorName ? { "X-Easel-Author": encodeURIComponent(authorName) } : {}) });

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status, body });
  return body as T;
}

export const api = {
  board: () => fetch("/api/board").then((r) => json<BoardResponse>(r)),
  saveBoard: (board: Board, label?: string) =>
    fetch("/api/board", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...who() },
      body: JSON.stringify({ ...board, clientId, ...(label ? { label } : {}) }),
    }).then((r) => json<{ ok: true }>(r)),
  post: <T>(path: string, body: unknown) =>
    fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...who() }, body: JSON.stringify(body) }).then((r) => json<T>(r)),
  put: <T>(path: string, body: unknown) =>
    fetch(path, { method: "PUT", headers: { "Content-Type": "application/json", ...who() }, body: JSON.stringify(body) }).then((r) => json<T>(r)),
  get: <T>(path: string) => fetch(path).then((r) => json<T>(r)),
};

export type ServerEvent =
  | { type: "file-changed"; file: string; kind: "change" | "add" | "unlink" }
  | { type: "board-changed"; source: string | null }
  | { type: "selection-changed" }
  | { type: "comments-changed" }
  | { type: "history-changed" }
  | { type: "errors-changed" }
  | { type: "assets-changed" }
  | { type: "tokens-changed" }
  | { type: "app-changed" }
  | { type: "chat"; id: string; ev: import("./chat").ChatEvent }
  | { type: "hello"; boot: string }
  | { type: "occupancy"; boards: import("./occupancy").Occupancy };

let socket: WebSocket | null = null;
let editing: string | null = null;
/** The board this tab has an element selected on, for the server's "who is on which board": sent now, and again after a reconnect (a restarted server forgot it) */
export function reportEditing(file: string | null) {
  editing = file;
  if (socket?.readyState === 1) socket.send(JSON.stringify({ type: "editing", file, client: browserId, person: authorName || undefined }));
}

/** WebSocket that reconnects 1 second after disconnecting */
export function connectEvents(onEvent: (e: ServerEvent) => void) {
  let ws: WebSocket | null = null;
  let closed = false;
  const open = () => {
    ws = socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws.onopen = () => editing && reportEditing(editing);
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (!closed) setTimeout(open, 1000);
    };
  };
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
