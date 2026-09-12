import { createReadStream, watch } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { buildProject } from "./build-panels.mjs";
import { discoverProjects, readArguments, selectProjects } from "./panel-projects.mjs";

const options = readArguments(process.argv.slice(2), ["--watch"]);
const [project] = selectProjects(await discoverProjects(), options.app ?? "starter");
await buildProject(project);
const port = Number(options.port ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid --port");
const root = await realpath(join(project.output, "app"));
const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".md": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg", ".wav": "audio/wav",
};
const manifest = JSON.parse(await readFile(join(project.output, ".codeshell-panel/panel.json"), "utf8"));
const entry = manifest.entry.slice("app/".length);
const server = createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const path = await realpath(resolve(root, pathname === "/" ? entry : `.${pathname}`));
    const relation = relative(root, path);
    if (relation === ".." || relation.startsWith(`..${sep}`) || relation.startsWith(sep)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    if (!(await stat(path)).isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(path).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(path).on("error", () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Preview ${project.name}: http://127.0.0.1:${port}/`);
  console.log("Browser preview has no CodeShell Host bridge. Use the installed panel to test Host capabilities.");
});

let watcher;
let timer;
let building = false;
let dirty = false;
async function rebuild() {
  if (building) {
    dirty = true;
    return;
  }
  building = true;
  do {
    dirty = false;
    try {
      await buildProject(project);
      console.log("Updated. Refresh the browser to load the current package.");
    } catch (error) {
      console.error(`Build failed; previous package preserved: ${error.message}`);
    }
  } while (dirty);
  building = false;
}
if (options.watch) {
  watcher = watch(project.source, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 120);
  });
}
function close() {
  clearTimeout(timer);
  watcher?.close();
  server.close();
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
