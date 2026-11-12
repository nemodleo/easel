// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Who changed what: the elements a change touched (pure, on the two HTML texts with parse5; board scripts never run), a short name for
// every history step, board tags (one per author per board, only someone else's changes), and the routes behind the tags and History.
import path from "node:path";

import { isTrackedRel } from "./copies.mjs";
import { toPosix } from "./fsutil.mjs";
import { fileList } from "./history.mjs";
import { elementChildren, findBody, parseHtml, textOf } from "./html.mjs";
import { readBody, safeJoin, sendJson } from "./index.mjs";
import { dropMissingAutoPlaced, mergeSteps, undoChanges, withBase } from "./runs.mjs";

/** More changed elements than this: no outline, only the tag */
export const MAX_OUTLINE = 5;
/** The diff stops collecting past this many items (a rewritten screen) */
const CAP = 60;
/** Elements that are never drawn: a change to them is not outlined */
const HIDDEN = new Set(["script", "style", "template", "meta", "link", "noscript", "title", "base"]);

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, n = 80) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const srcOf = (html, n) => {
  const l = n?.sourceCodeLocation;
  return l ? html.slice(l.startOffset, l.endOffset) : null;
};
const ownText = (n) => norm((n.childNodes ?? []).filter((c) => c.nodeName === "#text").map((c) => c.value).join(" "));
const attrsOf = (n) => new Map((n.attrs ?? []).map((a) => [a.name, a.value]));
const clsOf = (n) => n.attrs?.find((a) => a.name === "class")?.value.trim().split(/\s+/)[0] || undefined;
/** <head> as text (an implied <head> has no source range of its own, its children do) */
const headText = (doc, html) => {
  const head = doc.childNodes.find((n) => n.tagName === "html")?.childNodes.find((n) => n.tagName === "head");
  return (head?.childNodes ?? []).map((n) => srcOf(html, n) ?? n.value ?? "").join("");
};
const parseJson = (t) => {
  try {
    return t ? JSON.parse(t) : {};
  } catch {
    return null;
  }
};

/**
 * Elements that differ between two versions of a screen, by the path /api/outline, /api/element and comments use (element indexes
 * from the children of <body>, in the after version). Children are matched by equal source at both ends; the rest pairs up in order
 * and the surplus is added (paths in after) or removed (the parent's path). items: { path, kind: text|style|attr|added|removed|replaced,
 * tag, cls?, from?, to? }; head: the <head> changed (styles, title). full: more than CAP items, the list is cut
 */
export function changedElements(before, after) {
  const a = parseHtml(before);
  const b = parseHtml(after);
  const items = [];
  const same = (x, y) => {
    const sx = srcOf(before, x);
    return sx != null && sx === srcOf(after, y);
  };
  const walk = (x, y, p) => {
    if (items.length >= CAP || same(x, y)) return;
    const at = (i) => (p ? `${p}/${i}` : String(i));
    if (x.tagName !== y.tagName) return void items.push({ path: p, kind: "replaced", tag: y.tagName, cls: clsOf(y) });
    const ax = attrsOf(x);
    const ay = attrsOf(y);
    const names = [...new Set([...ax.keys(), ...ay.keys()])].filter((k) => ax.get(k) !== ay.get(k));
    if (names.length) items.push({ path: p, kind: names.every((k) => k === "style") ? "style" : "attr", tag: y.tagName, cls: clsOf(y) });
    if (HIDDEN.has(y.tagName)) {
      // A <style> or <script> inside body: its text is code, not copy
      if (!names.length && (srcOf(before, x) ?? "") !== (srcOf(after, y) ?? "")) items.push({ path: p, kind: y.tagName === "style" ? "style" : "attr", tag: y.tagName });
      return;
    }
    if (ownText(x) !== ownText(y)) items.push({ path: p, kind: "text", tag: y.tagName, cls: clsOf(y), from: clip(norm(textOf(x))), to: clip(norm(textOf(y))) });
    const cx = elementChildren(x);
    const cy = elementChildren(y);
    let s = 0;
    while (s < cx.length && s < cy.length && same(cx[s], cy[s])) s++;
    let e = 0;
    while (e < cx.length - s && e < cy.length - s && same(cx[cx.length - 1 - e], cy[cy.length - 1 - e])) e++;
    const mx = cx.slice(s, cx.length - e);
    const my = cy.slice(s, cy.length - e);
    const k = Math.min(mx.length, my.length);
    for (let i = 0; i < k; i++) walk(mx[i], my[i], at(s + i));
    for (let i = k; i < my.length && items.length < CAP; i++) items.push({ path: at(s + i), kind: "added", tag: my[i].tagName, cls: clsOf(my[i]) });
    if (mx.length > k) items.push({ path: p, kind: "removed", tag: mx[k].tagName, cls: clsOf(mx[k]), count: mx.length - k });
  };
  const bx = findBody(a);
  const by = findBody(b);
  if (bx && by) walk(bx, by, "");
  return { items, head: headText(a, before) !== headText(b, after), full: items.length >= CAP };
}

