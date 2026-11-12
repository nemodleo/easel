// AI-generated with Claude Code, 2026-10-09 and 2026-11-11, reviewed by Hyun Park
// In-canvas chat: agent choice (Claude Code, Codex, Cursor Agent, Gemini CLI, custom commands) with readiness, model, attaching selection,
// boards, comments and references, streaming and cancel, N variants. Answers render as markdown; Claude Code's permission requests
// show as cards. Each finished run ends with a result row (Undo this run / Compare, or Restore the copy after a restart).
// A failed run shows one sentence (cause + next step) with the raw output under Details, and its message goes back into the composer.
// The transcript is kept per canvas in localStorage with run ids, so it survives a reload and shows where Easel restarted.
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import { Compare, runBefore, type CompareBoard } from "./compare";
import { Icon } from "./icons";
import { Markdown } from "./Markdown";
import { strings } from "./strings";

type Decision = "once" | "always" | "deny";
type PermWhat = "command" | "edit" | "fetch" | "tool";
type PermReq = { id: string; what: PermWhat; tool: string; subject: string; where: string; outside?: boolean; rule: string | null; decision?: Decision };
export type RunBoard = { file: string; kind: "changed" | "added" | "removed" };

export type ChatEvent =
  | { kind: "start"; agent: string; prompt: string; variants?: string[] }
  | { kind: "session"; id: string }
  | { kind: "delta"; text: string }
  | { kind: "break" }
  | { kind: "text"; text: string }
  | { kind: "plain"; text: string }
  | { kind: "tool"; name: string; detail?: string }
  | ({ kind: "permission" } & PermReq)
  | { kind: "permission-answered"; id: string; decision: Decision }
  | { kind: "run-undo"; undone: boolean }
  | { kind: "boot"; boot: string }
  | { kind: "error"; text: string; cause?: Cause; raw?: string; changed?: boolean }
  | { kind: "log"; text: string }
  | { kind: "done"; cost?: number }
  | { kind: "end"; status: "done" | "error" | "cancelled"; step?: boolean; boards?: RunBoard[] };

export type Ref = { kind: "url" | "image" | "file"; value: string; name?: string };
export type Attach = { comments: { id: string; text: string; file: string }[]; refs: Ref[] };
/** Known failure causes, classified on the server (classifyFailure in server/chat.mjs) */
export type Cause = "signin" | "model" | "limit" | "missing" | "crash" | "other";

type Part =
  | { t: "text"; text: string }
  | { t: "plain"; text: string }
  | { t: "tool"; name: string; detail?: string }
  | ({ t: "perm" } & PermReq)
  | { t: "error"; text: string; cause?: Cause; raw?: string; changed?: boolean };
type AiMsg = {
  role: "ai";
  id: string;
  agent: string;
  label?: string;
  parts: Part[];
  status: "running" | "done" | "error" | "cancelled";
  cost?: number;
  variants?: string[];
  /** Server start time when the run began: a different one now means its undo history is gone */
  boot?: string;
  step?: boolean;
  boards?: RunBoard[];
  undone?: boolean;
  restored?: boolean;
};
type Msg = { role: "user"; text: string; chips: string[] } | AiMsg | { role: "restart"; at: string };

type AgentStatus = "ready" | "signin" | "missing" | "unknown";
type Agent = { id: string; label: string; ok: boolean; status?: AgentStatus; install?: string; custom?: boolean; command?: string };
type RunInfo = { live: boolean; undone: boolean; copy: { at: string; label: string } | null };
type Conflict = { id: string; kind: "undo" | "redo"; names: string[] };

const AGENT_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor Agent", gemini: "Gemini CLI" };
const FALLBACK_AGENTS: Agent[] = Object.entries(AGENT_LABEL).map(([id, label]) => ({ id, label, ok: true }));
/** Terminal commands the remedy card offers to copy */
const CLI: Record<string, string> = { claude: "claude", codex: "codex", cursor: "cursor-agent", gemini: "gemini" };
const LOGIN_CMD: Record<string, string> = { claude: "claude auth login", codex: "codex login", cursor: "cursor-agent login", gemini: "gemini" };
const INSTALL_CMD: Record<string, string> = { claude: "npm install -g @anthropic-ai/claude-code", codex: "npm install -g @openai/codex", cursor: "curl https://cursor.com/install -fsS | bash", gemini: "npm install -g @google/gemini-cli" };
/** Model aliases the CLI accepts. No CLI reports a list, so these are only suggestions; empty = CLI default */
const MODEL_ALIASES: Record<string, string[]> = { claude: ["opus", "sonnet", "haiku"], codex: [], cursor: [], gemini: ["gemini-2.5-pro", "gemini-2.5-flash"] };
/** Result row and Compare list changed boards first, then new ones, then removed ones */
const BOARD_ORDER = { changed: 0, added: 1, removed: 2 };
/** Agent colour dot (custom commands use a neutral one) */
const agentColor = (id: string) => (AGENT_LABEL[id] ? `var(--agent-${id})` : "var(--line-strong)");

const load = <T,>(key: string, d: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v == null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
};
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};
const hhmm = (at: string | number) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayTime = (at: string) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const folderName = (p: string) => (p.split(/[\\/]/).filter(Boolean).pop() ?? p) + "/";

/** `code` spans in a sentence → <code> */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((x, i) => (i % 2 ? <code key={i}>{x}</code> : x))}
    </>
  );
}

