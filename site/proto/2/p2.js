// Prototype 2: one real board beside its real file. The edits run through Easel's own code (edit.js, see edit-entry.mjs):
// pathOf finds the element's path as the canvas does, applyEdit patches that source range, fillProp/tokenRef pick what a fill writes.
(() => {
  "use strict";
  const E = window.EaselEdit;
  const $ = (s) => document.querySelector(s);
  const ORIGINAL = JSON.parse($("#home-src").textContent);
  const TOKENS = JSON.parse($("#tokens").textContent);
  const BASE = new URL("../../canvas/screens/", location.href).href;
  const frame = $("#frame"), board = $("#board"), sel = $("#sel"), etb = $("#etb"), srcEl = $("#src");
  let src = ORIGINAL;
  let selected = null; // element path
  let change = null; // { lines: [index], before: [text] }
  const TITLE = 'next-title display splice';

  const k = () => parseFloat(getComputedStyle(board).getPropertyValue("--k")) || 0.66;
  const doc = () => frame.contentDocument;
  const elAt = (path) => {
    let n = doc()?.body;
    if (path) for (const p of path.split("/")) n = n?.children[Number(p)];
    return n ?? null;
  };
  const titleEl = () => doc()?.querySelector(".next-title.splice");

  /* ---------- The source, with the lines Easel rewrote ---------- */
  const titleLine = ORIGINAL.split("\n").findIndex((l) => l.includes(TITLE));
  function showSource() {
    const lines = src.split("\n");
    const focus = change ? change.lines[0] : titleLine;
    const near = (i) => Math.abs(i - focus) <= 3;
    const esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    srcEl.innerHTML = lines
      .map((l, i) => {
        const at = change && change.lines.indexOf(i);
        const cls = near(i) ? " near" : "";
        if (change && at >= 0) return `<span class="ln del${cls}" data-n="−" aria-label="removed">${esc(change.before[at]) || " "}</span><span class="ln add${cls}" data-n="${i + 1}" id="${at === 0 ? "first-change" : ""}">${esc(l) || " "}</span>`;
        return `<span class="ln${cls}" data-n="${i + 1}">${esc(l) || " "}</span>`;
      })
      .join("");
    const target = $("#first-change") ?? srcEl.querySelector(`[data-n="${titleLine + 1}"]`);
    if (target) srcEl.scrollTop = Math.max(0, target.offsetTop - srcEl.clientHeight / 2);
  }

  /* ---------- The board ---------- */
  function render(path) {
    const html = /<head[^>]*>/i.test(src) ? src.replace(/<head[^>]*>/i, (m) => `${m}<base href="${BASE}">`) : `<base href="${BASE}">` + src;
    frame.addEventListener("load", () => wire(path), { once: true });
    frame.srcdoc = html;
  }
  function wire(path) {
    const d = doc();
    // Links on the board would leave the page: a click selects instead, as on the canvas
    d.addEventListener("click", (e) => {
      e.preventDefault();
      if (!editing) select(e.target);
    }, true);
    d.addEventListener("dblclick", (e) => {
      e.preventDefault();
      startEdit(e.target);
    });
    select(path ? elAt(path) : titleEl());
  }
  function select(el) {
    if (!el || el === doc().body || el === doc().documentElement) return;
    selected = E.pathOf(el);
    const r = el.getBoundingClientRect(), s = k();
    Object.assign(sel.style, { left: `${r.left * s}px`, top: `${r.top * s}px`, width: `${r.width * s}px`, height: `${r.height * s}px` });
    sel.hidden = false;
    const { label } = E.kindLabel(el);
    $("#etb-name").textContent = label || el.tagName.toLowerCase();
    etb.hidden = false;
  }

  /* ---------- Edit 1: retype a text in place ---------- */
  let editing = null;
  function startEdit(el) {
    if (!el || el.children.length || !el.textContent.trim()) return; // single text only, as the canvas does
    select(el);
    editing = el;
    const before = el.innerText;
    el.contentEditable = "true";
    el.focus();
    const range = doc().createRange();
    range.selectNodeContents(el);
    const s = doc().getSelection();
    s.removeAllRanges();
    s.addRange(range);
    const finish = (keep) => {
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("blur", onBlur);
      el.contentEditable = "false";
      editing = null;
      const text = el.innerText.replace(/\n$/, "");
      if (!keep || text === before) {
        el.innerText = before;
        return;
      }
      apply({ op: "setText", path: E.pathOf(el), text }, el);
    };
    const onKey = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") finish(false);
    };
    const onBlur = () => finish(true);
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", onBlur);
  }

  /* ---------- Edit 2: a fill from the screen's own tokens ---------- */
  function rootVars() {
    const vars = {};
    for (const sheet of doc().styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const r of rules) if (r.selectorText === ":root") for (const p of r.style) if (p.startsWith("--")) vars[p] = r.style.getPropertyValue(p).trim();
    }
    return vars;
  }
  const sw = $("#swatches");
  for (const t of TOKENS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sw-btn";
    b.style.background = t.value;
    b.title = b.ariaLabel = `Fill: ${t.name}`;
    b.addEventListener("click", () => {
      const el = elAt(selected);
      if (!el) return;
      const { kind } = E.kindLabel(el);
      const prop = E.fillProp(kind, getComputedStyle(el).backgroundColor);
      apply({ op: "setStyle", path: selected, prop, value: E.tokenRef(t, rootVars()) }, el);
    });
    sw.append(b);
  }

  /* ---------- Applying an edit: Easel's applyEdit, then the board redrawn from the new file ---------- */
  function apply(req, el) {
    let next;
    try {
      next = E.applyEdit(src, req);
    } catch (e) {
      $("#diffline").textContent = `Easel refused that edit: ${e.message}`;
      return;
    }
    if (next === src) return;
    const a = src.split("\n"), b = next.split("\n");
    const lines = b.map((_, i) => i).filter((i) => a[i] !== b[i]);
    change = { lines, before: lines.map((i) => a[i] ?? "") };
    src = next;
    const n = lines.length;
    $("#diffline").innerHTML = a.length === b.length ? `Easel rewrote <strong>${n === 1 ? `line ${lines[0] + 1}` : `${n} lines`}</strong> of <code>screens/home.html</code>. The other ${b.length - n} lines are byte for byte as they were.` : "Easel rewrote part of the file.";
    $("#src-status").textContent = "after your edit";
    $("#reset").disabled = false;
    showSource();
    render(req.path ?? E.pathOf(el));
    // On a phone the source sits under the board: bring the changed line into view
    if (matchMedia("(max-width: 899px)").matches) srcEl.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  $("#reset").addEventListener("click", () => {
    src = ORIGINAL;
    change = null;
    $("#diffline").textContent = "";
    $("#src-status").textContent = "the file, as it is now";
    $("#reset").disabled = true;
    showSource();
    render(null);
  });
  $("#kbd-edit").addEventListener("click", () => startEdit(titleEl()));

  /* ---------- Ask an agent instead: the recorded real run on this screen ---------- */
  const dlg = $("#agent-dlg"), vid = $("#agent-video");
  $("#agent").addEventListener("click", () => {
    vid.poster = "../../media/proto-ask-poster-1920.webp";
    dlg.showModal();
    vid.currentTime = 13.1;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) vid.play().catch(() => {});
  });
  const close = () => (vid.pause(), dlg.close());
  $("#agent-close").addEventListener("click", close);
  dlg.addEventListener("close", () => vid.pause());

  if (!E) {
    $("#diffline").textContent = "Easel’s edit code didn’t load, so this screen is read-only.";
    return;
  }
  showSource();
  render(null);
})();
