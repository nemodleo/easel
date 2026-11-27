// easel.d-t-it.com: copy buttons, the recording's five moments, and the live canvas (wide screens only) that takes the wheel after a click.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const WIDE = window.matchMedia("(min-width: 1100px)");

  /* ---------- Copy buttons ---------- */
  const live = document.createElement("p");
  live.className = "sr";
  live.setAttribute("aria-live", "polite");
  document.body.append(live);
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {}
      ta.remove();
      return ok;
    }
  }
  for (const b of document.querySelectorAll("[data-copy]")) {
    const word = $(".copy-word", b);
    let timer;
    b.addEventListener("click", async () => {
      const ok = await copyText(b.dataset.copy);
      word.textContent = ok ? "✓ Copied" : "Select and copy";
      b.classList.toggle("is-done", ok);
      live.textContent = ok ? `Copied: ${b.dataset.copy}` : "Copying is blocked here; select the command and copy it.";
      clearTimeout(timer);
      timer = setTimeout(() => {
        word.textContent = "Copy";
        b.classList.remove("is-done");
      }, 1800);
    });
  }

  /* ---------- The recording ---------- */
  const video = $("#run");
  const pp = $("#playpause");
  const big = $("#bigplay");
  const time = $("#time");
  const bar = $("#progress");
  const chips = [...document.querySelectorAll("#moments .chip")];
  const marks = chips.map((c) => Number(c.dataset.t));
  let userPaused = false;
  let started = false;
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  video.removeAttribute("controls");
  // A phone or narrow window gets the small poster from the HTML; a wide one the sharp one
  // (only once the player comes near, so the first view does not pay for it)
  if (window.matchMedia("(min-width: 700px)").matches && "IntersectionObserver" in window) {
    const near = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      near.disconnect();
      const img = new Image();
      img.onload = () => (video.poster = img.src);
      img.src = "media/poster-1920.webp";
    }, { rootMargin: "200px" });
    near.observe(video);
  }
  for (const el of [pp, time, $("#track"), $("#moments")]) el.hidden = false;

  const sync = () => {
    const t = video.currentTime || 0;
    const d = video.duration || 36.8;
    const total = Math.round(d);
    bar.style.width = `${(t / d) * 100}%`;
    time.textContent = `${fmt(Math.min(t, total))} / ${fmt(total)}`;
    let at = 0;
    marks.forEach((m, i) => {
      if (t >= m - 0.05) at = i;
    });
    chips.forEach((c, i) => c.setAttribute("aria-current", started && i === at ? "true" : "false"));
  };
  const state = () => {
    if (!$("#video-failed").hidden) return;
    const playing = !video.paused;
    pp.classList.toggle("is-playing", playing);
    pp.setAttribute("aria-label", playing ? "Pause the recording" : "Play the recording");
    big.hidden = playing || started;
  };
  const play = () => {
    started = true;
    if (video.preload !== "auto") video.preload = "auto";
    const p = video.play();
    if (p) p.catch(() => state());
  };
  video.addEventListener("timeupdate", sync);
  video.addEventListener("loadedmetadata", sync);
  video.addEventListener("play", state);
  video.addEventListener("pause", state);
  pp.addEventListener("click", () => {
    if (video.paused) {
      userPaused = false;
      play();
    } else {
      userPaused = true;
      video.pause();
    }
  });
  big.addEventListener("click", () => {
    userPaused = false;
    play();
  });
  const seek = (t) => {
    const go = () => {
      video.currentTime = t;
      sync();
    };
    if (video.readyState >= 1) go();
    else video.addEventListener("loadedmetadata", go, { once: true });
    userPaused = false;
    play();
  };
  chips.forEach((c) => c.addEventListener("click", () => seek(Number(c.dataset.t))));
  // The proofs' "Watch it at …" links bring the recording into view at that moment
  for (const b of document.querySelectorAll("button.seek")) {
    b.addEventListener("click", () => {
      $("#player").scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "center" });
      seek(Number(b.dataset.t));
      pp.focus({ preventScroll: true });
    });
  }
  // Every source failed: the poster stays, and the page says so
  const sources = [...video.querySelectorAll("source")];
  const failed = () => {
    $("#video-failed").hidden = false;
    for (const el of [big, pp, time, $("#track"), $("#moments")]) el.hidden = true;
    for (const b of document.querySelectorAll("button.seek")) b.hidden = true;
  };
  sources.at(-1).addEventListener("error", failed);
  video.addEventListener("error", failed);

  // Reduced motion: the poster and a Play button, no autoplay. Otherwise it plays, muted, while it is on screen
  if (reduced.matches) big.hidden = false;
  else if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !userPaused) play();
          else if (!e.isIntersecting && !video.paused) video.pause();
        }
      },
      { threshold: 0.5 },
    ).observe(video);
  }
  state();

  /* ---------- The live canvas (wide screens only) ---------- */
  // The export's own embed option does the rest (see the README's Share section): no board list or comments card, the opening view
  // fitted beside the card, and the wheel left to this page until the canvas is clicked. This script only adds the frame.
  const stage = $("#stage");
  let loaded = false;
  function loadCanvas() {
    if (loaded || !WIDE.matches) return;
    loaded = true;
    stage.insertAdjacentHTML(
      "beforeend",
      `<div class="loading" aria-hidden="true"><span class="bar"></span><span class="msg">Loading the canvas…</span></div><p class="sr" role="status" id="canvas-status">Loading the canvas…</p>`,
    );
    const frame = document.createElement("iframe");
    frame.title = "View-only Easel canvas of the Intercut demo. Click it to pan and zoom; Esc gives the page back.";
    const fail = () => {
      clearTimeout(timer);
      stage.closest(".top").classList.add("no-canvas");
      frame.remove();
      $(".loading", stage)?.remove();
      stage.insertAdjacentHTML(
        "beforeend",
        `<img class="stage-still" src="media/canvas-still.webp" alt="Easel with the Intercut No.14 demo: twelve boards on one canvas" width="1440" height="900">` +
          `<p class="notice" role="status">The live canvas didn’t load. This is a screenshot of Easel with the same demo; the command in the card runs it.</p>`,
      );
    };
    const timer = setTimeout(fail, 15000);
    frame.addEventListener("load", () => {
      clearTimeout(timer);
      setTimeout(() => $(".loading", stage)?.remove(), 600);
      $("#canvas-status").textContent = "The canvas has loaded.";
    });
    // A missing export would load an error page into the frame, so ask for it first
    fetch(stage.dataset.src.split("?")[0], { method: "HEAD" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        frame.src = stage.dataset.src;
        stage.append(frame);
      })
      .catch(fail);
  }
  loadCanvas();
  WIDE.addEventListener?.("change", loadCanvas);
})();
