import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDemoBars } from "../../../apps/quant-lab/app/engine.mjs";
import {
  createEmptyNotes,
  createNote,
  serializeNotes,
} from "../../../apps/quant-lab/app/notes.mjs";

const source = fileURLToPath(new URL("../../../apps/quant-lab", import.meta.url));
const fixtureRoot = fileURLToPath(new URL("../../../test-fixtures/quant-lab", import.meta.url));
const configuration = {
  strategy: { type: "sma-cross", fast: 20, slow: 50 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: 8,
};

async function snapshot(root, prefix = "") {
  const result = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(root, path));
    else if (entry.isFile()) result[path] = (await readFile(join(root, path))).toString("base64");
    else result[path] = "symlink";
  }
  return result;
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "quant-headless-cli-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "项目 with spaces $literal`"),
    selected = join(root, "selected package"),
    home = join(root, "home");
  await Promise.all([mkdir(project), mkdir(home), cp(source, selected, { recursive: true })]);
  const manifestPath = join(selected, ".codeshell-panel/panel.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = "9.8.7";
  await writeFile(manifestPath, JSON.stringify(manifest));
  const entry = join(selected, "app/tools/quant-lab.mjs");
  const guard = join(root, "network-guard.mjs");
  await writeFile(
    guard,
    `globalThis.fetch=()=>{throw new Error("Network forbidden in local CLI fixture")};\n`,
  );
  const invoke = (
    command,
    input,
    { expected = 0, raw = false, args = [], cwd = project, executable = entry } = {},
  ) => {
    const child = spawnSync(
      process.execPath,
      ["--import", guard, executable, ...(command ? [command] : []), ...args],
      {
        cwd,
        input: input === undefined ? "" : raw ? input : JSON.stringify(input),
        env: { PATH: "", HOME: home, USERPROFILE: home, LANG: "C.UTF-8" },
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    if (child.error) throw child.error;
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, expected, child.stdout + child.stderr);
    assert.equal(child.stderr, "", "stdout-only JSON contract must not emit diagnostics on stderr");
    assert.equal(child.stdout.trim().split("\n").length, 1, "CLI must emit exactly one JSON line");
    return JSON.parse(child.stdout);
  };
  const csv = async (count = 260, name = "data/prices.csv") => {
    const bars =
      count <= 5000
        ? generateDemoBars(count)
        : Array.from({ length: count }, (_, index) => ({
            date: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10),
            open: 10,
            high: 12,
            low: 9,
            close: 11,
            volume: 1000,
          }));
    const text =
      "date,open,high,low,close,volume\n" +
      bars
        .map((bar) => [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume].join(","))
        .join("\n") +
      "\n";
    await mkdir(join(project, "data"), { recursive: true });
    await writeFile(join(project, name), text);
    return { bars, name };
  };
  return { root, project, selected, manifestPath, invoke, csv };
}

test("installed selected package discovers exact schemas without dependencies, credentials, network or project writes", async (t) => {
  const f = await fixture(t);
  const result = f.invoke("ops").result;
  assert.equal(
    result.package.version,
    "9.8.7",
    "use this installed package, not another checkout/version",
  );
  assert.deepEqual(result.commands, [
    "dataset",
    "backtest",
    "parameter-sweep",
    "walk-forward",
    "watch",
    "portfolio",
    "notes",
  ]);
  assert.deepEqual(result.inputSchemas.backtest.required, ["csv", "configuration"]);
  assert.equal(result.inputSchemas.backtest.additionalProperties, false);
  assert.equal(result.inputExamples.backtest.configuration.strategy.type, "sma-cross");
  assert.equal(result.aliases.holdings, "portfolio");
  assert.equal(result.readOnly, true);
  assert.deepEqual(f.invoke("--help").result, result);
  const alias = join(f.root, "quant-command.mjs");
  await symlink(join(f.selected, "app/tools/quant-lab.mjs"), alias);
  assert.deepEqual(
    f.invoke("ops", undefined, { executable: alias }).result,
    result,
    "a terminal command symlink must execute the installed entry",
  );
  assert.deepEqual(await readdir(f.project), []);
  const skill = await readFile(join(f.selected, "agent/skills/project-runtime/SKILL.md"), "utf8");
  assert.match(skill, /app\/tools\/quant-lab\.mjs/);
  await writeFile(f.manifestPath, '{"id":"another-package","version":"1.0.0"}');
  assert.equal(f.invoke("ops", undefined, { expected: 1 }).error.code, "PACKAGE_UNAVAILABLE");
});

test("real CSV diagnosis and backtests preserve frozen engine results and make series explicit", async (t) => {
  const f = await fixture(t);
  const { bars, name } = await f.csv();
  const before = await snapshot(f.project);
  const dataset = f.invoke("analyze", { csv: name }).result;
  assert.equal(dataset.bars, 260);
  assert.equal(dataset.from, bars[0].date);
  assert.equal(dataset.to, bars.at(-1).date);
  assert.match(dataset.fingerprint, /^fnv1a32:/);
  assert.deepEqual(f.invoke("dataset/analyze", { csv: name }).result, dataset);
  const run = f.invoke("backtest", { csv: name, configuration }).result;
  assert.equal(run.engine.version, "1.3.0");
  assert.deepEqual(run.dataset, dataset);
  assert.deepEqual(
    run.configuration,
    configuration,
    "retain the actual supplied research assumptions",
  );
  assert.equal(run.research.metrics.finalEquity.toFixed(6), "156927.753986");
  assert.equal(run.research.metrics.sharpe.toFixed(6), "3.330226");
  assert.equal(run.research.trades.length, 2);
  for (const key of ["bars", "equity", "benchmark", "indicators"])
    assert.equal(Object.hasOwn(run.research, key), false);
  const full = f.invoke("backtest", { csv: name, configuration, includeSeries: true }).result
    .research;
  assert.equal(full.equity.length, 260);
  assert.equal(full.bars.length, 260);
  assert.equal(full.benchmark.length, 260);
  assert.deepEqual(full.metrics, run.research.metrics);
  assert.deepEqual(
    await snapshot(f.project),
    before,
    "research commands never persist strategy/results",
  );
});

test("parameter search and walk-forward execute the deterministic engines, reporting rejected combinations", async (t) => {
  const f = await fixture(t);
  const { name } = await f.csv(900);
  const config = { ...configuration, strategy: { type: "sma-cross" } };
  const sweep = f.invoke("parameter-sweep", {
    csv: name,
    configuration: config,
    ranges: { fast: [5, 10, 60], slow: [30, 50] },
  }).result.research;
  assert.equal(sweep.evaluated, 6);
  assert.equal(sweep.usable, 4);
  assert.equal(sweep.results.filter((row) => !row.ok).length, 2);
  assert(sweep.best && Number.isFinite(sweep.best.metrics.sharpe));
  const walk = f.invoke("walk-forward", {
    csv: name,
    configuration: config,
    ranges: { fast: [10, 20], slow: [50, 100] },
    options: { inSampleBars: 400, outOfSampleBars: 100 },
  }).result.research;
  assert.equal(walk.usableFolds, 5);
  assert.equal(walk.failedFolds, 0);
  assert(walk.folds.every((fold) => fold.from < fold.to));
  assert(Number.isFinite(walk.pooledOutOfSampleSharpe));
});

test("watch checks are deterministic and do not send notifications or create worker state", async (t) => {
  const f = await fixture(t);
  const { bars, name } = await f.csv();
  const before = await snapshot(f.project);
  const result = f.invoke("watch", {
    csv: name,
    item: { symbol: "SH600519", rule: { type: "price-below", price: 1_000_000 } },
  }).result;
  assert.equal(result.verdict.triggered, true);
  assert.equal(result.verdict.asOf, bars.at(-1).date);
  assert.equal(result.verdict.close, bars.at(-1).close);
  const compound = f.invoke("watch", {
    csv: name,
    item: {
      symbol: "SH600519",
      rule: {
        type: "compound",
        operator: "and",
        conditions: [
          { type: "price-below", price: 1_000_000 },
          { type: "price-below", price: 0.01 },
        ],
      },
    },
  }).result.verdict;
  assert.equal(compound.triggered, false);
  assert.deepEqual(
    compound.conditions.map((row) => row.triggered),
    [true, false],
  );
  assert.deepEqual(await snapshot(f.project), before);
});

test("holdings read the authoritative ledger and notes resolve links only with supplied context", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.project, "portfolio"));
  await cp(
    join(fixtureRoot, "g1-transactions.json"),
    join(f.project, "portfolio/transactions.json"),
  );
  const document = createEmptyNotes("2026-10-01T00:00:00Z");
  document.entries.push(
    createNote(
      {
        title: "记录已有交易",
        body: "来源保留",
        tags: ["复盘"],
        links: [{ type: "transaction", transactionId: "t1" }],
      },
      { id: "note-test", now: document.updatedAt },
    ),
  );
  await writeFile(join(f.project, "portfolio/journal.json"), serializeNotes(document));
  const before = await snapshot(f.project);
  const holdings = f.invoke("holdings").result;
  assert.equal(holdings.accounts.length, 2);
  assert.equal(holdings.holdings.cashByAccount["cn-main"].CNY, "49778.10");
  const position = holdings.holdings.positionsByAccount.find(
    (row) => row.instrumentId === "xshg-600519",
  );
  assert.equal(position.quantity, "300");
  assert.equal(position.costBasisLocal, "30003.60");
  assert.equal(
    Object.hasOwn(position, "unrealizedPnlLocal"),
    false,
    "ledger-only commands cannot invent current prices",
  );
  assert.deepEqual(f.invoke("portfolio/holdings", {}).result, holdings);
  const notes = f.invoke("notes").result;
  assert.equal(notes.document.entries[0].title, "记录已有交易");
  assert.equal(notes.timeline[0].currentStatus, "orphan");
  const linked = f.invoke("notes", { ledger: "portfolio/transactions.json" }).result;
  assert.equal(linked.timeline.find((row) => row.type === "note").currentStatus, "current");
  assert(linked.timeline.some((row) => row.type === "transaction" && row.id === "t1"));
  assert.deepEqual(
    await snapshot(f.project),
    before,
    "reading must not write a holdings cache or revise journal",
  );
});

test("JSON and path rejection remains structured, bounded, and free of writes", async (t) => {
  const f = await fixture(t);
  const { name } = await f.csv();
  const reject = (command, input, code, options = {}) => {
    const result = f.invoke(command, input, { expected: 2, ...options });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
  };
  reject(undefined, undefined, "INVALID_ARGUMENT");
  reject("unknown", {}, "INVALID_ARGUMENT");
  reject("dataset", "{", "INVALID_INPUT", { raw: true });
  reject("dataset", "[]", "INVALID_INPUT", { raw: true });
  reject("dataset", Buffer.from([0xc3, 0x28]), "INVALID_INPUT", { raw: true });
  reject("dataset", " ".repeat(64 * 1024 + 1), "INPUT_TOO_LARGE", { raw: true });
  reject("dataset", { csv: name, executable: "untrusted" }, "INVALID_INPUT");
  reject("dataset", { csv: name }, "INVALID_ARGUMENT", {
    args: ["--project", f.project, "--project", f.project],
  });
  reject("dataset", { csv: name }, "INVALID_ARGUMENT", { args: ["--project"] });
  reject("dataset", { csv: "missing.csv" }, "FILE_NOT_FOUND");
  reject("dataset", { csv: "../outside.csv" }, "INVALID_PATH");
  reject("dataset", { csv: join(f.project, name) }, "INVALID_PATH");
  reject("dataset", { csv: ".hidden/data.csv" }, "INVALID_PATH");
  reject("dataset", { csv: "data/prices.json" }, "INVALID_PATH");
  reject(
    "backtest",
    { csv: name, configuration: { ...configuration, feeBps: "5" } },
    "INVALID_INPUT",
  );
  reject(
    "backtest",
    { csv: name, configuration: { ...configuration, tradingFromIndex: 50 } },
    "INVALID_INPUT",
  );
  reject(
    "parameter-sweep",
    { csv: name, configuration, ranges: { period: [14] } },
    "INVALID_INPUT",
  );
  reject("parameter-sweep", { csv: name, configuration, ranges: {} }, "INVALID_INPUT");
  await writeFile(join(f.project, "request.json"), JSON.stringify({ csv: name }));
  assert.equal(
    f.invoke("dataset", undefined, { args: ["--input-file", "request.json"] }).result.bars,
    260,
  );
  reject("dataset", undefined, "INVALID_PATH", { args: ["--input-file", "../request.json"] });
  await writeFile(join(f.project, "oversize.json"), " ".repeat(64 * 1024 + 1));
  reject("dataset", undefined, "INPUT_TOO_LARGE", { args: ["--input-file", "oversize.json"] });
  await writeFile(join(f.root, "outside.csv"), await readFile(join(f.project, name)));
  await symlink(join(f.root, "outside.csv"), join(f.project, "linked.csv"));
  reject("dataset", { csv: "linked.csv" }, "INVALID_PATH");
  await symlink(join(f.project, "data"), join(f.project, "alias"), "dir");
  reject("dataset", { csv: "alias/prices.csv" }, "INVALID_PATH");
  await mkdir(join(f.project, "portfolio"));
  await writeFile(join(f.project, "portfolio/journal.json"), '{"format":"wrong"}');
  reject("notes", {}, "INVALID_INPUT");
  const before = await snapshot(f.project);
  reject("dataset", undefined, "INVALID_ARGUMENT", {
    args: ["--input-file", "request.json", "--unexpected"],
  });
  assert.deepEqual(await snapshot(f.project), before);
});

test("bar count, data byte size and parameter workload have independent limits", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.project, "data"));
  await writeFile(join(f.project, "data/huge.csv"), " ".repeat(16 * 1024 * 1024 + 1));
  assert.equal(
    f.invoke("dataset", { csv: "data/huge.csv" }, { expected: 2 }).error.code,
    "INPUT_TOO_LARGE",
  );
  const { name } = await f.csv(100_000);
  assert.equal(
    f.invoke(
      "parameter-sweep",
      {
        csv: name,
        configuration,
        ranges: {
          fast: Array.from({ length: 64 }, (_, index) => index + 2),
          slow: [70, 80, 90, 100],
        },
      },
      { expected: 2 },
    ).error.code,
    "WORK_LIMIT",
  );
  await f.csv(100_001);
  assert.equal(f.invoke("dataset", { csv: name }, { expected: 2 }).error.code, "INPUT_TOO_LARGE");
});
