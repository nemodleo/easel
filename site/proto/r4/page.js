// Round 4 pages: the replay button, the phone's stops, the next step after a pick; on p/5 the request and Ask all three.
(() => {
  "use strict";
  const S = window.EaselStage, stage = document.getElementById("stage");
  if (!S || !stage) return;
  const $ = (s) => document.querySelector(s);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const row = stage.querySelector(".row");

  // Replay (p/4's secondary act, p/5 after the first run)
  const clockbox = $("#clockbox");
  const replay = $("#replay");
  const play = () => {
    clockbox?.classList.add("on");
    S.play();
  };
  replay?.addEventListener("click", play);
  stage.addEventListener("stage:ended", () => replay && (replay.hidden = false));

  // After a pick: the next step is the command; Back to all three is the same Undo
  const next = $("#next");
  stage.addEventListener("stage:picked", () => {
    
    if (matchMedia("(max-width: 899px)").matches) next?.scrollIntoView({ block: "nearest", behavior: reduce.matches ? "auto" : "smooth" });
  });
  
  $("#back")?.addEventListener("click", () => S.undo());

  // p/5: the request waiting to be sent
  const ask = $("#ask");
  if (!ask) return;
  const chips = [...document.querySelectorAll("[data-chip]")];
  const composer = $("#composer");
  const R = window.EaselRun;
  let idle = setTimeout(() => !reduce.matches && ask.classList.add("nudge"), 6000);
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) addEventListener(ev, () => clearTimeout(idle), { once: true, passive: true });
  ask.addEventListener("click", () => {
    clearTimeout(idle);
    ask.classList.remove("nudge");
    composer.dataset.state = "running";
    ask.disabled = true;
    play();
  });
  stage.addEventListener("stage:render", (e) => {
    const t = e.detail.t;
    for (const c of chips) {
      const w = c.dataset.chip, st = c.querySelector(".st");
      const txt = t < 0 ? "ready" : t >= R.times[w] ? `done · ${R.times[w]} s` : "working";
      if (st.textContent !== txt) st.textContent = txt;
      c.dataset.state = t < 0 ? "ready" : t >= R.times[w] ? "done" : "working";
    }
  });
  stage.addEventListener("stage:ended", () => {
    composer.dataset.state = "done";
    ask.disabled = false;
  });
})();
