// Run alone: node scripts/bench-video-studio-selection-read.mjs /tmp/selection-read.json
// Uses the real workspace browser fixture without patching application source.
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const fixtureURL = new URL("../tests/video-studio-editor-workspace.test.mjs", import.meta.url), resolvePackage = createRequire(fixtureURL), directory = await mkdtemp(join(tmpdir(), "video-studio-selection-read-")), runner = join(directory, "benchmark.test.mjs");
try {
  const fixtureSource = (await readFile(fixtureURL, "utf8")).replaceAll("import.meta.url", JSON.stringify(fixtureURL.href)).replace('from "esbuild"', `from ${JSON.stringify(resolvePackage.resolve("esbuild"))}`).replace('import { chromium } from "playwright";', `import playwright from ${JSON.stringify(resolvePackage.resolve("playwright"))};\nconst { chromium } = playwright;`).replace('from "./helpers/video-studio-touch.mjs"', `from ${JSON.stringify(new URL("./helpers/video-studio-touch.mjs", fixtureURL).href)}`);
  await writeFile(runner, `${fixtureSource}
(${benchmark.toString()})();
`);
  const child = spawn(process.execPath, ["--test", "--test-reporter=spec", "--test-name-pattern=^independent 5000", runner], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: ["ignore", "pipe", "inherit"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  process.exitCode = code ?? 1;
  if (code === 0 && process.argv[2]) {
    const line = output.split("\n").find((value) => value.startsWith("SELECTION_READ_BENCH "));
    if (!line) throw new Error("Missing selection benchmark result");
    await writeFile(process.argv[2], JSON.stringify(JSON.parse(line.slice("SELECTION_READ_BENCH ".length)), null, 2) + "\n");
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
function benchmark() {
  async function largeSelectionFixture(t, count) {
    const page = await fixture(t);
    await page.evaluate(async (count2) => {
      const doc = fixture.read(), sequences = [];
      for (let offset = 0; offset < count2; offset += 2e3) {
        const id = offset ? `seq-${offset}` : "main";
        sequences.push({
          id,
          name: id,
          width: 320,
          height: 180,
          frameRate: { numerator: 30, denominator: 1 },
          background: "#000000",
          timelineMode: "free",
          tracks: [editor.createTrack("video", "video", "画面轨")],
          clips: Array.from({ length: Math.min(2e3, count2 - offset) }, (_, i) => ({
            id: `c-${offset + i}`,
            trackId: "video",
            kind: "shape",
            label: `矩形${offset + i}`,
            start: i * 48e4,
            duration: 24e4,
            shape: "rectangle",
            fill: "#ff0000",
            stroke: "#00000000",
            strokeWidth: 0,
            transform: editor.defaultTransform(),
            color: editor.defaultColorAdjustment(),
            blendMode: "normal"
          })),
          transitions: [],
          markers: []
        });
      }
      await fixture.internals.session.replace({ ...doc, id: `large-${count2}`, name: "选择性能工程", assets: [], sequences, activeSequenceId: "main" });
      await fixture.flush();
    }, count);
    await settle(page);
    await page.evaluate(() => fixture.internals.workspace.selectClips("main", ["c-0"]));
    await settle(page);
    await page.evaluate(() => {
      const w = fixture.internals.workspace, session = fixture.internals.session, read = session.read.bind(session);
      globalThis.selectionReadAudit = { active: false, phase: "other", consumer: "other", reads: [], spans: [], views: [] };
      const audit = selectionReadAudit;
      session.read = () => {
        const start = performance.now(), doc = read();
        if (audit.active) audit.reads.push({ phase: audit.phase, consumer: audit.consumer, ms: performance.now() - start });
        return doc;
      };
      const span = (name, work) => {
        if (!audit.active) return work();
        const start = performance.now(), index = audit.reads.length, previous = audit.phase;
        audit.phase = name;
        try {
          return work();
        } finally {
          audit.spans.push({ name, ms: performance.now() - start, reads: audit.reads.length - index, readMs: audit.reads.slice(index).reduce((n, r) => n + r.ms, 0) });
          audit.phase = previous;
        }
      };
      const select = w.timeline.context.select;
      w.timeline.context.select = (ids) => span("selection", () => select(ids));
      const begin = w.timeline.beginGesture.bind(w.timeline);
      w.timeline.beginGesture = (...args) => span("beginGesture", () => begin(...args));
      const plan = w.timeline.planDrag.bind(w.timeline);
      w.timeline.planDrag = (...args) => span("firstMovePlan", () => plan(...args));
      for (const [name, view] of [["inspector", w.inspector], ["timing", w.timing], ["sequences", w.sequences], ["multicam", w.multicam], ["canvas", w.canvasEditor]]) {
        if (!view) continue;
        const render = view.render.bind(view);
        view.render = (...args) => {
          if (!audit.active) return render(...args);
          const start = performance.now(), index = audit.reads.length, previous = audit.consumer;
          audit.consumer = name;
          try {
            return render(...args);
          } finally {
            audit.views.push({ name, phase: audit.phase, ms: performance.now() - start, reads: audit.reads.length - index });
            audit.consumer = previous;
          }
        };
      }
    });
    return page;
  }
  async function selectionSample(page, id, label, draft, moving = false) {
    if (draft) await (draft[0].startsWith("轨道名称") ? page.locator('[data-et-track-name="video"]') : page.getByLabel(draft[0], { exact: true })).fill(draft[1]);
    const node = page.locator(`[data-et-clip="${id}"]`), bounds = await node.boundingBox();
    assert.ok(bounds, `${label}: ${id}`);
    await page.evaluate(() => {
      const a = selectionReadAudit;
      a.reads = [];
      a.spans = [];
      a.views = [];
      a.active = true;
    });
    await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
    await page.mouse.down();
    await settle(page);
    if (moving) {
      await page.mouse.move(bounds.x + bounds.width * 0.5 + 16, bounds.y + bounds.height * 0.5);
      await settle(page);
    }
    const result = await page.evaluate(() => {
      const a = selectionReadAudit;
      a.active = false;
      return { reads: a.reads, spans: a.spans, views: a.views, selection: fixture.selection(), pending: !!fixture.internals.workspace.timeline.pendingTrackGesture, drag: !!fixture.internals.workspace.timeline.drag };
    });
    if (moving) await page.keyboard.press("Escape");
    await page.mouse.up();
    await settle(page);
    assert.deepEqual(result.selection, [id], label);
    assert.equal(result.drag, true, label);
    assert.equal(result.pending, false, label);
    return { label, ...result };
  }
  function selectionStats(rows, name) {
    const spans = rows.flatMap((row) => row.spans.filter((span) => span.name === name)), ordered = spans.map((span) => span.ms).sort((a, b) => a - b);
    return { n: spans.length, medianMs: ordered[Math.floor(ordered.length / 2)], p95Ms: ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))], reads: [...new Set(spans.map((span) => span.reads))], medianReadMs: spans.map((s) => s.readMs).sort((a, b) => a - b)[Math.floor(spans.length / 2)] };
  }
  test("independent 5000 legal clip selection read benchmark", async (t) => {
    const output = [];
    for (const count of [1e3, 5e3]) {
      const page = await largeSelectionFixture(t, count), same = [], changed = [], drafts = [], boundaries = [];
      await selectionSample(page, "c-0", "warm-up");
      for (let i = 0; i < 9; i++) same.push(await selectionSample(page, "c-0", "same IDs"));
      for (let i = 0; i < 10; i++) changed.push(await selectionSample(page, i % 2 ? "c-0" : "c-1", "changed IDs"));
      for (let i = 0; i < 4; i++) drafts.push(await selectionSample(page, "c-0", "track draft", ["轨道名称 画面轨", `画面轨${i}`]));
      for (let i = 0; i < 4; i++) drafts.push(await selectionSample(page, "c-0", "inspector draft", ["水平位置（%）", i % 2 ? "25" : "50"]));
      await page.evaluate(() => fixture.externalEdit());
      await settle(page);
      boundaries.push(await selectionSample(page, "c-1", "ordinary revision"));
      await page.evaluate(() => fixture.replaceGeneration());
      await settle(page);
      boundaries.push(await selectionSample(page, "c-0", "generation"));
      if (count === 5e3) {
        await page.evaluate(() => fixture.dispatch([{ type: "sequence.activate", sequenceId: "seq-2000" }], "切换序列"));
        await settle(page);
        boundaries.push(await selectionSample(page, "c-2000", "sequence"));
      }
      if (count === 5e3) {
        await page.evaluate(() => fixture.dispatch([{ type: "sequence.activate", sequenceId: "main" }], "回主序列"));
        await settle(page);
      }
      const firstMove = await selectionSample(page, "c-0", "first actual move (cancelled)", void 0, true);
      const document = await documentState(page);
      output.push({ count, sequenceClipCounts: document.sequences.map((s) => s.clips.length), same: { selection: selectionStats(same, "selection"), begin: selectionStats(same, "beginGesture") }, changed: { selection: selectionStats(changed, "selection"), begin: selectionStats(changed, "beginGesture") }, samples: { same: same[0], changed: changed[0], drafts, boundaries, firstMove }, errors: await page.evaluate(() => fixture.errors) });
      assert.deepEqual(await page.evaluate(() => fixture.errors), []);
      await page.close();
    }
    console.log("SELECTION_READ_BENCH " + JSON.stringify(output));
  });
}
