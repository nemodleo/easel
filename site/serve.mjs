// Local preview of site/dist/ (run npm run site first): a static server with Range requests and caching, so the video seeks and
// the canvas loads as they will on a real host (no compression, so JS and CSS are counted raw).
// Usage: node site/serve.mjs [port]   (default 4392, on 127.0.0.1 only)
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const PORT = Number(process.argv[2] ?? 4392);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "application/xml" };

http
  .createServer(async (req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = path.join(DIST, path.normalize(rel));
    if (!file.startsWith(DIST)) return res.writeHead(403).end();
    let st = await fs.stat(file).catch(() => null);
    if (st?.isDirectory()) {
      file = path.join(file, "index.html");
      st = await fs.stat(file).catch(() => null);
    }
    if (!st) return res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    // Like a static host: cacheable for an hour (otherwise every board frame fetches the demo's fonts again)
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Last-Modified", st.mtime.toUTCString());
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range) {
      const start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) return res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end();
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": st.size });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Easel site preview: http://127.0.0.1:${PORT}/`));
