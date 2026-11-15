// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
// Layer list: element tree of the source HTML. Click to select; drop onto another item to move in front of it (move). PLAN.md section 5.
import { useEffect, useState } from "react";

import { api } from "./api";
import { Icon } from "./icons";
import { strings } from "./strings";

type Node = { path: string; tag: string; cls?: string; text: string; children: Node[] };

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const indexOf = (p: string) => Number(p.split("/").pop());

export function Layers(props: { file: string; version: number; selected: string[]; onSelect: (path: string, add: boolean) => void; onMove: (path: string, toParentPath: string, index: number) => void }) {
  const [tree, setTree] = useState<Node[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({ "0": true });
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ tree: Node[] }>(`/api/outline?f=${encodeURIComponent(props.file)}`)
      .then((r) => setTree(r.tree))
      .catch(() => setTree([]));
  }, [props.file, props.version]);

  // Expand ancestors so the selected element is visible
  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const p of props.selected) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) next[parts.slice(0, i).join("/")] = true;
    }
    if (Object.keys(next).length) setOpen((o) => ({ ...o, ...next }));
  }, [props.selected.join("|")]);

  const drop = (target: string) => {
    if (!dragging || dragging === target || target.startsWith(dragging + "/")) return;
    const toParent = parentOf(target);
    let index = indexOf(target);
    // The server index is the sibling order excluding the item itself: subtract one when moving later within the same parent
    if (parentOf(dragging) === toParent && indexOf(dragging) < index) index -= 1;
    props.onMove(dragging, toParent, index);
  };

  // Arrow navigation: order of visible rows
  const visible: Node[] = [];
  const byPath = new Map<string, Node>();
  const flat = (ns: Node[]) => {
    for (const n of ns) {
      visible.push(n);
      byPath.set(n.path, n);
      if (n.children.length && open[n.path]) flat(n.children);
    }
  };
  flat(tree);
  const cur = focus ?? props.selected[props.selected.length - 1] ?? visible[0]?.path ?? null;
  const go = (p: string | undefined | null) => {
    if (p == null || !byPath.has(p)) return;
    setFocus(p);
    props.onSelect(p, false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!cur) return;
    const i = visible.findIndex((n) => n.path === cur);
    const n = byPath.get(cur);
    const keys: Record<string, () => void> = {
      ArrowDown: () => go(visible[i + 1]?.path),
      ArrowUp: () => go(visible[i - 1]?.path),
      ArrowRight: () => (n?.children.length ? (open[cur] ? go(n.children[0].path) : setOpen((o) => ({ ...o, [cur]: true }))) : undefined),
      ArrowLeft: () => (n?.children.length && open[cur] ? setOpen((o) => ({ ...o, [cur]: false })) : go(cur.includes("/") ? parentOf(cur) : null)),
      Home: () => go(visible[0]?.path),
      End: () => go(visible[visible.length - 1]?.path),
      Enter: () => go(cur),
      " ": () => go(cur),
    };
    const f = keys[e.key];
    if (f) {
      e.preventDefault();
      e.stopPropagation();
      f();
    }
  };

  const row = (n: Node, depth: number) => {
    const has = n.children.length > 0;
    const isOpen = open[n.path];
    return (
      <li key={n.path}>
        <div
          role="treeitem"
          aria-selected={props.selected.includes(n.path)}
          aria-expanded={has ? !!isOpen : undefined}
          aria-level={depth + 1}
          className={`layer ${props.selected.includes(n.path) ? "on" : ""} ${over === n.path ? "over" : ""} ${cur === n.path ? "kbd-focus" : ""}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          draggable
          onDragStart={(e) => {
            setDragging(n.path);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            setDragging(null);
            setOver(null);
          }}
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            setOver(n.path);
          }}
          onDragLeave={() => setOver((o) => (o === n.path ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            drop(n.path);
            setOver(null);
          }}
          onClick={(e) => {
            setFocus(n.path);
            props.onSelect(n.path, e.shiftKey);
          }}
        >
          <button
            className="twisty"
            tabIndex={-1}
            aria-label={isOpen ? strings.layers.collapse : strings.layers.expand}
            style={{ visibility: has ? "visible" : "hidden" }}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => ({ ...o, [n.path]: !isOpen }));
            }}
          >
            <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={14} />
          </button>
          <span className="tag">{n.tag}</span>
          <span className="lname">
            {n.cls && `.${n.cls}`}
            {n.cls && n.text && " · "}
            {n.text}
          </span>
        </div>
        {has && isOpen && <ul>{n.children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <section className="pp-group layers">
      {/* How to drag, multi-select and move by keys: the heading's tooltip, so the tree starts right under it */}
      <h3 className="pp-group-h" title={strings.layers.hint}>
        {strings.layers.title}
      </h3>
      <ul className="layer-tree" role="tree" aria-label={strings.layers.title} title={strings.layers.hint} tabIndex={0} onKeyDown={onKey}>
        {tree.map((n) => row(n, 0))}
      </ul>
    </section>
  );
}
