import { readFile } from "node:fs/promises";
import { join } from "node:path";

const assets = Object.freeze({
  "index.html": "text/html",
  "style.css": "text/css",
  "app.js": "text/javascript",
  "counter.mjs": "text/javascript",
});

// Serve only the reviewed installed Starter files. In particular, its current
// entry imports counter.mjs; blocking that module prevents any context render.
// This route never falls through to DNS or an external server.
export async function routeStarterPackageAsset(route, installPath) {
  const url = new URL(route.request().url());
  const file = url.pathname.slice(1) || "index.html";
  if (url.origin !== "https://starter.test" || !Object.hasOwn(assets, file)) return route.abort();
  return route.fulfill({ body: await readFile(join(installPath, "app", file)), contentType: assets[file] });
}
