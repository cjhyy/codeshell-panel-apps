import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  compileCaptionSources,
  mapCaptionSourceRange,
  planTranscriptCaptions,
  parseEditorSrt,
  planSrtImport,
  exportEditorSrt,
  planCaptionTranslation,
  captionTranslationItems,
  planCaptionStyle,
  planCaptionText,
  listCaptions,
  planAddCaption,
  planCaptionTiming,
  planRemoveCaptions,
} from "../apps/video-studio/src/editor/captions";
import {
  captionPresetStyle,
  planCaptionPreset,
  captionTemplate,
} from "../apps/video-studio/src/editor/caption-presets";
import { projectLegacyView } from "../apps/video-studio/src/editor/legacy-adapter";
import {
  createCaptionController,
  type CaptionControllerContext,
} from "../apps/video-studio/src/editor/caption-controller";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import {
  sequenceDuration,
  validateEditorDocument,
} from "../apps/video-studio/src/editor/validation";
import { secondsToTicks } from "../apps/video-studio/src/editor/time";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import { EditorSession } from "../apps/video-studio/src/editor/session";
import {
  setClipSpeed,
  splitClip,
  copyClips,
  pasteClips,
} from "../apps/video-studio/src/editor/clip-edits";
import { evaluateAnimatedNumber } from "../apps/video-studio/src/editor/animation";
import type {
  EditorDocument,
  MediaClip,
  TextClip,
  SequenceClip,
  MulticamClip,
} from "../apps/video-studio/src/editor/types";
const T = 240000;
function media(
  id: string,
  trackId: string,
  start = 0,
  duration = 4 * T,
  assetId = "voice",
): MediaClip {
  return {
    id,
    trackId,
    start,
    duration,
    assetId,
    label: id,
    kind: "media",
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
    audio: defaultAudioMix(),
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: duration, source: duration },
      ],
    },
  };
}
function fixture(): EditorDocument {
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: T,
    id: "project",
    revision: 0,
    name: "字幕",
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [
      { id: "voice", name: "旁白", kind: "audio", duration: 20 * T },
      { id: "video", name: "原声画面", kind: "video", duration: 20 * T, width: 640, height: 360 },
    ],
    sequences: [
      {
        id: "main",
        name: "主序列",
        width: 640,
        height: 360,
        frameRate: { numerator: 30000, denominator: 1001 },
        background: "#000000",
        timelineMode: "free",
        tracks: [createTrack("v", "video"), createTrack("a", "audio"), createTrack("t", "text")],
        clips: [media("sound", "a")],
        transitions: [],
        markers: [],
      },
    ],
  });
}
const transcript = [
  {
    start: 1,
    end: 3,
    text: "你好 世界",
    words: [
      { start: 1, end: 2, text: "你好" },
      { start: 2, end: 3, text: " 世界" },
    ],
  },
];
const captions = (doc: EditorDocument, sequenceId = "main") =>
  doc.sequences
    .find((seq) => seq.id === sequenceId)!
    .clips.filter((clip): clip is TextClip => clip.kind === "text");
const generated = (doc = fixture()) => {
  const plan = planTranscriptCaptions(doc, "main", new Map([["voice", transcript]]), {
    wordHighlight: true,
  });
  return applyEditorOperations(doc, plan.operations, doc.revision);
};
function nested(): EditorDocument {
  const doc = fixture(),
    root = doc.sequences[0]!;
  const child = {
    ...structuredClone(root),
    id: "child",
    name: "子序列",
    clips: [media("leaf", "a", T)],
    tracks: root.tracks.map((track) => ({ ...track })),
  };
  const owner: SequenceClip = {
    ...media("nested", "v", 2 * T, 16 * T),
    kind: "sequence",
    sequenceId: "child",
  } as any;
  delete (owner as any).assetId;
  owner.timeMap = {
    points: [
      { time: 0, source: 0 },
      { time: 16 * T, source: 8 * T },
    ],
  };
  const filler: any = {
    ...media("background", "v", 0, 8 * T),
    kind: "shape",
    shape: "rectangle",
    fill: "#000000",
    stroke: "#000000",
    strokeWidth: 0,
  };
  delete filler.assetId;
  delete filler.audio;
  delete filler.timeMap;
  child.clips.push(filler);
  root.clips = [owner];
  doc.sequences.push(child);
  return validateEditorDocument(doc);
}
function gate() {
  let resolve!: (value?: any) => void;
  const promise = new Promise<any>((done) => (resolve = done));
  return { promise, resolve };
}
async function harness(
  t: TestContext,
  overrides: Partial<CaptionControllerContext> = {},
  doc = fixture(),
) {
  const store = { data: structuredClone(doc), revision: 1, fail: false, writes: 0 };
  const session = await EditorSession.open(
    {
      read: async () => ({ data: store.data, revision: store.revision }),
      write: async (document, base) => {
        assert.equal(base, store.revision);
        store.writes++;
        if (store.fail) throw new Error("保存失败");
        store.data = structuredClone(document);
        return { revision: ++store.revision };
      },
      backupLegacy: async () => {},
    },
    { autosaveDelayMs: 60000 },
  );
  const controller = createCaptionController({
    session: () => session,
    apply: (ops, identity, label) => session.dispatchDurable(ops, identity, label, "user"),
    transcript: async ({ assetId, offset }) => ({
      assetId,
      offset,
      total: transcript.length,
      segments: transcript.slice(offset),
    }),
    ...overrides,
  });
  t.after(async () => {
    controller.dispose();
    await session.close({ save: false });
  });
  return { session, controller, store };
}

