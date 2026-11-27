// node:crypto for the browser bundle of prototype 2: only createHash("sha1").update(string).digest("hex"), which server/html.mjs uses
// for an element's hash. A plain SHA-1 over the UTF-8 bytes; site/build.mjs checks it matches node's before bundling.
function sha1Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const words = new Uint32Array((((len + 8) >> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  words[words.length - 1] = len * 8;
  let [a, b, c, d, e] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  const rol = (x, n) => (x << n) | (x >>> (32 - n));
  for (let o = 0; o < words.length; o += 16) {
    for (let i = 0; i < 16; i++) w[i] = words[o + i];
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [A, B, C, D, E] = [a, b, c, d, e];
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (B & C) | (~B & D) : i < 40 ? B ^ C ^ D : i < 60 ? (B & C) | (B & D) | (C & D) : B ^ C ^ D;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (rol(A, 5) + f + E + k + w[i]) >>> 0;
      [E, D, C, B, A] = [D, C, rol(B, 30) >>> 0, A, t];
    }
    a = (a + A) >>> 0; b = (b + B) >>> 0; c = (c + C) >>> 0; d = (d + D) >>> 0; e = (e + E) >>> 0;
  }
  return [a, b, c, d, e].map((x) => x.toString(16).padStart(8, "0")).join("");
}
export function createHash(alg) {
  if (alg !== "sha1") throw new Error(`Only sha1 here, not ${alg}`);
  let s = "";
  const h = { update: (x) => ((s += String(x)), h), digest: () => sha1Hex(s) };
  return h;
}
export default { createHash };
