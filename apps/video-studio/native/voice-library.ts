import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { acquireVoiceQueue } from "./queue.js";
import type { LibraryVoiceRecipe } from "../src/voice-library.js";

const MAX_AUDIO = 16 * 1024 * 1024;
const MAX_VOICES = 20;
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ASSET = /^(?:asset|external)-[a-f0-9]{64}$/;
type Audio = { sha256: string; bytes: number; mimeType: string };
type Entry = { schemaVersion: 1; recipe: LibraryVoiceRecipe; reference: Audio; sample: Audio };

function check(ok: unknown, message = "声音库数据无效，原有声音已保留"): asserts ok {
  if (!ok) throw new Error(message);
}
function text(value: unknown, limit: number) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value).length <= limit &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  );
}
function audio(value: any): Audio {
  check(
    value &&
      HEX.test(value.sha256) &&
      Number.isSafeInteger(value.bytes) &&
      value.bytes > 0 &&
      value.bytes <= MAX_AUDIO,
  );
  check(typeof value.mimeType === "string" && /^audio\/[a-z0-9.+-]{1,80}$/.test(value.mimeType));
  return { sha256: value.sha256, bytes: value.bytes, mimeType: value.mimeType };
}
export function validateLibraryEntry(value: any): Entry {
  const r = value?.recipe;
  check(value?.schemaVersion === 1 && r && text(r.id, 80));
  check(text(r.name, 80) && ["audio8-tts", "qwen3-tts"].includes(r.modelId));
  check(ASSET.test(r.referenceMediaId) && ASSET.test(r.sampleMediaId));
  check(text(r.referenceText, 1000) && text(r.sampleText, 120) && text(r.referenceName, 256));
  check(
    Number.isFinite(r.referenceDurationSeconds) &&
      r.referenceDurationSeconds >= 3 &&
      r.referenceDurationSeconds <= 30,
  );
  const recipe: LibraryVoiceRecipe = {
    id: r.id,
    name: r.name,
    modelId: r.modelId,
    referenceMediaId: r.referenceMediaId,
    referenceText: r.referenceText,
    sampleMediaId: r.sampleMediaId,
    sampleText: r.sampleText,
    referenceName: r.referenceName,
    referenceDurationSeconds: r.referenceDurationSeconds,
  };
  return {
    schemaVersion: 1,
    recipe,
    reference: audio(value.reference),
    sample: audio(value.sample),
  };
}
async function directory(root: string, parts: string[], create = true): Promise<string> {
  let path = root;
  for (const part of parts) {
    check(/^[a-zA-Z0-9._-]+$/.test(part) && part !== "." && part !== "..");
    path = join(path, part);
    if (create)
      await mkdir(path, { mode: 0o700 }).catch((e) => {
        if (e.code !== "EEXIST") throw e;
      });
    const info = await lstat(path);
    check(info.isDirectory() && !info.isSymbolicLink(), "声音库目录无效，请检查后重试");
  }
  return path;
}
async function bytes(path: string, maximum: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    check(info.isFile() && info.size <= maximum);
    const result = await file.readFile();
    check(result.length === info.size && result.length <= maximum);
    return result;
  } finally {
    await file.close();
  }
}
async function json(path: string): Promise<any> {
  return JSON.parse((await bytes(path, 32 * 1024)).toString("utf8"));
}
async function writeJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.partial`;
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(value));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const parent = await open(dirname(path), "r").catch(() => undefined);
    try {
      await parent?.sync().catch(() => {});
    } finally {
      await parent?.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
function digest(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
function entryName(id: string) {
  return `${createHash("sha256").update(id).digest("hex")}.json`;
}
function audioSignature(b: Buffer) {
  return (
    (b.length >= 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WAVE") ||
    b.toString("ascii", 0, 3) === "ID3" ||
    (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) ||
    b.toString("ascii", 0, 4) === "OggS" ||
    b.toString("ascii", 0, 4) === "fLaC" ||
    (b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp") ||
    (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3)
  );
}
async function verified(path: string, meta: Audio) {
  const data = await bytes(path, MAX_AUDIO);
  check(
    data.length === meta.bytes && digest(data) === meta.sha256 && audioSignature(data),
    "声音文件不完整或校验失败，原有声音已保留",
  );
  return data;
}

/** Only explicit library requests reach this app-owned directory; no workspace paths accepted. */
export async function runVoiceLibrary(
  raw: any,
  signal: AbortSignal,
  appData = process.cwd(),
): Promise<unknown> {
  check(
    raw?.action === "library" &&
      ["list", "begin", "write", "commit", "cancel", "get", "read"].includes(raw.operation),
  );
  signal.throwIfAborted();
  const root = await realpath(appData);
  const voices = await directory(root, ["voices"]);
  const entries = await directory(voices, ["entries"]);
  const blobs = await directory(voices, ["blobs"]);
  const staging = await directory(voices, ["staging"]);
  if (raw.operation === "list") {
    const names = (await readdir(entries))
      .filter((name) => HEX.test(name.replace(/\.json$/, "")) && name.endsWith(".json"))
      .sort();
    check(names.length <= MAX_VOICES, "声音库已达到容量限制");
    const result: LibraryVoiceRecipe[] = [];
    for (const name of names) {
      signal.throwIfAborted();
      const entry = validateLibraryEntry(await json(join(entries, name)));
      check(name === entryName(entry.recipe.id));
      result.push(entry.recipe);
    }
    return result;
  }
  if (raw.operation === "get" || raw.operation === "read") {
    check(text(raw.id, 80));
    const entry = validateLibraryEntry(await json(join(entries, entryName(raw.id))));
    check(entry.recipe.id === raw.id);
    if (raw.operation === "get") return entry;
    check(raw.part === "reference" || raw.part === "sample");
    check(Number.isSafeInteger(raw.offset) && raw.offset >= 0);
    const meta = entry[raw.part as "reference" | "sample"];
    check(raw.offset < meta.bytes);
    // The importing client hashes the complete stream before publishing it to the Host.
    // Read only this range, rather than repeatedly hashing a whole recording for every chunk.
    const file = await open(join(blobs, meta.sha256), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      check(info.isFile() && info.size === meta.bytes);
      const chunk = Buffer.alloc(Math.min(512 * 1024, meta.bytes - raw.offset));
      let offset = 0;
      while (offset < chunk.length) {
        const result = await file.read(chunk, offset, chunk.length - offset, raw.offset + offset);
        check(result.bytesRead > 0, "声音库文件不完整，请重新保存声音");
        offset += result.bytesRead;
      }
      return {
        ...meta,
        offset: raw.offset,
        dataBase64: chunk.toString("base64"),
        eof: raw.offset + chunk.length === meta.bytes,
      };
    } finally {
      await file.close();
    }
  }
  check(UUID.test(raw.token));
  if (raw.operation === "begin") {
    const entry = validateLibraryEntry(raw.entry);
    const stage = join(staging, raw.token);
    await mkdir(stage, { mode: 0o700 }); // exclusive session identity
    await writeJson(join(stage, "entry.json"), entry);
    return { token: raw.token };
  }
  if (raw.operation === "cancel") {
    await rm(join(staging, raw.token), { recursive: true, force: true });
    return { cancelled: true };
  }
  const stage = await directory(staging, [raw.token], false);
  const entry = validateLibraryEntry(await json(join(stage, "entry.json")));
  if (raw.operation === "write") {
    check(raw.part === "reference" || raw.part === "sample");
    check(Number.isSafeInteger(raw.offset) && raw.offset >= 0);
    check(
      typeof raw.dataBase64 === "string" &&
        raw.dataBase64.length <= 43692 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(raw.dataBase64),
    );
    const data = Buffer.from(raw.dataBase64, "base64");
    check(data.length > 0 && data.length <= 32768 && data.toString("base64") === raw.dataBase64);
    const meta = entry[raw.part as "reference" | "sample"];
    check(raw.offset + data.length <= meta.bytes);
    const file = await open(
      join(stage, `${raw.part}.bin`),
      constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const info = await file.stat();
      check(info.isFile() && info.size === raw.offset);
      let offset = 0;
      while (offset < data.length) {
        const result = await file.write(data, offset, data.length - offset, raw.offset + offset);
        check(result.bytesWritten > 0);
        offset += result.bytesWritten;
      }
      return { offset: raw.offset + data.length };
    } finally {
      await file.close();
    }
  }
  const queue = await directory(voices, ["queue"]);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  const release = await acquireVoiceQueue(queue, bounded, async () => {});
  try {
    let previous: Entry | undefined;
    try {
      previous = validateLibraryEntry(await json(join(entries, entryName(entry.recipe.id))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      check(
        JSON.stringify(previous) === JSON.stringify(entry),
        "同名声音记录已由另一个面板更新，请重新打开声音库",
      );
      await verified(join(blobs, previous.reference.sha256), previous.reference);
      await verified(join(blobs, previous.sample.sha256), previous.sample);
      return previous.recipe;
    }
    check(
      (await readdir(entries)).filter((name) => name.endsWith(".json")).length < MAX_VOICES,
      "声音库最多保存 20 个声音",
    );
    for (const part of ["reference", "sample"] as const) {
      const meta = entry[part];
      const source = join(stage, `${part}.bin`);
      await verified(source, meta);
      bounded.throwIfAborted();
      const destination = join(blobs, meta.sha256);
      try {
        await verified(destination, meta);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await rename(source, destination);
      }
    }
    bounded.throwIfAborted();
    // Publishing metadata is the single visibility point. Existing recipes are never overwritten.
    await writeJson(join(entries, entryName(entry.recipe.id)), entry);
    return entry.recipe;
  } finally {
    await release();
    await rm(stage, { recursive: true, force: true });
  }
}