test("caption sources use actual independent/main audible media; mute, zero gain, silent video and freeze emit no phantom sources", () => {
  const doc = fixture(),
    seq = doc.sequences[0]!;
  seq.clips.push(media("picture", "v", 0, 4 * T, "video"));
  seq.tracks[0]!.hidden = true;
  assert.equal(compileCaptionSources(doc, "main").length, 2);
  seq.tracks[1]!.muted = true;
  assert.deepEqual(
    compileCaptionSources(doc, "main").map((source) => source.assetId),
    ["video"],
  );
  doc.assets[1]!.metadata = { editorInspection: { video: { codec: "h264" } } };
  assert.equal(compileCaptionSources(doc, "main").length, 0);
  seq.tracks[1]!.muted = false;
  const audio = seq.clips[0] as MediaClip;
  audio.timeMap = {
    points: [
      { time: 0, source: T },
      { time: 4 * T, source: T },
    ],
  };
  assert.equal(compileCaptionSources(doc, "main").length, 0);
  audio.timeMap = {
    points: [
      { time: 0, source: 0 },
      { time: 4 * T, source: 4 * T },
    ],
  };
  audio.audio.volume = {
    keyframes: [
      { time: 0, value: 0 },
      { time: 4 * T, value: 0 },
    ],
  };
  assert.equal(compileCaptionSources(doc, "main").length, 0);
});

test("tick audibility partition matches shared cubic/hold gain evaluation without frame rounding", () => {
  const doc = fixture(),
    clip = doc.sequences[0]!.clips[0] as MediaClip;
  clip.start = 17;
  clip.duration = 1000;
  clip.timeMap = {
    points: [
      { time: 0, source: 0 },
      { time: 1000, source: 1000 },
    ],
  };
  clip.audio.volume = {
    keyframes: [
      { time: 0, value: 0, easing: { type: "cubic-bezier", x1: 0.15, y1: -3, x2: 0.75, y2: 3 } },
      { time: 700, value: 1, easing: "hold" },
      { time: 800, value: 0 },
      { time: 900, value: 1 },
      { time: 1000, value: 1 },
    ],
  };
  const source = compileCaptionSources(doc, "main")[0]!;
  for (let tick = 0; tick < 1000; tick++)
    assert.equal(
      source.ranges.some((range) => tick + 17 >= range.start && tick + 17 < range.end),
      evaluateAnimatedNumber(clip.audio.volume, tick) > 0,
      `tick ${tick}`,
    );
});

test("NTSC and reverse/held source inversion retain every integral boundary and only real word times", () => {
  const doc = fixture(),
    clip = doc.sequences[0]!.clips[0] as MediaClip;
  clip.start = 8008;
  clip.duration = 4 * T;
  clip.timeMap = {
    points: [
      { time: 0, source: 4 * T },
      { time: 2 * T, source: 2 * T },
      { time: 3 * T, source: 2 * T },
      { time: 4 * T, source: T },
    ],
  };
  const source = compileCaptionSources(doc, "main")[0]!;
  assert.deepEqual(mapCaptionSourceRange(source, 2 * T, 3 * T), [
    { start: 8008 + T + 1, end: 8008 + 2 * T },
    { start: 8008 + 3 * T, end: 8008 + 3 * T + 1 },
  ]);
  const plan = planTranscriptCaptions(doc, "main", new Map([["voice", transcript]]), {
    wordHighlight: true,
  });
  const result = applyEditorOperations(doc, plan.operations, doc.revision);
  assert.deepEqual(result.sequences[0]!.frameRate, { numerator: 30000, denominator: 1001 });
  for (const caption of captions(result)) {
    assert.equal(caption.style.animation, "word-highlight");
    assert.ok(caption.words.every((word) => ["你好", "世界"].includes(word.text)));
    assert.ok(caption.start + caption.duration <= 8008 + 2 * T || caption.start >= 8008 + 3 * T);
  }
});

test("nested instances use root-owned captions, select multicam main audio only, and never write shared child subtitles", () => {
  const doc = nested(),
    child = doc.sequences[1]!;
  doc.assets[0]!.kind = "video";
  doc.assets[0]!.width = 640;
  doc.assets[0]!.height = 360;
  const multicam = {
    ...media("multi", "v", 0, 4 * T),
    kind: "multicam",
    angles: [
      { id: "voice-angle", name: "主声音", assetId: "voice", offset: T },
      { id: "silent-angle", name: "另一个画面", assetId: "video", offset: 0 },
    ],
    audioAngleId: "voice-angle",
    switches: [{ time: 0, angleId: "silent-angle" }],
  } as unknown as MulticamClip;
  delete (multicam as any).assetId;
  child.tracks.push(createTrack("multi-track", "video"));
  multicam.trackId = "multi-track";
  child.clips = [multicam, child.clips[1]!];
  const sources = compileCaptionSources(doc, "main");
  assert.deepEqual(
    sources.map((source) => source.assetId),
    ["voice"],
  );
  const plan = planTranscriptCaptions(doc, "main", new Map([["voice", transcript]]));
  const result = applyEditorOperations(doc, plan.operations, doc.revision),
    caption = captions(result)[0]!;
  assert.equal(captions(result, "child").length, 0);
  assert.equal(caption.start, 2 * T);
  assert.equal(caption.duration, 4 * T - 1);
  assert.deepEqual(caption.sourceBinding!.provenance, {
    path: ["multi"],
    assetId: "voice",
    start: T,
    end: 3 * T,
  });
});

test("generated captions retain words/styles and reruns preserve corrected text without duplicates", () => {
  const first = generated(),
    caption = captions(first)[0]!;
  assert.deepEqual(caption.words, [
    { text: "你好", start: 0, end: T },
    { text: "世界", start: T, end: 2 * T },
  ]);
  const corrected = applyEditorOperations(
    first,
    planCaptionText(first, "main", caption.id, "校对完成"),
    first.revision,
  );
  const again = planTranscriptCaptions(corrected, "main", new Map([["voice", transcript]]), {
    wordHighlight: true,
  });
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 1);
  assert.equal(captions(corrected)[0]!.text, "校对完成");
  assert.equal(captions(corrected)[0]!.words.length, 0);
  assert.throws(
    () => planCaptionStyle(corrected, "main", [caption.id], { animation: "word-highlight" }),
    /真实词时间/,
  );
});

