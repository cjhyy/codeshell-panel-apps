import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function fixture(t, mode = "pending", width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true });
  t.after(() => context.close());
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const file = url.pathname.slice(1) || "index.html";
    if (
      url.origin !== "https://starter.test" ||
      !["index.html", "style.css", "app.js"].includes(file)
    )
      return route.abort();
    await route.fulfill({
      body: await readFile(new URL(`../templates/starter/app/${file}`, import.meta.url)),
      contentType: {
        "index.html": "text/html",
        "style.css": "text/css",
        "app.js": "text/javascript",
      }[file],
    });
  });
  const page = await context.newPage();
  if (mode !== "preview")
    await page.addInitScript((mode) => {
      window.__listeners = {};
      window.codeshellPanel = {
        on(name, listener) {
          window.__listeners[name] = listener;
          return () => {
            delete window.__listeners[name];
          };
        },
        getContext() {
          if (mode === "failure") return Promise.reject(Error("offline"));
          return new Promise((resolve) => {
            window.__initialContext = resolve;
          });
        },
      };
    }, mode);
  await page.goto("https://starter.test");
  await page.locator("#increment").waitFor();
  return page;
}

test("context changes arriving during discovery survive a late initial response", async (t) => {
  const page = await fixture(t);
  await page.waitForFunction(() => window.__initialContext);
  await page.evaluate(() => {
    window.__listeners["context.changed"]({ cwd: "/cloud/project-b", trusted: true });
    window.__initialContext({ cwd: "/local/project-a", trusted: true });
  });
  await page.waitForFunction(
    () => document.querySelector("#workspace").textContent === "/cloud/project-b",
  );
  assert.equal(await page.locator("#workspace").getAttribute("title"), "/cloud/project-b");
  await page.getByRole("button", { name: "试一下" }).tap();
  assert.equal(await page.locator("#count").textContent(), "1 次点击");
  await page.evaluate(() =>
    window.__listeners["context.changed"]({ cwd: "/cloud/project-c", trusted: false }),
  );
  assert.equal(await page.locator("#workspace").textContent(), "/cloud/project-c");
  assert.equal(await page.locator("#status").getAttribute("data-ready"), "false");
});

test("host failure is visible and a later context event recovers the view", async (t) => {
  const page = await fixture(t, "failure");
  await page.getByRole("status").filter({ hasText: "连接失败" }).waitFor();
  assert.doesNotMatch(await page.locator("#workspace").textContent(), /浏览器预览/);
  await page.evaluate(() =>
    window.__listeners["context.changed"]({ cwd: "/reconnected", trusted: true }),
  );
  assert.equal(await page.locator("#workspace").textContent(), "/reconnected");
});

for (const width of [320, 390, 768])
  test(`long project paths fit ${width}px and remain touch operable`, async (t) => {
    const page = await fixture(t, "pending", width);
    await page.waitForFunction(() => window.__initialContext);
    await page.evaluate(() =>
      window.__initialContext({ cwd: "/项目/" + "很长的目录名/".repeat(60), trusted: true }),
    );
    await page.waitForFunction(() => document.querySelector("#status").dataset.ready === "true");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const button = await page.locator("#increment").boundingBox();
    assert.ok(button.height >= 44);
    await page.locator("#increment").tap();
    assert.equal(await page.locator("#count").textContent(), "1 次点击");
  });

test("standalone preview remains available without the Host bridge", async (t) => {
  const page = await fixture(t, "preview");
  await page.getByText("浏览器预览", { exact: true }).waitFor();
  assert.equal(await page.locator("#status").getAttribute("data-ready"), "false");
});