/** Events of one run applied to its message (live from the WebSocket, or replayed after a reload) */
function applyEvent(m: AiMsg, ev: ChatEvent): AiMsg {
  const parts = [...m.parts];
  const last = parts[parts.length - 1];
  const next: AiMsg = { ...m };
  if (ev.kind === "delta") {
    if (last?.t === "text") parts[parts.length - 1] = { t: "text", text: last.text + ev.text };
    else parts.push({ t: "text", text: ev.text });
  } else if (ev.kind === "break") {
    if (last?.t === "text" && last.text) parts.push({ t: "text", text: "" });
  } else if (ev.kind === "text") parts.push({ t: "text", text: ev.text });
  else if (ev.kind === "plain") {
    if (last?.t === "plain") parts[parts.length - 1] = { t: "plain", text: `${last.text}\n${ev.text}` };
    else parts.push({ t: "plain", text: ev.text });
  } else if (ev.kind === "tool") parts.push({ t: "tool", name: ev.name, detail: ev.detail });
  else if (ev.kind === "permission") {
    const { kind: _k, ...req } = ev;
    const k = parts.findIndex((x) => x.t === "perm" && x.id === ev.id);
    if (k >= 0) parts[k] = { ...(parts[k] as PermReq & { t: "perm" }), ...req };
    else parts.push({ t: "perm", ...req });
  } else if (ev.kind === "permission-answered") {
    const k = parts.findIndex((x) => x.t === "perm" && x.id === ev.id);
    if (k >= 0) parts[k] = { ...(parts[k] as PermReq & { t: "perm" }), decision: ev.decision };
  } else if (ev.kind === "error" && ev.cause) {
    // The classified failure replaces the raw error lines (they are in its Details)
    for (let k = parts.length - 1; k >= 0; k--) if (parts[k].t === "error") parts.splice(k, 1);
    parts.push({ t: "error", text: ev.text, cause: ev.cause, raw: ev.raw, changed: ev.changed });
  } else if (ev.kind === "error") parts.push({ t: "error", text: ev.text });
  else if (ev.kind === "done") next.cost = ev.cost;
  else if (ev.kind === "start") next.variants = ev.variants;
  else if (ev.kind === "run-undo") next.undone = ev.undone;
  else if (ev.kind === "end") {
    next.status = ev.status;
    next.step = ev.step;
    next.boards = ev.boards;
  }
  next.parts = parts.filter((x) => (x.t !== "text" && x.t !== "plain") || x.text);
  return next;
}

