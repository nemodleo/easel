// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Inspector card body: what is selected (file, name, breadcrumb), the groups passed in (Properties, Checks, Layers), comments,
// and the action footer pinned to the card's foot (Duplicate, Copy, Screenshot, Delete for an element; a board's icons otherwise).
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { api } from "./api";
import { Icon } from "./icons";
import { describe } from "./editor";
import type { Selection } from "./types";
import { strings } from "./strings";
import { snapWidths } from "./ui";

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
  /** The selected element's Duplicate and Delete (the footer's first and last actions) */
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** The footer for anything that is not an element (a board's icons) */
  footer?: ReactNode;
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
  const footRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    snapWidths(footRef.current);
    snapWidths(scrollRef.current, ".crumb button, .crumb span[aria-hidden], .oc-cmt button");
  });
  const sendReply = async (id: string, resolve = false) => {
    if (!reply.trim()) return;
    await api.post("/api/comments", { action: "reply", id, text: reply, author: props.author, resolve });
    setReply("");
    setReplyTo(null);
  };
  const when = (d: string) => new Date(d).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const sel = props.selection;
  const onEl = !!sel && !!props.file && sel.file === props.file;
  const list = props.comments.filter((c) => !props.file || c.file === props.file);
  const open = list.filter((c) => !c.resolved).length;

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
    <div className="pp inspector">
      <div className="pp-scroll" ref={scrollRef}>
        {onEl && sel && (
          <header className="pp-head">
            <span className="pp-file">{sel.file}</span>
            <h2 className="pp-name">
              <span>
                {strings.inspector.kindName(sel.kind ?? sel.tag)}
                {sel.label && ` · ${sel.label.slice(0, 40)}`}
                {props.multi > 1 && <span className="muted"> {strings.inspector.more(props.multi - 1)}</span>}
              </span>
            </h2>
            <div className="pp-crumb">
              {props.crumbs}
              {sel.path.includes("/") && (
                <button className="icon-btn pp-ib" aria-label={strings.menu.selectParent} title={strings.menu.selectParent} onClick={() => props.onSelectPath(sel.path.slice(0, sel.path.lastIndexOf("/")))}>
                  <Icon name="parent" size={16} />
                </button>
              )}
            </div>
            {sel.text && !sel.label && <p className="pp-note sel-text">“{sel.text.slice(0, 120)}”</p>}
          </header>
        )}
        {props.error && <p className="pp-note warn">{props.error}</p>}
        {shot && <p className="pp-note muted shot">{shot}</p>}
        {props.children}
        {props.file && (
          <section className="pp-group oc-cmt" aria-label={strings.comments.title}>
            <h3 className="pp-group-h">
              {strings.comments.title}
              {open > 0 && <span className="oc-count">{open}</span>}
            </h3>
            <textarea
              ref={props.commentRef}
              value={text}
              aria-label={strings.comments.title}
              placeholder={onEl && sel ? strings.comments.placeholderElement(sel.path) : strings.comments.placeholderBoard}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void addComment();
              }}
            />
            <div className="oc-cmt-bar">
              <button className="btn" onClick={addComment} disabled={!text.trim()}>
                {strings.comments.add}
              </button>
              <button className="btn oc-plain" onClick={props.onAuthor} title={strings.comments.authorTitle}>
                {strings.comments.author(props.author)}
              </button>
              {!onEl && (
                <button className="btn oc-plain shot-link" onClick={takeShot} disabled={busy} title={strings.inspector.boardScreenshotTitle}>
                  {busy ? strings.inspector.capturing : strings.inspector.boardScreenshot}
                </button>
              )}
            </div>
            <ul className="comments">
              {list.map((c) => (
                <li key={c.id} className={`oc-cmt-item ${c.resolved ? "resolved" : ""}`}>
                  <div className="c-head">
                    <span className="who">{c.author}</span>
                    {c.path && (
                      <button className="btn oc-plain c-path" onClick={() => props.onSelectPath(c.path)}>
                        {c.path}
                      </button>
                    )}
                    <span className="when">{when(c.createdAt)}</span>
                  </div>
                  <div>{c.text}</div>
                  {(c.replies ?? []).length > 0 && (
                    <ul className="replies">
                      {c.replies!.map((r) => (
                        <li key={r.id}>
                          <div className="c-head">
                            <span className="who">{r.author}</span>
                            <span className="when">{when(r.createdAt)}</span>
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
                      <div className="oc-cmt-bar">
                        <button className="btn" onClick={() => void sendReply(c.id)} disabled={!reply.trim()}>
                          {strings.comments.reply}
                        </button>
                        <button className="btn" onClick={() => void sendReply(c.id, true)} disabled={!reply.trim()}>
                          {strings.comments.replyResolve}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="oc-cmt-bar">
                    {replyTo !== c.id && (
                      <button className="btn oc-plain" onClick={() => setReplyTo(c.id)}>
                        {strings.comments.reply}
                      </button>
                    )}
                    <button className="btn oc-plain" onClick={() => api.post("/api/comments", { action: "resolve", id: c.id, resolved: !c.resolved })}>
                      {c.resolved ? strings.comments.reopen : strings.comments.resolve}
                    </button>
                    {!c.resolved && props.onAskAI && (
                      <button className="btn oc-plain" onClick={() => props.onAskAI!(c)} title={strings.comments.sendToAITitle}>
                        {strings.comments.sendToAI}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {onEl ? (
        <footer className="pp-actions" aria-label={strings.inspector.actions} ref={footRef}>
          {props.onDuplicate && (
            <button className="btn" onClick={props.onDuplicate}>
              {strings.properties.duplicate}
            </button>
          )}
          <button className="btn" onClick={copy}>
            {copied ? strings.inspector.copied : strings.inspector.copy}
          </button>
          <button className="btn" onClick={takeShot} disabled={busy} title={strings.inspector.screenshotTitle}>
            {busy ? strings.inspector.capturing : strings.inspector.screenshot}
          </button>
          {props.onDelete && (
            <button className="icon-btn pp-del" aria-label={strings.properties.delete} title={strings.boardOptions.deleteTitleKey} onClick={props.onDelete}>
              <Icon name="trash" />
            </button>
          )}
        </footer>
      ) : (
        props.footer
      )}
    </div>
  );
}
