// AI-generated with Claude Code, 2026-11-27
// What P does on the canvas. No imports, so the tests can load it on its own.

/**
 * With exactly one board selected, P plays it in place (any board: playing is viewing, so it needs no is_interactive flag in
 * board.json); with no board or several selected, P picks the pen
 */
export function pKey(selected: readonly string[], boards: Readonly<Record<string, unknown>>): "play" | "pen" {
  return selected.length === 1 && Object.hasOwn(boards, selected[0]) ? "play" : "pen";
}