export function ChatPanel(p: {
  selection: { file: string; path: string; tag: string; text: string } | null;
  boards: string[];
  visibleCount: number;
  titleOf: (f: string) => string;
  /** Board size for Compare (null when the board is gone) */
  sizeOf: (f: string) => { w: number; h: number } | null;
  attach: Attach;
  setAttach: (fn: (a: Attach) => Attach) => void;
  draft: string;
  setDraft: (s: string) => void;
  subscribe: (fn: (id: string, ev: ChatEvent) => void) => () => void;
  onLocate: (files: string[]) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** The AI tab is showing: agent readiness is checked each time it opens */
  open: boolean;
  /** Canvas identity (its folder): the transcript is kept per canvas */
  storeKey: string | null;
  confirm: (o: { title: string; body: string; ok?: string; danger?: boolean }) => Promise<boolean>;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{ at: string; onOpen: boolean } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [models, setModels] = useState<Record<string, string>>(() => load("design-canvas:models", {}));
  const [restored, setRestored] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [agent, setAgent] = useState<string>(() => {
    try {
      return localStorage.getItem("design-canvas:agent") ?? "claude";
    } catch {
      return "claude";
    }
  });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [useSel, setUseSel] = useState(true);
  const [useBoards, setUseBoards] = useState(true);
  const [useVisible, setUseVisible] = useState(true);
  const [variants, setVariants] = useState(1);
  const [urlInput, setUrlInput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverBoot, setServerBoot] = useState<string | null>(null);
  const [savedBoot, setSavedBoot] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [runInfo, setRunInfo] = useState<Record<string, RunInfo>>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [busyRun, setBusyRun] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ id: string; boards: CompareBoard[] } | null>(null);
  const [customForm, setCustomForm] = useState<{ name: string; command: string; error?: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef<string | null>(null);
  runningRef.current = running;
  /** What each run was sent with, to put back into the composer when it fails */
  const sentRef = useRef(new Map<string, { text: string; attach: Attach }>());
  const storeKey = p.storeKey ? `easel:chat:${p.storeKey}` : null;

  const check = useCallback((onOpen = false) => {
    setChecking(true);
    api
      .get<{ agents: Agent[]; checkedAt: string }>("/api/agents")
      .then((r) => {
        setAgents(r.agents);
        setChecked({ at: r.checkedAt, onOpen });
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (p.open) check(true);
  }, [p.open, check]);
  useEffect(() => {
    try {
      localStorage.setItem("design-canvas:agent", agent);
    } catch {
      /* ignore */
    }
  }, [agent]);
  useEffect(() => save("design-canvas:models", models), [models]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [menuOpen]);
  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    });
  };

  // Server events → messages. Events that arrive before the send response are buffered and attached later
  const known = useRef(new Set<string>());
  const pending = useRef(new Map<string, ChatEvent[]>());
  const applyRef = useRef<(id: string, ev: ChatEvent) => void>(() => {});
  useEffect(
    () =>
      p.subscribe((id, ev) => {
        if (ev.kind === "boot") return setServerBoot(ev.boot);
        if (!known.current.has(id)) {
          pending.current.set(id, [...(pending.current.get(id) ?? []), ev]);
          return;
        }
        applyRef.current(id, ev);
      }),
    [p.subscribe],
  );
  applyRef.current = (id: string, ev: ChatEvent) => {
    setMsgs((list) => list.map((m) => (m.role === "ai" && m.id === id ? applyEvent(m, ev) : m)));
    if (ev.kind === "end") setRunning((cur) => (cur === id ? null : cur));
    if (ev.kind === "session") {
      const m = msgs.find((x) => x.role === "ai" && x.id === id) as AiMsg | undefined;
      if (m) setSessions((s) => ({ ...s, [m.agent]: ev.id }));
    }
    // Sign-in or install problems: re-check so the remedy card and the agent menu are current
    if (ev.kind === "error" && (ev.cause === "signin" || ev.cause === "missing")) check();
    // Failed: the message and its chips go back into the composer (unless something new is being written)
    const sent = sentRef.current.get(id);
    if (ev.kind === "end" && ev.status === "error" && sent && !p.draft.trim() && !p.attach.comments.length && !p.attach.refs.length) {
      p.setDraft(sent.text);
      p.setAttach(() => sent.attach);
      setRestored(true);
    }
  };

  // The WebSocket says hello with the server's start time on every connect; the first one may come before this panel exists
  useEffect(() => {
    api
      .get<{ boot: string }>("/api/chat/runs?ids=")
      .then((r) => setServerBoot((cur) => cur ?? r.boot))
      .catch(() => {});
  }, []);

  /* ---------- Transcript kept per canvas: load once, save on change ---------- */
  useEffect(() => {
    if (!storeKey || loaded) return;
    const s = load<{ msgs?: Msg[]; sessions?: Record<string, string>; boot?: string } | null>(storeKey, null);
    if (s?.msgs?.length) {
      setMsgs(s.msgs);
      setSessions(s.sessions ?? {});
    }
    setSavedBoot(s?.boot ?? null);
    setLoaded(true);
  }, [storeKey, loaded]);
  useEffect(() => {
    if (loaded && storeKey) save(storeKey, { msgs: msgs.slice(-100), sessions, boot: serverBoot ?? savedBoot });
  }, [loaded, storeKey, msgs, sessions, serverBoot, savedBoot]);
  // Once both the saved transcript and the server's start time are known: mark a restart, pick up runs still going, ask what earlier runs can do
  useEffect(() => {
    if (!loaded || !serverBoot) return;
    const restarted = !!savedBoot && savedBoot !== serverBoot;
    setSavedBoot(serverBoot);
    setMsgs((list) => {
      if (!restarted || !list.length) return list;
      const out = list.map((m) => (m.role === "ai" && m.status === "running" ? { ...m, status: "cancelled" as const } : m));
      return out[out.length - 1].role === "restart" ? out : [...out, { role: "restart", at: serverBoot }];
    });
    const ai = msgs.filter((m): m is AiMsg => m.role === "ai");
    for (const m of ai)
      if (m.status === "running" && !restarted && !known.current.has(m.id))
        void api.get<{ events: ChatEvent[] }>(`/api/chat?id=${encodeURIComponent(m.id)}`).then((r) => {
          known.current.add(m.id);
          setMsgs((list) => list.map((x) => (x.role === "ai" && x.id === m.id ? r.events.reduce(applyEvent, { ...x, parts: [] }) : x)));
          if (!r.events.some((e) => e.kind === "end")) setRunning(m.id);
        });
    const ids = ai.filter((m) => m.step).map((m) => m.id);
    if (ids.length) void api.get<{ runs: Record<string, RunInfo> }>(`/api/chat/runs?ids=${ids.join(",")}`).then((r) => setRunInfo((cur) => ({ ...cur, ...r.runs }))).catch(() => {});
    // Runs only when the transcript loads or the server changes; the message list is read as it is then
  }, [loaded, serverBoot]);

  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const sel = useSel ? p.selection : null;
  const boards = useBoards ? p.boards : [];
  const canVariants = boards.length === 1 || (!boards.length && !!sel);

  const list = agents.length ? agents : FALLBACK_AGENTS;
  const current = list.find((a) => a.id === agent);
  const label = current?.label ?? AGENT_LABEL[agent] ?? agent;
  const isCustom = agent.startsWith("custom:");
  const model = models[agent] ?? "";
  // Not ready: say why Send is off. unknown (the check failed) still lets the user try
  const blocked = current?.status === "signin" ? strings.chat.sendNeedsSignin(label) : current?.status === "missing" ? strings.chat.sendNeedsInstall(label) : null;
  const runningMsg = msgs.find((m): m is AiMsg => m.role === "ai" && m.id === running);
  const waiting = !!runningMsg?.parts.some((x) => x.t === "perm" && !x.decision);

  const send = async (text = p.draft.trim(), attach = p.attach) => {
    if (!text || running || blocked) return;
    setError(null);
    const chips = [
      ...(sel ? [strings.chat.chipElement(sel.tag)] : []),
      ...boards.map((f) => p.titleOf(f)),
      ...(useVisible && p.visibleCount ? [strings.chat.chipVisible(p.visibleCount)] : []),
      ...attach.comments.map((c) => strings.chat.chipComment(c.text.slice(0, 16))),
      ...attach.refs.map((r) => r.name ?? r.value),
      ...(variants > 1 ? [strings.chat.variants(variants)] : []),
    ];
    try {
      const r = await api.post<{ id: string; variants: string[] }>("/api/chat", {
        agent,
        text,
        model: isCustom ? undefined : model.trim() || undefined,
        resume: sessions[agent],
        variants: canVariants ? variants : 0,
        attach: { selection: !!sel, boards, visible: useVisible, comments: attach.comments.map((c) => c.id), refs: attach.refs },
      });
      sentRef.current.set(r.id, { text, attach });
      setRestored(false);
      setMsgs((l) => [...l, { role: "user", text, chips }, { role: "ai", id: r.id, agent, label, parts: [], status: "running", boot: serverBoot ?? undefined }]);
      setRunning(r.id);
      known.current.add(r.id);
      for (const ev of pending.current.get(r.id) ?? []) applyRef.current(r.id, ev);
      pending.current.delete(r.id);
      p.setDraft("");
      p.setAttach(() => ({ comments: [], refs: [] }));
      setVariants(1);
      if (r.variants.length) p.onLocate(r.variants);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const cancel = () => running && api.post("/api/chat/cancel", { id: running }).catch(() => {});
  /** Retry: what is in the composer (the restored message, maybe edited), else the failed message as it was sent */
  const retry = (id: string) => {
    const s = sentRef.current.get(id);
    if (p.draft.trim() || !s) void send();
    else void send(s.text, s.attach);
  };
  const patch = (id: string, fn: (m: AiMsg) => AiMsg) => setMsgs((l) => l.map((m) => (m.role === "ai" && m.id === id ? fn(m) : m)));
  const answer = (runId: string, id: string, decision: Decision) => {
    patch(runId, (m) => applyEvent(m, { kind: "permission-answered", id, decision }));
    api.post("/api/chat/permission/answer", { id, decision }).catch((e) => setError((e as Error).message));
  };
  /** Undo / redo a whole run; boards changed since come back as a question (rest / all / cancel) */
  const runAction = async (id: string, kind: "undo" | "redo", mode?: "rest" | "all") => {
    setBusyRun(id);
    try {
      await api.post(`/api/chat/${kind}-run`, { id, mode });
      setConflict(null);
      patch(id, (m) => ({ ...m, undone: kind === "undo" }));
    } catch (e) {
      const err = e as Error & { status?: number; body?: { conflicts?: { file: string }[] } };
      if (err.status === 409 && err.body?.conflicts) setConflict({ id, kind, names: [...new Set(err.body.conflicts.map((c) => (c.file.endsWith(".html") ? p.titleOf(c.file) : c.file)))] });
      else setError(err.message);
    } finally {
      setBusyRun(null);
    }
  };
  const restoreCopy = async (m: AiMsg, at: string) => {
    if (!(await p.confirm({ title: strings.chat.restoreTitle, body: strings.chat.restoreBody(dayTime(at)), ok: strings.chat.restoreOk, danger: true }))) return;
    try {
      await api.post("/api/chat/revert", { id: m.id });
      patch(m.id, (x) => ({ ...x, restored: true }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openCompare = (m: AiMsg) =>
    setCompare({
      id: m.id,
      boards: [...(m.boards ?? [])].sort((a, b) => BOARD_ORDER[a.kind] - BOARD_ORDER[b.kind]).map((b) => ({ ...b, title: p.titleOf(b.file), ...(p.sizeOf(b.file) ?? { w: 390, h: 844 }) })),
    });
  const saveCustom = async () => {
    if (!customForm) return;
    try {
      const r = await api.post<{ agent: Agent }>("/api/agents/custom", { name: customForm.name, command: customForm.command });
      setAgents((l) => [...l.filter((a) => a.id !== r.agent.id), r.agent]);
      setAgent(r.agent.id);
      setCustomForm(null);
    } catch (e) {
      setCustomForm((f) => f && { ...f, error: (e as Error).message });
    }
  };
  const removeCustom = async (id: string) => {
    await api.post("/api/agents/custom", { action: "delete", id }).catch(() => {});
    setAgents((l) => l.filter((a) => a.id !== id));
    if (agent === id) setAgent("claude");
  };
  const statusText = (a: Agent) => (a.status ? strings.chat.agentStatus[a.status] : checking ? strings.chat.checking : "");
  const remedy =
    current?.status === "signin"
      ? { text: strings.chat.remedySignin(label, LOGIN_CMD[agent] ?? `${agent} login`), cmd: LOGIN_CMD[agent] ?? `${agent} login` }
      : current?.status === "missing"
        ? { text: strings.chat.remedyMissing(isCustom ? (current.command ?? "").split(/\s+/)[0] : (CLI[agent] ?? agent)), cmd: isCustom ? null : (INSTALL_CMD[agent] ?? agent) }
        : null;

  const upload = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (f.size > 15 * 1024 * 1024) {
        setError(strings.chat.tooBig(f.name));
        continue;
      }
      const data = await new Promise<string>((res) => {
        const rd = new FileReader();
        rd.onload = () => res(String(rd.result).split(",")[1] ?? "");
        rd.readAsDataURL(f);
      });
      try {
        const r = await api.post<Ref>("/api/refs", { name: f.name || strings.defaults.pastedImage, data });
        p.setAttach((a) => ({ ...a, refs: [...a.refs, r] }));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };

  /** The row under a finished run that changed files */
  const resultRow = (m: AiMsg) => {
    const bs = [...(m.boards ?? [])].sort((a, b) => BOARD_ORDER[a.kind] - BOARD_ORDER[b.kind]);
    const changed = bs.filter((b) => b.kind !== "added").length;
    const added = bs.filter((b) => b.kind === "added").length;
    const line = strings.chat.runChanged(changed, added);
    const past = !!serverBoot && !!m.boot && m.boot !== serverBoot;
    const info = runInfo[m.id];
    const c = conflict?.id === m.id ? conflict : null;
    if (m.restored)
      return (
        <div className="run-result undone">
          <span className="rr-line">
            <Icon name="restore" size={14} /> {strings.chat.restoredCopy}
          </span>
        </div>
      );
    if (past)
      return (
        <div className="run-result">
          <span className="rr-line">{line}</span>
          {info === undefined ? null : info.copy ? (
            <>
              <div className="btn-row">
                <button onClick={() => void restoreCopy(m, info.copy!.at)}>
                  <Icon name="restore" size={14} /> {strings.chat.restoreCopy}
                </button>
              </div>
              <p className="sub">{strings.chat.savedAt(dayTime(info.copy.at))}</p>
            </>
          ) : (
            <p className="sub">{strings.chat.copyGone}</p>
          )}
        </div>
      );
    const conflictRow = c && (
      <div className="rr-conflict" role="alert">
        <p>{(c.kind === "undo" ? strings.chat.conflictUndo : strings.chat.conflictRedo)(c.names.join(", "))}</p>
        <div className="btn-row">
          <button onClick={() => void runAction(m.id, c.kind, "rest")}>{c.kind === "undo" ? strings.chat.undoRest : strings.chat.redoRest}</button>
          <button className="danger" onClick={() => void runAction(m.id, c.kind, "all")}>
            {c.kind === "undo" ? strings.chat.undoAll : strings.chat.redoAll}
          </button>
          <button onClick={() => setConflict(null)}>{strings.chat.cancel}</button>
        </div>
      </div>
    );
    if (m.undone)
      return (
        <div className="run-result undone">
          <span className="rr-line">
            <Icon name="undo" size={14} /> {strings.chat.runUndone(bs.length)}
          </span>
          <div className="btn-row">
            <button disabled={busyRun === m.id || !!running} onClick={() => void runAction(m.id, "redo")}>
              <Icon name="redo" size={14} /> {strings.chat.redo}
            </button>
          </div>
          {conflictRow}
        </div>
      );
    return (
      <div className="run-result">
        <span className="rr-line">{line}</span>
        {bs.length > 0 && (
          <div className="chips">
            {bs.map((b) =>
              b.kind === "removed" ? (
                <span key={b.file} className="chip">
                  <Icon name="board" size={12} /> {strings.chat.chipRemoved(p.titleOf(b.file))}
                </span>
              ) : (
                <button key={b.file} className="chip" title={b.file} onClick={() => p.onLocate([b.file])}>
                  <Icon name="board" size={12} /> {b.kind === "added" ? strings.chat.chipNew(p.titleOf(b.file)) : p.titleOf(b.file)}
                </button>
              ),
            )}
          </div>
        )}
        <div className="btn-row">
          <button disabled={busyRun === m.id || !!running} onClick={() => void runAction(m.id, "undo")}>
            <Icon name="undo" size={14} /> {strings.chat.undoRun}
          </button>
          {bs.length > 0 && (
            <button onClick={() => openCompare(m)}>
              <Icon name="compare" size={14} /> {strings.chat.compare}
            </button>
          )}
        </div>
        {conflictRow}
      </div>
    );
  };

  const permCard = (m: AiMsg, x: PermReq) =>
    x.decision ? (
      <div className="perm-done" title={x.subject}>
        <Icon name={x.decision === "deny" ? "close" : "check"} size={14} className={x.decision === "deny" ? "no" : "ok"} />
        <span>
          {strings.chat.permDone[x.decision]} · {x.tool} {x.what === "tool" ? null : <code>{x.subject}</code>}
          {x.outside ? ` ${strings.chat.permDoneOutside}` : ""}
        </span>
      </div>
    ) : (
      <div className="perm" role="group" aria-label={strings.chat.permAsk(m.label ?? AGENT_LABEL[m.agent] ?? m.agent, x.what, x.tool)}>
        <div className="perm-head">
          <span className="idot" style={{ background: agentColor(m.agent) }} aria-hidden="true" />
          {strings.chat.permAsk(m.label ?? AGENT_LABEL[m.agent] ?? m.agent, x.what, x.tool)}
        </div>
        <div className="perm-cmd">{x.subject}</div>
        <div className="perm-where" title={x.where}>
          <Icon name="folder" size={14} /> {strings.chat.permIn} <code>{folderName(x.where)}</code>
          {x.outside && <span className="perm-outside">· {strings.chat.permOutside}</span>}
        </div>
        <div className="btn-row">
          <button className="primary" onClick={() => answer(m.id, x.id, "once")}>
            {strings.chat.allowOnce}
          </button>
          {x.rule && (
            <button title={strings.chat.alwaysAllowTitle} onClick={() => answer(m.id, x.id, "always")}>
              {strings.chat.alwaysAllow(x.rule)}
            </button>
          )}
          <button onClick={() => answer(m.id, x.id, "deny")}>{strings.chat.deny}</button>
        </div>
      </div>
    );

  return (
    <section className="chat" aria-label={strings.chat.aria}>
      <div className="chat-head">
        <div className="chat-head-row">
          <div className="agent-pick" ref={menuRef}>
            <button
              className="agent-btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={strings.chat.agentButton(label, current ? statusText(current) : "")}
              title={strings.chat.agentHint}
              disabled={!!running}
              onClick={() => setMenuOpen((v) => !v)}
              onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
            >
              <span className={`dot ${current?.status ?? ""}`} aria-hidden="true" />
              <span className="agent-name">{label}</span>
              <Icon name="chevronDown" size={14} />
            </button>
            {menuOpen && (
              <div className="menu agent-menu" role="menu" aria-label={strings.chat.agent} onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}>
                {list.map((a) => (
                  <div key={a.id} className={`menu-item agent-item ${a.status === "missing" ? "off" : ""}`} role="none">
                    <button
                      role="menuitemradio"
                      aria-checked={a.id === agent}
                      className="agent-choose"
                      title={a.custom && a.command ? strings.chat.customCommandTitle(a.command) : undefined}
                      onClick={() => {
                        setAgent(a.id);
                        setMenuOpen(false);
                      }}
                    >
                      <span className={`menu-check ${a.id === agent ? "on" : ""}`} aria-hidden="true">
                        <Icon name="check" size={14} />
                      </span>
                      <span className="idot" style={{ background: agentColor(a.id) }} aria-hidden="true" />
                      <span className="menu-label">{a.label}</span>
                    </button>
                    <span className={`agent-status ${a.status === "missing" ? "off" : (a.status ?? "")}`}>
                      {a.status && a.status !== "missing" && <span className={`dot ${a.status}`} aria-hidden="true" />}
                      {statusText(a)}
                      {a.status === "missing" && a.install && (
                        <>
                          {" · "}
                          <a className="link" href={a.install} target="_blank" rel="noopener noreferrer">
                            {strings.chat.howToInstall}
                          </a>
                        </>
                      )}
                    </span>
                    {a.custom && (
                      <button className="icon-btn sm" aria-label={strings.chat.remove(a.label)} title={strings.chat.remove(a.label)} onClick={() => void removeCustom(a.id)}>
                        <Icon name="close" size={12} />
                      </button>
                    )}
                  </div>
                ))}
                <div className="menu-sep" role="separator" />
                <button
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setCustomForm({ name: "", command: "" });
                  }}
                >
                  <span className="menu-check on muted" aria-hidden="true">
                    <Icon name="plus" size={14} />
                  </span>
                  <span className="menu-label">{strings.chat.customCommand}</span>
                </button>
                <div className="menu-foot">
                  <span>{checking ? strings.chat.checking : checked ? strings.chat.checkedAt(hhmm(checked.at), checked.onOpen) : strings.chat.checkedOnOpen}</span>
                  <button className="link" disabled={checking} onClick={() => check()}>
                    {strings.chat.checkAgain}
                  </button>
                </div>
              </div>
            )}
          </div>
          {isCustom ? (
            <span className="model-field mono custom-cmd" title={current?.command}>
              {current?.command}
            </span>
          ) : (
            <>
              <input
                className="model-field"
                list={`models-${agent}`}
                value={model}
                placeholder={strings.chat.modelDefault}
                aria-label={strings.chat.model}
                title={strings.chat.modelTitle(label)}
                disabled={!!running}
                spellCheck={false}
                onChange={(e) => setModels((m) => ({ ...m, [agent]: e.target.value }))}
              />
              <datalist id={`models-${agent}`}>
                {(MODEL_ALIASES[agent] ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          )}
        </div>
        <div className="chat-head-row sub">
          <span className="muted small">{running ? strings.chat.running : sessions[agent] ? strings.chat.continuing : strings.chat.newConversation}</span>
          <div className="spacer" />
          <button
            className="icon-btn sm new-chat"
            aria-label={strings.chat.newChat}
            title={strings.chat.newChat}
            disabled={!!running || (!msgs.length && !sessions[agent])}
            onClick={() => {
              setMsgs([]);
              setSessions({});
              setRestored(false);
              setConflict(null);
            }}
          >
            <Icon name="plus" size={14} /> <span>{strings.chat.newChat}</span>
          </button>
        </div>
      </div>
      {customForm && (
        <div className="cf-card" role="dialog" aria-label={strings.chat.customTitle} onKeyDown={(e) => e.key === "Escape" && setCustomForm(null)}>
          <div className="cf">
            <div className="cf-title">
              <span className="idot" style={{ background: "var(--line-strong)" }} aria-hidden="true" />
              {strings.chat.customTitle}
            </div>
            <label className="cf-field">
              {strings.chat.customName}
              <input className="cf-input" autoFocus value={customForm.name} placeholder={strings.chat.customNamePlaceholder} onChange={(e) => setCustomForm({ ...customForm, name: e.target.value, error: undefined })} />
            </label>
            <label className="cf-field">
              {strings.chat.customCommandLabel}
              <input
                className="cf-input mono"
                value={customForm.command}
                spellCheck={false}
                placeholder={strings.chat.customCommandPlaceholder}
                onChange={(e) => setCustomForm({ ...customForm, command: e.target.value, error: undefined })}
                onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void saveCustom()}
              />
            </label>
            <p className="cf-hint">
              <Inline text={strings.chat.customHint} />
            </p>
            {customForm.error && <p className="warn small">{customForm.error}</p>}
            <div className="btn-row">
              <button className="primary" disabled={!customForm.name.trim() || !customForm.command.trim()} onClick={() => void saveCustom()}>
                {strings.chat.customSave}
              </button>
              <button onClick={() => setCustomForm(null)}>{strings.chat.cancel}</button>
            </div>
          </div>
        </div>
      )}
      <div className="chat-list" ref={listRef} aria-live="polite">
        {msgs.length === 0 ? (
          <div className="chat-empty">
            <Icon name="comment" size={28} />
            <p>{strings.chat.intro(label)}</p>
            <div className="chat-suggest">
              {strings.chat.suggestions.map((x) => (
                <button
                  key={x.label}
                  onClick={() => {
                    p.setDraft(x.text);
                    setVariants(x.n);
                  }}
                >
                  {x.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m, i) =>
            m.role === "restart" ? (
              <div key={i} className="restart" role="separator">
                {strings.chat.restarted(hhmm(m.at))}
              </div>
            ) : m.role === "user" ? (
              <div key={i} className="msg user">
                {m.chips.length > 0 && (
                  <div className="chips">
                    {m.chips.map((c, j) => (
                      <span key={j} className="chip">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                <div className="bubble">{m.text}</div>
              </div>
            ) : (
              <div key={i} className={`msg ai ${m.status}`}>
                <div className="msg-head">
                  <strong>{m.label ?? AGENT_LABEL[m.agent] ?? m.agent}</strong>
                  {m.status === "running" &&
                    (m.parts.some((x) => x.t === "perm" && !x.decision) ? (
                      <span className="waiting">
                        <span className="pulse" aria-hidden="true" />
                        {strings.chat.waiting}
                      </span>
                    ) : (
                      <span className="spinner" aria-label={strings.chat.running} />
                    ))}
                  {m.status === "cancelled" && <span className="muted">{strings.chat.cancelled}</span>}
                  {m.status === "error" && <span className="muted">{strings.chat.failed}</span>}
                  {m.status === "done" && m.cost != null && <span className="muted small">${m.cost.toFixed(3)}</span>}
                </div>
                {m.variants?.length ? (
                  <button className="link" onClick={() => p.onLocate(m.variants!)}>
                    {strings.chat.madeVariants(m.variants.length)}
                  </button>
                ) : null}
                {m.parts.map((x, j) =>
                  x.t === "text" ? (
                    <Markdown key={j} className="ai-text" text={x.text} />
                  ) : x.t === "plain" ? (
                    <pre key={j} className="ai-plain">
                      {x.text}
                    </pre>
                  ) : x.t === "perm" ? (
                    <div key={j}>{permCard(m, x)}</div>
                  ) : x.t === "tool" ? (
                    <div key={j} className="ai-tool">
                      <Icon name="edit" size={12} />
                      <span>{x.name}</span>
                      {x.detail && <code>{x.detail}</code>}
                    </div>
                  ) : x.cause ? (
                    <div key={j} className="ai-fail">
                      <div className="ai-error">
                        <Icon name="warn" size={14} />
                        <span>
                          <Inline text={x.text} />
                        </span>
                      </div>
                      {i === msgs.length - 1 && (
                        <div className="btn-row">
                          <button disabled={!!running || !!blocked} title={blocked ?? undefined} onClick={() => retry(m.id)}>
                            {strings.chat.retry}
                          </button>
                          {(() => {
                            const other = list.find((a) => a.id !== m.agent && a.status !== "missing" && a.ok && !a.custom);
                            return other && other.id !== agent ? <button onClick={() => setAgent(other.id)}>{strings.chat.switchTo(other.label)}</button> : null;
                          })()}
                        </div>
                      )}
                      {x.raw && (
                        <details className="ai-details">
                          <summary>{strings.chat.details}</summary>
                          <div className="ai-details-bar">
                            <button className="link" onClick={() => copy(`raw-${m.id}`, x.raw!)}>
                              {copied === `raw-${m.id}` ? strings.chat.copied : strings.chat.copy}
                            </button>
                          </div>
                          <pre>{x.raw}</pre>
                        </details>
                      )}
                      {x.changed === false && <p className="muted small">{strings.chat.noFilesChanged}</p>}
                    </div>
                  ) : (
                    <div key={j} className="ai-error">
                      <Icon name="warn" size={14} /> {x.text}
                    </div>
                  ),
                )}
                {m.status === "running" && !m.parts.length && <div className="muted">{strings.chat.thinking}</div>}
                {strings.chat.noPause[m.agent] && m.parts.some((x) => x.t === "tool") && <p className="ai-note">{strings.chat.noPause[m.agent]}</p>}
                {m.status !== "running" && m.step && resultRow(m)}
              </div>
            ),
          )
        )}
      </div>
      {remedy && (
        <div className="remedy" role="status">
          <Icon name="warn" size={14} />
          <div>
            <p>
              <Inline text={remedy.text} />
            </p>
            <div className="btn-row">
              {remedy.cmd && (
                <button className="sm" onClick={() => copy("cmd", remedy.cmd!)} title={remedy.cmd}>
                  <Icon name="copy" size={14} /> {copied === "cmd" ? strings.chat.copied : strings.chat.copyCommand}
                </button>
              )}
              <button className="sm" disabled={checking} onClick={() => check()}>
                {checking ? strings.chat.checking : strings.chat.checkAgain}
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className="composer"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
      >
        {waiting && (
          <div className="run-status" role="status">
            <span className="waiting">
              <span className="pulse" aria-hidden="true" />
              {strings.chat.waiting}
            </span>
            <span className="muted">· {strings.chat.waitingHint}</span>
          </div>
        )}
        <div className="chips">
          {p.selection && (
            <Chip on={useSel} onToggle={() => setUseSel((v) => !v)} icon="select" label={strings.chat.chipElementText(p.selection.tag, p.selection.text.slice(0, 14))} />
          )}
          {p.boards.length > 0 && <Chip on={useBoards} onToggle={() => setUseBoards((v) => !v)} icon="board" label={p.boards.length === 1 ? p.titleOf(p.boards[0]) : strings.chat.chipBoards(p.boards.length)} />}
          {p.visibleCount > 0 && <Chip on={useVisible} onToggle={() => setUseVisible((v) => !v)} icon="fit" label={strings.chat.chipVisible(p.visibleCount)} />}
          {p.attach.comments.map((c) => (
            <Chip key={c.id} on icon="comment" label={strings.chat.chipComment(c.text.slice(0, 14))} onRemove={() => p.setAttach((a) => ({ ...a, comments: a.comments.filter((x) => x.id !== c.id) }))} />
          ))}
          {p.attach.refs.map((r, i) => (
            <Chip key={i} on icon={r.kind === "url" ? "link" : "page"} label={r.name ?? r.value} onRemove={() => p.setAttach((a) => ({ ...a, refs: a.refs.filter((_, j) => j !== i) }))} />
          ))}
        </div>
        {urlInput != null && (
          <div className="url-row">
            <input
              autoFocus
              value={urlInput}
              placeholder="https://"
              aria-label={strings.chat.refLink}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter" && /^https?:\/\/\S+$/.test(urlInput.trim())) {
                  p.setAttach((a) => ({ ...a, refs: [...a.refs, { kind: "url", value: urlInput.trim() }] }));
                  setUrlInput(null);
                }
                if (e.key === "Escape") setUrlInput(null);
              }}
            />
          </div>
        )}
        {restored && p.draft.trim() && <span className="restored muted small">{strings.chat.restored}</span>}
        <textarea
          ref={p.inputRef}
          value={p.draft}
          rows={3}
          placeholder={running ? strings.chat.placeholderRunning : strings.chat.placeholder}
          aria-label={strings.chat.input}
          onChange={(e) => p.setDraft(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              void upload(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return; // Enter during IME composition commits the character
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
            if (e.key === "Escape") {
              if (running) cancel();
              else (e.target as HTMLTextAreaElement).blur();
            }
          }}
        />
        {error && <p className="warn small">{error}</p>}
        {blocked && !running && (
          <p className="send-why">
            <Icon name="warn" size={14} /> {blocked}
          </p>
        )}
        <div className="composer-bar">
          <button className="icon-btn sm" aria-label={strings.chat.attach} title={strings.chat.attachTitle} onClick={() => fileRef.current?.click()}>
            <Icon name="plus" size={14} />
          </button>
          <button className="icon-btn sm" aria-label={strings.chat.addLink} title={strings.chat.addLink} onClick={() => setUrlInput("")}>
            <Icon name="link" size={14} />
          </button>
          <input ref={fileRef} type="file" multiple hidden accept="image/*,.pdf,.md,.txt,.html,.csv,.json" onChange={(e) => e.target.files && void upload(e.target.files)} />
          <label className="variants" title={canVariants ? strings.chat.variantsTitle : strings.chat.variantsDisabledTitle}>
            <select value={variants} disabled={!canVariants || !!running} onChange={(e) => setVariants(Number(e.target.value))} aria-label={strings.chat.variantsAria}>
              <option value={1}>{strings.chat.variants(1)}</option>
              <option value={2}>{strings.chat.variants(2)}</option>
              <option value={3}>{strings.chat.variants(3)}</option>
              <option value={4}>{strings.chat.variants(4)}</option>
            </select>
          </label>
          <div className="spacer" />
          {running ? (
            <button className="danger" onClick={cancel}>
              <Icon name="close" size={14} /> {strings.chat.cancel}
            </button>
          ) : (
            <button className="primary" disabled={!p.draft.trim() || !!blocked} title={blocked ?? undefined} onClick={() => void send()}>
              {strings.chat.send}
            </button>
          )}
        </div>
      </div>
      {compare && <Compare before={runBefore(compare.id)} boards={compare.boards} onClose={() => setCompare(null)} />}
    </section>
  );
}

function Chip({ on, onToggle, onRemove, icon, label }: { on: boolean; onToggle?: () => void; onRemove?: () => void; icon: Parameters<typeof Icon>[0]["name"]; label: string }) {
  return (
    <span className={`chip ${on ? "on" : "off"}`}>
      <button className="chip-main" onClick={onToggle} disabled={!onToggle} aria-pressed={onToggle ? on : undefined} title={onToggle ? (on ? strings.chat.chipRemoveTitle : strings.chat.chipAddTitle) : undefined}>
        <Icon name={icon} size={12} />
        <span>{label}</span>
      </button>
      {onRemove && (
        <button className="chip-x" aria-label={strings.chat.remove(label)} onClick={onRemove}>
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}
