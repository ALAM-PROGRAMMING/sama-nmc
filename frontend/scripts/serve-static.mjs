// Tiny static file server for the exported site (used by the end-to-end tests).
// Handles many concurrent connections (unlike python -m http.server), serves index.html for
// directories (trailingSlash export) and 404.html with a real 404 status for unknown paths.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [dir = "out", port = "4190"] = process.argv.slice(2);
const root = path.resolve(dir);

// Apply the same security headers Vercel will send (vercel.json), so tests run under the real policy.
const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf-8"));
const SECURITY_HEADERS = Object.fromEntries((vercel.headers ?? []).flatMap((h) => h.headers.map((x) => [x.key, x.value])));
delete SECURITY_HEADERS["Strict-Transport-Security"]; // HTTPS-only header; the local test server is plain HTTP
SECURITY_HEADERS["Content-Security-Policy"] = (SECURITY_HEADERS["Content-Security-Policy"] ?? "").replace("; upgrade-insecure-requests", "");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm", ".png": "image/png", ".ico": "image/x-icon", ".map": "application/json",
};

function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const target = path.normalize(path.join(root, clean));
  if (!target.startsWith(root)) return null;
  for (const c of [target, path.join(target, "index.html"), target + ".html"]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

http
  .createServer((req, res) => {
    const file = resolve(req.url || "/");
    const send = (f, status) => {
      res.writeHead(status, { ...SECURITY_HEADERS, "content-type": TYPES[path.extname(f)] || "application/octet-stream", "cache-control": "no-store" });
      fs.createReadStream(f).pipe(res);
    };
    if (file) return send(file, 200);
    const nf = path.join(root, "404.html");
    if (fs.existsSync(nf)) return send(nf, 404);
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  })
  .listen(Number(port), "127.0.0.1", () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
