// Local-only production-build test server. Never included in dist.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
let generation = 0;
const root = resolve("dist"),
  base = "/19-bubble-pwa/";
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/__test/update" && req.method === "POST") {
      generation++;
      res.end("updated");
      return;
    }
    if (!url.pathname.startsWith(base)) {
      res.writeHead(404).end();
      return;
    }
    const file = resolve(
      root,
      decodeURIComponent(url.pathname.slice(base.length)) || "index.html",
    );
    if (!file.startsWith(root + "/")) {
      res.writeHead(403).end();
      return;
    }
    let data = await readFile(file);
    if (file.endsWith("/sw.js"))
      data = Buffer.from(
        data
          .toString()
          .replace(/bubble19-([a-f0-9]+)/, `bubble19-$1-test${generation}`),
      );
    res.writeHead(200, {
      "content-type": mime[extname(file)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
}).listen(4173, "127.0.0.1");
