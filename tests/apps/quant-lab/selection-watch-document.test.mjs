import assert from "node:assert/strict";
import test from "node:test";
import { parseSelectionWatchStorage as normalize } from "../../../apps/quant-lab/app/modules/a-share-selection-ui.mjs";
import {
  readSelectionWatchDocument,
  selectionWatchDocument,
} from "../../../apps/quant-lab/app/modules/selection-watch-document.mjs";

test("supported watch records normalize legacy symbols without losing compatible extension fields", () => {
  for (const version of [undefined, 1, 2]) {
    const source = {
      ...(version === undefined ? {} : { version }),
      custom: { owner: "me" },
      stocks: [
        {
          symbol: "600519",
          name: "stock",
          priority: "focus",
          source: "portfolio",
          note: { text: "keep" },
        },
      ],
      sectors: [{ id: "new_energy", name: "energy", priority: "focus", color: "blue" }],
    };
    const before = structuredClone(source);
    const value = readSelectionWatchDocument(source, normalize);
    const next = normalize({
      ...value,
      stocks: [{ symbol: "SH600519", name: "renamed" }],
      sectors: [{ id: "new_energy", name: "new name" }],
    });
    const document = selectionWatchDocument(source, next, normalize);
    assert.deepEqual(document.custom, source.custom);
    assert.deepEqual(document.stocks, [
      { symbol: "SH600519", name: "renamed", note: { text: "keep" } },
    ]);
    assert.deepEqual(document.sectors, [{ id: "new_energy", name: "new name", color: "blue" }]);
    assert.deepEqual(source, before);
    assert.deepEqual(selectionWatchDocument(source, normalize(null), normalize).stocks, []);
    assert.deepEqual(selectionWatchDocument(source, normalize(null), normalize).sectors, []);
  }
});

test("invalid, future, duplicate and over-capacity documents cannot silently shed records", () => {
  for (const source of [
    false,
    "text",
    [],
    { version: 3 },
    { stocks: null },
    { sectors: {} },
    { stocks: [{ symbol: "invalid" }] },
    { sectors: [{ id: "new_energy" }] },
    { stocks: [{ symbol: "600519" }, { symbol: "SH600519" }] },
    {
      sectors: Array.from({ length: 13 }, (_, i) => ({ id: `new_sector${i}`, name: `sector${i}` })),
    },
  ]) {
    assert.throws(() => readSelectionWatchDocument(source, normalize));
  }
  assert.deepEqual(readSelectionWatchDocument(null, normalize), normalize(null));
  assert.deepEqual(readSelectionWatchDocument({}, normalize), normalize(null));
});
