// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Renders an agent answer from mdparse.ts as React elements (never as HTML): small headings, lists, code blocks with Copy, safe links.
import { useMemo, useState } from "react";

import { Icon } from "./icons";
import { parseMarkdown, type Block, type Inline, type List } from "./mdparse";
import { strings } from "./strings";

function Spans({ c }: { c: Inline[] }) {
  return (
    <>
      {c.map((x, i) =>
        x.t === "text" ? (
          x.v
        ) : x.t === "code" ? (
          <code key={i}>{x.v}</code>
        ) : x.t === "b" ? (
          <strong key={i}>
            <Spans c={x.c} />
          </strong>
        ) : x.t === "i" ? (
          <em key={i}>
            <Spans c={x.c} />
          </em>
        ) : x.t === "a" ? (
          <a key={i} href={x.href} target="_blank" rel="noopener noreferrer">
            <Spans c={x.c} />
          </a>
        ) : (
          <br key={i} />
        ),
      )}
    </>
  );
}

function ListView({ list }: { list: List }) {
  const items = list.items.map((it, i) => (
    <li key={i}>
      <Spans c={it.c} />
      {it.sub && <ListView list={it.sub} />}
    </li>
  ));
  return list.t === "ol" ? <ol start={list.start}>{items}</ol> : <ul>{items}</ul>;
}

function CodeBlock({ v }: { v: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="codeblock">
      <button
        className="copy"
        onClick={() =>
          void navigator.clipboard?.writeText(v).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        <Icon name="copy" size={12} /> {copied ? strings.chat.copied : strings.chat.copy}
      </button>
      <pre>
        <code>{v}</code>
      </pre>
    </div>
  );
}

const BlockView = ({ b }: { b: Block }) =>
  b.t === "p" ? (
    <p>
      <Spans c={b.c} />
    </p>
  ) : b.t === "h" ? (
    <p className={`md-h h${Math.min(b.level, 3)}`} role="heading" aria-level={b.level}>
      <Spans c={b.c} />
    </p>
  ) : b.t === "code" ? (
    <CodeBlock v={b.v} />
  ) : b.t === "hr" ? (
    <hr />
  ) : (
    <ListView list={b} />
  );

/** Markdown text of an agent answer; re-parsed as it streams in (an open fence shows as a code block right away) */
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={`md ${className}`}>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
    </div>
  );
}
