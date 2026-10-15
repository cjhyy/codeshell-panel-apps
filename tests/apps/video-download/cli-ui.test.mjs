import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

let server, browser, baseUrl;
before(async () => {
  const source = await readFile(
    new URL("../../../apps/video-download/app/cli-jobs.js", import.meta.url),
  );
  server = createServer((request, response) => {
    if (request.url === "/cli-jobs.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }).end(source);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html>
      <section id="fixture"><button data-cli-refresh>刷新</button><p data-cli-status role="status"></p><div data-cli-list></div></section>
      <script type="module">
      import { mountCliJobs } from './cli-jobs.js';
      window.calls = []; window.invalid = false; window.hold = false;
      window.result = { format:'mimi-download.cli.jobs',schemaVersion:1,jobs:[] };
      window.view = mountCliJobs({root: document.querySelector('#fixture'),
        assertCurrent(){ if (window.invalid) throw new Error('project changed'); },
        panel:{async call(method,input){window.calls.push({method,input});return {handle:'project-grant'};}},
        processes:{async cliJobs(directory){window.calls.push({directory});if(window.hold) await new Promise(resolve=>window.release=resolve);return window.result;}}
      });
      </script>`);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
});
async function pageFor(t) {
  const context = await browser.newContext();
  await context.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(baseUrl + "/")
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(baseUrl);
  await page.waitForFunction(() => typeof window.view?.refresh === "function");
  return page;
}
test("CLI view reads the authorized project and renders independent task progress as text", async (t) => {
  const page = await pageFor(t);
  await page.evaluate(() => {
    window.result.jobs = [
      {
        id: "cli-id",
        status: "running",
        title: "<img src=x onerror=alert(1)>",
        progress: { fraction: 0.42 },
        files: [],
      },
    ];
  });
  await page.getByRole("button", { name: "刷新" }).click();
  await page.waitForFunction(() =>
    document.querySelector("[data-cli-list]").textContent.includes("42%"),
  );
  assert.equal(await page.locator("[data-cli-list] img").count(), 0);
  assert.match(await page.locator("[data-cli-list]").innerText(), /下载中.*42%/);
  assert.deepEqual(await page.evaluate(() => window.calls), [
    { method: "filesystem.getKnownDirectory", input: { name: "project" } },
    { directory: { handle: "project-grant" } },
  ]);
});
test("closing a view discards a late read without sending cancellation or mutating a job", async (t) => {
  const page = await pageFor(t);
  await page.evaluate(() => {
    window.hold = true;
    window.result.jobs = [{ id: "live-job", status: "running" }];
  });
  await page.getByRole("button", { name: "刷新" }).click();
  await page.waitForFunction(() => window.release);
  await page.evaluate(async () => {
    window.view.destroy();
    window.release();
    await Promise.resolve();
  });
  assert.equal(await page.locator("[data-cli-list] article").count(), 0);
  assert.equal(await page.evaluate(() => window.result.jobs[0].status), "running");
  assert.equal(await page.evaluate(() => window.calls.length), 2);
});
test("project invalidation blocks reads and empty projects do not create work", async (t) => {
  const page = await pageFor(t);
  await page.getByRole("button", { name: "刷新" }).click();
  await page.waitForFunction(() =>
    document.querySelector("[data-cli-status]").textContent.includes("还没有"),
  );
  await page.evaluate(() => {
    window.calls = [];
    window.invalid = true;
  });
  await page.getByRole("button", { name: "刷新" }).click();
  await page.waitForFunction(() =>
    document.querySelector("[data-cli-status]").textContent.includes("project changed"),
  );
  assert.deepEqual(await page.evaluate(() => window.calls), []);
});