/**
 * One change to one screen in a few fields for the tag popover: kind (text, style, attr, added, removed, replaced, many, page: only
 * <head>, source: only whitespace or comments, new: the board was created, deleted), count of changed elements, the element (tag, cls),
 * from/to for a text change, and paths to outline — none when it cannot be pinned to at most MAX_OUTLINE elements
 */
export function describeChange(before, after) {
  if (before == null) return { kind: "new", count: 1, paths: [] };
  if (after == null) return { kind: "deleted", count: 1, paths: [] };
  const { items, head, full } = changedElements(before, after);
  if (!items.length) return { kind: head ? "page" : "source", count: 0, paths: [] };
  const els = [...new Set(items.map((i) => i.path))];
  const shown = els.filter((p) => p !== "" && !items.some((i) => i.path === p && HIDDEN.has(i.tag)));
  const paths = !full && shown.length <= MAX_OUTLINE ? shown : [];
  if (full || els.length > 1) return { kind: "many", count: els.length, ...(full ? { more: true } : {}), paths };
  const first = items[0];
  if (items.length === 1 && first.kind === "text") return { kind: "text", count: 1, tag: first.tag, cls: first.cls, from: first.from, to: first.to, paths };
  // One element, several kinds of change (its text and its style): "edited"
  const kind = items.every((i) => i.kind === "style") ? "style" : items.length === 1 ? first.kind : "edited";
  return { kind, count: first.count ?? 1, tag: first.tag, cls: first.cls, paths };
}

/** board.json boards entries that a change added, removed, moved, resized, renamed or otherwise changed (board files) */
export function boardEntries(beforeText, afterText) {
  const a = parseJson(beforeText)?.boards ?? {};
  const b = parseJson(afterText)?.boards ?? {};
  const out = { added: [], removed: [], moved: [], resized: [], renamed: [], changed: [] };
  for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[f];
    const y = b[f];
    if (!x && y) out.added.push(f);
    else if (x && !y) out.removed.push(f);
    else if (JSON.stringify(x) !== JSON.stringify(y)) {
      if (x.w !== y.w || x.h !== y.h) out.resized.push(f);
      else if (x.x !== y.x || x.y !== y.y) out.moved.push(f);
      else if (x.title !== y.title) out.renamed.push(f);
      else out.changed.push(f);
    }
  }
  return out;
}

/* ---------- Step names ---------- */
const EDIT_OPS = { setText: "Change text on", setStyle: "Change style on", setAttr: "Change attribute on", delete: "Delete element on", duplicate: "Duplicate element on", move: "Move element on", insert: "Add element on", setTweaks: "Change tweaks on", batch: "Edit", wrap: "Group elements on" };
/** App labels for board.json steps that are about some boards: named after them */
const BOARD_LABELS = new Set(["Move board", "Resize board", "Board options", "Bring to front", "Send to back", "Move to page", "Set launch screen"]);
/** What the text of an element is called in a step name */
const copyNoun = (tag) => (tag === "button" ? "button copy" : tag === "a" ? "link text" : /^h[1-6]$/.test(tag) ? "heading" : tag === "label" ? "label" : "text");

/**
 * A short human name for a history step: "Change button copy on Welcome", "Move board Inbox", "Add board Pricing", "Add note".
 * Steps the app labels by file and operation, board operations and changes made outside the app (or by a run) are named after the
 * boards; the text wording only when the diff really is one text node. env: { screensDir, boardPath, titles: { file: title } }
 */
