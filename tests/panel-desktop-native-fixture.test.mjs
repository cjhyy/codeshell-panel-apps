import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { preparePanelDesktopNativeFixture, requireNativeNetworkBoundary, waitForPanelDesktopIdle } from "../scripts/panel-desktop-native-fixture.mjs";

test("unsupported platforms fail explicitly instead of using only a JS network guard", () => {
  for (const platform of ["linux", "win32"])
    assert.throws(() => requireNativeNetworkBoundary(platform), /no enforceable boundary is configured/);
});

test("real NativeEntry wrapper denies Node, unguarded descendants and native clients, while preserving entry stdin", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "panel-native-boundary-"));
  try {
    const environment = { HOME: directory, TMPDIR: directory, PATH: "/usr/bin:/bin" };
    const fixture = await preparePanelDesktopNativeFixture({ directory, binDirectory: join(directory, "bin"), nodeExecutable: process.execPath, environment });
    assert.equal(fixture.selfTest.netCode, "EPERM");
    assert.equal(fixture.selfTest.fetchCode, "EPERM");
    assert.deepEqual(fixture.selfTest.descendant, { netCode: "EPERM", fetchCode: "EPERM", nodeOptionsPresent: false });
    assert.equal(fixture.selfTest.nativeChild.denied, true);
    assert.equal(fixture.selfTest.positiveControlRequests, 1);
    assert.equal(fixture.selfTest.exited, true);
    const entry = join(directory, "entry.mjs");
    await writeFile(entry, `const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); console.log(Buffer.concat(chunks).toString("utf8"));`);
    const input = JSON.stringify({ action: "list", nested: { synthetic: "输入完整保留" } });
    const child = spawn(fixture.wrapper, [entry], { env: environment, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    const closed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    child.stdin.end(input);
    assert.deepEqual(await closed, { code: 0, signal: null }, stderr);
    assert.equal(stdout.trim(), input);
    const receipts = (await fixture.receipts()).filter(value => value.pid === child.pid);
    const start = receipts.find(value => value.event === "entry-start");
    assert.equal(start.entry, entry);
    assert.equal(start.entrySha256, createHash("sha256").update(await readFile(entry)).digest("hex"));
    assert.equal(start.nodeOptionsPresent, false);
    assert.equal(receipts.find(value => value.event === "entry-request").action, "list");
    assert.equal(receipts.find(value => value.event === "entry-exit").code, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const busy = { ok: false, error: "面板还有正在提交、排队或运行的任务，请结束后再修改。", blockers: [{ kind: "process", label: "download-service", tabId: "fixture-A", count: 1 }] };

test("finite BUSY observations preserve structured blockers and reuse the original operation", async () => {
  let calls = 0;
  const observations = [];
  const expected = { ok: false, error: "EACCES: permission denied, rename staged package" };
  const result = await waitForPanelDesktopIdle({ id: "video-download", pollMs: 1,
    operation: async () => ++calls < 3 ? busy : expected,
    nativeReceipts: async () => [{ event: "entry-start", entry: "service.mjs", pid: 100 }],
    onBusy: observation => { observations.push(observation); },
  });
  assert.equal(calls, 3);
  assert.equal(result, expected, "publication failure must reach the caller unchanged");
  assert.deepEqual(observations.map(value => value.result), [busy, busy]);
  assert.equal(observations[0].nativeReceipts[0].pid, 100);
  assert.deepEqual(observations.map(value => value.attempt), [1, 2]);
});

test("BUSY timeout names real holders and entry evidence without inventing a startup cause", async () => {
  await assert.rejects(waitForPanelDesktopIdle({ id: "video-download", timeoutMs: 0,
    operation: async () => busy,
    nativeReceipts: async () => [{ event: "entry-request", action: "list", pid: 101 }],
  }), error => {
    assert.match(error.message, /remained BUSY/);
    assert.match(error.message, /download-service/);
    assert.match(error.message, /"action":"list"/);
    assert.doesNotMatch(error.message, /startup probes/);
    return true;
  });
});

test("thrown unknown-dispatch errors are never retried as undispatched BUSY receipts", async () => {
  const expected = new Error(busy.error);
  let calls = 0;
  await assert.rejects(waitForPanelDesktopIdle({ id: "video-download", operation: async () => { calls++; throw expected; } }), error => error === expected);
  assert.equal(calls, 1);
});
