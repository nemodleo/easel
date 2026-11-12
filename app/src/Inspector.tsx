// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Right panel: selection info, copy, screenshot, comments. (Properties and layers attach here since M5)
import { Children, useState, type ReactNode, type RefObject } from "react";

import { api } from "./api";
import { Icon } from "./icons";
import { describe } from "./editor";
import type { Selection } from "./types";
import { strings } from "./strings";

export type Reply = { id: string; author: string; text: string; createdAt: string };
export type Comment = { id: string; file: string; path: string; text: string; author: string; createdAt: string; resolved: boolean; replies?: Reply[] };

export function Inspector(props: {
  file: string | null;
  selection: Selection | null;
  /** Board › parents › element, under the selected element's name */
  crumbs?: ReactNode;
  /** The comment box (Comment in the element toolbar focuses it) */
  commentRef?: RefObject<HTMLTextAreaElement | null>;
  multi: number;
  error: string | null;
  comments: Comment[];
  onSelectPath: (path: string) => void;
  onAskAI?: (c: Comment) => void;
  /** Empty state: open the AI tab */
  onAskAi?: () => void;
  author: string;
  onAuthor: () => void;
  children?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const sendReply = async (id: string, resolve = false) => {
    if (!reply.trim()) return;
    await api.post("/api/comments", { action: "reply", id, text: reply, author: props.author, resolve });
    setReply("");
    setReplyTo(null);
  };
  const when = (d: string) => new Date(d).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const sel = props.selection;
  const list = props.comments.filter((c) => !props.file || c.file === props.file);

  const copy = async () => {
    if (!sel) return;
    await navigator.clipboard.writeText(describe(sel.file, sel.path, sel.tag, sel.text)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const takeShot = async () => {
    if (!props.file) return;
    setBusy(true);
    try {
      const r = await api.post<{ path: string }>("/api/screenshot", { file: props.file, path: sel?.path });
      setShot(r.path);
    } catch (e) {
      setShot(strings.inspector.shotFailed((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const addComment = async () => {
    if (!props.file || !text.trim()) return;
    await api.post("/api/comments", { file: props.file, path: sel?.file === props.file ? sel.path : "", text, author: props.author });
    setText("");
  };

  return (
    <aside className="inspector">
      {!props.file ? (
        Children.toArray(props.children).length ? props.children : (
          <div className="inspector-empty">
            <p className="empty-lead">{strings.inspector.emptyLead}</p>
            {props.onAskAi && (
              <button className="primary ask-ai-cta" onClick={props.onAskAi}>
                <Icon name="comment" size={16} /> {strings.inspector.emptyAiCta}
              </button>
            )}
            <p className="muted">{strings.inspector.pickBoard}</p>
            <ul className="muted">
              <li><kbd>B</kbd> {strings.inspector.hintDraw} · <kbd>T</kbd> {strings.inspector.hintTitle} · <kbd>N</kbd> {strings.inspector.hintNote}</li>
              <li>{strings.inspector.hintClick} <kbd>F</kbd> {strings.inspector.hintFocus}</li>
              <li>{strings.inspector.hintRightClick} · <kbd>⌘K</kbd> {strings.inspector.hintFind}</li>
            </ul>
          </div>
        )
      ) : (
        <>
          <section>
            <h3>{props.file}</h3>
            {!(sel && sel.file === props.file) && <p className="muted">{strings.canvas.hint}</p>}
            {props.error && <p className="warn">{props.error}</p>}
            {sel && sel.file === props.file && (
              <div className="sel">
                <div className="sel-name">
                  <strong>{strings.inspector.kindName(sel.kind ?? sel.tag)}</strong>
                  {sel.label && <span className="sel-label"> · {sel.label.slice(0, 40)}</span>}
                  {props.multi > 1 && <span className="muted"> {strings.inspector.more(props.multi - 1)}</span>}
                </div>
                {props.crumbs}
                {sel.text && !sel.label && <div className="sel-text">“{sel.text.slice(0, 120)}”</div>}
                <div className="row">
                  <button onClick={copy}>{copied ? strings.inspector.copied : strings.inspector.copy}</button>
                  {sel.path.includes("/") && <button onClick={() => props.onSelectPath(sel.path.slice(0, sel.path.lastIndexOf("/")))}>{strings.inspector.parent}</button>}
                  <button onClick={takeShot} disabled={busy}>
                    {busy ? strings.inspector.capturing : strings.inspector.screenshot}
                  </button>
                </div>
              </div>
            )}
            {shot && <p className="muted small">{shot}</p>}
          </section>
          {props.children}
          <section>
            <h3>{strings.comments.title} {list.filter((c) => !c.resolved).length > 0 && <span className="muted">{list.filter((c) => !c.resolved).length}</span>}</h3>
            <textarea
              ref={props.commentRef}
              value={text}
              placeholder={sel?.file === props.file ? strings.comments.placeholderElement(sel.path) : strings.comments.placeholderBoard}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void addComment();
              }}
            />
            <div className="row">
              <button onClick={addComment} disabled={!text.trim()}>
                {strings.comments.add}
              </button>
              <button className="link" onClick={props.onAuthor} title={strings.comments.authorTitle}>
                {strings.comments.author(props.author)}
              </button>
              {!sel && (
                <button className="link shot-link" onClick={takeShot} disabled={busy} title={strings.inspector.boardScreenshotTitle}>
                  {busy ? strings.inspector.capturing : strings.inspector.boardScreenshot}
                </button>
              )}
            </div>
            <ul className="comments">
              {list.map((c) => (
                <li key={c.id} className={c.resolved ? "resolved" : ""}>
                  <div className="c-head">
                    <strong>{c.author}</strong>
                    {c.path && (
                      <button className="link" onClick={() => props.onSelectPath(c.path)}>
                        {c.path}
                      </button>
                    )}
                    <span className="muted">{new Date(c.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div>{c.text}</div>
                  {(c.replies ?? []).length > 0 && (
                    <ul className="replies">
                      {c.replies!.map((r) => (
                        <li key={r.id}>
                          <div className="c-head">
                            <strong>{r.author}</strong>
                            <span className="muted">{when(r.createdAt)}</span>
                          </div>
                          <div>{r.text}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {replyTo === c.id && (
                    <div className="reply-box">
                      <textarea
                        autoFocus
                        value={reply}
                        placeholder={strings.comments.replyPlaceholder(props.author)}
                        aria-label={strings.comments.reply}
                        onChange={(e) => setReply(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing) return;
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void sendReply(c.id);
                          if (e.key === "Escape") setReplyTo(null);
                        }}
                      />
                      <div className="row">
                        <button onClick={() => void sendReply(c.id)} disabled={!reply.trim()}>
                          {strings.comments.reply}
                        </button>
                        <button onClick={() => void sendReply(c.id, true)} disabled={!reply.trim()}>
                          {strings.comments.replyResolve}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="row">
                    {replyTo !== c.id && (
                      <button className="link" onClick={() => setReplyTo(c.id)}>
                        {strings.comments.reply}
                      </button>
                    )}
                    <button className="link" onClick={() => api.post("/api/comments", { action: "resolve", id: c.id, resolved: !c.resolved })}>
                      {c.resolved ? strings.comments.reopen : strings.comments.resolve}
                    </button>
                    {!c.resolved && props.onAskAI && (
                      <button className="link" onClick={() => props.onAskAI!(c)} title={strings.comments.sendToAITitle}>
                        {strings.comments.sendToAI}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </aside>
  );
}
