# Timeline visible audio plan research, 2026-10-12

Status: independent prototype; no production source changes. The rejected descriptor guard experiment remains on its separate research branch (`61f7bea`) and is not a dependency.

Run from this research worktree with npm dependencies, Playwright Chromium, FFmpeg and ffprobe available:

```sh
node scripts/video-studio-timeline-owned-plan-prototype.mjs baseline owned
```

The script bundles transformed modules in memory, temporarily copies the existing real-media browser fixture, runs its own ten tests in each mode, then removes that temporary test. It generates red/blue MP4, reversed MP4, real PCM waveforms and a native-prepared source proxy. It does not rewrite production modules or user media.

## Measurements

The document contains 5000 legal media clips, distributed across sequences containing 2000, 2000 and 1000 clips. Timing covers completed `EditorTimelineMedia` rendering, including source thumbnails and waveform strips; it does not include timeline DOM layout or the public `session.read()` needed to build the visible strip list. Each warm phase has 32 samples.

| Phase                                               | Baseline median / p95 | Owned median / p95 | Owned compilation          |
| --------------------------------------------------- | --------------------- | ------------------ | -------------------------- |
| Same visible roots, alternating viewport crop/width | 13.8 / 17.4 ms        | 0.2 / 0.4 ms       | 0 compiles; 32 hits        |
| Alternating visible roots                           | 13.5 / 17.0 ms        | 13.1 / 15.0 ms     | 31 compiles; 1 initial hit |
| Alternating active sequences                        | 13.4 / 14.7 ms        | 13.1 / 14.6 ms     | 32 compiles                |

First real-media render varied with browser decoding: baseline 61.7–84.8 ms; owned 63.9–79.6 ms across runs. The owned factory's complete validation, freeze and evaluator preparation cost 34.4–39.8 ms. This preparation replaces the evaluator's existing independently validated document copy; it does not retain an additional full graph. Cold rendering has no demonstrated improvement.

After explicit Chromium GC, held heap was approximately 6.57 MB baseline and 6.60 MB owned. Removing only the owned private plan reduced heap by 22,836 bytes. Reset reduced owned heap to approximately 4.67 MB and reported no cap, plan, thumbnail or waveform; dispose retained no owned snapshot. These are process heap measurements, not a precise retained-object attribution.

The benefit is bounded to repeated rendering with the same visible root set. Crossing root or sequence boundaries continues compiling the original partial graph with full public validation. No whole-sequence compilation is introduced.

## Proposed production API

Names below omit the prototype prefix. The formal factory should require identity; the prototype accepts an omitted identity solely for isolated fixtures.

```ts
export interface PreparedTimelineSnapshot extends PreparedEvaluator {
  readonly documentId: string;
  readonly generation: number;
  readonly revision: number;
  stripInfo(sequenceId: string, clipIds: readonly string[]): TimelineStripInfo;
  compileVisibleAudio(sequenceId: string, clipIds: readonly string[]): AudioPlanLane[];
  onDispose(listener: () => void): () => void;
  dispose(): void;
}

export function prepareTimelineSnapshot(
  value: unknown,
  identity: SessionIdentity,
): PreparedTimelineSnapshot;
export function isPreparedTimelineSnapshot(value: unknown): value is PreparedTimelineSnapshot;

class EditorTimelineMedia {
  // Existing public render keeps its existing validation and no plan cache.
  render(
    document: EditorDocument,
    sequenceId: string,
    strips: readonly TimelineMediaStrip[],
    identity?: SessionIdentity,
  ): Promise<void>;
  // Runtime registry check occurs before any capability property is read.
  renderPrepared(
    snapshot: PreparedTimelineSnapshot,
    sequenceId: string,
    strips: readonly TimelineMediaStrip[],
    identity: SessionIdentity,
  ): Promise<void>;
}

interface EditorTimelineContext {
  // Opt-in capability provider. Generic contexts with only identity remain on render().
  prepareMediaSnapshot?(
    document: EditorDocument,
    identity: SessionIdentity,
  ): PreparedTimelineSnapshot;
}
```

`TimelineStripInfo` is a detached minimal projection, not an `EditorDocument`: primitive asset identity/kind/duration, sequence ID and dimensions, primitive track ID/kind/hidden, and requested root ID/kind/start/duration/track/asset plus cloned animated audio volume. It contains no internal document, clip, track, map or plan reference. Evaluated frames and returned audio lanes remain detached. No document reader is exposed by the capability.

## Ownership and trust boundary

The factory calls the complete public document validator once, checks identity without invoking accessor properties, deeply freezes the validator-rebuilt plain graph, and creates an evaluator over that same private graph. `createEvaluator(ownedDocument)` stays non-exported. Existing `prepareEvaluator(value)` continues complete validation and independent isolation.

A private registry accepts only the exact factory capability. Spread copies, objects inheriting from a genuine cap, proxies wrapping a cap, objects with getters, and disposed caps are rejected before capability properties are inspected. Identity records are copied into immutable primitive fields and `renderPrepared` checks document ID, generation and revision. The factory never trusts identity as evidence that an input document is valid.

`compileVisibleAudio` still invokes the existing public `compileAudioPlan` with the original partial-document construction: only visible eligible roots of the requested sequence; every other sequence remains intact; transitions are omitted in that requested sequence. The capability stores no plan and returns new mutable detached lanes on every call. The renderer stores at most one returned plan in an actual ECMAScript `#private` field, inaccessible through ordinary property lookup. Public stats expose only counts.

