import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yauzl from "yauzl";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = ".codeshell-panel/panel.json";
export const LIMITS = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxEntries: 4096,
  maxFileBytes: 64 * 1024 * 1024,
  maxCompressedFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxCompressedTotalBytes: 64 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024,
  maxMetadataBytes: 2 * 1024 * 1024,
  maxRatio: 200,
});
const messages = {
  ARGUMENT:
    "Expected --tag <panel-id-vX.Y.Z> --zip <local-file> --dir <repo-relative-installable-package>.",
  INPUT: "ZIP must be a readable regular file opened without following a symlink.",
  GIT: "Exact local tag or required Git object unavailable; no network attempted.",
  GIT_TREE: "Tag package inventory contains an unsupported entry or invalid path.",
  PACKAGE_DIR:
    "Use the tag's installable package directory; source-built apps require panels/<name>.",
  MANIFEST: "A bounded UTF-8 JSON panel manifest with id and version is required.",
  ZIP_INVALID:
    "Unsupported, ambiguous or corrupt ZIP (ZIP64/encryption/data descriptors/special files are rejected).",
  LIMIT_EXCEEDED: "Verification budget exceeded; no complete comparison was made.",
  SOURCE_CHANGED: "ZIP identity or contents changed during verification.",
};
function fail(code) {
  const error = new Error(messages[code]);
  error.code = code;
  throw error;
}
function limitsFor(overrides) {
  const result = { ...LIMITS, ...overrides };
  for (const key of Object.keys(result))
    if (
      !(key in LIMITS) ||
      !Number.isSafeInteger(result[key]) ||
      result[key] < 1 ||
      result[key] > LIMITS[key]
    )
      fail("ARGUMENT");
  return result;
}
function pathValid(path, directory = false) {
  const name = directory ? path.slice(0, -1) : path;
  return (
    typeof path === "string" &&
    Buffer.byteLength(path) <= 512 &&
    (!directory || path.endsWith("/")) &&
    name.length > 0 &&
    name === name.normalize("NFC") &&
    !/[\\\x00-\x1f\x7f:]/.test(name) &&
    !name.startsWith("/") &&
    name
      .split("/")
      .every(
        (part) =>
          part &&
          part !== "." &&
          part !== ".." &&
          !/[. ]$/.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}
function registerPath(nodes, explicit, path, directory, code) {
  if (!pathValid(path, directory) || explicit.has(path)) fail(code);
  explicit.add(path);
  const parts = (directory ? path.slice(0, -1) : path).split("/");
  for (let i = 1; i <= parts.length; i++) {
    const name = parts.slice(0, i).join("/"),
      key = name.toUpperCase().toLowerCase();
    const type = i < parts.length || directory ? "directory" : "file";
    const previous = nodes.get(key);
    if (previous && (previous.name !== name || previous.type !== type)) fail(code);
    nodes.set(key, { name, type });
  }
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function gitReader(root) {
  // No inherited Git config, credentials, alternate object paths, shell or hooks.
  // Every object read below is a hex OID obtained from this exact local repo/tag.
  return (args, maxBuffer = LIMITS.maxMetadataBytes) => {
    try {
      return execFileSync("git", ["--no-optional-locks", ...args], {
        cwd: root,
        shell: false,
        timeout: 15000,
        maxBuffer,
        env: {
          PATH: process.env.PATH,
          LANG: "C",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_NO_REPLACE_OBJECTS: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_NO_LAZY_FETCH: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      fail(error.code === "ENOBUFS" ? "LIMIT_EXCEEDED" : "GIT");
    }
  };
}
function readTree(git, commit, dir, limits) {
  const raw = git(["ls-tree", "-r", "-z", "-l", commit, "--", dir]);
  if (raw.length > limits.maxMetadataBytes) fail("LIMIT_EXCEEDED");
  let records;
  try {
    records = new TextDecoder("utf-8", { fatal: true }).decode(raw).split("\0").filter(Boolean);
  } catch {
    fail("GIT_TREE");
  }
  if (records.length > limits.maxEntries) fail("LIMIT_EXCEEDED");
  const nodes = new Map(),
    explicit = new Set();
  return records.map((record) => {
    const match = /^(\d{6}) (\w+) ([0-9a-f]{40,64}) +([0-9]+|-)\t([\s\S]+)$/.exec(record);
    if (
      !match ||
      !match[5].startsWith(`${dir}/`) ||
      (match[1] !== "100644" && match[1] !== "100755") ||
      match[2] !== "blob"
    )
      fail("GIT_TREE");
    const path = match[5].slice(dir.length + 1),
      bytes = Number(match[4]);
    registerPath(nodes, explicit, path, false, "GIT_TREE");
    if (!Number.isSafeInteger(bytes) || bytes > limits.maxFileBytes) fail("LIMIT_EXCEEDED");
    return { path, oid: match[3], bytes };
  });
}
function parseManifest(bytes, limits) {
  if (!bytes || bytes.length > limits.maxManifestBytes) fail(bytes ? "LIMIT_EXCEEDED" : "MANIFEST");
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.id !== "string" ||
      value.id.length > 64 ||
      typeof value.version !== "string" ||
      value.version.length > 128
    )
      fail("MANIFEST");
    if (
      typeof value.entry !== "string" ||
      !pathValid(value.entry) ||
      !value.entry.startsWith("app/")
    )
      fail("MANIFEST");
    return { id: value.id, version: value.version, entry: value.entry };
  } catch {
    fail("MANIFEST");
  }
}
const shipped = (name) => name === "README.md" || /^(?:\.codeshell-panel|app|agent)\//.test(name);
function tagInventory(repoRoot, tag, dir, limits) {
  const git = gitReader(repoRoot);
  const tagObject = git(["show-ref", "--verify", "--hash", `refs/tags/${tag}`])
    .toString()
    .trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(tagObject)) fail("GIT");
  const commit = git(["rev-parse", "--verify", "--end-of-options", `${tagObject}^{commit}`])
    .toString()
    .trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) fail("GIT");
  const source = `apps/${basename(dir)}`;
  const sourceTree = readTree(git, commit, source, limits);
  const built = sourceTree.some((item) => item.path === "panel.build.json");
  if (dir.startsWith("apps/") && built) fail("PACKAGE_DIR");
  if (dir.startsWith("panels/") && !built) fail("PACKAGE_DIR");
  const all = readTree(git, commit, dir, limits);
  const present = all.length > 0;
  if (!present && !(built && dir.startsWith("panels/"))) fail("PACKAGE_DIR");
  const manifestEntry =
    all.find((item) => item.path === manifestPath) ??
    (built ? sourceTree.find((item) => item.path === manifestPath) : undefined);
  if (!manifestEntry) fail("MANIFEST");
  if (manifestEntry.bytes > limits.maxManifestBytes) fail("LIMIT_EXCEEDED");
  const manifest = parseManifest(
    git(["cat-file", "blob", manifestEntry.oid], limits.maxManifestBytes),
    limits,
  );
  const files = new Map();
  let total = 0;
  for (const item of all.filter((item) => shipped(item.path))) {
    total += item.bytes;
    if (total > limits.maxTotalBytes) fail("LIMIT_EXCEEDED");
    // Bounded to one <=64MiB blob; never load all package contents in memory.
    const bytes = git(["cat-file", "blob", item.oid], limits.maxFileBytes);
    if (bytes.length !== item.bytes) fail("GIT_TREE");
    files.set(item.path, { bytes: bytes.length, sha256: sha256(bytes) });
  }
  const generatedIssues = [];
  if (built) {
    for (const path of [manifestPath, manifest.entry, "app/build-manifest.json"])
      if (!files.has(path)) generatedIssues.push({ path, reason: "missing generated tag file" });
    const inventory = all.find((item) => item.path === "app/build-manifest.json");
    if (inventory) {
      if (inventory.bytes > limits.maxManifestBytes) fail("LIMIT_EXCEEDED");
      let value;
      try {
        value = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            git(["cat-file", "blob", inventory.oid], limits.maxManifestBytes),
          ),
        );
      } catch {
        fail("GIT_TREE");
      }
      if (
        value?.schemaVersion !== 1 ||
        !value.files ||
        typeof value.files !== "object" ||
        Array.isArray(value.files)
      )
        fail("GIT_TREE");
      const names = Object.keys(value.files);
      if (names.length > limits.maxEntries) fail("LIMIT_EXCEEDED");
      for (const path of names) {
        if (!pathValid(path) || !shipped(path) || !/^[a-f0-9]{64}$/.test(value.files[path]))
          fail("GIT_TREE");
        if (files.get(path)?.sha256 !== value.files[path])
          generatedIssues.push({
            path,
            reason: "generated inventory hash absent or different in tag",
          });
      }
      for (const path of files.keys())
        if (path !== "app/build-manifest.json" && !Object.hasOwn(value.files, path))
          generatedIssues.push({ path, reason: "generated tag file absent from build inventory" });
    }
  }
  const complete = present && generatedIssues.length === 0;
  return {
    tagObject,
    commit,
    manifest,
    files,
    scope: {
      complete,
      rule: "installable-v1: .codeshell-panel/** + agent/** + app/** + README.md",
      reason: complete
        ? "Committed installable files only; no rebuild or source-to-bundle equivalence claimed."
        : "Tag lacks complete generated installable output. Compare only listed committed files and manifest identity; absent generated tag bytes remain unverified.",
      generatedIssues,
      excludedTagPaths: all.filter((item) => !shipped(item.path)).map((item) => item.path),
    },
  };
}

