/** Browser fixture adapter: existing media fixtures simulate the Panel tool, while
 * production code sees only the real tasks/resources Host contract. No runtime
 * implementation is replaced; deterministic completion controls remain explicit. */
export function installGenericMediaTaskMock() {
  if (window.__genericMediaTaskMockInstalled) return;
  window.__genericMediaTaskMockInstalled = true;
  const listeners = new Map();
  const copy = (value) => (value === undefined ? undefined : structuredClone(value));
  const persisted = JSON.parse(localStorage.getItem("test-generic-media-tasks") || "{}");
  const editorTransfers = JSON.parse(localStorage.getItem("test-editor-transfers") || "{}");
  const localJobs = new Map(
      Object.entries(JSON.parse(localStorage.getItem("test-generic-local-media-jobs") || "{}")),
    ),
    uploads = new Map(
      Object.entries(JSON.parse(localStorage.getItem("test-generic-resource-uploads") || "{}")),
    ),
    uploadedFiles = new Map(
      Object.entries(JSON.parse(localStorage.getItem("test-generic-resource-files") || "{}")),
    ),
    resources = new Map([...uploadedFiles].map(([id, value]) => [id, copy(value.asset)])),
    documents = new Map();
  window.__genericHostCalls = [];
  window.__nativeCaptures = [];
  window.__editorRenderRequests = [];
  const emit = (event, value) => {
    for (const listener of listeners.get(event) || []) listener(copy(value));
  };
  const persist = () => {
    localStorage.setItem("test-editor-transfers", JSON.stringify(editorTransfers));
    localStorage.setItem(
      "test-generic-resource-uploads",
      JSON.stringify(Object.fromEntries(uploads)),
    );
    localStorage.setItem(
      "test-generic-resource-files",
      JSON.stringify(Object.fromEntries(uploadedFiles)),
    );
    localStorage.setItem("test-generic-media-tasks", JSON.stringify(persisted));
    localStorage.setItem(
      "test-generic-local-media-jobs",
      JSON.stringify(Object.fromEntries(localJobs)),
    );
  };
  const methodFor = (action) =>
    ({
      status: "media.status",
      voices: "media.tts.voices",
      prepare: "media.prepare",
      transcribe: "media.transcribe",
      "audio-extract": "media.audio.extract",
      "audio-enhance": "media.audio.enhance",
      scene: "media.scene",
      render: "media.render",
      tts: "media.tts",
      "tts-setup": "media.tts.setup",
    })[action];
  const terminal = (status) => ["succeeded", "failed", "cancelled", "interrupted"].includes(status);
  const preparedKey = (id) => `video-studio-prepared-${id}`;
  function wrap(raw) {
    if (!raw || raw.__genericTaskFixture) return raw;
    async function fixture(method, params = {}) {
      return raw.call(method, params);
    }
    async function fixtureData(method, args) {
      // Hydrate pre-existing native document fixtures, not a new UI operation.
      const index = window.__calls?.length;
      try {
        return await fixture(method, args);
      } finally {
        const call = window.__calls?.[index];
        if (call?.method === method) window.__calls.splice(index, 1);
      }
    }
    async function existingPreparation(id) {
      const current = await fixture("media.assets.get", { id });
      resources.set(current.asset.id, copy(current.asset));
      const prep = copy(current.preparation);
      if (prep && !Array.isArray(prep.transcription?.segments)) {
        try {
          prep.transcription = { ...prep.transcription, ...(await transcript(id, true)) };
        } catch {
          /* Fixture intentionally has no transcript. */
        }
      }
      if (prep && !prep.silence) {
        try {
          prep.silence = await fixtureData("media.analysis", {
            assetId: id,
            kind: "silence",
            offset: 0,
            limit: 100,
          });
        } catch {}
      }
      return prep;
    }
    async function transcript(id, hydrate = false) {
      const segments = [];
      let offset = 0,
        total;
      do {
        const page = await (hydrate ? fixtureData : fixture)("media.transcript", {
          assetId: id,
          offset,
          limit: 100,
        });
        total = page.total;
        if (!Array.isArray(page.segments) || !page.segments.length) break;
        segments.push(...page.segments);
        offset += page.segments.length;
      } while (offset < total);
      return { assetId: id, segments };
    }
    async function enrich(job, meta) {
      const value = copy(job);
      if (value.status === "succeeded" && value.result) {
        const result = value.result;
        if (
          meta.action === "prepare" &&
          meta.request.params.transcribe &&
          result.transcription &&
          !Array.isArray(result.transcription.segments)
        ) {
          try {
            result.transcription = {
              ...result.transcription,
              ...(await transcript(meta.request.params.assetId)),
            };
          } catch {
            /* Preserve deliberate missing transcript fixtures. */
          }
        }
        if (meta.action === "transcribe" && !Array.isArray(result.segments))
          Object.assign(result, await transcript(meta.request.params.assetId));
        if (meta.action === "prepare") {
          for (const kind of ["silence", "scenes"])
            if (
              result[kind] &&
              !Array.isArray(result[kind][kind === "silence" ? "intervals" : "cuts"])
            ) {
              try {
                result[kind] = {
                  ...result[kind],
                  ...(await fixture("media.analysis", {
                    assetId: meta.request.params.assetId,
                    kind,
                    offset: 0,
                    limit: 100,
                  })),
                };
              } catch {
                /* Optional analysis remains absent. */
              }
            }
        }
        for (const asset of [
          result.asset,
          result.video?.asset,
          result.proxy?.asset,
          result.thumbnail?.asset,
        ])
          if (asset?.id) resources.set(asset.id, copy(asset));
      }
      const { type, ...base } = value;
      return {
        ...base,
        entry: { name: meta.entry ?? "media-runtime", sha256: "a".repeat(64) },
        input: { request: copy(meta.request) },
        recovery: meta.recovery,
        sequence: value.updatedAt ?? Date.now(),
        ...(value.result === undefined ? {} : { result: { result: value.result, artifacts: [] } }),
      };
    }
    async function nativeGet(id) {
      const meta = persisted[id];
      if (!meta) throw Error("Task not found");
      const job = localJobs.get(id) ?? (await fixture("media.jobs.get", { id }));
      if (!job) throw Error("Task not found");
      return enrich(job, meta);
    }
    async function changed(job) {
      if (!persisted[job.id]) {
        emit("media.job.changed", job);
        return;
      }
      const result = await enrich(job, persisted[job.id]);
      const { input, result: output, ...summary } = result;
      emit("tasks.changed", summary);
    }
    raw.on("media.job.changed", (job) => {
      void changed(job);
    });
    // The renderer itself is not mocked inside the app. These explicit native task
    // receipts test the full browser staging/export hand-off, not MP4 encoding quality.
    window.__completeEditorRender = async (id, video) => {
      const job = localJobs.get(id),
        meta = persisted[id];
      if (
        !job ||
        meta?.entry !== "editor-runtime" ||
        meta.action !== "render" ||
        job.status !== "queued"
      )
        throw Error("Expected one queued canonical render task");
      if (
        !/^asset-[a-f0-9]{64}$/.test(video?.id) ||
        video.sha256 !== video.id.slice(6) ||
        !Number.isSafeInteger(video.bytes) ||
        video.bytes < 1
      )
        throw Error("Expected a complete renderer video artifact receipt");
      const request = meta.request,
        document = editorTransfers[request.transferId].document;
      const sequence = document.sequences.find((item) => item.id === request.sequenceId);
      const duration = Math.max(0, ...sequence.clips.map((clip) => clip.start + clip.duration));
      job.status = "succeeded";
      job.updatedAt = Date.now();
      job.completedAt = job.updatedAt;
      job.result = {
        video: copy(video),
        verified: true,
        durationSeconds: duration / 240000,
        frameCount: Math.ceil(
          (duration * request.profile.frameRate.numerator) /
            (240000 * request.profile.frameRate.denominator),
        ),
      };
      resources.set(video.id, copy(video));
      persist();
      await changed(job);
    };
    async function editorStart(args) {
      const request = copy(args.input?.request),
        action = request?.action;
      if (
        !request ||
        !/^editor-[a-f0-9-]{36}$/.test(request.transferId) ||
        args.recovery !== "retry"
      )
        throw Error("Invalid canonical editor task request");
      if (
        !["stage-status", "stage-resources", "stage-document", "commit", "render"].includes(action)
      )
        throw Error("Unsupported explicit editor fixture action " + action);
      const transfer = (editorTransfers[request.transferId] ??= { resources: [], chunks: {} });
      const incoming = args.input.resources ?? [];
      if (action === "stage-resources") {
        if (
          !request.resourceIds?.length ||
          incoming.length !== request.resourceIds.length ||
          incoming.some(
            (item, index) =>
              item.assetId !== request.resourceIds[index] ||
              !/^asset-[a-f0-9]{64}$/.test(item.assetId) ||
              item.path !== `inputs/resource-${index}.bin`,
          )
        )
          throw Error("Invalid canonical resource hand-off");
        for (const id of request.resourceIds) {
          const resource = resources.get(id) ?? (await fixture("media.assets.get", { id })).asset;
          if (resource?.id !== id) throw Error("Canonical fixture resource was not authorized");
          resources.set(id, copy(resource));
          if (!transfer.resources.includes(id)) transfer.resources.push(id);
        }
      } else if (incoming.length) throw Error("Unexpected canonical resource authority");
      if (action !== "stage-resources" && !/^[a-f0-9]{64}$/.test(request.documentHash ?? ""))
        throw Error("Missing canonical document hash");
      let result;
      if (action === "stage-status")
        result = {
          resourceIds: request.resourceIds.filter((id) => transfer.resources.includes(id)),
          chunks: Object.keys(transfer.chunks[request.documentHash] ?? {}).map(Number),
          ...(transfer.documentHash
            ? { committedDocumentHash: transfer.documentHash, sequenceId: transfer.sequenceId }
            : {}),
        };
      else if (action === "stage-resources")
        result = {
          resources: request.resourceIds.map((id) => ({
            resourceId: id,
            sha256: id.slice(6),
            bytes: resources.get(id).bytes,
          })),
        };
      else if (action === "stage-document") {
        if (
          !Number.isSafeInteger(request.chunkIndex) ||
          request.chunkIndex < 0 ||
          request.chunkIndex >= request.chunkCount ||
          request.chunkCount > 64 ||
          typeof request.dataBase64 !== "string" ||
          btoa(atob(request.dataBase64)) !== request.dataBase64
        )
          throw Error("Invalid canonical document chunk");
        if (transfer.documentHash && transfer.documentHash !== request.documentHash)
          throw Error("Committed snapshot cannot be overwritten");
        const chunks = (transfer.chunks[request.documentHash] ??= {});
        chunks[request.chunkIndex] = request.dataBase64;
        result = { chunkIndex: request.chunkIndex, bytes: atob(request.dataBase64).length };
      } else if (action === "commit") {
        const chunks = transfer.chunks[request.documentHash];
        if (!chunks || Object.keys(chunks).length !== request.chunkCount)
          throw Error("Incomplete canonical snapshot");
        const binary = Array.from({ length: request.chunkCount }, (_, index) =>
          atob(chunks[index]),
        ).join("");
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        if (bytes.length !== request.byteLength || sha256 !== request.documentHash)
          throw Error("Canonical snapshot hash mismatch");
        const document = JSON.parse(new TextDecoder().decode(bytes));
        if (
          document.schemaVersion !== 2 ||
          !document.sequences.some((item) => item.id === request.sequenceId)
        )
          throw Error("Expected complete schema 2 snapshot");
        for (const asset of document.assets)
          if (asset.resourceId && !transfer.resources.includes(asset.resourceId))
            throw Error("Unstaged canonical resource");
        Object.assign(transfer, { document, documentHash: sha256, sequenceId: request.sequenceId });
        result = { documentHash: sha256, sequenceId: request.sequenceId };
      } else {
        if (
          transfer.documentHash !== request.documentHash ||
          transfer.sequenceId !== request.sequenceId ||
          !request.profile?.frameRate
        )
          throw Error("Render snapshot does not match its committed document");
        window.__editorRenderRequests.push({
          request: copy(request),
          document: copy(transfer.document),
        });
      }
      const job = {
        id: crypto.randomUUID(),
        status: action === "render" ? "queued" : "succeeded",
        attempt: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(result ? { result } : {}),
      };
      localJobs.set(job.id, job);
      persisted[job.id] = { entry: "editor-runtime", action, request, recovery: args.recovery };
      persist();
      return enrich(job, persisted[job.id]);
    }
    const localSettings = () => window.__localVoiceTaskMockOptions;
    window.__completeLocalVoice = (action, error = "") => {
      const entry = [...localJobs].find(
        ([id, j]) => persisted[id]?.voiceAction === action && !terminal(j.status),
      );
      if (!entry) throw Error("No running local voice action " + action);
      const [id, job] = entry,
        meta = persisted[id],
        params = meta.request.params,
        settings = localSettings();
      job.status = error ? "failed" : "succeeded";
      job.updatedAt = Date.now();
      if (error) job.error = { code: "TEST_FAILURE", message: error, retryable: true };
      else if (action === "setup") {
        localStorage.setItem("local-voice-process-test-installed", "yes");
        job.result = { providerId: params.providerId, available: true, state: "ready" };
      } else {
        const asset = settings.outputAsset
          ? copy(settings.outputAsset)
          : {
              id: settings.outputAssetId,
              sha256: settings.outputAssetId.slice(6),
              name: "本人声音真实试听.wav",
              mimeType: "audio/wav",
              bytes: 96,
              createdAt: Date.now(),
            };
        resources.set(asset.id, asset);
        window.__nativeCaptures.push(copy(asset));
        job.result = {
          asset,
          inspection: settings.outputInspection
            ? copy(settings.outputInspection)
            : {
                kind: "audio",
                durationSeconds: settings.durationSeconds,
                audio: { sampleRate: 48000, channels: 1 },
              },
          speech: {
            ...params,
            engine: params.modelId,
            rate: params.rate ?? 1,
            voiceId: "reference",
          },
        };
      }
      persist();
      void changed(job);
    };
    return {
      ...raw,
      __genericTaskFixture: true,
      async getContext() {
        return {
          ...(await raw.getContext()),
          apiVersion: 14,
          availableMethods: [
            "tasks.start",
            "tasks.get",
            "tasks.list",
            "tasks.cancel",
            "tasks.retry",
            "resources.get",
            "resources.list",
            "resources.read",
            "resources.upload.begin",
            "resources.upload.write",
            "resources.upload.finish",
            "resources.upload.cancel",
            "media.document.get",
            "media.document.set",
          ],
          capabilities: {
            tasks: { maxInputBytes: 2 * 1024 * 1024 + 8192 },
            bridge: {
              maxParamsBytes: 2 * 1024 * 1024,
              maxCallsPerWindow: 10000,
              maxTransferCallsPerWindow: 10000,
              rateWindowMs: 1000,
            },
          },
        };
      },
      on(event, listener) {
        if (["tasks.changed", "media.job.changed"].includes(event)) {
          const set = listeners.get(event) || new Set();
          set.add(listener);
          listeners.set(event, set);
          return () => set.delete(listener);
        }
        return raw.on(event, listener);
      },
      async call(method, args = {}) {
        window.__genericHostCalls.push({ method, args: copy(args) });
        if (method === "resources.upload.begin") {
          if (
            typeof args.name !== "string" ||
            !args.name ||
            args.name.length > 240 ||
            !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(args.mimeType) ||
            !Number.isSafeInteger(args.expectedBytes) ||
            args.expectedBytes < 1 ||
            args.expectedBytes > 20 * 1024 ** 3
          )
            throw Error("Invalid resource upload metadata");
          const sessionId = `upload-${crypto.randomUUID()}`;
          const session = {
            sessionId,
            name: args.name,
            mimeType: args.mimeType,
            expectedBytes: args.expectedBytes,
            state: "uploading",
            receivedBytes: 0,
            nextSequence: 0,
            maxChunkBytes: 32768,
            maxFileBytes: 20 * 1024 ** 3,
            expiresAt: Date.now() + 86400000,
            chunks: [],
          };
          uploads.set(sessionId, session);
          persist();
          const { chunks, ...result } = session;
          return copy(result);
        }
        if (method.startsWith("resources.upload.")) {
          const session = uploads.get(args.sessionId);
          if (!session) throw Error("Unknown resource upload session");
          if (method === "resources.upload.cancel") {
            if (session.state === "finished")
              throw Error("Resource upload is already a managed asset");
            session.state = "cancelled";
            session.chunks = [];
            persist();
            return { cancelled: true };
          }
          if (method === "resources.upload.finish" && session.state === "finished")
            return { asset: copy(session.asset) };
          if (session.state !== "uploading") throw Error("Upload no longer accepts input");
          if (method === "resources.upload.write") {
            if (
              typeof args.dataBase64 !== "string" ||
              args.dataBase64.length > Math.ceil(32768 / 3) * 4 ||
              !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
                args.dataBase64,
              )
            )
              throw Error("Invalid bounded resource base64");
            const bytes = atob(args.dataBase64);
            if (
              !bytes.length ||
              bytes.length > session.maxChunkBytes ||
              btoa(bytes) !== args.dataBase64
            )
              throw Error("Invalid resource chunk bytes");
            const previous = session.chunks.at(-1);
            if (
              previous?.sequence === args.sequence &&
              previous.offset === args.offset &&
              previous.dataBase64 === args.dataBase64
            ) {
              const { chunks, ...result } = session;
              return copy(result);
            }
            if (
              args.sequence !== session.nextSequence ||
              args.offset !== session.receivedBytes ||
              args.offset + bytes.length > session.expectedBytes
            )
              throw Error("Resource chunks must arrive in order");
            session.chunks.push({
              sequence: args.sequence,
              offset: args.offset,
              dataBase64: args.dataBase64,
            });
            session.receivedBytes += bytes.length;
            session.nextSequence++;
            persist();
            const { chunks, ...result } = session;
            return copy(result);
          }
          if (method === "resources.upload.finish") {
            if (!session.receivedBytes || session.receivedBytes !== session.expectedBytes)
              throw Error("Resource upload is incomplete");
            const bytes = new Uint8Array(session.receivedBytes);
            for (const chunk of session.chunks) {
              const decoded = atob(chunk.dataBase64);
              for (let i = 0; i < decoded.length; i++)
                bytes[chunk.offset + i] = decoded.charCodeAt(i);
            }
            const sha256 = Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
              (value) => value.toString(16).padStart(2, "0"),
            ).join("");
            const asset = {
              id: `asset-${sha256}`,
              name: session.name,
              mimeType: session.mimeType,
              bytes: bytes.length,
              sha256,
              createdAt: Date.now(),
            };
            resources.set(asset.id, copy(asset));
            uploadedFiles.set(asset.id, { asset: copy(asset), chunks: copy(session.chunks) });
            session.state = "finished";
            session.asset = asset;
            session.chunks = [];
            persist();
            return { asset: copy(asset) };
          }
          throw Error("Unsupported resource upload method");
        }
        if (method === "resources.read" && uploadedFiles.has(args.assetId)) {
          const saved = uploadedFiles.get(args.assetId);
          if (
            !Number.isSafeInteger(args.offset) ||
            args.offset < 0 ||
            args.offset > saved.asset.bytes ||
            !Number.isSafeInteger(args.length) ||
            args.length < 1 ||
            args.length > 32768
          )
            throw Error("Invalid resource read range");
          const end = Math.min(saved.asset.bytes, args.offset + args.length);
          let binary = "";
          for (const chunk of saved.chunks) {
            const decoded = atob(chunk.dataBase64);
            const start = Math.max(args.offset, chunk.offset),
              stop = Math.min(end, chunk.offset + decoded.length);
            if (stop > start) binary += decoded.slice(start - chunk.offset, stop - chunk.offset);
          }
          return {
            assetId: args.assetId,
            offset: args.offset,
            totalBytes: saved.asset.bytes,
            mimeType: saved.asset.mimeType,
            dataBase64: btoa(binary),
            eof: end === saved.asset.bytes,
          };
        }
        if (method === "media.assets.get" && uploadedFiles.has(args.id))
          return { asset: copy(uploadedFiles.get(args.id).asset) };
        if (method === "tasks.start") {
          if (args.entry === "editor-runtime") return editorStart(args);
          if (args.entry !== "media-runtime" || !args.input?.request)
            throw Error("Invalid reviewed task entry");
          const request = copy(args.input.request),
            action = request.action,
            params = request.params ?? {};
          for (const resource of args.input.resources ?? [])
            if (
              !/^asset-[a-f0-9]{64}$/.test(resource.assetId) ||
              !/^inputs\/source-\d+\.bin$/.test(resource.path)
            )
              throw Error("Invalid task resource hand-off");
          let job;
          const local = localSettings(),
            voiceAction =
              local &&
              (action === "tts-clone" ||
                (action === "tts-setup" && ["audio8-tts", "qwen3-tts"].includes(params.providerId)))
                ? action === "tts-setup"
                  ? "setup"
                  : "generate"
                : null;
          if (voiceAction) {
            job = {
              id: crypto.randomUUID(),
              status: "queued",
              attempt: 1,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            localJobs.set(job.id, job);
            window.__voiceRuntimeRequests.push({
              action: voiceAction,
              engine: params.modelId ?? params.providerId,
              ...copy(params),
            });
          } else if (action === "inspect") {
            const preparation = await existingPreparation(params.assetId);
            if (!preparation?.inspection) throw Error("Fixture requires actual source inspection");
            job = {
              id: crypto.randomUUID(),
              status: "succeeded",
              attempt: 1,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              result: { assetId: params.assetId, inspection: preparation.inspection },
            };
            localJobs.set(job.id, job);
          } else {
            const method = methodFor(action);
            if (!method) throw Error("Unsupported fixture Panel tool action " + action);
            const result = await fixture(
              method,
              action === "prepare"
                ? { assetIds: [params.assetId], transcribe: params.transcribe }
                : params,
            );
            job = action === "prepare" ? result.jobs[0] : result;
            if (!job?.id || !job.status) {
              if (action === "voices" && local) {
                const installed =
                  localStorage.getItem("local-voice-process-test-installed") === "yes" ||
                  local.installed;
                for (const model of result.models ?? [])
                  if (["audio8-tts", "qwen3-tts"].includes(model.id)) {
                    model.available = installed;
                    model.state = installed ? "ready" : "not-installed";
                    model.reason = installed ? undefined : "本地声音引擎尚未安装";
                  }
                result.available = result.models?.some((m) => m.available) ?? result.available;
              }
              job = {
                id: crypto.randomUUID(),
                status: "succeeded",
                attempt: 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                result,
              };
              localJobs.set(job.id, job);
            }
          }
          persisted[job.id] = {
            action,
            request,
            recovery: args.recovery,
            ...(voiceAction ? { voiceAction } : {}),
          };
          persist();
          return enrich(job, persisted[job.id]);
        }
        if (method === "tasks.get") return nativeGet(args.id);
        if (method === "tasks.list") {
          const values = [];
          for (const id of Object.keys(persisted)) {
            try {
              const { input, result, ...job } = await nativeGet(id);
              values.push(job);
            } catch {}
          }
          return values
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 50));
        }
        if (method === "tasks.cancel") {
          if (!persisted[args.id]) throw Error("Task not found");
          const local = localJobs.get(args.id);
          if (local) {
            local.status = "cancelled";
            local.updatedAt = Date.now();
            void changed(local);
            return nativeGet(args.id);
          }
          const result = await fixture("media.jobs.cancel", args);
          return enrich(result, persisted[args.id]);
        }
        if (method === "tasks.retry") {
          const meta = persisted[args.id];
          if (!meta || meta.recovery !== "retry") throw Error("Manual task requires a new request");
          throw Error("Fixture requires explicit retry completion setup");
        }
        if (method === "resources.get") {
          if (resources.has(args.id)) return { asset: copy(resources.get(args.id)) };
          const found = await fixture("media.assets.get", args);
          resources.set(found.asset.id, copy(found.asset));
          return { asset: found.asset };
        }
        if (method === "resources.list") {
          return {
            assets: [...resources.values()].slice(
              args.offset ?? 0,
              (args.offset ?? 0) + (args.limit ?? 50),
            ),
            total: resources.size,
          };
        }
        if (method === "media.jobs.list") {
          const result = await fixture(method, args);
          return { ...result, jobs: (result.jobs ?? []).filter((j) => !persisted[j.id]) };
        }
        if (method === "media.document.get" && args.key.startsWith("video-studio-prepared-")) {
          const saved = await fixture(method, args);
          if (saved.data) return saved;
          try {
            const data = await existingPreparation(args.key.slice("video-studio-prepared-".length));
            if (data) return { revision: 0, data };
          } catch {}
          return saved;
        }
        if (
          (method === "media.document.get" || method === "media.document.set") &&
          args.key === "video-studio-native-media-v1"
        ) {
          try {
            return await fixture(method, args);
          } catch (error) {
            if (!/Unexpected.*(?:call|method)/i.test(error.message)) throw error;
            if (method.endsWith(".get"))
              return copy(documents.get(args.key) ?? { revision: 0, data: null });
            const saved = { revision: args.baseRevision + 1, data: copy(args.data) };
            documents.set(args.key, saved);
            return saved;
          }
        }
        if (/^media\.(?:status|prepare|tts|render|scene|audio\.)/.test(method))
          throw Error("Production business call reached raw Host: " + method);
        if (method === "media.document.set") {
          const receipt = await fixture(method, args);
          return {
            ...receipt,
            updatedAt: receipt.updatedAt ?? Date.now(),
            label: receipt.label ?? args.label ?? "保存",
          };
        }
        return fixture(method, args);
      },
    };
  }
  let bridge = wrap(window.codeshellPanel);
  Object.defineProperty(window, "codeshellPanel", {
    configurable: true,
    get: () => bridge,
    set: (value) => {
      bridge = wrap(value);
    },
  });
}
