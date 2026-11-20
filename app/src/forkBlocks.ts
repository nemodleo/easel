// AI-generated with Claude Code, 2026-11-20, reviewed by Hyun Park
// The forks of one original as blocks: forks lying near one another are one block (the rule forkSpot in server/place.mjs places
// them by), and each block gets one caption and one arrow. No imports, so the tests can load it on its own.

export type Box = { x: number; y: number; w: number; h: number };

/**
 * Two boxes count as one block when the gap between them is at most half their sizes. A copy of near in server/place.mjs:
 * test/forkBlocks.test.mjs fails when the two drift apart
 */
export const near = (a: Box, b: Box) => a.x < b.x + b.w + (a.w + b.w) / 2 && b.x < a.x + a.w + (a.w + b.w) / 2 && a.y < b.y + b.h + (a.h + b.h) / 2 && b.y < a.y + a.h + (a.h + b.h) / 2;

/** The blocks among boxes: groups connected by near, each in input order, in the order of their first box */
export function blocks<T extends Box>(items: T[]): T[][] {
  const seen = new Set<T>();
  const out: T[][] = [];
  for (const it of items) {
    if (seen.has(it)) continue;
    const block = [it];
    seen.add(it);
    for (let i = 0; i < block.length; i++)
      for (const s of items)
        if (!seen.has(s) && near(s, block[i])) {
          seen.add(s);
          block.push(s);
        }
    out.push(items.filter((s) => block.includes(s)));
  }
  return out;
}

/** A block's first box: in its top row (within half a box of the topmost), the leftmost. The arrow from the original ends there */
export function firstOf<T extends Box>(block: T[]): T {
  const top = Math.min(...block.map((b) => b.y));
  return block.filter((b) => b.y - top < b.h / 2).reduce((a, b) => (b.x < a.x ? b : a));
}

/** The block's outer box (world coordinates) */
export function bounds(block: Box[]): Box {
  const x = Math.min(...block.map((b) => b.x));
  const y = Math.min(...block.map((b) => b.y));
  return { x, y, w: Math.max(...block.map((b) => b.x + b.w)) - x, h: Math.max(...block.map((b) => b.y + b.h)) - y };
}

/** A block caption's three texts: long ("… · made while X was editing", null unless every fork was made while the same agent edited),
 * medium ("3 forks of Empty day") and short ("3 forks") */
export type CaptionTexts = { long: string | null; medium: string; short: string };

export function captionTexts(
  n: number,
  title: string,
  whiles: (string | undefined)[],
  s: { forkBlockWhile: (n: number, title: string, whileBy: string) => string; forkBlock: (n: number, title: string) => string; forkBlockShort: (n: number) => string },
): CaptionTexts {
  const one = new Set(whiles.map((w) => w ?? "")).size === 1 && whiles[0] ? whiles[0] : null;
  return { long: one ? s.forkBlockWhile(n, title, one) : null, medium: s.forkBlock(n, title), short: s.forkBlockShort(n) };
}

/**
 * The caption to draw, or null: the long text when it fits the block's width (avail px) and nothing is in its way; else the medium
 * one, which may run past the block's right edge when nothing is there; else the short one; null when even that would cover
 * something. width(t): the text's width on screen; hits(w): a box of that width where the caption goes covers a board, label or note
 */
export function chooseCaption(t: CaptionTexts, avail: number, width: (t: string) => number, hits: (w: number) => boolean): string | null {
  if (t.long && width(t.long) <= avail && !hits(width(t.long))) return t.long;
  for (const x of [t.medium, t.short]) if (!hits(width(x))) return x;
  return null;
}
