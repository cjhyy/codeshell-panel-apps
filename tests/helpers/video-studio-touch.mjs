import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Native Chromium touch input; the trace distinguishes it from targeted cancellation probes. */
export async function touchInput(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  await page.evaluate((selector) => {
    globalThis.touchTrace = [];
    const target = document.querySelector(selector);
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture"])
      target.addEventListener(type, (event) => {
        touchTrace.push({ type, pointerId: event.pointerId, trusted: event.isTrusted, pointerType: event.pointerType });
      }, true);
  }, selector);
  return {
    async send(type, points = []) {
      await cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((point) => ({ ...point, radiusX: 3, radiusY: 3, force: 1 })),
      });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    },
    async ids() {
      const ids = await page.evaluate(() => touchTrace.filter((event) => event.type === "pointerdown").map((event) => event.pointerId));
      assert.equal(ids.length, 2, "two real touches must reach the editor");
      assert.notEqual(ids[0], ids[1]);
      return ids;
    },
    async assertNative() {
      const trace = await page.evaluate(() => touchTrace);
      for (const type of ["pointerdown", "pointermove", "pointerup"])
        assert.ok(trace.some((event) => event.type === type && event.trusted && event.pointerType === "touch"), `missing native ${type}`);
    },
    async capture(name, state) {
      const directory = process.env.VIDEO_STUDIO_TOUCH_EVIDENCE;
      if (!directory) return;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await page.screenshot({ path: join(directory, `${name}.png`) });
      await writeFile(join(directory, `${name}.json`), JSON.stringify({
        state, trace: await page.evaluate(() => touchTrace),
      }, null, 2) + "\n", { mode: 0o600 });
    },
  };
}