export function stepName(step, env, describe = describeChange) {
  const label = step.label ?? "";
  // A board this step removed (a version "Use this" sent to trash) is named as board.json had it before the step
  const was = () => parseJson(step.changes.find((c) => c.path === env.boardPath)?.before)?.boards ?? {};
  const title = (f) => env.titles?.[f] || was()[f]?.title || f.replace(/\.html$/, "");
  const rel = (p) => toPosix(path.relative(env.screensDir, p));
  const html = step.changes.filter((c) => c.path.endsWith(".html") && !rel(c.path).startsWith(".."));
  const textOf1 = (c) => {
    const d = c && c.before != null && c.after != null ? describe(c.before, c.after) : null;
    return d?.kind === "text" ? d : null;
  };
  const boardsIn = () => {
    const bj = step.changes.find((c) => c.path === env.boardPath);
    const d = bj ? boardEntries(bj.before, bj.after) : null;
    return d ? [...new Set([...d.moved, ...d.resized, ...d.renamed, ...d.changed])] : [];
  };
  const several = (verb, n) => `${verb} ${n} boards`;
  let m = /^(.+\.html) (\w+)$/.exec(label);
  if (m && EDIT_OPS[m[2]]) {
    const t = html.length === 1 ? textOf1(html[0]) : null;
    return t ? `Change ${copyNoun(t.tag)} on ${title(m[1])}` : `${EDIT_OPS[m[2]]} ${title(m[1])}`;
  }
  if ((m = /^Create board (.+)$/.exec(label))) return `Add board ${title(m[1])}`;
  // One writer per board, and picking a version (server/forks.mjs)
  if ((m = /^Fork (.+\.html) for (.+)$/.exec(label))) return `Fork ${title(m[1])} for ${m[2]}`;
  if ((m = /^Use (.+\.html) for (.+\.html)$/.exec(label))) return `Use ${title(m[1]).replace(/:.*$/, "")} for ${title(m[2])}`;
  if ((m = /^Keep (.+\.html), trash (.+)$/.exec(label))) return `Keep ${title(m[1])}, trash ${fileList(m[2].split(", ").map(title))}`;
  if ((m = /^Keep all (variants|versions) of (.+\.html)$/.exec(label))) return `Keep all ${m[1]} of ${title(m[2])}`;
  if ((m = /^Write board (.+\.html)$/.exec(label))) {
    if (html.length === 1 && html[0].before == null) return `Add board ${title(m[1])}`;
    const t = html.length === 1 ? textOf1(html[0]) : null;
    return t ? `Change ${copyNoun(t.tag)} on ${title(m[1])}` : `Change ${title(m[1])}`;
  }
  if ((m = /^Duplicate board (.+)$/.exec(label))) return `Duplicate board ${title(m[1])}`;
  if ((m = /^Delete board (.+)$/.exec(label))) {
    const files = m[1].split(", ");
    return files.length === 1 ? `Delete board ${title(files[0])}` : several("Delete", files.length);
  }
  if ((m = /^Rename (?!file )(.+\.html)$/.exec(label))) return `Rename board ${title(m[1])}`;
  if (BOARD_LABELS.has(label)) {
    const files = boardsIn();
    if (files.length === 1) return `${label} ${title(files[0])}`;
    if (files.length > 1) return /^(Move|Resize) board$/.test(label) ? several(label.split(" ")[0], files.length) : `${label} · ${files.length} boards`;
    return label;
  }
  if (!step.outside) return label;
  // Changes found on disk (an agent's own file tools, an editor, an in-app run): named after the boards
  const added = html.filter((c) => c.before == null);
  const removed = html.filter((c) => c.after == null);
  const changed = html.filter((c) => c.before != null && c.after != null);
  const fileOf = (c) => rel(c.path);
  if (!html.length) {
    const files = boardsIn();
    return files.length === 1 ? `Change board ${title(files[0])}` : files.length ? several("Change", files.length) : "Change board.json";
  }
  if (added.length === html.length) return added.length === 1 ? `Add board ${title(fileOf(added[0]))}` : several("Add", added.length);
  if (removed.length === html.length) return removed.length === 1 ? `Delete board ${title(fileOf(removed[0]))}` : several("Delete", removed.length);
  if (changed.length === 1 && html.length === 1) {
    const t = textOf1(changed[0]);
    return t ? `Change ${copyNoun(t.tag)} on ${title(fileOf(changed[0]))}` : `Change ${title(fileOf(changed[0]))}`;
  }
  return `Change ${fileList(html.map((c) => title(fileOf(c))))}`;
}

