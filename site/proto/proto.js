// Round 3 prototypes: copy buttons, and the recording's moments where a page has one
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const live = Object.assign(document.createElement("p"), { className: "sr" });
  live.setAttribute("aria-live", "polite");
  document.body.append(live);
  for (const b of document.querySelectorAll("[data-copy]")) {
    const word = $(".copy-word", b);
    let t;
    b.addEventListener("click", async () => {
      let ok = true;
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
      } catch {
        ok = false;
      }
      word.textContent = ok ? "✓ Copied" : "Select and copy";
      live.textContent = ok ? `Copied: ${b.dataset.copy}` : "Copying is blocked here; select the command.";
      clearTimeout(t);
      t = setTimeout(() => (word.textContent = "Copy"), 1800);
    });
  }
  window.EaselProto = { $ };
})();
