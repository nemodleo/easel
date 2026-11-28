// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Entry of the exported viewer (vite --mode viewer): reads window.EASEL_EXPORT, written next to it by server/export.mjs.
import { createRoot } from "react-dom/client";

import { lang, strings } from "./strings";
import type { ExportData } from "./types";
import { Viewer } from "./Viewer";
import "./style.css";

declare global {
  interface Window {
    EASEL_EXPORT?: ExportData;
  }
}

// The viewer follows the browser's language as the canvas does (strings.ts pickLang)
document.documentElement.lang = lang;
const data = window.EASEL_EXPORT;
createRoot(document.getElementById("root")!).render(
  data ? (
    <Viewer data={data} />
  ) : (
    <div className="loading" role="alert">
      {strings.viewer.noData}
    </div>
  ),
);