test("SRT roundtrip preserves Unicode/multiline and explicit millisecond quantization without 30fps conversion", () => {
  const source =
    "\uFEFF1\r\n00:00:00,033 --> 00:00:01,067\r\n第一行🙂\r\n第二行\r\n\r\n2\r\n01:00:00,001 --> 01:00:01,234\r\n尾声\r\n";
  const parsed = parseEditorSrt(source);
  assert.equal(parsed[0]!.start, 7920);
  assert.equal(parsed[1]!.start, 864000240);
  const doc = fixture(),
    plan = planSrtImport(doc, "main", source);
  const result = applyEditorOperations(doc, plan.operations, doc.revision);
  assert.deepEqual(parseEditorSrt(exportEditorSrt(result, "main")), parsed);
  assert.equal(planSrtImport(result, "main", source).skipped, 2);
  assert.throws(() => parseEditorSrt("1\n00:61:00,000 --> 00:62:00,000\n坏"), /时间无效/);
  assert.throws(() => parseEditorSrt("1\n00:00:01,000 --> 00:00:01,000\n坏"), /正时长/);
});

test("translation preserves original timed words through translated-only and bilingual modes; unmatched results never apply", () => {
  const doc = generated(),
    caption = captions(doc)[0]!,
    id = caption.id;
  const translated = applyEditorOperations(
    doc,
    planCaptionTranslation(doc, "main", [id], "en", "translated", [{ id, text: "Hello world" }])
      .operations,
    doc.revision,
  );
  const result = captions(translated)[0]!;
  assert.deepEqual(result.words, []);
  assert.deepEqual(result.translation!.originalWords, caption.words);
  assert.equal(result.style.animation, "none");
  assert.deepEqual(captionTranslationItems(translated, "main", [id]), [{ id, text: "你好 世界" }]);
  const bilingual = applyEditorOperations(
    translated,
    planCaptionTranslation(translated, "main", [id], "fr", "bilingual", [
      { id, text: "Bonjour monde" },
    ]).operations,
    translated.revision,
  );
  assert.equal(captions(bilingual)[0]!.text, "你好 世界\nBonjour monde");
  assert.deepEqual(captions(bilingual)[0]!.words, caption.words);
  assert.throws(
    () =>
      planCaptionTranslation(doc, "main", [id], "en", "bilingual", [{ id: "wrong", text: "x" }]),
    /不匹配/,
  );
});

test("nested leaf moves and speed changes automatically remap root captions and original word metadata atomically; locked outer captions reject", () => {
  const base = nested(),
    generatedPlan = planTranscriptCaptions(base, "main", new Map([["voice", transcript]]));
  let doc = applyEditorOperations(base, generatedPlan.operations, base.revision);
  const caption = captions(doc)[0]!;
  assert.equal(caption.start, 6 * T - 1);
  doc = applyEditorOperations(
    doc,
    [{ type: "clip.move", sequenceId: "child", clipIds: ["leaf"], delta: T }],
    doc.revision,
  );
  assert.equal(captions(doc)[0]!.start, 8 * T - 1);
  assert.deepEqual(captions(doc)[0]!.words, caption.words);
  const blocked = structuredClone(doc);
  blocked.sequences[0]!.tracks.find((track) => track.id === "t")!.locked = true;
  assert.throws(
    () =>
      applyEditorOperations(
        blocked,
        [{ type: "clip.move", sequenceId: "child", clipIds: ["leaf"], delta: -T }],
        blocked.revision,
      ),
    /字幕轨已锁定/,
  );
  const speedDoc = applyEditorOperations(doc, setClipSpeed(doc, "child", "leaf", 2), doc.revision);
  assert.equal(captions(speedDoc)[0]!.duration, 2 * T);
  assert.equal(captions(speedDoc)[0]!.words[0]!.end, T);
});

test("nested source removal removes only dependent captions; trim that changes source selection rejects instead of leaving stale provenance", () => {
  const base = nested(),
    plan = planTranscriptCaptions(base, "main", new Map([["voice", transcript]]));
  const doc = applyEditorOperations(base, plan.operations, base.revision);
  const leaf = doc.sequences[1]!.clips[0] as MediaClip;
  assert.throws(
    () =>
      applyEditorOperations(
        doc,
        [
          {
            type: "clip.update",
            sequenceId: "child",
            clipId: "leaf",
            patch: {
              duration: 2 * T,
              timeMap: {
                points: [
                  { time: 0, source: 0 },
                  { time: 2 * T, source: 2 * T },
                ],
              },
            },
          },
        ],
        doc.revision,
      ),
    /裁掉嵌套音源/,
  );
  const removed = applyEditorOperations(
    doc,
    [{ type: "clip.remove", sequenceId: "child", clipIds: ["leaf"] }],
    doc.revision,
  );
  assert.equal(captions(removed).length, 0);
  assert.equal(doc.sequences[1]!.clips[0]!.id, leaf.id);
});

test("provenance validates complete graph and survives JSON roundtrip and root split without sharing state", () => {
  const doc = generated();
  assert.deepEqual(validateEditorDocument(JSON.parse(JSON.stringify(doc))), doc);
  const bad = structuredClone(doc);
  captions(bad)[0]!.sourceBinding!.provenance!.assetId = "video";
  assert.throws(() => validateEditorDocument(bad), /实际音源/);
  const split = applyEditorOperations(
    doc,
    splitClip(doc, "main", "sound", 2 * T, () => crypto.randomUUID()),
    doc.revision,
  );
  assert.equal(captions(split).length, 2);
  assert.ok(
    captions(split).every((caption) => caption.sourceBinding!.provenance!.assetId === "voice"),
  );
});

