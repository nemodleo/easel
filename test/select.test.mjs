// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Selecting and editing without a mode (app/src/directSelect.ts) as pure functions: click vs drag, toolbar placement and flip,
// breadcrumb paths, design words for CSS values, token matching and the variable reference a token writes
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import ts from "typescript";

import { TOOL_ROOT } from "../server/args.mjs";

let ds, tmp;
before(async () => {
  const src = await fs.readFile(path.join(TOOL_ROOT, "app/src/directSelect.ts"), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dc-sel-"));
  await fs.writeFile(path.join(tmp, "directSelect.mjs"), js);
  ds = await import(path.join(tmp, "directSelect.mjs"));
});
after(() => fs.rm(tmp, { recursive: true, force: true }));

test("click vs drag: under 3 screen px is a click, from 3 on the press moves the board", () => {
  assert.equal(ds.isDrag(0, 0), false);
  assert.equal(ds.isDrag(1, 1), false);
  assert.equal(ds.isDrag(2, 1), true);
  assert.equal(ds.isDrag(-3, 0), true);
  assert.equal(ds.isDrag(4, 0, 6), false, "a custom slop");
});

test("toolbar placement: centred above with room for the move handle, flipped below near the top, kept inside the bounds", () => {
  const bounds = { w: 1000, h: 700 };
  const bar = { w: 400, h: 36 };
  assert.deepEqual(ds.placeBar({ x: 300, y: 300, w: 200, h: 50 }, bar, bounds), { x: 200, y: 236, below: false });
  // No room above: below the element
  assert.deepEqual(ds.placeBar({ x: 300, y: 40, w: 200, h: 50 }, bar, bounds), { x: 200, y: 102, below: true });
  // It would reach over the board's top edge (its title row, Use this one): below the element
  assert.deepEqual(ds.placeBar({ x: 300, y: 300, w: 200, h: 50 }, bar, { ...bounds, top: 280 }), { x: 200, y: 362, below: true });
  assert.equal(ds.placeBar({ x: 300, y: 300, w: 200, h: 50 }, bar, { ...bounds, top: 200 }).below, false);
  // Near the left and right edges: clamped
  assert.equal(ds.placeBar({ x: 0, y: 300, w: 40, h: 40 }, bar, bounds).x, 8);
  assert.equal(ds.placeBar({ x: 980, y: 300, w: 40, h: 40 }, bar, bounds).x, 1000 - 400 - 8);
  // An element taller than the view: the bar stays inside
  const tall = ds.placeBar({ x: 300, y: 20, w: 200, h: 2000 }, bar, bounds);
  assert.equal(tall.below, true);
  assert.equal(tall.y, 700 - 36 - 8);
  // A view smaller than the bar: pinned to the padding, never negative
  assert.deepEqual(ds.placeBar({ x: 0, y: 0, w: 10, h: 10 }, bar, { w: 200, h: 30 }), { x: 8, y: 8, below: true });
});

test("breadcrumb paths: nothing between board and a top-level element, the nearest parents otherwise", () => {
  assert.deepEqual(ds.crumbPaths("3"), { paths: [], skipped: false });
  assert.deepEqual(ds.crumbPaths("0/2"), { paths: ["0"], skipped: false });
  assert.deepEqual(ds.crumbPaths("0/1/1/5"), { paths: ["0/1", "0/1/1"], skipped: true });
  assert.deepEqual(ds.crumbPaths("0/1/1/5", 5), { paths: ["0", "0/1", "0/1/1"], skipped: false });
});

test("design words: numbers without px, padding as 12 · 16, weights by name, fonts by their first family", () => {
  assert.equal(ds.designNumber("15px"), "15");
  assert.equal(ds.designNumber("15.50px"), "15.5");
  assert.equal(ds.designNumber("1.5em"), "1.5em");
  assert.equal(ds.designNumber(undefined), "");
  assert.equal(ds.designSpacing("12px 16px"), "12 · 16");
  assert.equal(ds.designSpacing("0px"), "0");
  assert.equal(ds.designSpacing("8px auto"), "8 · auto");
  assert.equal(ds.cssSpacing("12 · 16"), "12px 16px");
  assert.equal(ds.cssSpacing("12 16 4"), "12px 16px 4px");
  assert.equal(ds.cssSpacing("8"), "8px");
  assert.equal(ds.cssSpacing("1em auto"), "1em auto");
  const names = { 400: "Regular", 600: "Semibold", 700: "Bold" };
  assert.equal(ds.designWeight("700", names), "Bold · 700");
  assert.equal(ds.designWeight(400, names), "Regular · 400");
  assert.equal(ds.designWeight("350", names), "350");
  assert.equal(ds.designWeight("", names), "");
  assert.equal(ds.designFont('system-ui, -apple-system, "Segoe UI", sans-serif'), "System UI");
  assert.equal(ds.designFont("-apple-system, BlinkMacSystemFont"), "System UI");
  assert.equal(ds.designFont('"Pretendard Variable", sans-serif'), "Pretendard Variable");
  assert.equal(ds.cssFont("System UI"), "system-ui");
  assert.equal(ds.cssFont("Inter"), "Inter");
  assert.equal(ds.cssFont("Pretendard Variable"), '"Pretendard Variable"');
  assert.equal(ds.cssFont("Inter, sans-serif"), "Inter, sans-serif");
});

test("steppers: numbers move by the step and never below zero; padding moves every side", () => {
  assert.equal(ds.stepNumber("15px", 1), 16);
  assert.equal(ds.stepNumber("0px", -1), 0);
  assert.equal(ds.stepNumber("", 1, 4), 4);
  assert.equal(ds.stepSpacing("12px 16px", 1), "16px 20px");
  assert.equal(ds.stepSpacing("2px", -1), "0px");
  assert.equal(ds.stepSpacing("", 1), "4px");
});

test("token colours: a value matches by hex or by its variable; choosing a token writes the board's variable or var(--slug, #HEX)", () => {
  const colors = [
    { name: "Blue", value: "#2b59c3" },
    { name: "Blue soft", value: "#DFE7FB" },
    { name: "Ink", value: "#10213A" },
  ];
  assert.equal(ds.hexOf("rgb(43, 89, 195)"), "#2B59C3");
  assert.equal(ds.hexOf("#abc"), "#AABBCC");
  assert.equal(ds.hexOf("rgba(0, 0, 0, 0)"), null, "transparent is no colour");
  assert.equal(ds.hexOf("var(--x)"), null);
  assert.equal(ds.matchToken("rgb(43, 89, 195)", colors)?.name, "Blue");
  assert.equal(ds.matchToken("#dfe7fb", colors)?.name, "Blue soft");
  assert.equal(ds.matchToken("var(--blue-soft, #DFE7FB)", colors)?.name, "Blue soft");
  assert.equal(ds.matchToken("var(--brand, #10213a)", colors)?.name, "Ink", "an unknown variable falls back to its fallback colour");
  assert.equal(ds.matchToken("#123456", colors), null);
  assert.equal(ds.matchToken("", colors), null);
  assert.equal(ds.tokenSlug("Blue soft"), "blue-soft");
  assert.equal(ds.tokenSlug("  Accent / pressed "), "accent-pressed");
  // The board defines nothing: a reference that still renders
  assert.equal(ds.tokenRef(colors[1], {}), "var(--blue-soft, #DFE7FB)");
  // The board defines the variable by the token's name
  assert.equal(ds.tokenRef(colors[0], { "--blue": "#2b59c3" }), "var(--blue)");
  // The board defines the same colour under its own name
  assert.equal(ds.tokenRef(colors[2], { "--ink-900": " #10213a" }), "var(--ink-900)");
});

test("Fill changes the text colour of a text element on a clear background, otherwise the background", () => {
  assert.equal(ds.fillProp("text", "rgba(0, 0, 0, 0)"), "color");
  assert.equal(ds.fillProp("text", "rgb(255, 255, 255)"), "background");
  assert.equal(ds.fillProp("button", "rgba(0, 0, 0, 0)"), "background");
  assert.equal(ds.fillProp("container", "rgb(43, 89, 195)"), "background");
});
