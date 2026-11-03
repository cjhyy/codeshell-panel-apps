import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { routeStarterPackageAsset } from "../scripts/panel-upgrade-starter-assets.mjs";

const installPath = fileURLToPath(new URL("../templates/starter", import.meta.url));
async function request(url) {
  let result;
  await routeStarterPackageAsset({ request: () => ({ url: () => url }),
    abort: async () => { result = { aborted: true }; },
    fulfill: async value => { result = value; },
  }, installPath);
  return result;
}

test("installed Starter route serves its real module dependency with JavaScript MIME", async () => {
  const entry = await request("https://starter.test/app.js");
  assert.equal(entry.contentType, "text/javascript");
  assert.deepEqual(entry.body, await readFile(new URL("../templates/starter/app/app.js", import.meta.url)));
  const dependencies = [...entry.body.toString().matchAll(/from\s+["'](\.\/[^"']+)["']/gu)].map(match => match[1]);
  assert.deepEqual(dependencies, ["./counter.mjs"], "fixture must cover the actual installed entry's imports");
  for (const dependency of dependencies) {
    const result = await request(new URL(dependency, "https://starter.test/app.js").href);
    assert.equal(result.contentType, "text/javascript");
    assert.deepEqual(result.body, await readFile(new URL(`../templates/starter/app/${dependency.slice(2)}`, import.meta.url)));
    const module = await import(`data:text/javascript;base64,${result.body.toString("base64")}`);
    assert.equal(module.incrementCount(0), 1);
  }
  assert.equal((await request("https://starter.test/")).contentType, "text/html");
  assert.equal((await request("https://starter.test/style.css")).contentType, "text/css");
});

test("installed Starter route aborts external, unknown and undeclared assets without network fallback", async () => {
  for (const url of ["https://example.invalid/counter.mjs", "http://starter.test/counter.mjs", "https://starter.test/tools/starter.mjs", "https://starter.test/constructor", "https://starter.test/%2e%2e%2fcounter.mjs"])
    assert.deepEqual(await request(url), { aborted: true });
});
