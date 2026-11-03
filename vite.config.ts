import { defineConfig } from "vite";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const base = "/19-bubble-pwa/";
export default defineConfig({
  base,
  plugins: [
    {
      name: "offline-shell",
      closeBundle() {
        const files = (dir: string): string[] =>
          readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory()
              ? files(resolve(dir, e.name))
              : [resolve(dir, e.name)],
          );
        const assets = files("dist")
          .filter((p) => !p.endsWith("/sw.js"))
          .map((p) => p.slice(resolve("dist").length + 1));
        const version = createHash("sha256")
          .update(
            assets
              .map((p) => readFileSync("dist/" + p))
              .reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0)),
          )
          .digest("hex")
          .slice(0, 16);
        writeFileSync(
          "dist/sw.js",
          `const CACHE='bubble19-${version}',BASE=${JSON.stringify(base)},ASSETS=${JSON.stringify(assets.map((p) => base + p))};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(async error=>{await caches.delete(CACHE);throw error;})));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('message',e=>{if(e.data==='ACTIVATE')self.skipWaiting();});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||!u.pathname.startsWith(BASE))return;e.respondWith(caches.open(CACHE).then(async c=>{const hit=await c.match(e.request);if(hit)return hit;if(u.pathname.startsWith(BASE+'assets/')){const old=await caches.match(e.request);if(old)return old;}if(e.request.mode==='navigate')return (await c.match(BASE+'index.html'))||fetch(e.request);return fetch(e.request);}));});`,
        );
      },
    },
  ],
});
