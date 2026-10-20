#!/usr/bin/env node
import { constants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BACKTEST_ENGINE_RELEASE,
  analyzeDataset,
  evaluateWatchItem,
  fingerprintBars,
  parameterSweep,
  parseOhlcvCsv,
  runBacktest,
  walkForward,
} from "../engine.mjs";
import { deriveHoldings, parseTransactions } from "../portfolio.mjs";
import { MAX_NOTES_BYTES, NOTES_PATH, buildReviewTimeline, parseNotes } from "../notes.mjs";

const INPUT_BYTES = 64 * 1024;
const DATA_BYTES = 16 * 1024 * 1024;
const OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_BARS = 100_000;
const MAX_WORK = 20_000_000;
const number = { type: "number" };
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const string = { type: "string", minLength: 1, maxLength: 512 };
const object = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const array = (items, maxItems = 64) => ({ type: "array", items, minItems: 1, maxItems });
const choice = (...values) => ({ type: "string", enum: values });
const strategy = object(
  {
    type: choice("sma-cross", "rsi-reversion", "breakout"),
    fast: integer(2, MAX_BARS),
    slow: integer(3, MAX_BARS),
    period: integer(2, MAX_BARS),
    oversold: number,
    overbought: number,
    lookback: integer(2, MAX_BARS),
  },
  ["type"],
);
const configuration = object(
  {
    strategy,
    initialCapital: number,
    feeBps: number,
    slippageBps: number,
    stopLossPct: number,
    maxHoldingDays: integer(0, 10_000),
    signalMode: choice("state", "edge"),
    riskFreeRate: number,
    sizer: object(
      {
        type: choice("all-in", "fixed-fraction", "volatility-target"),
        pct: number,
        annual: number,
        lookback: integer(2, MAX_BARS),
        maxLeverage: number,
      },
      ["type"],
    ),
  },
  ["strategy", "initialCapital", "feeBps", "slippageBps", "stopLossPct"],
);
const ranges = object(
  Object.fromEntries(
    ["fast", "slow", "period", "oversold", "overbought", "lookback"].map((key) => [
      key,
      array(number),
    ]),
  ),
);
const primitiveRule = {
  type: choice("price-below", "rsi-oversold", "drawdown-from-high", "signal-entry", "compound"),
  price: number,
  period: integer(2, MAX_BARS),
  threshold: number,
  lookback: integer(2, MAX_BARS),
  pct: number,
  strategy,
};
const rule = object(
  {
    ...primitiveRule,
    operator: choice("and", "or"),
    conditions: { ...array(object(primitiveRule, ["type"]), 4), minItems: 2 },
  },
  ["type"],
);
const schemas = {
  dataset: object({ csv: string }, ["csv"]),
  backtest: object({ csv: string, configuration, includeSeries: { type: "boolean" } }, [
    "csv",
    "configuration",
  ]),
  "parameter-sweep": object(
    {
      csv: string,
      configuration,
      ranges,
      options: object({ minimumTrades: integer(1, MAX_BARS) }),
    },
    ["csv", "configuration", "ranges"],
  ),
  "walk-forward": object(
    {
      csv: string,
      configuration,
      ranges,
      options: object({
        inSampleBars: integer(30, MAX_BARS),
        outOfSampleBars: integer(10, MAX_BARS),
        warmupBars: integer(0, MAX_BARS),
      }),
    },
    ["csv", "configuration", "ranges"],
  ),
  watch: object(
    {
      csv: string,
      item: object({ symbol: { ...string, maxLength: 32 }, rule, strategy }, ["symbol", "rule"]),
    },
    ["csv", "item"],
  ),
  portfolio: object({ ledger: string }),
  notes: object({ path: string, ledger: string }),
};
const aliases = {
  analyze: "dataset",
  "dataset/analyze": "dataset",
  holdings: "portfolio",
  "portfolio/holdings": "portfolio",
};
const exampleConfiguration = {
  strategy: { type: "sma-cross", fast: 20, slow: 50 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: 8,
};
const inputExamples = {
  dataset: { csv: "data/prices.csv" },
  backtest: { csv: "data/prices.csv", configuration: exampleConfiguration, includeSeries: false },
  "parameter-sweep": {
    csv: "data/prices.csv",
    configuration: exampleConfiguration,
    ranges: { fast: [10, 20], slow: [40, 60] },
  },
  "walk-forward": {
    csv: "data/prices.csv",
    configuration: exampleConfiguration,
    ranges: { fast: [10, 20], slow: [40, 60] },
    options: { inSampleBars: 400, outOfSampleBars: 100 },
  },
  watch: {
    csv: "data/prices.csv",
    item: { symbol: "SH600519", rule: { type: "price-below", price: 1500 } },
  },
  portfolio: {},
  notes: {},
};

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function validate(value, schema, path = "input", depth = 0) {
  if (depth > 20) throw failure("INVALID_INPUT", `${path}: nesting is too deep`);
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw failure("INVALID_INPUT", `${path}: object required`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key))
        throw failure("INVALID_INPUT", `${path}.${key}: unknown field`);
      validate(value[key], schema.properties[key], `${path}.${key}`, depth + 1);
    }
    for (const key of schema.required)
      if (!Object.hasOwn(value, key)) throw failure("INVALID_INPUT", `${path}.${key}: required`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems)
      throw failure(
        "INVALID_INPUT",
        `${path}: expected ${schema.minItems}..${schema.maxItems} items`,
      );
    value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`, depth + 1));
  } else {
    const valid =
      schema.type === "integer"
        ? Number.isInteger(value)
        : schema.type === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : typeof value === schema.type;
    if (
      !valid ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum) ||
      (schema.minLength !== undefined && (!value.trim() || value.length > schema.maxLength)) ||
      (schema.enum && !schema.enum.includes(value))
    )
      throw failure("INVALID_INPUT", `${path}: invalid ${schema.type}`);
  }
}

function projectPath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 512 ||
    isAbsolute(value) ||
    /[\\:\u0000-\u001f\u007f]/u.test(value) ||
    value
      .split("/")
      .some(
        (part) =>
          !part || part === "." || part === ".." || part.startsWith(".") || part === "node_modules",
      )
  )
    throw failure(
      "INVALID_PATH",
      "Data paths must be project-relative files without hidden, parent or symlink components",
    );
  return value;
}

async function readProjectFile(root, value, maximum) {
  projectPath(value);
  let current = root;
  let handle;
  try {
    const parts = value.split("/");
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || (index < parts.length - 1 && !entry.isDirectory()))
        throw failure("INVALID_PATH", "Symlinks and non-directory path components are unavailable");
    }
    handle = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile()) throw failure("INVALID_PATH", "A regular project file is required");
    const actual = await realpath(current);
    const within = relative(root, actual);
    const pathInfo = await lstat(actual);
    if (
      within === ".." ||
      within.startsWith(`..${sep}`) ||
      isAbsolute(within) ||
      info.ino !== pathInfo.ino ||
      info.dev !== pathInfo.dev
    )
      throw failure("INVALID_PATH", "Project file changed or escaped the selected project");
    if (info.size > maximum) throw failure("INPUT_TOO_LARGE", `File exceeds ${maximum} bytes`);
    const chunks = [];
    let bytes = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maximum + 1 - bytes));
      const { bytesRead } = await handle.read(buffer);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > maximum) throw failure("INPUT_TOO_LARGE", `File exceeds ${maximum} bytes`);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    } catch {
      throw failure("INVALID_INPUT", "File must contain valid UTF-8 text");
    }
  } catch (error) {
    if (error.code === "ENOENT")
      throw failure("FILE_NOT_FOUND", `Project file is missing: ${value}`);
    throw error;
  } finally {
    await handle?.close();
  }
}

function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw failure("INVALID_INPUT", "Input must contain valid JSON");
  }
}

async function packageIdentity() {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(new URL("../../.codeshell-panel/panel.json", import.meta.url), "utf8"),
    );
  } catch {
    throw failure("PACKAGE_UNAVAILABLE", "The selected Quant Lab package manifest is unavailable");
  }
  if (manifest.id !== "quant-lab")
    throw failure("PACKAGE_UNAVAILABLE", "The selected package is not quant-lab");
  return { id: manifest.id, version: manifest.version };
}

function validateConfiguration(input) {
  const config = input.configuration;
  if (!config) return;
  const fields = {
    "sma-cross": ["fast", "slow"],
    "rsi-reversion": ["period", "oversold", "overbought"],
    breakout: ["lookback"],
  }[config.strategy.type];
  for (const key of Object.keys(config.strategy))
    if (key !== "type" && !fields.includes(key))
      throw failure("INVALID_INPUT", `strategy.${key} does not belong to ${config.strategy.type}`);
  for (const key of Object.keys(input.ranges ?? {}))
    if (!fields.includes(key))
      throw failure("INVALID_INPUT", `ranges.${key} does not belong to ${config.strategy.type}`);
  for (const key of fields)
    if (!Object.hasOwn(config.strategy, key) && !Object.hasOwn(input.ranges ?? {}, key))
      throw failure("INVALID_INPUT", `strategy.${key} or its parameter range is required`);
  if (
    !(config.initialCapital > 0) ||
    config.feeBps < 0 ||
    config.feeBps >= 10_000 ||
    config.slippageBps < 0 ||
    config.slippageBps >= 10_000 ||
    config.stopLossPct < 0 ||
    config.stopLossPct >= 100 ||
    (config.riskFreeRate !== undefined && Math.abs(config.riskFreeRate) > 1)
  )
    throw failure(
      "INVALID_INPUT",
      "Invalid capital, fee, slippage, stop loss or risk-free-rate assumptions",
    );
  if (config.sizer) {
    const allowed = {
      "all-in": ["type"],
      "fixed-fraction": ["type", "pct"],
      "volatility-target": ["type", "annual", "lookback", "maxLeverage"],
    }[config.sizer.type];
    for (const key of Object.keys(config.sizer))
      if (!allowed.includes(key))
        throw failure("INVALID_INPUT", `sizer.${key}: unknown field for this sizer`);
    if (
      config.sizer.type === "fixed-fraction" &&
      !(config.sizer.pct > 0 && config.sizer.pct <= 100)
    )
      throw failure("INVALID_INPUT", "sizer.pct must be within (0, 100]");
    if (
      config.sizer.type === "volatility-target" &&
      (!(config.sizer.annual > 0 && config.sizer.annual <= 500) ||
        (config.sizer.maxLeverage !== undefined &&
          !(config.sizer.maxLeverage > 0 && config.sizer.maxLeverage <= 1)))
    )
      throw failure("INVALID_INPUT", "Invalid volatility target or leverage");
  }
}

export async function runQuantLab(command, input, { project = process.cwd() } = {}) {
  const selectedPackage = await packageIdentity();
  command = aliases[command] ?? command;
  if (command === "ops" || command === "--help")
    return {
      ok: true,
      result: {
        format: "codeshell.quant-lab.cli",
        version: 1,
        package: selectedPackage,
        commands: Object.keys(schemas),
        aliases,
        inputSchemas: schemas,
        inputExamples,
        limits: {
          inputBytes: INPUT_BYTES,
          dataBytes: DATA_BYTES,
          outputBytes: OUTPUT_BYTES,
          bars: MAX_BARS,
          barEvaluations: MAX_WORK,
        },
        readOnly: true,
        input:
          "--input-file <project-relative.json> or one JSON object on stdin; --project defaults to cwd",
      },
    };
  if (!Object.hasOwn(schemas, command))
    throw failure("INVALID_ARGUMENT", `Unknown command: ${command ?? "(missing)"}; use ops`);
  validate(input, schemas[command]);
  validateConfiguration(input);
  let root;
  try {
    root = await realpath(resolve(project));
  } catch {
    throw failure("INVALID_PATH", "The selected project directory is unavailable");
  }
  if (!(await lstat(root)).isDirectory())
    throw failure("INVALID_PATH", "--project must name a directory");
  let result;
  try {
    if (command === "portfolio") {
      const path = input.ledger ?? "portfolio/transactions.json";
      const { ledger, fingerprint } = parseTransactions(
        await readProjectFile(root, path, DATA_BYTES),
      );
      result = {
        path,
        fingerprint,
        baseCurrency: ledger.baseCurrency,
        accounts: ledger.accounts,
        instruments: ledger.instruments,
        holdings: deriveHoldings(ledger),
        priceBasis:
          "No current prices supplied; market value and unrealized P&L remain unavailable.",
      };
    } else if (command === "notes") {
      const path = input.path ?? NOTES_PATH;
      const document = parseNotes(await readProjectFile(root, path, MAX_NOTES_BYTES));
      const ledger = input.ledger
        ? parseTransactions(await readProjectFile(root, input.ledger, DATA_BYTES)).ledger
        : undefined;
      result = {
        path,
        document,
        timeline: buildReviewTimeline({ notes: document.entries, ledger }),
      };
    } else {
      if (!input.csv.toLowerCase().endsWith(".csv"))
        throw failure("INVALID_PATH", "csv must name a .csv file");
      const bars = parseOhlcvCsv(await readProjectFile(root, input.csv, DATA_BYTES));
      if (bars.length > MAX_BARS)
        throw failure("INPUT_TOO_LARGE", `CSV accepts at most ${MAX_BARS} bars`);
      const dataset = {
        path: input.csv,
        bars: bars.length,
        from: bars[0].date,
        to: bars.at(-1).date,
        fingerprint: fingerprintBars(bars),
        ...analyzeDataset(bars),
      };
      if (command === "dataset") result = dataset;
      else if (command === "watch")
        result = { dataset, verdict: evaluateWatchItem(bars, input.item) };
      else {
        if (input.ranges) {
          const combinations = Object.values(input.ranges).reduce(
            (count, values) => count * values.length,
            1,
          );
          if (!Object.keys(input.ranges).length || combinations > 4096)
            throw failure("INVALID_INPUT", "Parameter ranges need 1..4096 combinations");
          const folds =
            command === "walk-forward"
              ? Math.max(
                  1,
                  Math.floor(
                    (bars.length - (input.options?.inSampleBars ?? 504)) /
                      (input.options?.outOfSampleBars ?? 126),
                  ),
                )
              : 1;
          const workBars =
            command === "walk-forward"
              ? combinations * (input.options?.inSampleBars ?? 504) +
                (input.options?.inSampleBars ?? 504) +
                (input.options?.outOfSampleBars ?? 126)
              : combinations * bars.length;
          if (folds * workBars > MAX_WORK)
            throw failure(
              "WORK_LIMIT",
              "Parameter search exceeds the CLI work limit; reduce ranges or data",
            );
        }
        let research;
        if (command === "backtest") {
          research = runBacktest(bars, input.configuration);
          if (!input.includeSeries) {
            const { bars: sourceBars, equity, benchmark, indicators, ...summary } = research;
            research = { ...summary, seriesIncluded: false };
          }
        } else if (command === "parameter-sweep")
          research = parameterSweep(bars, input.configuration, input.ranges, input.options);
        else research = walkForward(bars, input.configuration, input.ranges, input.options);
        result = {
          engine: BACKTEST_ENGINE_RELEASE,
          dataset,
          configuration: input.configuration,
          ...(input.ranges ? { ranges: input.ranges } : {}),
          ...(input.options ? { options: input.options } : {}),
          research,
        };
      }
    }
  } catch (error) {
    if (error.name?.endsWith("ValidationError")) throw failure("INVALID_INPUT", error.message);
    if (error.code) throw error;
    throw failure("INVALID_INPUT", error.message);
  }
  return { ok: true, command, package: selectedPackage, result };
}

export async function main(argv = process.argv.slice(2)) {
  let command,
    project = process.cwd(),
    inputFile;
  const used = new Set();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (["--project", "--input-file"].includes(token)) {
      if (used.has(token)) throw failure("INVALID_ARGUMENT", `Duplicate option: ${token}`);
      used.add(token);
      const value = argv[++index];
      if (!value || value.startsWith("--"))
        throw failure("INVALID_ARGUMENT", `${token} requires a value`);
      if (token === "--project") project = value;
      else inputFile = value;
    } else if (!command && (token === "--help" || !token.startsWith("-"))) command = token;
    else throw failure("INVALID_ARGUMENT", `Unknown argument: ${token}`);
  }
  if (command === "ops" || command === "--help") {
    if (inputFile) throw failure("INVALID_ARGUMENT", "ops does not accept an input file");
    return runQuantLab(command, {}, { project });
  }
  if (!Object.hasOwn(schemas, aliases[command] ?? command))
    throw failure("INVALID_ARGUMENT", "A supported command is required; use ops");
  let text;
  if (inputFile) {
    let root;
    try {
      root = await realpath(resolve(project));
    } catch {
      throw failure("INVALID_PATH", "The selected project directory is unavailable");
    }
    text = await readProjectFile(root, inputFile, INPUT_BYTES);
  } else {
    const chunks = [];
    let bytes = 0;
    if (!process.stdin.isTTY)
      for await (const chunk of process.stdin) {
        bytes += chunk.length;
        if (bytes > INPUT_BYTES)
          throw failure("INPUT_TOO_LARGE", `JSON input exceeds ${INPUT_BYTES} bytes`);
        chunks.push(chunk);
      }
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    } catch {
      throw failure("INVALID_INPUT", "Input must contain valid UTF-8 text");
    }
  }
  return runQuantLab(command, text.trim() ? json(text) : {}, { project });
}

const invokedPath = process.argv[1]
  ? await realpath(resolve(process.argv[1])).catch(() => null)
  : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main()
    .then((result) => {
      const text = JSON.stringify(result);
      if (Buffer.byteLength(text) > OUTPUT_BYTES)
        throw failure(
          "OUTPUT_TOO_LARGE",
          "Result exceeds the CLI output limit; reduce the input or omit series",
        );
      process.stdout.write(`${text}\n`);
    })
    .catch((error) => {
      const code = error.code ?? "OPERATION_FAILED";
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: { code, message: String(error.message).slice(0, 4096) } })}\n`,
      );
      process.exitCode = [
        "INVALID_ARGUMENT",
        "INVALID_INPUT",
        "INVALID_PATH",
        "FILE_NOT_FOUND",
        "INPUT_TOO_LARGE",
        "WORK_LIMIT",
      ].includes(code)
        ? 2
        : 1;
    });
}
