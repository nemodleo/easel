// Round 4 stage: the three real boards of one run, as Easel draws them (labels, tags, spinner, Use this one, the confirm, the block
// caption, the toast: app.css and app-strings.js, both from main), the pick, and the replay of the real run N× faster.
// The three always sit in one row, scaled to the width there is. Below about 210px a board is a thumbnail: the label takes the app's
// compact form (the title, or for a fork its agent, and the check alone), and tapping a version opens it large, with Use this one.
(() => {
  "use strict";
  const R = window.EaselRun, A = window.EaselApp, O = A.occupancy;
  const stage = document.getElementById("stage");
  if (!R || !A || !stage) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = matchMedia("(max-width: 899px)");
  const WHO = { claude: "Claude Code", codex: "Codex", cursor: "Cursor" };
  const FILE = { claude: "empty-day.html", codex: "empty-day-codex.html", cursor: "empty-day-cursor.html" };
  const ORDER = ["claude", "codex", "cursor"];
  const SCREENS = "../r4/screens/";
  const T0 = Date.parse(R.t0);
  const END = R.end;
  const title = (w) => R.titles[FILE[w]];
  const ORIGINAL = title("claude");
  const ev = R.events;
  const claimAt = Object.fromEntries(ORDER.map((w) => [w, ev[w].find((e) => e.tool === "claim_board").t]));
  const doneAt = (w) => R.times[w];
  const writes = Object.fromEntries(ORDER.map((w) => [w, ev[w].filter((e) => e.tool === "write_board")]));
  const svg = (d, size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const el = (tag, cls, html) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, html != null ? { innerHTML: html } : {});
  const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const live = document.getElementById("stage-live");
  const say = (t) => live && (live.textContent = t);
  const X = "M6 6l12 12M18 6L6 18";

  /* ---------- State ---------- */
  // t: real seconds since the three CLIs started (END or more: the run is over); picked: who was kept; keptAll; mini: thumbnails
  const S = { t: stage.dataset.start === "before" ? -1 : Infinity, picked: null, keptAll: false, playing: false, mini: false, big: null };

  /* ---------- What each version shows at time t ---------- */
  function view(w, t) {
    const fork = w !== "claude";
    const here = !fork || (t >= claimAt[w] && !S.picked);
    const forksNow = ORDER.filter((x) => x !== "claude" && t >= claimAt[x]);
    const busy = ORDER.filter((x) => t >= claimAt[x] && t < doneAt(x)).sort((a, b) => claimAt[a] - claimAt[b]);
    const who = S.picked && !fork ? S.picked : w; // after a pick the original shows the chosen version under its own name
    let tag = null;
    if (!S.picked && !S.keptAll && t >= claimAt[w]) {
      const editing = t < doneAt(w);
      tag = { editing, text: editing ? O.editing(WHO[w]) : O.done(WHO[w], O.clock(T0 + doneAt(w) * 1000)) };
    }
    const done = writes[w].filter((e) => e.t <= t);
    const src = S.picked && !fork ? FILE[S.picked] : t < 0 || !done.length ? "empty-day.before.html" : done[done.length - 1].shows;
    return {
      w, fork, here, who, tag, src, busy,
      title: fork && !S.picked ? title(w) : ORIGINAL,
      file: fork && !S.picked ? FILE[w] : FILE.claude,
      showUse: forksNow.length > 0 && !S.picked && !S.keptAll,
      running: t >= 0 && t < doneAt(w),
      secs: t < 0 ? "waiting" : t < doneAt(who) ? mmss(t) : `${doneAt(who)} s`,
    };
  }
  const useBtn = (v, compact) => {
    const label = O.useThisOne;
    const t = v.busy.length ? O.waitFor(WHO[v.busy[0]]) : compact ? label : O.useThisOneTitle(2);
    return `<button class="icon-btn sm use-btn ${v.busy.length ? "" : "ready"} ${compact ? "icon-only" : ""}" type="button" data-use="${v.w}" aria-haspopup="dialog" aria-expanded="false" ${v.busy.length ? `aria-disabled="true"` : ""} ${compact ? `aria-label="${escH(`${label}: ${WHO[v.w]}’s version`)}"` : ""} title="${escH(t)}">${svg(A.icons.check, 14)}${compact ? "" : `<span class="use-label">${escH(label)}</span>`}</button>`;
  };
  // The label above a board, as Canvas.tsx draws it: tags, then title · file · buttons; compact (zoomed out): one row
  function labelHTML(v, compact, words = false) {
    if (compact) {
      const head = v.fork && !S.picked
        ? `<span class="occ-tag fork-who ${v.tag?.editing ? "" : "done"}">${v.tag?.editing ? `<span class="spinner" aria-hidden="true"></span>` : svg(A.icons.comment, 16)}<span class="act-tag-text">${escH(WHO[v.w])}</span></span>`
        : `<span class="board-title">${escH(v.title)}</span>`;
      return { cls: "board-label compact fork-scene", html: `<span class="lab-row">${head}${v.showUse ? `<span class="board-btns pinned">${useBtn(v, !words)}</span>` : ""}</span>` };
    }
    const tag = v.tag ? `<span class="occ-tag ${v.tag.editing ? "" : "done"}" title="${escH(v.tag.text)}">${v.tag.editing ? `<span class="spinner" aria-hidden="true"></span>` : svg(A.icons.comment, 16)}<span class="act-tag-text">${escH(v.tag.text)}</span></span>` : "";
    return {
      cls: "board-label tagged fork-scene",
      html: `<span class="act-tags" role="group" aria-label="${escH(O.tagsAria)}">${tag}</span><span class="lab-row"><span class="board-title">${escH(v.title)}</span><span class="board-file">${escH(v.file)}</span><span class="board-btns pinned">${v.showUse ? useBtn(v, false) : ""}</span></span>`,
    };
  }
  const callText = (e, short) => {
    if (short) return e.tool === "check_tokens" ? `check_tokens: ${e.issues}` : e.tool;
    const f = e.args?.file ? ` ${e.args.file}` : "";
    if (e.tool === "claim_board") return `claim_board${f} → ${e.got}${e.forked ? " · fork" : ""}`;
    if (e.tool === "check_tokens") return `check_tokens: ${e.issues} issues`;
    if (e.tool === "add_comment") return `add_comment “${e.text}”`;
    return `${e.tool}${f}`;
  };
  const comment = (w) => ev[w].find((e) => e.tool === "add_comment");

  /* ---------- The columns: label (app), board (live iframe), maker, calls, comment (this page) ---------- */
  const row = stage.querySelector(".row");
  const cols = {};
  for (const w of ORDER) {
    const c = el("article", `v4 v4-${w}`);
    c.dataset.who = w;
    c.setAttribute("aria-label", `${WHO[w]}’s version`);
    c.innerHTML = `
      <div class="board" data-file="${FILE[w]}">
        <div class="board-label"></div>
        <div class="slot" aria-hidden="true"></div>
        <div class="board-frame"><iframe class="cur" loading="eager" width="390" height="844" tabindex="-1"></iframe></div>
        <button class="open-big" type="button" aria-label="Open ${WHO[w]}’s version large"></button>
      </div>
      <div class="maker"><b>${WHO[w]}</b><span class="secs"></span></div>
      <ol class="calls" aria-label="${WHO[w]}’s Easel tool calls"></ol>
      <p class="said"></p>`;
    row.append(c);
    cols[w] = c;
  }
  const capRow = el("div", "fork-caption-row", `<span></span>`);
  row.after(capRow);
  const arrow = el("div", "fork-arrow", `<svg aria-hidden="true"><path class="ln"/><path class="hd"/></svg>`);
  row.append(arrow);

  /* ---------- The board's live HTML: the next version loads behind the one shown, then takes its place ---------- */
  function setSrc(frame, file, name) {
    if (frame.dataset.src === file) return;
    frame.dataset.src = file;
    const cur = frame.querySelector("iframe.cur");
    if (!cur.getAttribute("src")) {
      cur.src = SCREENS + file;
      cur.title = `${name} (live HTML)`;
      return;
    }
    const next = el("iframe", "next");
    Object.assign(next, { width: 390, height: 844, title: `${name} (live HTML)`, tabIndex: -1 });
    next.addEventListener("load", () => {
      if (frame.dataset.src !== file) return next.remove();
      frame.querySelectorAll("iframe.cur").forEach((f) => f.remove());
      next.className = "cur";
    }, { once: true });
    next.src = SCREENS + file;
    frame.append(next);
  }
  const setHTML = (node, html, cls) => {
    if (cls != null && node.className !== cls) node.className = cls;
    if (node.dataset.k !== html) { node.innerHTML = html; node.dataset.k = html; }
  };

  /* ---------- Rendering at time t ---------- */
  function render() {
    const t = S.t;
    stage.dataset.phase = t < 0 ? "before" : t >= END ? "after" : "running";
    stage.classList.toggle("picked", !!S.picked);
    stage.classList.toggle("kept-all", S.keptAll);
    stage.classList.toggle("mini", S.mini);
    for (const w of ORDER) {
      const c = cols[w];
      const v = view(w, t);
      c.classList.toggle("absent", !v.here);
      c.classList.toggle("gone", !v.here && !!S.picked);
      c.classList.toggle("running", v.running);
      c.classList.toggle("done", t >= doneAt(w));
      const lab = labelHTML(v, true, !S.mini); // the row: the maker's label always; the button's words wherever the board is 200px or wider
      setHTML(c.querySelector(".board-label"), v.here ? lab.html : "", lab.cls);
      c.querySelector(".open-big").setAttribute("aria-label", `Open ${WHO[v.who]}’s version large`);
      c.querySelector(".open-big").tabIndex = v.here && S.mini ? 0 : -1;
      if (v.here) setSrc(c.querySelector(".board-frame"), v.src, v.title);
      c.querySelector(".maker b").textContent = WHO[v.who];
      c.querySelector(".secs").textContent = v.secs;
      const list = ev[w].filter((e) => e.t <= t);
      const calls = list.map((e, i) => `<li class="${i === list.length - 1 ? "new" : ""}"><time>${e.src === "placed" ? "~" : ""}${mmss(e.t)}</time><span>${escH(callText(e, S.mini))}</span></li>`).join("");
      setHTML(c.querySelector(".calls"), calls);
      const cm = comment(v.who);
      const said = cm && t >= cm.t ? `“${cm.text}”` : "";
      const sp = c.querySelector(".said");
      if (sp.textContent !== said) { sp.textContent = said; sp.title = said ? `${WHO[v.who]}’s comment on ${FILE[v.who]}, via add_comment` : ""; }
    }
    // The block's caption: the longest of the app's three texts that fits the block's width, as the canvas chooses
    const n = ORDER.filter((x) => x !== "claude" && t >= claimAt[x]).length;
    const on = n > 0 && !S.picked && !S.keptAll;
    const cap = capRow.querySelector("span");
    const texts = [O.forkBlockWhile(n, ORIGINAL, "Claude Code"), O.forkBlock(n, ORIGINAL), O.forkBlockShort(n)];
    // long when it fits the block's width; else medium where there is room to its right; else short
    const blockW = cols.cursor.offsetLeft + cols.cursor.offsetWidth - cols.codex.offsetLeft;
    const room = row.clientWidth - cols.codex.offsetLeft;
    const ctx = (render.ctx ??= document.createElement("canvas").getContext("2d"));
    ctx.font = `400 12px ${getComputedStyle(cap).fontFamily}`;
    const wd = (x) => ctx.measureText(x).width + 8;
    const capText = !on ? "" : wd(texts[0]) <= blockW ? texts[0] : wd(texts[1]) <= room ? texts[1] : texts[2];
    if (cap.textContent !== capText) cap.textContent = capText;
    capRow.classList.toggle("on", on);
    arrow.classList.toggle("on", on && !S.mini);
    const clock = document.getElementById("clock");
    if (clock) clock.textContent = t < 0 ? "0:00" : mmss(Math.min(t, END));
    if (S.big) renderBig();
    stage.dispatchEvent(new CustomEvent("stage:render", { detail: { t, over: t >= END } }));
    layoutArrow();
  }

  /* ---------- Size: one row of three, as large as the width and the first view allow ---------- */
  function fit() {
    const vw = row.clientWidth;
    const bar = stage.parentElement.querySelector(".bar");
    const calc = (mini) => {
      const gaps = mini ? 12 + 8 : 64 + 24;
      const kW = (vw - gaps) / 1170;
      const labelH = 34;
      const below = mini ? 30 + 36 + 18 + 22 : 36 + 20 + 60;
      let h;
      if (!narrow.matches) h = stage.clientHeight - 12 - labelH - below;
      else h = innerHeight - (row.getBoundingClientRect().top + scrollY) - labelH - below - (bar ? bar.offsetHeight + 12 : 0) - 8;
      return Math.max(0.16, Math.min(kW, h / 844, 0.9));
    };
    let k = calc(false);
    const mini = 390 * k < 200;
    if (mini) k = calc(true);
    stage.style.setProperty("--k", k.toFixed(4));
    stage.classList.toggle("tiny", 390 * k < 120);
    if (mini !== S.mini) { S.mini = mini; closeConfirm(); render(); }
    layoutArrow();
  }
  function layoutArrow() {
    const a = cols.claude.querySelector(".board").getBoundingClientRect();
    const b = cols.codex.querySelector(".board").getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const k = parseFloat(stage.style.getPropertyValue("--k")) || 0.6;
    const y = a.top - r.top + Math.min(48, (844 * k) / 4);
    const x1 = a.right - r.left + 8, x2 = b.left - r.left - 8;
    const s = arrow.querySelector("svg");
    s.setAttribute("style", `left:0;top:0;width:${r.width}px;height:${r.height}px`);
    s.querySelector(".ln").setAttribute("d", `M${x1} ${y}L${x2} ${y}`);
    s.querySelector(".hd").setAttribute("d", `M${x2 - 6 * Math.cos(-0.6)} ${y - 6 * Math.sin(-0.6)}L${x2} ${y}L${x2 - 6 * Math.cos(0.6)} ${y - 6 * Math.sin(0.6)}`);
    // the caption starts under the block of forks (the first fork's left edge), 10px under it, as the app places it
    const span = capRow.querySelector("span");
    span.style.left = `${b.left - r.left}px`;
    span.style.top = `${b.bottom - r.bottom + 10}px`;
  }
  addEventListener("resize", fit);
  new ResizeObserver(() => fit()).observe(stage);

  /* ---------- Large: one version at a readable size, with its full label and Use this one ---------- */
  const big = el("dialog", "big4 oc");
  big.setAttribute("aria-label", "One version, large");
  big.innerHTML = `
    <div class="big-top">
      <div class="big-stops" role="group" aria-label="Versions">${ORDER.map((w) => `<button type="button" data-big="${w}">${WHO[w]}</button>`).join("")}</div>
      <button class="icon-btn big-close" type="button" aria-label="Close">${svg(X, 18)}</button>
    </div>
    <div class="big-body">
      <div class="board"><div class="board-label"></div><div class="board-frame"><iframe class="cur" width="390" height="844" tabindex="-1"></iframe></div></div>
      <div class="maker"><b></b><span class="secs"></span></div>
      <p class="said"></p>
    </div>`;
  document.body.append(big);
  function renderBig() {
    const w = S.big;
    if (!w) return;
    const v = view(w, S.t);
    if (!v.here && !(S.picked && w === "claude")) { closeBig(); return; }
    const k = Math.max(0.3, Math.min((innerWidth - 48) / 390, (innerHeight - 240) / 844, 0.9));
    big.style.setProperty("--k", k.toFixed(4));
    const lab = labelHTML(v, false);
    setHTML(big.querySelector(".board-label"), lab.html, lab.cls);
    setSrc(big.querySelector(".board-frame"), v.src, v.title);
    big.querySelector(".maker b").textContent = WHO[v.who];
    big.querySelector(".secs").textContent = v.secs;
    const cm = comment(v.who);
    big.querySelector(".said").textContent = cm && S.t >= cm.t ? `“${cm.text}”` : "";
    for (const b of big.querySelectorAll("[data-big]")) {
      b.setAttribute("aria-current", String(b.dataset.big === w));
      b.disabled = !view(b.dataset.big, S.t).here;
    }
  }
  function openBig(w) {
    S.big = w;
    renderBig();
    if (!big.open) big.showModal();
    big.querySelector(`[data-big="${w}"]`).focus();
  }
  function closeBig() {
    const w = S.big;
    S.big = null;
    closeConfirm();
    if (big.open) big.close();
    if (w) cols[w]?.querySelector(".open-big")?.focus({ preventScroll: true });
  }
  big.addEventListener("close", () => { S.big = null; closeConfirm(); });
  big.addEventListener("click", (e) => {
    if (e.target === big) return closeBig();
    const b = e.target.closest("[data-big]");
    if (b) { S.big = b.dataset.big; renderBig(); return; }
    if (e.target.closest(".big-close")) return closeBig();
  });
  row.addEventListener("click", (e) => {
    const o = e.target.closest(".open-big");
    if (o) openBig(o.closest(".v4").dataset.who);
  });

  /* ---------- Pick: Use this one → the app's confirm → Apply / Keep all → the app's toast with Undo ---------- */
  let confirmEl = null, confirmBtn = null;
  function closeConfirm(back) {
    if (!confirmEl) return;
    confirmEl.remove();
    confirmEl = null;
    if (confirmBtn) { confirmBtn.setAttribute("aria-expanded", "false"); confirmBtn.classList.remove("pressed"); if (back) confirmBtn.focus(); }
    confirmBtn = null;
  }
  function openConfirm(w, btn) {
    closeConfirm();
    const others = ORDER.filter((x) => x !== "claude");
    const [t1, body] = w === "claude"
      ? [O.confirmKeep(ORIGINAL), O.confirmKeepBody(others.map(title).join(", "), others.length)]
      : [O.confirmFork(title(w), ORIGINAL), O.confirmForkBody(ORIGINAL, others.length - 1)];
    const m = el("div", "menu confirm entering");
    m.setAttribute("role", "dialog");
    m.setAttribute("aria-label", t1);
    m.innerHTML = `<p class="c-title">${escH(t1)}</p><p class="c-body">${escH(body)}</p><div class="btn-row"><button class="btn oc-strong" type="button" data-act="apply">${escH(O.apply)}</button><button class="btn oc-plain" type="button" data-act="keep">${escH(O.keepAll)}</button></div>`;
    const box = big.contains(btn) ? big.querySelector(".big-body") : document.getElementById("ocbox");
    box.append(m);
    const sr = box.getBoundingClientRect(), br = btn.getBoundingClientRect();
    const wdt = m.offsetWidth;
    m.style.left = `${Math.round(Math.max(8 - sr.left, Math.min(br.right - sr.left - wdt, innerWidth - sr.left - wdt - 8)))}px`;
    m.style.top = `${Math.round(br.bottom - sr.top + 8)}px`;
    btn.setAttribute("aria-expanded", "true");
    btn.classList.add("pressed");
    confirmEl = m;
    confirmBtn = btn;
    m.querySelector("button").focus();
    m.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeConfirm(true); } });
    m.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      closeConfirm();
      if (big.open) closeBig();
      if (act === "apply") apply(w); else keepAll();
    });
  }
  addEventListener("pointerdown", (e) => {
    if (confirmEl && !confirmEl.contains(e.target) && !confirmBtn?.contains(e.target)) closeConfirm();
  }, true);
  for (const host of [stage, big]) host.addEventListener("click", (e) => {
    const b = e.target.closest("[data-use]");
    if (!b || b.getAttribute("aria-disabled") === "true") return;
    e.stopPropagation();
    if (confirmBtn === b) return closeConfirm();
    openConfirm(b.dataset.use, b);
  });

  const toasts = stage.querySelector(".toasts");
  function toast(text, onUndo) {
    toasts.innerHTML = "";
    const tEl = el("div", "toast ok", `${svg(A.icons.check, 18)}<span>${escH(text)}</span>`);
    const u = el("button", "toast-action", escH(O.undo));
    u.type = "button";
    u.addEventListener("click", () => { tEl.remove(); onUndo(); });
    tEl.append(u);
    toasts.append(tEl);
    // the app keeps a toast 3.2 s (ToastHost default); the page's "Back to all three" stays after it
    setTimeout(() => tEl.remove(), 3200);
    u.focus({ preventScroll: true });
  }
  function apply(w) {
    S.picked = w;
    render();
    const text = w === "claude" ? O.kept(ORIGINAL, 2) : O.applied(title(w).replace(/:.*$/, ""), ORIGINAL);
    say(text);
    toast(text, undo);
    stage.dispatchEvent(new CustomEvent("stage:picked", { detail: { who: w, text } }));
  }
  function keepAll() {
    S.keptAll = true;
    render();
    const text = O.keptAll("fork", 2);
    say(text);
    toast(text, undo);
    stage.dispatchEvent(new CustomEvent("stage:picked", { detail: { who: null, text } }));
  }
  function undo() {
    S.picked = null;
    S.keptAll = false;
    render();
    say("All three versions are back.");
    stage.dispatchEvent(new CustomEvent("stage:undone"));
    stage.querySelector("[data-use], .open-big[tabindex='0']")?.focus({ preventScroll: true });
  }

  /* ---------- Replay: the real offsets, N× faster ---------- */
  let raf = 0;
  function play() {
    cancelAnimationFrame(raf);
    closeConfirm();
    S.picked = null;
    S.keptAll = false;
    toasts.innerHTML = "";
    if (reduce.matches) {
      S.t = Infinity;
      render();
      say("Reduced motion: the run’s end state is shown. Codex finished in 43 s, Claude Code in 81 s, Cursor in 163 s.");
      stage.dispatchEvent(new CustomEvent("stage:ended"));
      return;
    }
    S.playing = true;
    stage.classList.add("playing");
    say(`Replay started: ${R.N} times faster than the real run.`);
    const start = performance.now();
    const step = (now) => {
      S.t = ((now - start) / 1000) * R.N;
      if (S.t >= END) {
        S.t = Infinity;
        S.playing = false;
        stage.classList.remove("playing");
        render();
        say("Replay over. All three versions are on the canvas; pick one with Use this one.");
        stage.dispatchEvent(new CustomEvent("stage:ended"));
        return;
      }
      render();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  window.EaselStage = { play, undo, state: S, render, fit };
  render();
  fit();
  requestAnimationFrame(fit);
  stage.classList.add("ready");
})();
