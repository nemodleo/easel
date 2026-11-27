// Prototype 1: the recording is the hero. It opens on the request (0:13), plays muted unless reduced motion, and the moments seek it.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const START = 13.1;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const video = $("#run"), pp = $("#playpause"), big = $("#bigplay"), time = $("#time"), bar = $("#progress");
  const chips = [...document.querySelectorAll("#moments .chip")];
  const marks = chips.map((c) => Number(c.dataset.t));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  video.removeAttribute("controls");
  if (matchMedia("(min-width: 700px)").matches) video.poster = "../../media/proto-ask-poster-1920.webp";
  for (const el of [pp, time, $("#track"), $("#moments")]) el.hidden = false;
  let failed = false;
  const sync = () => {
    const t = video.currentTime || START, d = Math.round(video.duration || 36.8);
    bar.style.width = `${(t / d) * 100}%`;
    time.textContent = `${fmt(Math.min(t, d))} / ${fmt(d)}`;
    let at = 0;
    marks.forEach((m, i) => t >= m - 0.05 && (at = i));
    chips.forEach((c, i) => c.setAttribute("aria-current", String(i === at)));
  };
  const state = () => {
    if (failed) return;
    pp.classList.toggle("is-playing", !video.paused);
    pp.setAttribute("aria-label", video.paused ? "Play the recording" : "Pause the recording");
    big.hidden = !video.paused || !reduced || video.currentTime > START + 0.5;
  };
  const play = () => video.play()?.catch(() => state());
  const seek = (t) => {
    const go = () => ((video.currentTime = t), sync());
    video.readyState >= 1 ? go() : video.addEventListener("loadedmetadata", go, { once: true });
    play();
  };
  video.addEventListener("loadedmetadata", () => video.currentTime < START - 0.5 && (video.currentTime = START));
  video.addEventListener("timeupdate", sync);
  video.addEventListener("play", state);
  video.addEventListener("pause", state);
  pp.addEventListener("click", () => (video.paused ? play() : video.pause()));
  big.addEventListener("click", play);
  chips.forEach((c) => c.addEventListener("click", () => seek(Number(c.dataset.t))));
  const fail = () => {
    failed = true;
    $("#video-failed").hidden = false;
    for (const el of [big, pp, time, $("#track"), $("#moments")]) el.hidden = true;
  };
  video.querySelector("source:last-of-type").addEventListener("error", fail);
  sync();
  if (reduced) big.hidden = false;
  else play();
  state();
})();
