import { parseTransactions } from "./portfolio.mjs";
import {
  appendTransaction,
  deriveHoldingsSnapshot,
  readWorkspaceJson,
} from "./portfolio-store.mjs";

const EMPTY = {
  format: "codeshell.portfolio-transactions",
  version: 1,
  baseCurrency: "CNY",
  accounts: [],
  instruments: [],
  transactions: [],
};

function civilDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function decimal(value, field, positive = false) {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/u.test(value) ||
    (positive && Number(value) <= 0)
  )
    throw new Error(`${field}必须是有效的非负十进制字符串`);
  return value;
}

function text(value, maximum, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f]/u.test(value)
  )
    throw new Error(`${label}无效`);
  return value.trim();
}

export async function readPortfolioContext(hostCall, options = {}) {
  const stored = await readWorkspaceJson(
    hostCall,
    "portfolio/transactions.json",
    options.epochToken,
  );
  const parsed = stored.exists ? parseTransactions(stored.content) : null;
  const snapshot = parsed
    ? deriveHoldingsSnapshot(stored.content, {}, new Date().toISOString())
    : null;
  return {
    exists: stored.exists,
    fingerprint: parsed?.fingerprint ?? null,
    accounts: parsed?.ledger.accounts ?? [],
    instruments: parsed?.ledger.instruments ?? [],
    positions: snapshot?.positionsByAccount ?? [],
    imports: (parsed?.ledger.transactions ?? [])
      .filter((item) => item.source)
      .map((item) => ({
        accountId: item.accountId,
        instrumentId: item.instrumentId,
        valuationDate: item.valuationDate,
        ...item.source,
      })),
  };
}

