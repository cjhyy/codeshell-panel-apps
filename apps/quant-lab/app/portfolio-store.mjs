import {
  deriveHoldings,
  fingerprintInputs,
  parseHoldings,
  parseTransactions,
} from "./portfolio.mjs";

const TRANSACTIONS_PATH = "portfolio/transactions.json";
const HOLDINGS_PATH = "portfolio/holdings.json";

function checkEpoch(epochToken) {
  if (!epochToken) return;
  const expected = epochToken.expected ?? epochToken.expectedEpoch;
  const current = epochToken.current ?? epochToken.currentEpoch;
  if (typeof current === "function" && current() !== expected) {
    throw new Error("workspace epoch changed; operation cancelled");
  }
}

function safePortfolioPath(path) {
  return path === TRANSACTIONS_PATH || path === HOLDINGS_PATH;
}

function parentPath(path) {
  return path.slice(0, path.lastIndexOf("/")) || ".";
}

export class PortfolioStoreConflictError extends Error {
  constructor(message, draft, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "PortfolioStoreConflictError";
    this.frozen = true;
    this.draft = draft;
  }
}

export async function readWorkspaceJson(hostCall, path, epochToken) {
  if (typeof hostCall !== "function") throw new Error("hostCall must be a function");
  if (!safePortfolioPath(path)) throw new Error("portfolio store path is not allowed");
  checkEpoch(epochToken);
  const directory = parentPath(path);
  const listing = await hostCall("workspace.list", { path: directory });
  checkEpoch(epochToken);
  if (!listing || !Array.isArray(listing.entries)) throw new Error("workspace.list returned an invalid response");
  const entry = listing.entries.find(
    (candidate) =>
      candidate?.kind === "file" &&
      (candidate.path === path || `${directory}/${candidate.name}` === path),
  );
  if (!entry) {
    if (listing.truncated) throw new Error("workspace.list was truncated before file existence could be proven");
    return { exists: false, content: null, modifiedAt: null, revision: null };
  }
  const result = await hostCall("workspace.readText", { path });
  checkEpoch(epochToken);
  if (!result || typeof result.content !== "string") throw new Error("workspace.readText returned invalid content");
  return {
    exists: true,
    content: result.content,
    modifiedAt: result.modifiedAt,
    revision: result.revision,
  };
}

export function deriveHoldingsSnapshot(sourceText, inputs, derivedAt) {
  if (typeof derivedAt !== "string" || Number.isNaN(Date.parse(derivedAt))) {
    throw new Error("derivedAt must be a valid timestamp");
  }
  const { ledger, fingerprint } = parseTransactions(sourceText);
  const holdings = deriveHoldings(ledger, inputs);
  return {
    format: "codeshell.portfolio-holdings",
    version: 1,
    derivedAt,
    transactionsFingerprint: fingerprint,
    // Market-dependent fields (unrealized P&L, base availability, valuation)
    // change without any ledger edit, so the cache also pins its inputs.
    inputsFingerprint: fingerprintInputs(inputs),
    baseCurrency: ledger.baseCurrency,
    ...holdings,
  };
}

export async function loadHoldingsSnapshot(
  hostCall,
  transactionsSourceText,
  inputs,
  derivedAt,
  epochToken,
) {
  const authoritative = parseTransactions(transactionsSourceText);
  let stored;
  try {
    stored = await readWorkspaceJson(hostCall, HOLDINGS_PATH, epochToken);
  } catch (error) {
    return {
      rebuilt: true,
      snapshot: deriveHoldingsSnapshot(transactionsSourceText, inputs, derivedAt),
      modifiedAt: null,
      revision: null,
      cacheWarning: {
        code: "holdings-cache-read-failed",
        message: error?.message ?? "holdings cache read failed",
        rebuildRequired: true,
      },
    };
  }
  if (stored.exists) {
    try {
      const snapshot = parseHoldings(stored.content);
      if (
        snapshot.transactionsFingerprint === authoritative.fingerprint &&
        snapshot.inputsFingerprint === fingerprintInputs(inputs)
      ) {
        return { rebuilt: false, snapshot, modifiedAt: stored.modifiedAt, revision: stored.revision };
      }
    } catch {
      // holdings is a disposable cache. Strict parsing still rejects the file,
      // but the store rebuilds from authoritative transactions in memory.
    }
  }
  return {
    rebuilt: true,
    snapshot: deriveHoldingsSnapshot(transactionsSourceText, inputs, derivedAt),
    modifiedAt: stored.modifiedAt,
    revision: stored.revision,
  };
}

function writeParameters(path, content, existing) {
  return {
    path,
    content,
    expectedModifiedAt: existing.exists ? existing.modifiedAt : null,
    ...(existing.exists && existing.revision ? { expectedRevision: existing.revision } : {}),
  };
}

async function verifiedWrite(hostCall, path, content, existing, epochToken, draft) {
  checkEpoch(epochToken);
  let result;
  try {
    result = await hostCall("workspace.writeText", writeParameters(path, content, existing));
  } catch (error) {
    throw new PortfolioStoreConflictError(error?.message ?? "portfolio write failed", draft, error);
  }
  checkEpoch(epochToken);
  const reread = await hostCall("workspace.readText", { path });
  checkEpoch(epochToken);
  if (!reread || reread.content !== content) {
    throw new PortfolioStoreConflictError("write verification failed; input is frozen", draft);
  }
  return { result, reread };
}