The workspace alone opts in through `prepareMediaSnapshot`; it memoizes one real capability from its own synchronous session-backed detached read, keyed by the current session's three identity fields. The timeline does not start trusting arbitrary context documents because an `identity()` method exists. The ephemeral `frameDocument` is not retained or frozen. The factory's new private validated copy replaces the copy already retained by timeline media's evaluator.

## Minimal production diff to review

- `evaluate.ts`: extract non-exported evaluator constructor without changing evaluator logic; add the frozen owned snapshot factory, genuine-cap registry and private disposal observers; add typed detached strip projection and public-audio-plan adapter.
- `timeline-media.ts`: add `renderPrepared`; preserve `render` as the public baseline; share rendering core; add actual private snapshot, unsubscribe and one-plan fields; canonical root-set key; runtime loader/enable invalidation; synchronous abort checks after compositor drawing and after audio drawing.
- `timeline-ui.ts`: add only the optional `prepareMediaSnapshot` context hook and use it in `scheduleMedia` when identity is present. Existing contexts retain `render`. Existing media reset/dispose release the renderer-owned cap.
- `workspace-ui.ts`: add only the timeline constructor hook and a private capability memo. Release on identity changes in `refresh`, before `refreshMedia`, and in `dispose`. If the renderer already disposed the memoized cap, the next hook call rebuilds it. Reuse the detached document already read for that `scheduleMedia` call.
- Tests: factory isolation/genuine-cap checks and real timeline-media/workspace lifecycle coverage. No generated panel files in the task commit.

The timeline call site becomes:

```ts
const identity = this.context.identity?.();
const snapshot = identity && this.context.prepareMediaSnapshot?.(document, identity);
void (snapshot
  ? this.media.renderPrepared(snapshot, sequence.id, strips, identity!)
  : this.media.render(document, sequence.id, strips, identity));
```

The renderer's adoption/disposal order is important:

```ts
// Adoption: release previous cap, then retain the next cap and its unsubscribe function.
const release = () => {
  if (this.#snapshot !== next) return;
  this.releaseSnapshot(); // Unsubscribe, clear cap and plan references, then idempotent dispose.
  this.cancel(); // Abort pending work and reset pool-owned media/resources.
  this.clearCaches(); // Clear evaluator, thumbnails, waveforms, errors and keys.
};
this.#unsubscribeSnapshot = next.onDispose(release);
```

Disposal first clears the capability state and registry entry. It copies and clears the private observer set, then invokes every observer independently; a user observer that throws or calls dispose recursively cannot prevent renderer cleanup. The listener set is private instead of a public AbortSignal, so a caller cannot suppress cleanup using `stopImmediatePropagation`.

## Cache invalidation and failure behavior

The plan key contains the adopted capability identity, its captured session identity, sequence ID and sorted unique actual eligible visible root IDs. Duplicate requests and request order do not change the audio graph; drawing order remains the request order. Viewport crop and scale do not enter the key because the plan spans whole root clips, and clipping occurs only while painting.

A new cap object, document generation, revision, sequence or root set causes a miss. Every miss discards the prior plan before compiling. A failed plan is never cached, so retry compiles again. Offscreen nested roots with 257 lanes do not consume the current visible-root budget; making that root visible still fails at the unchanged 256-lane limit. A later valid revision succeeds.

The constructor already retains the options object and reads `loadWaveform` and `canLoadWaveform` at render time. Changing the waveform loader reference discards the plan and wave cache; disabling loading discards the plan; reenabling compiles once and may reuse still-valid source wave data. This adds no new runtime settings API. `resolveAsset` is captured by the existing pool constructor and is not treated as a new mutable setting.

External cap disposal during idle, resolver waiting, waveform waiting or synchronous canvas hooks immediately releases renderer references and pool resources. Old asynchronous completions cannot add tiles/waves, set ready, report stale errors, or affect a newer cap. Late owned URLs are revoked exactly once; borrowed URLs are not revoked. Reset, refresh and renderer dispose also release the cap and plan.

## Verified counterexamples

Ten tests run in both baseline and owned modes:

1. Legal 5000-clip first/same-root/cross-root/sequence-switch timing and GC release.
2. Public same-ID/revision illegal source bound, missing track field and getter-bearing inactive document remain rejected; getter calls stay zero. Factory rejects those same inputs; fake caps reject.
3. Mutating caller input, detached strip projection and returned audio plan cannot change later results; root order/duplicates preserve one plan.
4. External dispose during a pending resolver cannot publish old pixels or leak an owned URL.
5. Existing runtime loader options, deferral, failed waveform retry, changed waveform bytes and disabling/reenabling.
6. Original partial 256-lane limit, repeated failed-plan retry, revision recovery and same-ID/revision new-cap replacement with real reversed pixels.
7. External dispose during pending waveform; late old wave cannot overwrite fresh reversed audio.
8. Synchronous thumbnail drawImage and audio stroke hooks disposing the cap cannot refill caches or set ready.
9. Idle external dispose clears renderer cap/plan/resources; every stale method rejects; fake getters and Proxy caps execute no property getters.
10. Identity caller mutation cannot change captured generation; mismatched generation rejects; throwing/reentrant disposal observers cannot block cleanup; ordinary same-name property writes cannot alter the runtime-private plan.

An independent read-only review also verified evaluator output mutation isolation and waveform loader replacement while a previous request was pending.
