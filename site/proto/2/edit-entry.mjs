// Prototype 2's browser bundle: Easel's own functions, unchanged, bundled by site/build.mjs with esbuild.
// server/edit.mjs (applyEdit: the patch of the source range) and server/html.mjs (paths, ranges, hashes, parse5),
// app/src/editor.ts (pathOf), app/src/directSelect.ts (fillProp, tokenRef, hexOf), app/src/useElementSelect.ts (kindLabel).
// Two stand-ins, both outside those files: node:crypto's sha1 (sha1-shim.mjs, checked against node's at build) and an empty react
// (useElementSelect.ts imports React hooks it does not need for kindLabel).
export { applyEdit, EditError } from "../../../server/edit.mjs";
export { pathOf } from "../../../app/src/editor.ts";
export { fillProp, hexOf, tokenRef } from "../../../app/src/directSelect.ts";
export { kindLabel } from "../../../app/src/useElementSelect.ts";