/** Boards a step touched, for its tags: screens it changed, added or removed (with the change described) and boards it moved or resized */
export function stepBoards(step, env, describe = describeChange) {
  const out = new Map();
  for (const c of step.changes) {
    if (c.path === env.boardPath) continue;
    const rel = toPosix(path.relative(env.screensDir, c.path));
    if (!c.path.endsWith(".html") || rel.startsWith("..")) continue;
    out.set(rel, { file: rel, kind: c.before == null ? "added" : c.after == null ? "removed" : "changed", change: describe(c.before, c.after), path: c.path, after: c.after });
  }
  const bj = step.changes.find((c) => c.path === env.boardPath);
  if (bj) {
    const d = boardEntries(bj.before, bj.after);
    for (const kind of ["moved", "resized", "renamed", "changed"])
      for (const f of d[kind]) if (!out.has(f)) out.set(f, { file: f, kind: "board", change: { kind: kind === "changed" ? "options" : kind, count: 1, paths: [] } });
  }
  return [...out.values()];
}

/**
 * Board tags from the applied steps (oldest first): per board, one tag per author, newest first. Leaves out steps made in the browser
 * asking (client) and steps an applied undo took back (undid, or undoOf for a chat run). Each tag: who (by, person, outside), its step ids (newest first),
 * count, at (newest), newBoard (its oldest step created the board), the newest change and its paths when that change is still on disk (fresh)
 */
export function boardTags(steps, client) {
  // Taken back: steps a tag Undo undid, and chat runs undone by Undo this run (until a later Redo of that run)
  const taken = new Set();
  for (const s of steps) {
    for (const id of s.undid ?? []) taken.add(id);
    if (s.undoOf) taken.add(`run:${s.undoOf}`);
    if (s.redoOf) taken.delete(`run:${s.redoOf}`);
  }
  const tags = {};
  for (const s of steps) {
    if (taken.has(s.id) || (s.run && taken.has(`run:${s.run}`)) || (client && s.client === client)) continue;
    const key = s.by ? `a:${s.by}` : s.person ? `p:${s.person}` : s.outside ? "outside" : "app";
    for (const b of s.boards) {
      const list = (tags[b.file] ??= []);
      let t = list.find((x) => x.key === key);
      if (!t) {
        t = { key, ...(s.by ? { by: s.by } : s.person ? { person: s.person } : {}), outside: key === "outside", steps: [], count: 0, at: 0, newBoard: b.kind === "added", change: null, paths: [], runs: new Set() };
        list.push(t);
      }
      t.steps.unshift(s.id);
      t.count++;
      t.at = Math.max(t.at, s.lastAt ?? s.at);
      t.change = b.change;
      t.paths = b.fresh ? (b.change?.paths ?? []) : [];
      t.runs.add(s.run ?? null);
    }
  }
  for (const f of Object.keys(tags)) {
    // A board that is gone again has nothing to hang a tag on
    if (tags[f].every((t) => t.change?.kind === "deleted")) delete tags[f];
    else tags[f] = tags[f].sort((a, b) => b.at - a.at).map(({ runs, ...t }) => ({ ...t, run: runs.size === 1 ? [...runs][0] : null }));
  }
  return tags;
}

/* ---------- What the app reads ---------- */
const cache = new WeakMap(); // step → { rev, boards }

/** Per step: its name, author and boards (cached while the step is unchanged), as the tags and the History menu need them */
function stepInfo(ctx, step, env) {
  let c = cache.get(step);
  if (!c || c.rev !== (step.rev ?? 0)) cache.set(step, (c = { rev: step.rev ?? 0, boards: stepBoards(step, env) }));
  const describe = (before, after) => c.boards.find((b) => b.after === after)?.change ?? describeChange(before, after);
  return {
    id: step.id,
    name: stepName(step, env, describe),
    label: step.label,
    ...(step.by ? { by: step.by } : step.person ? { person: step.person } : {}),
    ...(step.client ? { client: step.client } : {}),
    outside: !!step.outside,
    ...(step.run ? { run: step.run } : {}),
    ...(step.undid ? { undid: step.undid } : {}),
    ...(step.undoOf ? { undoOf: step.undoOf } : {}),
    ...(step.redoOf ? { redoOf: step.redoOf } : {}),
    at: step.lastAt ?? step.at,
    boards: c.boards.map(({ path: p, after, ...b }) => ({ ...b, fresh: !!p && ctx.history.current(p) === after })),
  };
}

