// AI-generated with Claude Code, 2026-11-27
// Export PNG from the board menu: the download's name and what a failure means. No imports, so the tests can load it on its own.

/** The download's name: the board's file name with .png, never a folder ("scr-02.html" → "scr-02.png") */
export function pngName(file: string): string {
  const base = file.split(/[\\/]/).pop() || "board.html";
  return base.replace(/\.html?$/i, "") + ".png";
}

/**
 * Why the render failed, for the toast: "browser" when there is no headless browser to render with (playwright missing → 501,
 * or no Chromium to launch), otherwise "render" (the board itself, a timeout, the server)
 */
export function pngFailure(status: number | undefined, message: string): "browser" | "render" {
  if (status === 501) return "browser";
  return /executable doesn't exist|playwright install|playwright is not installed|failed to launch|browserType\.launch/i.test(message) ? "browser" : "render";
}

/** The first line of a server error, short enough for a toast */
export const shortReason = (message: string) => (message.split("\n")[0] ?? "").trim().slice(0, 140);