// Current holdings are opening positions, never invented historical buy trades.
export async function importPortfolioSnapshot(hostCall, input, options = {}) {
  if (!input || !["preview", "commit"].includes(input.mode)) throw new Error("导入模式无效");
  const account = {
    id: text(input.account?.id, 64, "账户 ID"),
    name: text(input.account?.name, 100, "账户名"),
    broker: text(input.account?.broker, 100, "券商（未知时明确写未知）"),
    currencies: ["CNY"],
  };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(account.id)) throw new Error("账户 ID 无效");
  if (!civilDate(input.valuationDate))
    throw new Error("需要明确的建账日期；截图行情日期未知时不能伪造日期");
  const marketDate = input.source?.marketDate;
  if (marketDate !== null && !civilDate(marketDate))
    throw new Error("截图行情日期须为实际日期或 null");
  if (marketDate !== null && marketDate !== input.valuationDate)
    throw new Error("已知截图日期须与期初估值日期一致");
  const reference = text(input.source?.reference, 500, "来源");
  if (!Array.isArray(input.positions) || input.positions.length < 1 || input.positions.length > 100)
    throw new Error("每次导入 1–100 只股票");
  const seen = new Set();
  const positions = input.positions
    .map((item) => {
      const symbol = text(item?.symbol, 8, "股票代码");
      if (!/^(SH6|SZ[03])\d{5}$/u.test(symbol) || seen.has(symbol))
        throw new Error("股票代码无效或重复；当前导入支持沪深 A 股");
      seen.add(symbol);
      return {
        symbol,
        name: text(item.name, 80, "股票名"),
        quantity: decimal(item.quantity, "数量", true),
        costBasis: decimal(item.costBasis, "持仓总成本"),
        marketValue: decimal(item.marketValue, "截图市值"),
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const identity = JSON.stringify({
    account,
    valuationDate: input.valuationDate,
    marketDate,
    reference,
    positions,
  });
  const importId = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity))),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const epochToken = { expected: options.expectedEpoch, current: options.currentEpoch };
  const stored = await readWorkspaceJson(hostCall, "portfolio/transactions.json", epochToken);
  const existing = stored.exists ? parseTransactions(stored.content) : null;
  const ledger = existing?.ledger ?? EMPTY;
  const warnings = [
    "期初持仓导入不补造历史成交；截图市值仅作为期初估值，不作为最新行情。",
    ...(marketDate === null
      ? ["截图行情日期未知：仅以指定建账日建立起点，不能据此还原此前收益。"]
      : []),
    "本次只录入证券持仓；可用资金不等于现金余额，融资负债与净资产未由此导入。",
  ];
  const imported = ledger.transactions.filter((item) => item.source?.importId === importId);
  if (imported.length) {
    if (imported.length !== positions.length)
      throw new Error("既有导入记录不完整，请核查账本，勿重复追加");
    return {
      status: "already-imported",
      committed: true,
      importId,
      warnings,
      fingerprint: existing.fingerprint,
      snapshot: deriveHoldingsSnapshot(stored.content, {}, new Date().toISOString()),
    };
  }
  if (input.expectedFingerprint !== (existing?.fingerprint ?? null))
    throw new Error("账本已变化，请先重新读取持仓上下文");
  if (
    ledger.transactions.some(
      (item) =>
        item.accountId === account.id ||
        item.fromAccountId === account.id ||
        item.toAccountId === account.id,
    )
  ) {
    throw new Error("该账户已有流水；期初导入不能叠加到已有账户。请核对后使用实际交易或调整流程");
  }
  const existingAccount = ledger.accounts.find((item) => item.id === account.id);
  if (existingAccount && JSON.stringify(existingAccount) !== JSON.stringify(account))
    throw new Error("账户信息与账本冲突");
  const instruments = [];
  const createdAt = options.now?.().toISOString() ?? new Date().toISOString();
  const transactions = positions.map((position, index) => {
    const matches = ledger.instruments.filter(
      (item) => item.symbol === position.symbol && item.market === "cn",
    );
    if (matches.length > 1) throw new Error("账本中有重复证券，请先核查");
    const instrument = matches[0] ?? {
      id: `stock-${position.symbol}`,
      type: "stock",
      market: "cn",
      currency: "CNY",
      symbol: position.symbol,
      name: position.name,
      aliases: [],
    };
    if (matches[0] && instrument.name !== position.name)
      throw new Error(`${position.symbol}名称与账本不一致，请核对`);
    if (!matches[0]) instruments.push(instrument);
    return {
      id: `opening-${importId.slice(0, 40)}-${index}`,
      type: "position-in",
      createdAt,
      accountId: account.id,
      instrumentId: instrument.id,
      quantity: position.quantity,
      valuationDate: input.valuationDate,
      timing: "begin",
      fairValueBase: position.marketValue,
      costBasisLocal: position.costBasis,
      costBasisBase: position.costBasis,
      source: { kind: "holding-snapshot", reference, marketDate, importId },
    };
  });
  const prospective = {
    ...structuredClone(ledger),
    accounts: [...ledger.accounts, ...(existingAccount ? [] : [account])],
    instruments: [...ledger.instruments, ...instruments],
    transactions: [...ledger.transactions, ...transactions],
  };
  const snapshot = deriveHoldingsSnapshot(JSON.stringify(prospective), {}, createdAt);
  if (input.mode === "preview")
    return {
      status: "preview",
      committed: false,
      importId,
      warnings,
      positions,
      snapshot,
      fingerprint: existing?.fingerprint ?? null,
    };
  const result = await appendTransaction(
    hostCall,
    {
      accounts: existingAccount ? [] : [account],
      instruments,
      transactions,
      ...(!existing ? { initialLedger: EMPTY } : {}),
    },
    { ...options, derivedAt: createdAt, expectedFingerprint: input.expectedFingerprint },
  );
  return { ...result, importId, warnings };
}

export function registerPortfolioTools({
  registerTool,
  hostCall,
  ready,
  currentEpoch,
  refresh,
  displayedPositions,
}) {
  if (typeof registerTool !== "function") return;
  let running = false;
  registerTool("get_portfolio_context", async () => {
    await ready;
    const expected = currentEpoch();
    return readPortfolioContext(hostCall, { epochToken: { expected, current: currentEpoch } });
  });
  registerTool("import_portfolio_snapshot", async (input) => {
    await ready;
    if (running) throw new Error("另一笔持仓导入正在执行，请等待完成");
    running = true;
    const expectedEpoch = currentEpoch();
    try {
      const result = await importPortfolioSnapshot(hostCall, input, {
        expectedEpoch,
        currentEpoch,
      });
      if (result.committed) {
        try {
          await refresh(expectedEpoch);
          const displayed = displayedPositions();
          const expected = result.snapshot.positionsByAccount.filter(
            (item) => item.accountId === input.account.id,
          );
          result.panelVerified =
            currentEpoch() === expectedEpoch &&
            expected.every((item) =>
              displayed.some(
                (candidate) =>
                  candidate.accountId === item.accountId &&
                  candidate.instrumentId === item.instrumentId &&
                  candidate.quantity === item.quantity,
              ),
            );
        } catch {
          result.panelVerified = false;
        }
      }
      return result;
    } finally {
      running = false;
    }
  });
}