// CRC is the incremental algorithm already used by native/editor-runtime/bundle.ts.
// yauzl validates lengths, but does not validate file CRC for callers.
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let n = index;
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crcUpdate(crc, bytes) {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc;
}
function hashFd(fd, size, maximum) {
  const hash = createHash("sha256"),
    buffer = Buffer.alloc(128 * 1024);
  let offset = 0;
  while (offset < size) {
    const count = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
    if (!count) fail("SOURCE_CHANGED");
    offset += count;
    if (offset > maximum) fail("LIMIT_EXCEEDED");
    hash.update(buffer.subarray(0, count));
  }
  return hash.digest("hex");
}
function rejectZip64Envelope(fd, size) {
  // Only a bounded envelope rejection check, not a ZIP parser. yauzl owns parsing.
  const tail = Buffer.alloc(Math.min(size, 65577));
  if (readSync(fd, tail, 0, tail.length, size - tail.length) !== tail.length) fail("ZIP_INVALID");
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== 0x06054b50 || i + 22 + tail.readUInt16LE(i + 20) !== tail.length)
      continue;
    if (
      tail.readUInt16LE(i + 4) ||
      tail.readUInt16LE(i + 6) ||
      tail.readUInt16LE(i + 8) !== tail.readUInt16LE(i + 10) ||
      tail.readUInt16LE(i + 10) === 0xffff ||
      tail.readUInt32LE(i + 12) === 0xffffffff ||
      tail.readUInt32LE(i + 16) === 0xffffffff ||
      (i >= 20 && tail.readUInt32LE(i - 20) === 0x07064b50)
    )
      fail("ZIP_INVALID");
    return;
  }
  fail("ZIP_INVALID");
}
async function zipInventory(path, allowedRoots, limits) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    fail("INPUT");
  }
  let zip;
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile()) fail("INPUT");
    if (before.size > BigInt(limits.maxArchiveBytes)) fail("LIMIT_EXCEEDED");
    const size = Number(before.size),
      assetSha256 = hashFd(fd, size, limits.maxArchiveBytes);
    rejectZip64Envelope(fd, size);
    zip = await yauzl.fromFdPromise(fd, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    let readerError;
    zip.on("error", (error) => {
      readerError = error;
    });
    const centralStart = zip.readEntryCursor;
    if (zip.entryCount > limits.maxEntries) fail("LIMIT_EXCEEDED");
    const entries = [],
      nodes = new Map(),
      explicit = new Set(),
      ranges = [];
    let expanded = 0,
      compressed = 0,
      metadata = Buffer.byteLength(zip.comment);
    for await (const entry of zip.eachEntry()) {
      if (entries.length >= limits.maxEntries) fail("LIMIT_EXCEEDED");
      const directory = entry.fileName.endsWith("/"),
        type = (entry.externalFileAttributes >>> 16) & 0xf000;
      registerPath(nodes, explicit, entry.fileName, directory, "ZIP_INVALID");
      if (
        (type !== 0 && type !== (directory ? 0x4000 : 0x8000)) ||
        (!directory && entry.externalFileAttributes & 0x10) ||
        entry.externalFileAttributes & 8 ||
        entry.generalPurposeBitFlag & ~(0x800 | 6) ||
        ![0, 8].includes(entry.compressionMethod) ||
        entry.versionNeededToExtract >= 45 ||
        entry.extraFields.some((field) => field.id !== 0x5455) ||
        !entry.fileNameRaw.equals(Buffer.from(entry.fileName))
      )
        fail("ZIP_INVALID");
      if (
        entry.fileNameLength > 512 ||
        entry.extraFieldLength > 4096 ||
        entry.fileCommentLength > 1024
      )
        fail("LIMIT_EXCEEDED");
      metadata += 46 + entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength;
      if (metadata > limits.maxMetadataBytes) fail("LIMIT_EXCEEDED");
      if (directory && (entry.compressedSize || entry.uncompressedSize || entry.crc32))
        fail("ZIP_INVALID");
      if (
        ![entry.uncompressedSize, entry.compressedSize].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        )
      )
        fail("ZIP_INVALID");
      expanded += entry.uncompressedSize;
      compressed += entry.compressedSize;
      if (
        entry.uncompressedSize > limits.maxFileBytes ||
        entry.compressedSize > limits.maxCompressedFileBytes ||
        expanded > limits.maxTotalBytes ||
        compressed > limits.maxCompressedTotalBytes ||
        entry.uncompressedSize > Math.max(1, entry.compressedSize) * limits.maxRatio
      )
        fail("LIMIT_EXCEEDED");
      const local = await zip.readLocalFileHeaderPromise(entry, { minimal: false });
      if (
        !local.fileName.equals(entry.fileNameRaw) ||
        local.compressionMethod !== entry.compressionMethod ||
        local.generalPurposeBitFlag !== entry.generalPurposeBitFlag ||
        local.versionNeededToExtract !== entry.versionNeededToExtract ||
        yauzl.parseExtraFields(local.extraField).some((field) => field.id !== 0x5455) ||
        (!(entry.generalPurposeBitFlag & 8) &&
          (local.compressedSize !== entry.compressedSize ||
            local.uncompressedSize !== entry.uncompressedSize ||
            local.crc32 !== entry.crc32))
      )
        fail("ZIP_INVALID");
      metadata += 30 + local.fileNameLength + local.extraFieldLength;
      if (local.extraFieldLength > 4096 || metadata > limits.maxMetadataBytes)
        fail("LIMIT_EXCEEDED");
      const end = local.fileDataStart + entry.compressedSize;
      if (!Number.isSafeInteger(end) || entry.relativeOffsetOfLocalHeader < 0 || end > centralStart)
        fail("ZIP_INVALID");
      ranges.push([entry.relativeOffsetOfLocalHeader, end]);
      entries.push(entry);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    if (ranges.some((range, i) => i && range[0] < ranges[i - 1][1])) fail("ZIP_INVALID");
    const manifests = entries.filter(
      (entry) =>
        entry.fileName === manifestPath ||
        allowedRoots.some((root) => entry.fileName === `${root}/${manifestPath}`),
    );
    if (manifests.length !== 1) fail("MANIFEST");
    const prefix = manifests[0].fileName.slice(0, -manifestPath.length),
      files = new Map(),
      directories = [];
    let actualTotal = 0,
      manifest;
    for (const entry of entries) {
      if (prefix && entry.fileName === prefix) {
        directories.push(entry.fileName);
        continue;
      }
      if (!entry.fileName.startsWith(prefix)) fail("ZIP_INVALID");
      const name = entry.fileName.slice(prefix.length);
      if (entry.fileName.endsWith("/")) {
        directories.push(name);
        continue;
      }
      const maximum = name === manifestPath ? limits.maxManifestBytes : limits.maxFileBytes;
      if (entry.uncompressedSize > maximum) fail("LIMIT_EXCEEDED");
      const hash = createHash("sha256"),
        chunks = [];
      let bytes = 0,
        crc = 0xffffffff;
      const stream = await zip.openReadStreamPromise(entry);
      try {
        for await (const chunk of stream) {
          bytes += chunk.length;
          actualTotal += chunk.length;
          if (
            bytes > maximum ||
            actualTotal > limits.maxTotalBytes ||
            bytes > Math.max(1, entry.compressedSize) * limits.maxRatio
          )
            fail("LIMIT_EXCEEDED");
          if (bytes > entry.uncompressedSize) fail("ZIP_INVALID");
          hash.update(chunk);
          crc = crcUpdate(crc, chunk);
          if (name === manifestPath) chunks.push(chunk);
        }
        if (bytes !== entry.uncompressedSize || (crc ^ 0xffffffff) >>> 0 !== entry.crc32)
          fail("ZIP_INVALID");
        if (name === manifestPath) manifest = parseManifest(Buffer.concat(chunks), limits);
        files.set(name, { bytes, sha256: hash.digest("hex") });
      } finally {
        stream.destroy();
      }
    }
    if (readerError) fail("ZIP_INVALID");
    const after = fstatSync(fd, { bigint: true });
    if (
      ["dev", "ino", "size", "mtimeNs", "ctimeNs"].some((key) => before[key] !== after[key]) ||
      hashFd(fd, size, limits.maxArchiveBytes) !== assetSha256
    )
      fail("SOURCE_CHANGED");
    return {
      assetSha256,
      archiveBytes: size,
      files,
      manifest,
      root: prefix || ".",
      directories,
      actualTotal,
    };
  } catch (error) {
    if (Object.hasOwn(messages, error.code)) throw error;
    fail("ZIP_INVALID");
  } finally {
    // yauzl owns the original fd after a successful fromFd; never reopen by path.
    if (zip)
      await new Promise((done, reject) => {
        zip.once("close", done);
        zip.once("error", reject);
        zip.close();
      });
    else closeSync(fd);
  }
}