/** What step names need: where the screens and board.json are, and the board titles now */
async function envOf(ctx) {
  const board = await ctx.store.readBoard();
  return { screensDir: ctx.store.screensDir, boardPath: ctx.store.boardPath, titles: Object.fromEntries(Object.entries(board.boards).map(([f, b]) => [f, b.title])) };
}

/** Steps for the History menu (newest first, with Now) and board tags for the browser asking (client) */
export async function activity(ctx, client) {
  const env = await envOf(ctx);
  const { undo, redo } = ctx.history.entries();
  const applied = undo.map((s) => stepInfo(ctx, s, env));
  const undone = redo.map((s) => stepInfo(ctx, s, env));
  const row = ({ boards, client: c, ...s }) => ({ ...s, mine: !!client && c === client });
  return {
    boot: ctx.boot,
    // History menu, newest first: undone steps (the next redo last), then the applied ones; "now" is the newest applied step
    steps: [...undone.map((s) => ({ ...row(s), undone: true })), ...[...applied].reverse().map((s, i) => ({ ...row(s), ...(i === 0 ? { now: true } : {}) }))],
    tags: boardTags(applied, client),
  };
}

export function activityRoutes() {
  return [
    ["GET", "/api/activity", async (req, res, url, ctx) => sendJson(res, 200, await activity(ctx, url.searchParams.get("client") ?? ""))],
    // History › Go back to here: a walk along the undo stack, so Redo brings everything back
    [
      "POST",
      "/api/history/goto",
      async (req, res, url, ctx) => {
        const { id } = await readBody(req);
        try {
          const moved = await ctx.history.goTo(String(id ?? ""));
          await dropMissingAutoPlaced(ctx);
          await ctx.store.syncBoardNow();
          sendJson(res, 200, { ok: true, moved });
        } finally {
          ctx.broadcast({ type: "board-changed", source: "server:goto" });
          ctx.broadcast({ type: "history-changed" });
        }
      },
    ],
    // Undo from a board tag: the tag's steps, a plain undo when they are the newest, else only their files (409 with the boards changed
    // since unless mode is "rest" or "all") — the rule of Undo this run, through the same helper
    [
      "POST",
      "/api/history/undo-steps",
      async (req, res, url, ctx) => {
        const b = await readBody(req);
        const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(String))].slice(0, 100);
        await ctx.history.observe();
        const { undo } = ctx.history.entries();
        const steps = undo.filter((s) => ids.includes(s.id));
        if (!steps.length || steps.length !== ids.length) return sendJson(res, 409, { error: "These changes are no longer in the undo history" });
        const top = undo.slice(-steps.length);
        const onTop = top.every((s) => steps.includes(s)) ? steps.length : 0;
        const label = steps.length === 1 ? `Undo ${stepName(steps[0], await envOf(ctx))}` : `Undo ${steps.length} changes`;
        const r = await undoChanges(ctx, { onTop, changes: mergeSteps(steps), mode: b.mode, label, mark: { undid: steps.map((s) => s.id) } });
        if (r.conflicts) return sendJson(res, 409, { conflicts: r.conflicts, error: "Some boards changed since" });
        await ctx.store.syncBoardNow();
        ctx.broadcast({ type: "board-changed", source: "server:undo-steps" });
        ctx.broadcast({ type: "history-changed" });
        sendJson(res, 200, { ok: true, changed: r.changed });
      },
    ],
    // Read-only: a screen as it was before a history step (Compare's "before" for a tag), from the history in memory
    [
      "GET",
      "/api/history/step-file",
      async (req, res, url, ctx) => {
        const f = url.searchParams.get("f") ?? "";
        const id = url.searchParams.get("id") ?? "";
        const p = isTrackedRel(`screens/${f}`) ? safeJoin(ctx.store.screensDir, f) : null;
        const { undo, redo } = ctx.history.entries();
        const step = p && [...undo, ...redo].find((s) => s.id === id);
        const c = step?.changes.find((x) => x.path === p);
        if (!c || c.before == null) return sendJson(res, 404, { error: "No earlier version of that screen in this step" });
        const out = withBase(c.before, f);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(out), "Cache-Control": "no-store" });
        res.end(out);
      },
    ],
  ];
}