test("controller obtains complete real pages and selected source list, previews before a single durable save, and retains failed candidate for retry", async (t) => {
  const seen: string[][] = [];
  const h = await harness(t, {
    prepare: async ({ assetIds }) => {
      seen.push(assetIds);
    },
  });
  await h.controller.generate({ sequenceId: "main", assetIds: ["voice"], wordHighlight: true });
  assert.deepEqual(seen, [["voice"]]);
  assert.equal(captions(h.session.read()).length, 0);
  assert.equal(h.controller.getState().phase, "preview");
  h.store.fail = true;
  await assert.rejects(h.controller.apply(), /保存失败/);
  assert.equal(h.session.read().revision, 0);
  assert.ok(h.controller.getState().candidate);
  h.store.fail = false;
  await h.controller.apply();
  assert.equal(captions(h.session.read()).length, 1);
  assert.equal(h.session.read().revision, 1);
  h.session.undo();
  assert.equal(captions(h.session.read()).length, 0);
});

test("controller rejects changed transcript revision, incomplete/repeated pages and missing capability without fabricating cues", async (t) => {
  const many = Array.from({ length: 101 }, (_, i) => ({
    start: i / 100,
    end: (i + 1) / 100,
    text: `词${i}`,
  }));
  const h = await harness(t, {
    transcript: async ({ assetId, offset }) => ({
      assetId,
      offset,
      total: 101,
      revision: offset ? "new" : "old",
      segments: many.slice(offset, offset + 100),
    }),
  });
  await assert.rejects(h.controller.generate({ sequenceId: "main" }), /版本.*变化/);
  assert.equal(captions(h.session.read()).length, 0);
  const missing = await harness(t, { transcript: undefined });
  await assert.rejects(missing.controller.generate({ sequenceId: "main" }), /没有接入/);
  const empty = await harness(t, {
    transcript: async ({ assetId, offset }) => ({ assetId, offset, total: 1, segments: [] }),
  });
  await assert.rejects(empty.controller.generate({ sequenceId: "main" }), /分页不完整/);
});