export async function verifyReleaseZip({
  tag,
  zip,
  dir,
  repoRoot = repositoryRoot,
  limits: overrides = {},
}) {
  const match =
    typeof tag === "string" &&
    /^([a-z][a-z0-9-]{0,63})-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(tag);
  if (
    !match ||
    tag.includes("..") ||
    typeof zip !== "string" ||
    !zip ||
    zip.includes("\0") ||
    typeof dir !== "string" ||
    !/^(?:apps|panels|templates)\/[a-z][a-z0-9-]{0,63}$/.test(dir)
  )
    fail("ARGUMENT");
  const limits = limitsFor(overrides),
    expected = tagInventory(repoRoot, tag, dir, limits);
  const actual = await zipInventory(zip, [...new Set([basename(dir), match[1]])], limits);
  const manifestMismatches = ["id", "version"].filter(
    (key, i) =>
      expected.manifest[key] !== actual.manifest[key] || expected.manifest[key] !== match[i + 1],
  );
  const differences = [],
    files = [];
  for (const path of [...new Set([...expected.files.keys(), ...actual.files.keys()])].sort()) {
    const a = expected.files.get(path),
      b = actual.files.get(path);
    const kind = !a
      ? expected.scope.complete
        ? "extra"
        : "unverified"
      : !b
        ? "missing"
        : a.sha256 !== b.sha256
          ? "changed"
          : "equal";
    const file = {
      path,
      kind,
      tagBytes: a?.bytes ?? null,
      zipBytes: b?.bytes ?? null,
      tagSha256: a?.sha256 ?? null,
      zipSha256: b?.sha256 ?? null,
    };
    files.push(file);
    if (kind !== "equal") differences.push(file);
  }
  const status = !expected.scope.complete
    ? "incomplete"
    : differences.length || manifestMismatches.length
      ? "different"
      : "equal";
  return {
    format: "codeshell.panel-release-zip-verification",
    schemaVersion: 1,
    status,
    exitCode: status === "equal" ? 0 : 1,
    tag,
    tagObject: expected.tagObject,
    tagCommit: expected.commit,
    dir,
    assetSha256: actual.assetSha256,
    archiveBytes: actual.archiveBytes,
    comparison:
      "SHA-256 of uncompressed regular-file contents, not ZIP container byte identity or rebuilt-source equivalence",
    scope: expected.scope,
    limits,
    zipRoot: actual.root,
    directories: actual.directories,
    manifest: { tag: expected.manifest, zip: actual.manifest },
    manifestMismatches,
    files,
    differences,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (
        !["--tag", "--zip", "--dir"].includes(args[i]) ||
        !args[i + 1] ||
        args[i + 1].startsWith("--") ||
        Object.hasOwn(options, args[i].slice(2))
      )
        fail("ARGUMENT");
      options[args[i].slice(2)] = args[i + 1];
    }
    const report = await verifyReleaseZip(options);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    process.exitCode = report.exitCode;
  } catch (error) {
    const code = Object.hasOwn(messages, error.code) ? error.code : "INPUT";
    process.stdout.write(
      JSON.stringify({
        format: "codeshell.panel-release-zip-verification",
        schemaVersion: 1,
        status: "error",
        exitCode: 2,
        code,
        message: messages[code],
      }) + "\n",
    );
    process.exitCode = 2;
  }
}
