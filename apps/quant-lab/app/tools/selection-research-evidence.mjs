import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { parseSelectionResearchEvidence } from "../modules/selection-evidence-ui.mjs";

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 45_000;
const SYMBOL = /^(?:SH6\d{5}|SZ[03]\d{5})$/u;

function unavailable(reason) {
  return { version: 1, status: "unavailable", reason, providers: {}, stocks: [] };
}

export async function selectionPythonPath(environment = process.env, home = homedir()) {
  if (environment.QUANT_LAB_PYTHON) return environment.QUANT_LAB_PYTHON;
  const local = process.platform === "win32"
    ? join(home, ".code-shell", "runtimes", "quant-lab-python", "Scripts", "python.exe")
    : join(home, ".code-shell", "runtimes", "quant-lab-python", "bin", "python");
  try {
    await access(local);
    return local;
  } catch {
    return process.platform === "win32" ? "python" : "python3";
  }
}

// Fixed program and JSON stdin; no shell, user code, package installation, or
// credentials are placed on the command line. Optional providers cannot block
// publication of an otherwise valid selection snapshot.
export async function runSelectionBridge(request, options = {}) {
  const python = options.python ?? await selectionPythonPath();
  const source = options.source ?? (await import("./selection-python-source.mjs")).PYTHON_SOURCE;
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > MAX_BYTES) throw new Error("增强核验输入超过上限");
  return new Promise((resolve, reject) => {
    const launch = options.spawnProcess ?? spawn;
    const grouped = process.platform !== "win32";
    const child = launch(python, ["-B", "-c", source], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      detached: grouped,
      windowsHide: true,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    let settled = false;
    let size = 0;
    let errorSize = 0;
    const chunks = [];
    const stop = () => {
      if (grouped && Number.isInteger(child.pid) && child.pid > 0) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      } else child.kill("SIGKILL");
    };
    const onTermination = (signal) => {
      stop();
      cleanup();
      // Preserve the Host's cancellation semantics after reaping this separate
      // process group (including the provider's worker children).
      process.kill(process.pid, signal);
    };
    const onTerm = () => onTermination("SIGTERM");
    const onInt = () => onTermination("SIGINT");
    const cleanup = () => {
      process.removeListener("SIGTERM", onTerm);
      process.removeListener("SIGINT", onInt);
      process.removeListener("exit", stop);
    };
    process.once("SIGTERM", onTerm);
    process.once("SIGINT", onInt);
    process.once("exit", stop);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (error) { stop(); reject(error); }
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("增强核验超时，本轮未补充指标与财务快照")), options.timeoutMs ?? TIMEOUT_MS);
    child.on("error", () => finish(new Error("未找到可用的股票研究 Python 环境")));
    child.stdin.on("error", () => finish(new Error("增强核验进程提前退出")));
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) finish(new Error("增强核验返回超过上限"));
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      errorSize += chunk.length;
      if (errorSize > MAX_BYTES) finish(new Error("增强核验错误输出超过上限"));
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) return finish(new Error("增强核验未完成，保留原选股结果"));
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { finish(new Error("增强核验没有返回有效 JSON")); }
    });
    child.stdin.end(input);
  });
}

export function selectionEvidenceRequest(snapshot, histories) {
  const symbols = [...new Set([
    ...snapshot.sectors.flatMap((sector) => sector.candidates),
    ...snapshot.sectors.flatMap((sector) => sector.representatives),
    ...snapshot.sectors.flatMap((sector) => sector.timingQueue),
  ].map((item) => item.symbol).filter((symbol) => SYMBOL.test(symbol)))].slice(0, 20);
  const provisional = snapshot.session.provisional === true;
  return {
    action: "enrich",
    marketDate: snapshot.marketDate,
    generatedAt: snapshot.generatedAt,
    provisional,
    symbols,
    histories: symbols.map((symbol) => ({
      symbol,
      adjustment: "qfq",
      // These come exclusively from the existing qfq cache/fetch contract.
      // Never substitute today's raw quote into an adjusted historical series.
      bars: (histories.get(symbol) ?? [])
        .filter((bar) => provisional ? bar.date < snapshot.marketDate : bar.date <= snapshot.marketDate)
        .slice(-180)
        .map(({ date, open, high, low, close, volume }) => ({ date, open, high, low, close, volume })),
    })),
  };
}

export async function enrichSelectionSnapshot(snapshot, histories, options = {}) {
  const request = selectionEvidenceRequest(snapshot, histories);
  if (!request.symbols.length) return { ...snapshot, researchEvidence: unavailable("当前研究池没有可补充核验的股票") };
  if (options.timeoutMs != null && options.timeoutMs < 30_000) {
    return { ...snapshot, researchEvidence: unavailable(options.skipReason || "本轮行情采集耗时较长，先保留选股结果；下次刷新再补充核验") };
  }
  try {
    const response = await (options.runBridge ?? runSelectionBridge)(request, options);
    if (!Array.isArray(response?.stocks) || response.stocks.some((stock) => !request.symbols.includes(stock?.symbol))) {
      throw new Error("增强核验返回了研究池以外的股票");
    }
    // The bridge reports per-provider availability; use the same strict parser
    // in the producer and UI, including backwards-compatible missing fields.
    const result = parseSelectionResearchEvidence({
      ...response,
      status: response.stocks.some((stock) => stock.technical?.available || stock.fundamentals?.available)
        ? "partial" : "unavailable",
      reason: "指标与财务截面仅补充研究证据；财报披露时点、现金流质量与样本外验证仍需核验。",
    }, {
      marketDate: snapshot.marketDate,
      generatedAt: new Date().toISOString(),
      provisional: snapshot.session.provisional === true,
    });
    return { ...snapshot, researchEvidence: result };
  } catch (error) {
    return {
      ...snapshot,
      researchEvidence: unavailable(error instanceof Error ? error.message : "增强核验暂不可用"),
    };
  }
}
