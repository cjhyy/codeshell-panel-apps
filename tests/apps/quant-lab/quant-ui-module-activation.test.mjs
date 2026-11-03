import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createPanelBootstrap } from '../../../apps/quant-lab/app/modules/panel-bootstrap.mjs';
import { createProjectSetting } from '../../../apps/quant-lab/app/modules/project-setting.mjs';

// Execute the production module dispatcher, not a parallel test implementation.
// DOM/rendering and unrelated controllers are adapters; bootstrap and project
// setting storage are the actual browser modules.
const source = await readFile(new URL('../../../apps/quant-lab/app/app.js', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('app.js', source, ts.ScriptTarget.Latest, true);
const dispatcher = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ensureActiveModule').getText(parsed);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture({ configurationBarrier } = {}) {
  const calls = [];
  const saved = { workspaceRoot: '/fixture/project', strategy: { type: 'sma-cross', fast: 17, slow: 61 }, dataPath: 'data/market/TEST.csv' };
  const fields = { fast: 20, slow: 50, dataPath: '' };
  const controller = name => ({ load: async () => { calls.push(name); }, setActive() {} });
  const sandbox = {
    workspaceEpoch: 1, activeModule: 'stock', context: { cwd: '/fixture/project', visible: true },
    holdingsController: { ...controller('holdings'), loadBase: async () => calls.push('base') },
    liveMarketController: controller('live'), aShareSelectionController: controller('selection'),
    selectionSignalLabController: controller('signals'), dataSourcesController: controller('sources'),
    marketInsightsController: controller('insights'), alertsController: controller('alerts'),
    newsController: controller('news'), socialRadarController: controller('social'), notesController: controller('notes'),
    historyDataController: { ...controller('history'), refreshHistorySummaryFromLocal: async () => calls.push('history-status') },
    loadWatchlist: async () => calls.push('watchlist'), updateParameterVisibility() {}, renderDataset() {}, run() {},
    syncSelectionActivity() {}, scheduleBackgroundWatchRestore() {}, renderDataCapabilityMatrix() {}, setTimeout() {},
    async loadConfiguration(scope, storageRoot, epoch) {
      assert.equal(scope, saved.workspaceRoot); assert.equal(storageRoot, scope); assert.equal(epoch, sandbox.workspaceEpoch);
      const setting = createProjectSetting({ key: 'configuration', currentEpoch: () => sandbox.workspaceEpoch,
        getContext: () => ({}), hostCall: async (method, params) => {
          calls.push(`${method}:${params.key}`);
          if (configurationBarrier) await configurationBarrier.promise;
          return saved;
        } });
      const restored = await setting.load();
      Object.assign(fields, { fast: restored.strategy.fast, slow: restored.strategy.slow, dataPath: restored.dataPath });
    },
  };
  const bootstrap = createPanelBootstrap({ currentEpoch: () => sandbox.workspaceEpoch });
  sandbox.bootstrap = bootstrap; bootstrap.open(1);
  return { sandbox, bootstrap, calls, fields, ensure: runInNewContext(`${dispatcher}; ensureActiveModule`, sandbox) };
}

test('cold Stock leaves Research untouched; explicit Research activation restores the saved parameters', async () => {
  const f = fixture();
  await f.ensure();
  assert.deepEqual(f.calls, ['insights']);
  assert.equal(f.fields.fast, 20, 'a hidden, unvisited module has not read project configuration');
  f.sandbox.activeModule = 'research'; await f.ensure();
  assert.deepEqual(f.fields, { fast: 17, slow: 61, dataPath: 'data/market/TEST.csv' });
  assert.equal(f.calls.filter(call => call === 'storage.get:configuration').length, 1);
});

test('same-turn Research→Stock navigation cannot cache Stock work under the Research module key', async () => {
  const gate = deferred(), f = fixture({ configurationBarrier: gate });
  f.sandbox.activeModule = 'research'; const research = f.ensure();
  f.sandbox.activeModule = 'stock'; const stock = f.ensure();
  await stock;
  assert.equal(f.calls.filter(call => call === 'storage.get:configuration').length, 1,
    'the selected Research request must retain its own module identity before the async bootstrap callback');
  assert.equal(f.bootstrap.isReady('research'), false, 'configuration read is still behind the Promise barrier');
  gate.resolve(); await research;
  f.sandbox.activeModule = 'research'; await f.ensure();
  assert.deepEqual(f.fields, { fast: 17, slow: 61, dataPath: 'data/market/TEST.csv' });
  assert.equal(f.calls.filter(call => call === 'storage.get:configuration').length, 1);
});

test('a queued module load does no work after its project epoch closes', async () => {
  const f = fixture();
  const oldProject = f.ensure();
  f.sandbox.workspaceEpoch = 2; f.bootstrap.close(); f.bootstrap.open(2);
  await oldProject;
  assert.deepEqual(f.calls, [], 'the closed project cannot start a loader through the new project bridge');
  await f.ensure();
  assert.deepEqual(f.calls, ['insights']);
});
