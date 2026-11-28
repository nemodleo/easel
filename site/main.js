// easel.d-t-it.com: Copy buttons, the app switch, the three answers as live frames on wide screens, the embedded canvas.
// The page reads in full without this file: stills stand in for the frames, every app's panel is shown, the share still stays.
(() => {
  const wide = matchMedia("(min-width: 1024px)");

  /* ---------- Copy ---------- */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }
  const live = Object.assign(document.createElement("div"), { className: "sr" });
  live.setAttribute("aria-live", "polite");
  live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)";
  document.body.append(live);
  for (const b of document.querySelectorAll(".copy[data-copy]")) {
    b.addEventListener("click", async () => {
      const ok = await copyText(b.dataset.copy);
      b.textContent = ok ? "Copied" : "Select it";
      b.toggleAttribute("data-done", true);
      live.textContent = ok ? "Copied to the clipboard" : "Could not copy: select the line instead";
      clearTimeout(b._t);
      b._t = setTimeout(() => {
        b.textContent = "Copy";
        b.removeAttribute("data-done");
      }, 1600);
    });
  }

  /* ---------- App switch (tabs: arrow keys move, Home/End jump) ---------- */
  const tabs = [...document.querySelectorAll('.seg [role="tab"]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
    if (focus) tab.focus();
  };
  if (tabs.length) {
    select(tabs[0], false);
    for (const t of tabs) {
      t.addEventListener("click", () => select(t, false));
      t.addEventListener("keydown", (e) => {
        const i = tabs.indexOf(t);
        const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        select(tabs[(to + tabs.length) % tabs.length], true);
      });
    }
  }

  /* ---------- The three answers: the real HTML files, scaled, over their stills ---------- */
  // Only on wide screens: the still holds the box (no layout shift) and stays if a frame fails to load.
  function frames() {
    for (const fig of document.querySelectorAll(".ans[data-src]")) {
      const box = fig.querySelector(".phone");
      if (box.querySelector("iframe")) continue;
      const f = document.createElement("iframe");
      f.src = fig.dataset.src;
      f.title = "";
      f.tabIndex = -1;
      f.setAttribute("aria-hidden", "true");
      f.setAttribute("scrolling", "no");
      f.setAttribute("inert", "");
      f.setAttribute("sandbox", "allow-same-origin");
      const fit = () => (f.style.transform = `scale(${box.clientWidth / 390})`);
      fit();
      new ResizeObserver(fit).observe(box);
      f.addEventListener("load", () => {
        // Show the frame once its fonts are in, so it never flashes a fallback face over the still
        const fonts = f.contentDocument?.fonts;
        (fonts ? fonts.ready : Promise.resolve()).then(() => f.classList.add("ready"));
      });
      box.append(f);
    }
  }
  if (wide.matches) frames();
  else wide.addEventListener("change", (e) => e.matches && frames(), { once: true });

  /* ---------- Phone: the dots follow the swipe ---------- */
  const strip = document.getElementById("answers");
  const dots = [...document.querySelectorAll(".dots span:not(.label)")];
  if (strip && dots.length) {
    strip.addEventListener(
      "scroll",
      () => {
        const max = strip.scrollWidth - strip.clientWidth;
        const i = max > 0 ? Math.round((strip.scrollLeft / max) * (dots.length - 1)) : 0;
        dots.forEach((d, j) => d.classList.toggle("on", i === j));
      },
      { passive: true },
    );
  }

  /* ---------- Share: the real export, framed with ?embed, once it scrolls near ---------- */
  const embed = document.querySelector(".embed[data-embed]");
  if (embed && wide.matches && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const f = document.createElement("iframe");
        f.src = embed.dataset.embed;
        f.title = "The bundled demo canvas, exported by Easel and framed with ?embed";
        f.addEventListener(
          "load",
          () => {
            f.classList.add("ready");
            const cap = document.querySelector(".embed-cap");
            if (cap?.dataset.live) cap.textContent = cap.dataset.live;
          },
          { once: true },
        );
        embed.append(f);
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(embed);
  }
})();
