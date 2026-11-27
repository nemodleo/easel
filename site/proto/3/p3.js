// Prototype 3: the export's embed option at full width, and Play the app: the phone screens' own links, as the canvas's Play runs them.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const box = $("#canvas3");
  const HOME = "../../canvas/screens/home.html";
  if (matchMedia("(min-width: 900px)").matches) {
    const f = document.createElement("iframe");
    f.title = "View-only Easel canvas of the demo. Click it to pan and zoom; Esc gives the page back.";
    f.src = box.dataset.src;
    box.prepend(f);
  }
  const dlg = $("#phone-dlg"), pf = $("#phone-frame");
  $("#play-offer").addEventListener("click", () => {
    pf.src = HOME;
    dlg.showModal();
  });
  $("#phone-restart").addEventListener("click", () => (pf.src = HOME));
  $("#phone-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());
})();