export async function appendTransaction(
  hostCall,
  draft,
  {
    expectedEpoch,
    currentEpoch,
    derivedAt,
    derivationInputs = {},
    expectedFingerprint,
  } = {},
) {
  const epochToken = { expected: expectedEpoch, current: currentEpoch };
  checkEpoch(epochToken);
  if (!draft || typeof draft !== "object" || (!draft.transaction && !draft.transactions?.length)) {
    throw new Error("draft.transaction or draft.transactions is required");
  }
  const existingTransactions = await readWorkspaceJson(hostCall, TRANSACTIONS_PATH, epochToken);
  let existingHoldings = null;
  let cacheWarning = null;
  try {
    existingHoldings = await readWorkspaceJson(hostCall, HOLDINGS_PATH, epochToken);
  } catch (error) {
    // A cache that cannot be read is not authority. We cannot safely overwrite
    // it without its conflict token, so commit only transactions and report a
    // rebuild requirement to the caller.
    cacheWarning = {
      code: "holdings-cache-read-failed",
      message: error?.message ?? "holdings cache read failed",
      rebuildRequired: true,
    };
  }

  let ledger;
  if (existingTransactions.exists) {
    if (draft.initialLedger !== undefined) {
      // The caller intends to create the ledger. Appending to a file that
      // appeared meanwhile would silently merge into a ledger the user has
      // never seen; fail closed exactly like the Host's create-only write.
      throw new PortfolioStoreConflictError(
        "portfolio/transactions.json already exists; reload before adding to it",
        draft,
      );
    }
    ledger = parseTransactions(existingTransactions.content).ledger;
  } else {
    if (!draft.initialLedger || typeof draft.initialLedger !== "object") {
      throw new Error("initialLedger is required when creating the portfolio ledger");
    }
    ledger = parseTransactions(`${JSON.stringify(draft.initialLedger)}\n`).ledger;
  }
  const currentFingerprint = existingTransactions.exists ? parseTransactions(existingTransactions.content).fingerprint : null;
  if (expectedFingerprint !== undefined && expectedFingerprint !== currentFingerprint) {
    throw new PortfolioStoreConflictError("账本已变化，请重新读取后再导入", draft);
  }
  const nextLedger = structuredClone(ledger);
  for (const account of [...(draft.accounts ?? []), ...(draft.account ? [draft.account] : [])]) {
    const existingAccount = nextLedger.accounts.find(
      (candidate) => candidate.id === account.id,
    );
    if (existingAccount) {
      if (JSON.stringify(existingAccount) !== JSON.stringify(account)) {
        throw new Error(`account ${account.id} conflicts with the ledger`);
      }
    } else {
      nextLedger.accounts.push(structuredClone(account));
    }
  }
  for (const instrument of [...(draft.instruments ?? []), ...(draft.instrument ? [draft.instrument] : [])]) {
    const existingInstrument = nextLedger.instruments.find(
      (candidate) => candidate.id === instrument.id,
    );
    if (existingInstrument) {
      if (JSON.stringify(existingInstrument) !== JSON.stringify(instrument)) {
        throw new Error(`instrument ${instrument.id} conflicts with the ledger`);
      }
    } else {
      nextLedger.instruments.push(structuredClone(instrument));
    }
  }
  nextLedger.transactions.push(...structuredClone(draft.transactions ?? [draft.transaction]));
  const nextSource = `${JSON.stringify(nextLedger, null, 2)}\n`;
  const parsedNext = parseTransactions(nextSource);
  // Replay and snapshot derivation happen before the authoritative write. A bad
  // transaction therefore cannot leave transactions.json half-accepted.
  const snapshot = deriveHoldingsSnapshot(nextSource, derivationInputs, derivedAt);
  checkEpoch(epochToken);

  const transactionWrite = await verifiedWrite(
    hostCall,
    TRANSACTIONS_PATH,
    nextSource,
    existingTransactions,
    epochToken,
    draft,
  );

  const holdingsSource = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (existingHoldings) {
    try {
      await verifiedWrite(
        hostCall,
        HOLDINGS_PATH,
        holdingsSource,
        existingHoldings,
        epochToken,
        draft,
      );
    } catch (error) {
      // transactions.json is the sole authority and has already been verified.
      // The cache write cannot be rolled back atomically because Host exposes no
      // rename/transaction primitive; return the honest degraded state.
      cacheWarning = {
        code: "holdings-cache-write-failed",
        message: error.message,
        rebuildRequired: true,
      };
    }
  }
  return {
    status: "committed",
    committed: true,
    // cacheStale describes holdings.json only. A snapshot that honestly reports
    // missing FX is still a fresh cache; base availability lives in snapshot.
    cacheStale: cacheWarning !== null,
    frozen: false,
    ledger: parsedNext.ledger,
    fingerprint: parsedNext.fingerprint,
    snapshot,
    cacheWarning,
    modifiedAt: transactionWrite.reread.modifiedAt,
    revision: transactionWrite.reread.revision,
  };
}