test("cancelled, disposed or stale async translation/ASR completions never publish candidates; autosave state does not cancel valid preview", async (t) => {
  const pending = gate();
  let signal: AbortSignal | undefined;
  const h = await harness(t, {
    transcript: async (request) => {
      signal = request.signal;
      await pending.promise;
      return { assetId: request.assetId, offset: 0, total: 1, segments: transcript };
    },
  });
  const work = h.controller.generate({ sequenceId: "main" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.controller.cancel();
  assert.equal(signal!.aborted, true);
  pending.resolve();
  await assert.rejects(work, /取消/);
  assert.equal(h.controller.getState().candidate, undefined);
  const pending2 = gate(),
    second = await harness(
      t,
      {
        translate: async ({ items }) => {
          await pending2.promise;
          return items.map((item) => ({ id: item.id, text: "Translated" }));
        },
      },
      generated(),
    );
  const translating = second.controller.translate({
    sequenceId: "main",
    clipIds: [captions(second.session.read())[0]!.id],
    language: "en",
    mode: "bilingual",
  });
  second.session.dispatch(
    [{ type: "project.rename", name: "新版本" }],
    second.session.getState().identity,
  );
  pending2.resolve();
  await assert.rejects(translating, /取消|变化/);
  assert.equal(second.controller.getState().phase, "stale");
  assert.equal(second.controller.getState().candidate, undefined);
});

test("translation is batched and previewed with exact IDs, and same-ID restore invalidates a prepared candidate", async (t) => {
  const h = await harness(
    t,
    { translate: async ({ items }) => items.map((item) => ({ id: item.id, text: "Hello" })) },
    generated(),
  );
  const id = captions(h.session.read())[0]!.id;
  await h.controller.translate({
    sequenceId: "main",
    clipIds: [id],
    language: "en",
    mode: "bilingual",
  });
  assert.equal(captions(h.session.read())[0]!.text, "你好 世界");
  assert.equal(h.controller.getState().candidate!.rows[0]!.text, "你好 世界\nHello");
  const restored = h.session.read();
  restored.name = "恢复版本";
  await h.session.replace(restored);
  assert.equal(h.controller.getState().candidate, undefined);
  await assert.rejects(h.controller.apply(), /没有待应用/);
});

test("clipboard and portable project preserve full caption provenance and translated original words without shared references", async () => {
  const { validatePortableProjectManifest } =
    await import("../apps/video-studio/src/editor/portable-project");
  const base = generated(),
    id = captions(base)[0]!.id,
    doc = applyEditorOperations(
      base,
      planCaptionTranslation(base, "main", [id], "en", "translated", [{ id, text: "Hello" }])
        .operations,
      base.revision,
    );
  const manifest = {
    format: "mimi-video-project",
    formatVersion: 1,
    document: doc,
    media: doc.assets.map((asset, index) => ({
      sha256: String(index + 1).repeat(64),
      bytes: 100,
      assetIds: [asset.id],
    })),
  };
  const restored = validatePortableProjectManifest(JSON.parse(JSON.stringify(manifest))).document;
  assert.deepEqual(restored, doc);
  const copied = copyClips(doc, "main", ["sound"]);
  const pasted = applyEditorOperations(
    doc,
    pasteClips(doc, "main", copied, { at: 6 * T, idFactory: () => crypto.randomUUID() }),
    doc.revision,
  );
  const fresh = captions(pasted).find((clip) => clip.id !== id)!;
  assert.notEqual(fresh.sourceBinding!.clipId, "sound");
  assert.deepEqual(fresh.translation!.originalWords, captions(doc)[0]!.translation!.originalWords);
  fresh.sourceBinding!.provenance!.path.push("change");
  assert.deepEqual(captions(doc)[0]!.sourceBinding!.provenance!.path, []);
});

test("callback capability readiness gates actual operations and complete stamped pagination reads every segment", async (t) => {
  const seen: number[] = [],
    segments = Array.from({ length: 201 }, (_, index) => ({
      start: index / 100,
      end: (index + 1) / 100,
      text: `真实${index}`,
    }));
  const h = await harness(t, {
    transcript: async ({ assetId, offset }) => {
      seen.push(offset);
      return {
        assetId,
        offset,
        total: segments.length,
        revision: "stable",
        segments: segments.slice(offset, offset + 100),
      };
    },
  });
  h.controller.setCapabilities({ canTranscribe: false, canTranslate: false });
  await assert.rejects(h.controller.generate({ sequenceId: "main" }), /没有接入/);
  assert.deepEqual(seen, []);
  h.controller.setCapabilities({ canTranscribe: true, canTranslate: false });
  await h.controller.generate({ sequenceId: "main" });
  assert.deepEqual(seen, [0, 100, 200]);
  assert.equal(h.controller.getState().candidate!.rows.length, 201);
  assert.equal(h.session.read().revision, 0);
  h.controller.dispose();
  assert.equal(h.controller.getState().candidate!.rows.length, 201);
});

test("dispose aborts outstanding service work and suppresses all later candidate/state notifications", async (t) => {
  const pending = gate();
  let signal: AbortSignal | undefined;
  const h = await harness(t, {
    transcript: async (request) => {
      signal = request.signal;
      await pending.promise;
      return { assetId: request.assetId, offset: 0, total: 1, segments: transcript };
    },
  });
  let notifications = 0;
  h.controller.subscribe(() => notifications++);
  const work = h.controller.generate({ sequenceId: "main" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.controller.dispose();
  const previous = notifications;
  assert.equal(signal!.aborted, true);
  pending.resolve();
  await assert.rejects(work, /取消/);
  assert.equal(notifications, previous);
  assert.equal(h.controller.getState().candidate, undefined);
});

test("explicit detach preserves complete subtitle content and allows formerly rejected nested source cuts", async (t) => {
  const base = nested(),
    plan = planTranscriptCaptions(base, "main", new Map([["voice", transcript]]));
  const doc = applyEditorOperations(base, plan.operations, base.revision),
    original = captions(doc)[0]!;
  const h = await harness(t, {}, doc);
  await h.controller.detach("main", [original.id]);
  const next = captions(h.session.read())[0]!;
  assert.equal(next.sourceBinding, undefined);
  assert.deepEqual(next.words, original.words);
  assert.deepEqual(next.style, original.style);
  const trimmed = applyEditorOperations(
    h.session.read(),
    [
      {
        type: "clip.update",
        sequenceId: "child",
        clipId: "leaf",
        patch: {
          duration: 2 * T,
          timeMap: {
            points: [
              { time: 0, source: 0 },
              { time: 2 * T, source: 2 * T },
            ],
          },
        },
      },
    ],
    h.session.read().revision,
  );
  assert.equal(captions(trimmed)[0]!.text, original.text);
});

test("long sentences split only at authentic word boundaries while retaining original punctuation and words", () => {
  const doc = fixture(),
    words = Array.from({ length: 8 }, (_, i) => ({
      text: `真实词${i}，`,
      start: i * 0.5,
      end: (i + 1) * 0.5,
    })),
    text = words.map((word) => word.text).join("");
  const plan = planTranscriptCaptions(
    doc,
    "main",
    new Map([["voice", [{ start: 0, end: 4, text, words }]]]),
  );
  const result = applyEditorOperations(doc, plan.operations, doc.revision),
    clips = captions(result).sort((a, b) => a.start - b.start);
  assert.ok(clips.length > 1);
  assert.equal(clips.map((clip) => clip.text).join(""), text);
  assert.deepEqual(
    clips.flatMap((clip) =>
      clip.words.map((word) => ({
        text: word.text,
        start: (clip.start + word.start) / T,
        end: (clip.start + word.end) / T,
      })),
    ),
    words,
  );
});

/** Real camera media: off-frame asset length and placement, which the old frame projection excludes. */
function realMedia(): EditorDocument {
  const doc = fixture(),
    seq = doc.sequences[0]!;
  doc.assets.push({
    id: "camera",
    name: "实拍素材",
    kind: "video",
    duration: 10_000_123,
    width: 640,
    height: 360,
  });
  seq.clips = [media("camera-clip", "v", 1_234_567, 10_000_123, "camera")];
  return validateEditorDocument(doc);
}
test("caption planners edit a real off-frame media timeline with exact ticks and no old projection", () => {
  const doc = realMedia(),
    end = 1_234_567 + 10_000_123;
  assert.equal(projectLegacyView(doc).timelineComplete, false);
  const added = applyEditorOperations(
    doc,
    planAddCaption(doc, "main", {
      start: 2_345_678,
      text: "真实素材字幕",
      idFactory: () => "manual-caption",
    }),
    doc.revision,
  );
  let caption = listCaptions(added, "main")[0]!;
  assert.equal(caption.id, "manual-caption");
  assert.equal(caption.trackId, "t");
  assert.equal(caption.start, 2_345_678);
  assert.equal(caption.duration, 3 * T, "Default duration is three seconds");
  assert.equal(caption.role, "subtitle");
  const tail = applyEditorOperations(
    doc,
    planAddCaption(doc, "main", { start: end - 1000, text: "尾声", idFactory: () => "tail" }),
    doc.revision,
  );
  assert.equal(listCaptions(tail, "main")[0]!.duration, 1000, "Clamped to the sequence end");
  assert.throws(
    () => planAddCaption(doc, "main", { start: end, text: "越界" }),
    /播放头|画面范围/,
  );
  assert.throws(() => planAddCaption(doc, "main", { start: 0, text: " " }), /字幕文字/);
  const moved = applyEditorOperations(
    added,
    planCaptionTiming(added, "main", "manual-caption", { start: 2_400_001, end: 3_100_003 }),
    added.revision,
  );
  caption = listCaptions(moved, "main")[0]!;
  assert.equal(caption.start, 2_400_001);
  assert.equal(caption.duration, 700_002);
  const extended = applyEditorOperations(
    moved,
    planCaptionTiming(moved, "main", "manual-caption", { start: 2_400_001, end: 4_000_007 }),
    moved.revision,
  );
  assert.equal(listCaptions(extended, "main")[0]!.duration, 1_600_006);
  assert.deepEqual(
    planCaptionTiming(extended, "main", "manual-caption", { start: 2_400_001, end: 4_000_007 }),
    [],
  );
  const removed = applyEditorOperations(
    extended,
    planRemoveCaptions(extended, "main", ["manual-caption"]),
    extended.revision,
  );
  assert.deepEqual(listCaptions(removed, "main"), []);
  const srt = "1\n00:00:05,001 --> 00:00:06,999\n导入的字幕\n";
  const imported = applyEditorOperations(
    removed,
    planSrtImport(removed, "main", srt).operations,
    removed.revision,
  );
  assert.equal(listCaptions(imported, "main")[0]!.start, 1_200_240);
  assert.equal(exportEditorSrt(imported, "main"), srt);
  assert.equal(projectLegacyView(imported).timelineComplete, false);
});

test("multitrack captions list every subtitle track in time order and presets keep content and titles", () => {
  const doc = fixture(),
    seq = doc.sequences[0]!;
  seq.tracks = [
    createTrack("v", "video"),
    createTrack("v2", "video"),
    createTrack("a", "audio"),
    createTrack("t", "text"),
    createTrack("t2", "text"),
  ];
  const text = (id: string, trackId: string, start: number, role: "title" | "subtitle") => {
    const clip = captions(
      applyEditorOperations(
        doc,
        planAddCaption(doc, "main", { start, text: id, trackId, idFactory: () => id }),
        doc.revision,
      ),
    ).find((item) => item.id === id)!;
    clip.role = role;
    return clip;
  };
  seq.clips = [
    media("sound", "a"),
    { ...media("picture", "v", 0, 6 * T, "video") },
    { ...media("overlay", "v2", T, 2 * T, "video") },
  ];
  const worded = text("worded", "t", T, "subtitle");
  worded.words = [{ text: "worded", start: 0, end: T }];
  worded.style.animation = "word-highlight";
  worded.translation = { original: "原文", language: "英语", mode: "bilingual" };
  const faded = text("faded", "t2", 2 * T / 3, "subtitle");
  faded.style.animation = "fade";
  const last = text("last", "t2", 3 * T, "subtitle");
  const title = text("title", "t", 0, "title");
  seq.clips.push(worded, faded, last, title);
  const multi = validateEditorDocument(doc);
  assert.deepEqual(
    listCaptions(multi, "main").map((clip) => clip.id),
    ["faded", "worded", "last"],
  );
  const styled = applyEditorOperations(
    multi,
    planCaptionPreset(multi, "main", "bold"),
    multi.revision,
  );
  const bold = captionPresetStyle(styled.sequences[0]!, "bold");
  for (const clip of listCaptions(styled, "main")) {
    const before = captions(multi).find((item) => item.id === clip.id)!;
    assert.deepEqual(clip.style, { ...bold, animation: before.style.animation });
    assert.deepEqual(clip.words, before.words);
    assert.deepEqual(clip.translation, before.translation);
    assert.equal(clip.text, before.text);
  }
  assert.deepEqual(
    captions(styled).find((clip) => clip.id === "title"),
    captions(multi).find((clip) => clip.id === "title"),
  );
  assert.equal(styled.production?.legacyCaptionStyle, "bold");
  assert.equal(projectLegacyView(styled).project.captionStyle, "bold");
  assert.deepEqual(planCaptionPreset(styled, "main", "bold"), []);
});

test("manual caption timing detaches source following, trims real words and respects locks", () => {
  const doc = generated(),
    original = captions(doc)[0]!;
  assert.ok(original.sourceBinding);
  assert.equal(original.start, T);
  const shortened = applyEditorOperations(
    doc,
    planCaptionTiming(doc, "main", original.id, { start: T, end: 2 * T }),
    doc.revision,
  );
  let caption = captions(shortened)[0]!;
  assert.equal(caption.sourceBinding, undefined);
  assert.equal(caption.duration, T);
  assert.deepEqual(caption.words, [{ text: "你好", start: 0, end: T }]);
  assert.equal(caption.text, "你好 世界", "A retime never rewrites the caption text");
  assert.equal(caption.style.animation, "word-highlight");
  const clamped = applyEditorOperations(
    doc,
    planCaptionTiming(doc, "main", original.id, { start: T, end: 2.5 * T }),
    doc.revision,
  );
  assert.deepEqual(captions(clamped)[0]!.words, [
    { text: "你好", start: 0, end: T },
    { text: "世界", start: T, end: 1.5 * T },
  ]);
  const moved = applyEditorOperations(
    doc,
    planCaptionTiming(doc, "main", original.id, { start: 1.5 * T, end: 3.5 * T }),
    doc.revision,
  );
  caption = captions(moved)[0]!;
  assert.equal(caption.start, 1.5 * T);
  assert.equal(caption.duration, 2 * T);
  assert.deepEqual(caption.words, original.words, "Clip-local words move with the caption");
  const sourceMoved = applyEditorOperations(
    moved,
    [{ type: "clip.move", sequenceId: "main", clipIds: ["sound"], delta: T }],
    moved.revision,
  );
  assert.equal(captions(sourceMoved)[0]!.start, 1.5 * T, "A manual time is never snapped back");
  assert.throws(
    () => planCaptionTiming(doc, "main", original.id, { start: 2 * T, end: 2 * T }),
    /结束时间/,
  );
  const locked = applyEditorOperations(
    doc,
    [{ type: "track.update", sequenceId: "main", trackId: "t", patch: { locked: true } }],
    doc.revision,
  );
  assert.throws(
    () => planCaptionTiming(locked, "main", original.id, { start: 0, end: T }),
    /锁定/,
  );
  assert.throws(() => planRemoveCaptions(locked, "main", [original.id]), /锁定/);
  assert.throws(() => planCaptionPreset(locked, "main", "minimal"), /锁定/);
  assert.throws(
    () => planAddCaption(locked, "main", { start: 0, text: "新字幕", trackId: "t" }),
    /锁定/,
  );
});

test("retiming never lengthens the sequence and keeps duration-relative animations", () => {
  const doc = realMedia(),
    end = 1_234_567 + 10_000_123;
  const tail = applyEditorOperations(
    doc,
    planAddCaption(doc, "main", { start: end - 2 * T, text: "尾声", idFactory: () => "tail" }),
    doc.revision,
  );
  const extended = applyEditorOperations(
    tail,
    planCaptionTiming(tail, "main", "tail", { start: end - 2 * T, end: end + 5 * T }),
    tail.revision,
  );
  const caption = listCaptions(extended, "main")[0]!;
  assert.equal(caption.start + caption.duration, end, "Clamped to the picture end");
  assert.equal(sequenceDuration(extended.sequences[0]!), end);
  assert.throws(
    () => planCaptionTiming(tail, "main", "tail", { start: end, end: end + T }),
    /画面范围/,
  );
  const styled = (animation: "typewriter" | "fade") => {
    const added = applyEditorOperations(
      doc,
      planAddCaption(doc, "main", {
        start: 2 * T,
        duration: 2 * T,
        text: "逐字出现的字幕",
        idFactory: () => animation,
      }),
      doc.revision,
    );
    return applyEditorOperations(
      added,
      planCaptionStyle(added, "main", [animation], { animation }),
      added.revision,
    );
  };
  for (const animation of ["typewriter", "fade"] as const) {
    const before = styled(animation);
    const shortened = applyEditorOperations(
      before,
      planCaptionTiming(before, "main", animation, { start: 2.5 * T, end: 3.5 * T }),
      before.revision,
    );
    const clip = listCaptions(shortened, "main")[0]!;
    assert.deepEqual([clip.start, clip.duration], [2.5 * T, T]);
    assert.equal(clip.style.animation, animation, "The animation scales with the new length");
    assert.equal(clip.text, "逐字出现的字幕");
    assert.equal(clip.transform.opacity, 1, "A fade stays a fade, not baked keyframes");
  }
  const keyed = styled("fade");
  const id = listCaptions(keyed, "main")[0]!.id;
  const animated = applyEditorOperations(
    keyed,
    [
      {
        type: "clip.update",
        sequenceId: "main",
        clipId: id,
        patch: {
          transform: {
            ...listCaptions(keyed, "main")[0]!.transform,
            x: {
              keyframes: [
                { time: 0, value: 0 },
                { time: 2 * T, value: 0.2 },
              ],
            },
          },
        },
      },
    ],
    keyed.revision,
  );
  const halved = applyEditorOperations(
    animated,
    planCaptionTiming(animated, "main", id, { start: 2 * T, end: 3 * T }),
    animated.revision,
  );
  assert.deepEqual(listCaptions(halved, "main")[0]!.transform.x, {
    keyframes: [
      { time: 0, value: 0 },
      { time: T, value: 0.2 },
    ],
  });
});

test("new captions from every path follow the project's caption preset", () => {
  const base = fixture(),
    seq = base.sequences[0]!;
  const look = (preset: "classic" | "bold" | "minimal") => {
    const template = captionTemplate({
      width: seq.width,
      height: seq.height,
      captionStyle: preset,
    });
    return { style: template.style, transform: template.transform };
  };
  const added = (doc: EditorDocument) =>
    captions(
      applyEditorOperations(
        doc,
        planAddCaption(doc, "main", { start: T, text: "新字幕", idFactory: () => "fresh" }),
        doc.revision,
      ),
    ).find((clip) => clip.id === "fresh")!;
  const plain = added(base);
  assert.deepEqual({ style: plain.style, transform: plain.transform }, look("classic"));
  const first = applyEditorOperations(
    base,
    planAddCaption(base, "main", { start: 0, text: "第一条", idFactory: () => "first" }),
    base.revision,
  );
  const bold = applyEditorOperations(
    first,
    planCaptionPreset(first, "main", "bold"),
    first.revision,
  );
  const again = added(bold);
  assert.deepEqual({ style: again.style, transform: again.transform }, look("bold"));
  const imported = applyEditorOperations(
    bold,
    planSrtImport(bold, "main", "1\n00:00:05,000 --> 00:00:06,000\n导入\n").operations,
    bold.revision,
  );
  assert.ok(listCaptions(imported, "main").every((clip) => clip.style.color === "#ffe46b"));
  assert.deepEqual(captions(imported).at(-1)!.style, look("bold").style);
  const preferred = fixture();
  preferred.production = { legacyCaptionStyle: "minimal" };
  const transcribed = captions(generated(validateEditorDocument(preferred)))[0]!;
  assert.deepEqual(transcribed.style, { ...look("minimal").style, animation: "word-highlight" });
});

test("word-timed transcripts caption only the words actually played in trimmed or repeated audio", () => {
  const doc = fixture(),
    seq = doc.sequences[0]!;
  const trimmed = media("sound", "a", 4 * T, T);
  trimmed.timeMap = {
    points: [
      { time: 0, source: T },
      { time: T, source: 2 * T },
    ],
  };
  seq.clips = [trimmed];
  const words = [
    { start: 0, end: 1, text: "删除" },
    { start: 1, end: 2, text: "保留" },
    { start: 2, end: 3, text: "删除" },
  ];
  const kept = applyEditorOperations(
    validateEditorDocument(doc),
    planTranscriptCaptions(
      validateEditorDocument(doc),
      "main",
      new Map([["voice", [{ start: 0, end: 3, text: "删除保留删除", words }]]]),
    ).operations,
    doc.revision,
  );
  assert.deepEqual(
    captions(kept).map((clip) => [clip.start, clip.duration, clip.text]),
    [[4 * T, T, "保留"]],
  );
  const unplayed = planTranscriptCaptions(
    validateEditorDocument(doc),
    "main",
    new Map([
      [
        "voice",
        [{ start: 0, end: 3, text: "静音里的完整句子", words: [{ start: 2, end: 3, text: "没有播放" }] }],
      ],
    ]),
  );
  assert.equal(unplayed.added, 0, "Known word times inside unplayed audio never become a caption");
  const repeated = fixture();
  repeated.sequences[0]!.clips = [
    media("first", "a", 3 * T, 2 * T),
    media("again", "a", 14 * T, 2 * T),
    { ...media("muted", "a", 17 * T, 2 * T), audio: { ...defaultAudioMix(), volume: 0 } },
  ];
  const placed = applyEditorOperations(
    validateEditorDocument(repeated),
    planTranscriptCaptions(
      validateEditorDocument(repeated),
      "main",
      new Map([["voice", [{ start: 1, end: 2, text: "画面前的旁白" }]]]),
    ).operations,
    repeated.revision,
  );
  const clips = captions(placed);
  assert.deepEqual(
    clips.map((clip) => [clip.start, clip.duration]),
    [
      [4 * T, T],
      [15 * T, T],
    ],
  );
  assert.notEqual(clips[0]!.id, clips[1]!.id);
});

test("Chinese word timings form readable captions at real word starts across repeated trims", () => {
  const doc = fixture();
  doc.assets[0]!.duration = 20 * T;
  const trim = (id: string, start: number, from: number, to: number) => {
    const clip = media(id, "a", start, to - from);
    clip.timeMap = {
      points: [
        { time: 0, source: from },
        { time: to - from, source: to },
      ],
    };
    return clip;
  };
  doc.sequences[0]!.clips = [trim("a", 0, 3 * T, 10 * T), trim("b", 7 * T, 0, 5 * T)];
  const words = Array.from({ length: 44 }, (_, index) => ({
    start: (index * 13.82) / 44,
    end: ((index + 1) * 13.82) / 44,
    text: "画面",
  }));
  const result = applyEditorOperations(
    validateEditorDocument(doc),
    planTranscriptCaptions(
      validateEditorDocument(doc),
      "main",
      new Map([
        ["voice", [{ start: 0, end: 13.82, text: words.map((w) => w.text).join(""), words }]],
      ]),
    ).operations,
    doc.revision,
  );
  const clips = captions(result).sort((a, b) => a.start - b.start);
  assert.ok(clips.length >= 5);
  assert.ok(clips.every((clip) => [...clip.text].length <= 30));
  assert.ok(clips.every((clip) => clip.duration > 0 && clip.duration <= 4.5 * T));
  assert.equal(clips[0]!.start, 0);
  assert.ok(clips.some((clip) => clip.start === 7 * T));
  const starts = new Set(words.map((word) => secondsToTicks(word.start)));
  for (const clip of clips.filter((clip) => clip.start > 0 && clip.start < 7 * T))
    assert.ok(starts.has(clip.start + 3 * T), `caption starts at a real word: ${clip.start}`);
  const sentence = applyEditorOperations(
    fixture(),
    planTranscriptCaptions(
      fixture(),
      "main",
      new Map([["voice", [{ start: 1, end: 3, text: "没有逐字时间就保留真实整段范围" }]]]),
    ).operations,
    0,
  );
  assert.deepEqual(
    captions(sentence).map((clip) => [clip.start, clip.duration, clip.text]),
    [[T, 2 * T, "没有逐字时间就保留真实整段范围"]],
  );
});

test("new subtitles avoid a title track and join the track that already holds subtitles", () => {
  const title: TextClip = {
    id: "title",
    kind: "text",
    role: "title",
    label: "标题",
    trackId: "t",
    start: 0,
    duration: T,
    text: "标题",
    style: defaultTextStyle(),
    words: [],
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  };
  const titled = fixture();
  titled.sequences[0]!.clips.push(title);
  const plan = planTranscriptCaptions(titled, "main", new Map([["voice", transcript]]));
  const after = applyEditorOperations(titled, plan.operations, titled.revision);
  const subtitles = captions(after).filter((clip) => clip.role === "subtitle");
  assert.ok(subtitles.length);
  assert.ok(subtitles.every((clip) => clip.trackId !== "t"), "The title track keeps only titles");
  const both = structuredClone(titled);
  both.sequences[0]!.tracks.push(createTrack("subs", "text", "字幕"));
  both.sequences[0]!.clips.push({
    ...structuredClone(title),
    id: "old-sub",
    role: "subtitle",
    trackId: "subs",
    start: 10 * T,
  });
  const again = planSrtImport(both, "main", "1\n00:00:01,000 --> 00:00:02,000\n新字幕\n");
  const imported = applyEditorOperations(both, again.operations, both.revision);
  assert.equal(captions(imported).find((clip) => clip.text === "新字幕")?.trackId, "subs");
});
