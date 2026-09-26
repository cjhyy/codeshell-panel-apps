import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { prepareProjectSnapshotDocuments, hydrateProjectSnapshotDocuments } from '../../../apps/job-hunt-hq/app/snapshot-sharding-model.mjs';
const root = fileURLToPath(new URL('../../../apps/job-hunt-hq/app/', import.meta.url));
let browser, server, url;
before(async () => {
  server = createServer(async (req, res) => {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!path.startsWith(root.replace(/\/$/, '') + sep)) return res.writeHead(403).end();
    try {
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' })[extname(path)] || 'application/octet-stream' });
      res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); });

async function fixture(t, options = {}) {
  const context = await browser.newContext({ acceptDownloads: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const { workspace, ...browserOptions } = options;
  if (workspace) await page.exposeFunction("__workspace", workspace);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.addInitScript(options => {
    const projects = { a: { storage: {}, files: {}, writtenText: {} }, b: { storage: {}, files: {}, writtenText: {} } };
    for (const [id, project] of Object.entries(projects)) {
      project.files['job-hunt-panel.json'] = { schemaVersion: options.schemaVersion ?? 2, updatedAt: '2026-01-01T00:00:00Z',
        jobs: [], versions: [], profile: { name: id },
        resume: { versionId: 'resume-' + id, kind: 'base', title: 'Resume ' + id,
          markdown: '# Resume ' + id, updatedAt: '2026-01-01T00:00:00Z' },
      };
      project.storage['job-hunt-state-v1'] = { localStateVersion: 2,
        interviewDraft: { answer: 'draft-' + id, updatedAt: '2026-01-01T00:00:00Z' },
      };
    }
    let current = 'a'; const listeners = [], calls = [], tools = {};
    const methods = ['storage.getSnapshot', 'storage.compareAndSet'];
    const ctx = () => ({ cwd: '/workspace', sessionId: 'session-' + current, trusted: true, busy: false, availableMethods: methods });
    const snapshot = async (data, key) => {
      if (!(key in data)) return { exists: false, value: null, revision: null };
      const value = structuredClone(data[key]);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
      return { exists: true, value, revision: 'sha256:' + [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') };
    };
    window.__fixture = { projects, calls, tools, switch(id) { current = id; listeners.forEach(fn => fn(ctx())); },
      failRead: options.failRead, failSnapshotBackup: options.failSnapshotBackup, hold: null, release: null };
    window.codeshellPanel = {
      getContext: async () => ctx(), on(event, callback) { if (event === 'context.changed') listeners.push(callback); },
      registerTool(name, handler) { tools[name] = handler; },
      async call(method, params = {}) {
        const id = current, project = projects[id]; calls.push({ id, method, params: structuredClone(params) });
        if (window.__fixture.hold === method) await new Promise(resolve => { window.__fixture.release = resolve; });
        if (method === 'storage.getSnapshot') {
          if (window.__fixture.failRead && params.key === 'job-hunt-state-v1') throw new Error('disk unavailable');
          return snapshot(project.storage, params.key);
        }
        if (method === 'storage.compareAndSet') {
          const before = await snapshot(project.storage, params.key);
          const updated = before.revision === params.expectedRevision;
          if (updated) project.storage[params.key] = structuredClone(params.value);
          return { updated, snapshot: await snapshot(project.storage, params.key) };
        }
        if (method.startsWith('workspace.') && window.__workspace) return window.__workspace(method, params);
        if (method === 'workspace.info') return { name: id, cwd: '/workspace' };
        if (method === 'workspace.list') {
          const prefix = params.path === '.' ? '' : params.path + '/';
          const children = new Map();
          for (const path of Object.keys(project.files)) {
            if (!path.startsWith(prefix)) continue;
            const [name, ...rest] = path.slice(prefix.length).split('/');
            children.set(name, { name, path: prefix + name, kind: rest.length ? 'directory' : 'file' });
          }
          return { entries: [...children.values()] };
        }
        if (method === 'workspace.readText') {
          if (!(params.path in project.files)) throw new Error('ENOENT');
          const record = await snapshot(project.files, params.path);
          const written = project.writtenText[params.path];
          const content = written?.value === JSON.stringify(record.value) ? written.content
            : typeof record.value === 'string' ? record.value : JSON.stringify(record.value);
          return { content, revision: record.revision, modifiedAt: 1 };
        }
        if (method === 'workspace.writeText') {
          if (window.__fixture.failWrites) throw new Error('write unavailable');
          if (window.__fixture.failSnapshotBackup && params.path.startsWith('career-data/panel-backups/')) throw new Error('backup unavailable');
          const previous = await snapshot(project.files, params.path);
          if (params.expectedModifiedAt === null && previous.exists) throw new Error('file already exists');
          if (params.expectedRevision && params.expectedRevision !== previous.revision) throw new Error('revision conflict');
          project.files[params.path] = params.path.endsWith('.txt') ? params.content : JSON.parse(params.content);
          project.writtenText[params.path] = { content: params.content, value: JSON.stringify(project.files[params.path]) };
          if (params.path === 'job-hunt-panel.json' && window.__fixture.loseRootAck) {
            window.__fixture.loseRootAck = false;
            throw new Error('lost root acknowledgement');
          }
          const record = await snapshot(project.files, params.path);
          return { revision: record.revision, modifiedAt: 2 };
        }
        if (method === 'automations.list') return [];
        return null;
      },
    };
    if (options.legacy) localStorage.setItem('job-hunt-critical-drafts-v1', JSON.stringify({
      interviewDraft: { answer: 'foreign-draft', updatedAt: '2099-01-01T00:00:00Z' },
    }));
  }, browserOptions);
  await page.goto(url);
  return page;
}
const ready = page => page.waitForFunction(() => !document.querySelector('.app-shell').inert && document.querySelector('#draft-storage-status').textContent !== '正在连接草稿存储…');
async function backup(page) {
  const download = page.waitForEvent('download'); await page.locator('#download-draft-backup').click();
  return JSON.parse(await readFile(await (await download).path(), 'utf8'));
}

test('same-path project switch reads its own draft and old unowned browser bytes remain exportable', async t => {
  const page = await fixture(t, { legacy: true }); await ready(page);
  let result = await backup(page);
  assert.equal(result.current.drafts.interviewDraft.answer, 'draft-a');
  assert.match(result.legacyRaw, /foreign-draft/);
  await page.evaluate(() => window.__fixture.switch('b')); await ready(page);
  result = await backup(page);
  assert.equal(result.current.drafts.interviewDraft.answer, 'draft-b');
  assert.equal(result.detached[0].drafts.interviewDraft.answer, 'draft-a');
  const owners = await page.evaluate(() => Object.values(window.__fixture.projects).map(p => p.storage['job-hunt-draft-owner-v1'].id));
  assert.notEqual(...owners);
});

test('failed draft read blocks editing and writes; explicit reload recovers', async t => {
  const page = await fixture(t, { failRead: true });
  await page.waitForFunction(() => document.querySelector('#draft-storage-status').textContent.includes('disk unavailable'));
  assert.equal(await page.locator('.app-shell').evaluate(el => el.inert), true);
  assert.equal(await page.evaluate(() => window.__fixture.calls.some(c => c.method === 'storage.compareAndSet' && c.params.key === 'job-hunt-state-v1')), false);
  await page.evaluate(() => { window.__fixture.failRead = false; });
  page.once('dialog', dialog => dialog.accept()); await page.locator('#reload-draft-storage').click(); await ready(page);
  assert.equal((await backup(page)).current.drafts.interviewDraft.answer, 'draft-a');
});

test('late old-project reads cannot replace the new project after a same-path switch', async t => {
  const page = await fixture(t); await ready(page);
  await page.evaluate(() => { window.__fixture.hold = 'workspace.readText'; });
  page.once('dialog', dialog => dialog.accept()); await page.locator('#reload-draft-storage').click();
  await page.waitForFunction(() => Boolean(window.__fixture.release));
  await page.evaluate(() => { window.__fixture.hold = null; window.__fixture.switch('b'); }); await ready(page);
  await page.evaluate(() => window.__fixture.release());
  const result = await backup(page);
  assert.equal(result.current.drafts.interviewDraft.answer, 'draft-b');
  assert.equal(result.current.sessionId, 'session-b');
});

const edit = (page, markdown) => page.evaluate(markdown => {
  const editor = document.querySelector('#resume-editor');
  editor.value = markdown; editor.dispatchEvent(new Event('input', { bubbles: true }));
}, markdown);

test('switching before draft and snapshot timers fire keeps input in its original project', async t => {
  const page = await fixture(t); await ready(page);
  await page.evaluate(() => {
    const editor = document.querySelector('#resume-editor');
    editor.value = '# Unsaved A'; editor.dispatchEvent(new Event('input', { bubbles: true }));
    window.__fixture.switch('b');
  });
  await ready(page);
  // Both former deadlines have elapsed; no old queued write may target B.
  await page.waitForTimeout(600);
  const writes = await page.evaluate(() => window.__fixture.calls.filter(c => c.id === 'b' && ['storage.compareAndSet', 'workspace.writeText'].includes(c.method)));
  assert.equal(writes.some(c => JSON.stringify(c.params).includes('Unsaved A')), false);
  await page.evaluate(() => window.__fixture.switch('a')); await ready(page);
  const content = await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json'].resume.markdown);
  assert.equal(content, '# Unsaved A', 'the original project recovers and saves its own pending draft');
});

test('a snapshot read finishing after a project switch cannot write its old payload into the new project', async t => {
  const page = await fixture(t); await ready(page);
  await page.evaluate(() => { window.__fixture.hold = 'workspace.readText'; });
  await edit(page, '# Delayed snapshot A');
  await page.waitForFunction(() => Boolean(window.__fixture.release));
  await page.evaluate(() => { window.__fixture.hold = null; window.__fixture.switch('b'); }); await ready(page);
  await page.evaluate(() => window.__fixture.release());
  const result = await backup(page);
  assert.equal(result.current.drafts.interviewDraft.answer, 'draft-b');
  const b = await page.evaluate(() => window.__fixture.projects.b);
  assert.equal(b.files['job-hunt-panel.json'].resume.markdown, '# Resume b');
  assert.equal(b.storage['job-hunt-state-v1'].interviewDraft.answer, 'draft-b');
});

test('an in-flight old-project cache acknowledgement cannot mark the new project saved', async t => {
  const page = await fixture(t); await ready(page);
  await page.evaluate(() => { window.__fixture.hold = 'storage.compareAndSet'; });
  await edit(page, '# Pending acknowledgement A');
  await page.waitForFunction(() => Boolean(window.__fixture.release));
  await page.evaluate(() => { window.__fixture.hold = null; window.__fixture.switch('b'); }); await ready(page);
  await page.evaluate(() => window.__fixture.release());
  const result = await backup(page);
  assert.equal(result.current.drafts.interviewDraft.answer, 'draft-b');
  assert.equal(await page.evaluate(() => window.__fixture.projects.b.storage['job-hunt-state-v1'].resumeDraft?.markdown ?? ''), '');
});

test('explicit reread keeps the old draft in backup but does not replay it over the latest project', async t => {
  const page = await fixture(t); await ready(page);
  await edit(page, '# Discarded local draft');
  await page.evaluate(() => {
    window.__fixture.projects.a.storage['job-hunt-state-v1'] = {
      localStateVersion: 2, interviewDraft: { answer: 'latest remote answer', updatedAt: '2026-02-01T00:00:00Z' },
    };
  });
  page.once('dialog', dialog => dialog.accept()); await page.locator('#reload-draft-storage').click(); await ready(page);
  const result = await backup(page);
  assert.equal(result.current.drafts.resumeDraft.markdown, '');
  assert.equal(result.current.drafts.interviewDraft.answer, 'latest remote answer');
  assert.ok(result.detached.some(draft => draft.drafts.resumeDraft.markdown === '# Discarded local draft'));
  assert.equal(await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json'].resume.markdown), '# Resume a');
});

async function importDraft(page, value) {
  await page.locator('#draft-import-file').setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await page.locator('#draft-import-dialog').waitFor({ state: 'visible' });
}

test('reviewed legacy resume import archives the current content and resets foreign identity and evidence', async t => {
  const page = await fixture(t); await ready(page);
  await page.evaluate(() => { window.__fixture.projects.a.files['job-hunt-panel.json'].resume.claimEvidence = [{ claim: 'old claim', status: 'verified' }]; });
  page.once('dialog', d => d.accept()); await page.locator('#reload-draft-storage').click(); await ready(page);
  await importDraft(page, { resumeDraft: { markdown: '# Imported resume', resumeVersionId: 'foreign-id', parentVersionId: 'foreign-parent' }, profile: { name: 'foreign person' } });
  assert.equal(await page.locator('#draft-import-resume-preview').inputValue(), '# Imported resume');
  assert.equal(await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json'].resume.markdown), '# Resume a');
  await page.locator('#draft-import-apply').click();
  await page.waitForFunction(() => !document.querySelector('#draft-import-dialog').open);
  const record = await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json']);
  assert.equal(record.resume.markdown, '# Imported resume');
  assert.notEqual(record.resume.versionId, 'foreign-id');
  assert.equal(record.resume.parentVersionId, 'resume-a');
  assert.deepEqual(record.resume.claimEvidence, []);
  assert.equal(record.profile.name, 'a');
  const saved = await backup(page);
  assert.ok(saved.stored.records.some(r => JSON.parse(r.raw).archived && r.raw.includes('# Resume a')));
});

test('closing import or changing project before confirmation leaves documents untouched', async t => {
  const page = await fixture(t); await ready(page);
  const source = { resumeDraft: { markdown: '# Never applied' } };
  await importDraft(page, source); await page.locator('#draft-import-cancel').click();
  assert.equal(await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json'].resume.markdown), '# Resume a');
  await importDraft(page, source); await page.evaluate(() => window.__fixture.switch('b')); await ready(page);
  assert.equal(await page.locator('#draft-import-dialog').evaluate(el => el.open), false);
  assert.equal(await page.evaluate(() => window.__fixture.projects.b.files['job-hunt-panel.json'].resume.markdown), '# Resume b');
});

test('a competing Host cache update prevents applying an imported draft', async t => {
  const page = await fixture(t); await ready(page);
  await importDraft(page, { resumeDraft: { markdown: '# Conflicting import' } });
  await page.evaluate(() => { window.__fixture.projects.a.storage['job-hunt-state-v1'] = { localStateVersion: 2, interviewDraft: { answer: 'other window' } }; });
  await page.locator('#draft-import-apply').click();
  await page.waitForFunction(() => document.querySelector('#draft-import-error').textContent.includes('其他窗口'));
  assert.equal(await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json'].resume.markdown), '# Resume a');
});

test('answer import requires an explicit local question and never carries its old practice session', async t => {
  const page = await fixture(t); await ready(page);
  await page.evaluate(() => {
    window.__fixture.projects.a.files['job-hunt-panel.json'].questionBank = [{ id: 'question-local', question: '请说明项目数据的完整恢复策略？', status: 'ready', type: 'technical', category: '系统可靠性', competency: '数据恢复', answerPoints: ['保存', '校验', '恢复'], recommendedAnswer: '先验证完整性，再恢复到明确的目标项目。', sourceRefs: ['user:fixture'] }];
  });
  page.once('dialog', d => d.accept()); await page.locator('#reload-draft-storage').click(); await ready(page);
  await importDraft(page, { interviewDraft: { answer: 'Recovered answer', questionId: 'foreign-question', practiceSessionId: 'foreign-session' } });
  await page.locator('#draft-import-apply').click();
  await page.waitForFunction(() => document.querySelector('#draft-import-error').textContent.includes('请选择当前项目'));
  await page.locator('#draft-import-question').selectOption('question-local');
  await page.locator('#draft-import-apply').click();
  await page.waitForFunction(() => !document.querySelector('#draft-import-dialog').open);
  const answer = await page.evaluate(() => window.__fixture.projects.a.storage['job-hunt-state-v1'].interviewDraft);
  assert.equal(answer.questionId, 'question-local');
  assert.equal(answer.practiceSessionId, '');
  assert.equal(answer.answer, 'Recovered answer');
});

test('an imported resume awaiting file persistence recovers without reusing old evidence', async t => {
  const page = await fixture(t); await ready(page);
  await page.evaluate(() => {
    window.__fixture.projects.a.files['job-hunt-panel.json'].resume.claimEvidence = [{ claim: 'old verified text', status: 'verified' }];
  });
  page.once('dialog', d => d.accept()); await page.locator('#reload-draft-storage').click(); await ready(page);
  await importDraft(page, { resumeDraft: { markdown: '# Resume after interrupted import' } });
  await page.evaluate(() => { window.__fixture.failWrites = true; });
  await page.locator('#draft-import-apply').click();
  await page.waitForFunction(() => document.querySelector('#draft-import-error').textContent.includes('尚未同步'));
  assert.equal(await page.evaluate(() => window.__fixture.projects.a.storage['job-hunt-state-v1'].resumeDraft.textOnly), true);
  await page.evaluate(() => { window.__fixture.failWrites = false; window.__fixture.switch('b'); }); await ready(page);
  await page.evaluate(() => window.__fixture.switch('a')); await ready(page);
  const record = await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json'].resume);
  assert.equal(record.markdown, '# Resume after interrupted import');
  assert.deepEqual(record.claimEvidence, []);
});

test('explicit reread preserves damaged browser bytes and reopens the valid Host project', async t => {
  const page = await fixture(t); await ready(page);
  await page.evaluate(() => {
    const owner = window.__fixture.projects.a.storage['job-hunt-draft-owner-v1'].id;
    window.__badDraftKey = 'job-hunt-critical-drafts-v2:' + owner + '.damaged';
    localStorage.setItem(window.__badDraftKey, '{bad browser bytes');
    window.__fixture.switch('b');
  }); await ready(page);
  await page.evaluate(() => window.__fixture.switch('a'));
  await page.waitForFunction(() => document.querySelector('#draft-storage-status').textContent.includes('无法读取'));
  assert.equal(await page.locator('.app-shell').evaluate(el => el.inert), true);
  page.once('dialog', d => d.accept()); await page.locator('#reload-draft-storage').click(); await ready(page);
  assert.equal(await page.evaluate(() => localStorage.getItem(window.__badDraftKey)), '{bad browser bytes');
  const saved = await backup(page);
  assert.ok(saved.stored.records.some(r => r.raw.includes('rawBackup') && r.raw.includes('bad browser bytes')));
});

test('two real pages save independent shard generations, reject a stale root and reopen the winner', { timeout: 90_000 }, async t => {
  const initial = prepareProjectSnapshotDocuments({
    schemaVersion: 2, updatedAt: '2026-01-01T00:00:00Z',
    resume: { versionId: 'large-resume', kind: 'base', title: 'Large project', markdown: '# Original', updatedAt: '2026-01-01T00:00:00Z' },
    questionBank: Array.from({ length: 150 }, (_, i) => ({
      id: `q-${i}`, question: `Explain recovery case ${i}`, notes: 'x'.repeat(3000),
      status: 'inbox', origin: 'manual', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    })),
  }, {}, { generation: 'a' });
  assert.ok(initial.shards.length > 1);
  const files = new Map(initial.shards.map(shard => [shard.path, shard.content]));
  files.set('job-hunt-panel.json', initial.rootContent);
  const writes = [];
  const read = path => {
    if (!files.has(path)) throw new Error('ENOENT');
    const content = files.get(path);
    return { content, modifiedAt: 1, revision: createHash('sha256').update(content).digest('hex') };
  };
  let holdLoser = false, releaseLoser, sawLoser, winnerSaved;
  const winnerCommitted = new Promise(resolve => { winnerSaved = resolve; });
  t.after(() => releaseLoser?.());
  const loserCaptured = new Promise(resolve => { sawLoser = resolve; });
  const workspace = label => async (method, params) => {
    if (method === 'workspace.info') return { name: 'shared-large-project', cwd: '/workspace' };
    if (method === 'workspace.list') {
          const prefix = params.path === '.' ? '' : params.path + '/';
          const children = new Map();
          for (const path of files.keys()) {
            if (!path.startsWith(prefix)) continue;
            const [name, ...rest] = path.slice(prefix.length).split('/');
            children.set(name, { name, path: prefix + name, kind: rest.length ? 'directory' : 'file' });
          }
          return { entries: [...children.values()] };
        }
    if (method === 'workspace.readText') {
      const captured = read(params.path);
      if (label === 'loser' && holdLoser && params.path === 'job-hunt-panel.json') {
        holdLoser = false;
        sawLoser();
        await new Promise(resolve => { releaseLoser = resolve; });
      }
      return captured;
    }
    if (method === 'workspace.writeText') {
      if (params.expectedModifiedAt === null && files.has(params.path)) throw new Error('already exists');
      if (params.expectedRevision && read(params.path).revision !== params.expectedRevision) throw new Error('revision conflict');
      files.set(params.path, params.content);
      writes.push({ label, ...params });
      if (label === 'winner' && params.path === 'job-hunt-panel.json') winnerSaved();
      return read(params.path);
    }
    throw new Error(`unexpected workspace method ${method}`);
  };
  const winner = await fixture(t, { workspace: workspace('winner') }); await ready(winner);
  await winner.waitForFunction(() => document.querySelector('#resume-editor').value === '# Original');
  const loser = await fixture(t, { workspace: workspace('loser') }); await ready(loser);
  await loser.waitForFunction(() => document.querySelector('#resume-editor').value === '# Original');
  holdLoser = true;
  await edit(loser, '# Losing edit');
  await Promise.race([loserCaptured, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('loser never read root')), 5_000); timer.unref(); })]);
  await edit(winner, '# Winning edit');
  // Backup reads/writes use the production 12-call/10.1s pacing; allow
  // both backup passes while keeping the actual successful root write as
  // the only event that releases the competing writer.
  await Promise.race([winnerCommitted, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('winner never committed')), 30_000); timer.unref(); })]).catch(async error => {
    console.error({ writes: writes.map(w => ({ label: w.label, path: w.path })), status: await winner.locator('#project-snapshot-state').textContent(), error: await winner.locator('#project-snapshot-error').textContent(), calls: await winner.evaluate(() => window.__fixture.calls.slice(-8).map(c => ({ method: c.method, path: c.params.path }))) });
    throw error;
  });
  const committed = read('job-hunt-panel.json').content;
  releaseLoser();
  await loser.waitForFunction(() => document.querySelector('#project-snapshot-state').textContent.includes('发现外部更新'), null, { timeout: 30_000 }).catch(async error => {
    console.error({ writes: writes.map(w => ({ label: w.label, path: w.path })), status: await loser.locator('#project-snapshot-state').textContent(), error: await loser.locator('#project-snapshot-error').textContent(), calls: await loser.evaluate(() => window.__fixture.calls.slice(-8)) });
    throw error;
  });
  assert.equal(read('job-hunt-panel.json').content, committed);
  const winningGeneration = JSON.parse(committed).artifactStorage.generation;
  assert.match(winningGeneration, /^g-[0-9a-f]{32}$/);
  const losingShards = writes.filter(write => write.label === 'loser' && write.path.startsWith('career-data/panel-shards/') && !write.path.endsWith('previous-root.json'));
  assert.ok(losingShards.length > 0);
  assert.ok(losingShards.every(write => !write.path.includes(winningGeneration) && write.expectedModifiedAt === null));
  assert.ok(writes.some(write => write.path.endsWith('/previous-root.json') && write.content === initial.rootContent));
  const original = hydrateProjectSnapshotDocuments(initial.root, new Map([...files].filter(([path]) => !path.endsWith('.txt')).map(([path, content]) => [path, JSON.parse(content)])));
  assert.equal(original.questionBank.length, 150);
  assert.equal(original.resume.markdown, '# Original');
  const reopened = await fixture(t, { workspace: workspace('reopened') }); await ready(reopened);
  assert.equal(await reopened.locator('#resume-editor').inputValue(), '# Winning edit');
  assert.equal(writes.some(write => write.label === 'reopened'), false, 'reopening a valid generation does not rewrite it');
});


test('opening a v1 root completes migration even without a user edit', async t => {
  const page = await fixture(t, { schemaVersion: 1 }); await ready(page);
  assert.equal(await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json'].schemaVersion), 2);
  const recovered = await page.evaluate(async () => {
    const files = window.__fixture.projects.a.files;
    const path = Object.keys(files).find(path => path.startsWith('career-data/panel-backups/') && path.endsWith('/manifest.json'));
    const { readSnapshotBackup } = await import('./snapshot-backup.mjs');
    return readSnapshotBackup(path, { scope: { check() {}, call: (...args) => window.codeshellPanel.call(...args) } });
  });
  assert.equal(recovered.root.schemaVersion, 1);
  assert.equal(recovered.root.resume.markdown, '# Resume a');
  assert.equal(recovered.root.profile.name, 'a');
});


test('failed migration backup preserves v1 and explicit retry still completes migration', async t => {
  const page = await fixture(t, { schemaVersion: 1, failSnapshotBackup: true }); await ready(page);
  assert.equal(await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json'].schemaVersion), 1);
  assert.match(await page.locator('#project-snapshot-error').textContent(), /backup unavailable/);
  await page.evaluate(() => { window.__fixture.failSnapshotBackup = false; document.querySelector('#save-project-snapshot').click(); });
  await page.waitForFunction(() => window.__fixture.projects.a.files['job-hunt-panel.json'].schemaVersion === 2);
  assert.ok(await page.evaluate(() => Object.keys(window.__fixture.projects.a.files).some(path => path.endsWith('/manifest.json'))));
});

async function seedRecoveryBackup(page) {
  return page.evaluate(async () => {
    const { createSnapshotBackup } = await import('/snapshot-backup.mjs');
    const scope = { check() {}, call: (...args) => window.codeshellPanel.call(...args) };
    const result = await createSnapshotBackup({ content: JSON.stringify({ schemaVersion: 2,
      jobs: [{ id: 'restored-job', company: 'Example' }], resume: { versionId: 'backup-resume', markdown: '# Restored backup', updatedAt: '2020-01-01T00:00:00Z' } }) }, { scope });
    return result.path;
  });
}
async function chooseRecovery(page, path) {
  await page.locator('#snapshot-recovery-open').click();
  await page.waitForFunction(() => !document.querySelector('#snapshot-recovery-source').disabled);
  await page.locator('#snapshot-recovery-source').selectOption(path);
  await page.waitForFunction(() => !document.querySelector('#snapshot-recovery-review').disabled);
  assert.equal(await page.locator('#snapshot-recovery-apply').isEnabled(), true, await page.locator('#snapshot-recovery-status').textContent());
}
async function finishRecovery(page) {
  await page.locator('#snapshot-recovery-apply').click();
  await page.waitForFunction(() => document.querySelector('#snapshot-recovery-status').textContent.startsWith('项目快照已恢复。'));
  await ready(page);
  await page.waitForFunction(() => !document.querySelector('#snapshot-recovery-close').disabled);
}

test('actual restore UI previews, preserves current data, rejects stale drafts and accepts new edits after reopening', { timeout: 90000 }, async t => {
  const page = await fixture(t); await ready(page);
  const path = await seedRecoveryBackup(page);
  await page.evaluate(() => {
    const host = window.__fixture.projects.a;
    host.storage['job-hunt-state-v1'].resumeDraft = { markdown: '# Stale future draft', updatedAt: '2099-01-01T00:00:00Z' };
    const owner = host.storage['job-hunt-draft-owner-v1'].id;
    localStorage.setItem('job-hunt-critical-drafts-v2:' + owner + '.foreign-writer', JSON.stringify({
      version: 2, owner, savedAt: 9999999999999, drafts: { resumeDraft: { markdown: '# Stale browser future', updatedAt: '2099-01-01T00:00:00Z' } },
    }));
  });
  await chooseRecovery(page, path);
  assert.match(await page.locator('#snapshot-recovery-preview').textContent(), /Restored backup/);
  assert.equal(await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json'].resume.markdown), '# Resume a');
  if (process.env.JOB_HUNT_RECOVERY_SCREENSHOT) await page.screenshot({ path: process.env.JOB_HUNT_RECOVERY_SCREENSHOT, fullPage: true });
  await finishRecovery(page);
  await page.locator('#snapshot-recovery-close').click();
  const restored = await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json']);
  assert.equal(restored.resume.markdown, '# Restored backup');
  assert.match(restored.snapshotRestoreId, /^g-[a-f0-9]{32}$/);
  assert.equal((await backup(page)).current.drafts.resumeDraft.markdown, '');
  await page.evaluate(() => window.__fixture.switch('b')); await ready(page);
  assert.equal(await page.evaluate(() => window.__fixture.projects.b.files['job-hunt-panel.json'].resume.markdown), '# Resume b');
  await page.evaluate(() => window.__fixture.switch('a')); await ready(page);
  assert.equal(await page.locator('#resume-editor').inputValue(), '# Restored backup');
  await edit(page, '# New post-restore edit');
  await page.waitForFunction(() => window.__fixture.projects.a.files['job-hunt-panel.json'].resume.markdown === '# New post-restore edit');
  await page.waitForFunction(() => window.__fixture.projects.a.storage['job-hunt-state-v1'].snapshotRestoreId === window.__fixture.projects.a.files['job-hunt-panel.json'].snapshotRestoreId);
  const originals = await page.evaluate(() => Object.values(window.__fixture.projects.a.files).filter(v => v?.reason === 'retired-drafts'));
  assert.equal(originals.length, 1, 'the old Host cache is archived before replacement');
  await page.evaluate(() => window.__fixture.switch('b')); await ready(page);
  await page.evaluate(() => window.__fixture.switch('a')); await ready(page);
  assert.equal(await page.locator('#resume-editor').inputValue(), '# New post-restore edit');
});

test('recovery UI preserves a corrupt primary file verbatim and exports the archived drafts', { timeout: 90000 }, async t => {
  const page = await fixture(t); await ready(page);
  const path = await seedRecoveryBackup(page);
  await page.evaluate(() => { window.__fixture.projects.a.files['job-hunt-panel.json'] = '{broken original 中🙂\n'; });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#reload-draft-storage').click(); await ready(page);
  assert.match(await page.locator('#project-snapshot-error').textContent(), /无法读取/);
  await chooseRecovery(page, path);
  assert.match(await page.locator('#snapshot-recovery-status').textContent(), /主文件损坏/);
  await finishRecovery(page);
  const preservedPath = await page.evaluate(() => Object.entries(window.__fixture.projects.a.files).find(([path, value]) => path.endsWith('manifest.json') && value.reason === 'before-restore')[0]);
  await page.locator('#snapshot-recovery-refresh').click();
  await page.waitForFunction(() => !document.querySelector('#snapshot-recovery-source').disabled);
  await page.locator('#snapshot-recovery-source').selectOption(preservedPath);
  await page.waitForFunction(() => !document.querySelector('#snapshot-recovery-download').disabled);
  assert.equal(await page.locator('#snapshot-recovery-apply').isEnabled(), false);
  const downloaded = page.waitForEvent('download'); await page.locator('#snapshot-recovery-download').click();
  assert.equal(await readFile(await (await downloaded).path(), 'utf8'), '{broken original 中🙂\n');
  const drafts = page.waitForEvent('download'); await page.locator('#snapshot-recovery-drafts').click();
  const saved = JSON.parse(await readFile(await (await drafts).path(), 'utf8'));
  assert.equal(saved.format, 'codeshell.job-hunt.draft-backup');
  assert.equal(saved.current.drafts.interviewDraft.answer, 'draft-a');
});

test('recovery preview cannot authorize a changed project or survive a project switch', async t => {
  const page = await fixture(t); await ready(page);
  const path = await seedRecoveryBackup(page);
  await chooseRecovery(page, path);
  await page.evaluate(() => { window.__fixture.projects.a.files['job-hunt-panel.json'].resume.markdown = '# Other writer'; });
  await page.locator('#snapshot-recovery-apply').click();
  await page.waitForFunction(() => document.querySelector('#snapshot-recovery-status').textContent.includes('项目已变化'));
  assert.equal(await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json'].resume.markdown), '# Other writer');
  await page.locator('#snapshot-recovery-close').click();
  await chooseRecovery(page, path);
  await page.evaluate(() => window.__fixture.switch('b')); await ready(page);
  assert.equal(await page.locator('#snapshot-recovery-apply').isEnabled(), false);
  assert.match(await page.locator('#snapshot-recovery-status').textContent(), /项目已切换/);
  assert.equal(await page.evaluate(() => window.__fixture.projects.b.files['job-hunt-panel.json'].resume.markdown), '# Resume b');
});

test('failed preservation blocks UI restore; retry can verify a lost successful root acknowledgement', { timeout: 90000 }, async t => {
  const page = await fixture(t); await ready(page);
  const path = await seedRecoveryBackup(page);
  await chooseRecovery(page, path);
  await page.evaluate(() => { window.__fixture.failSnapshotBackup = true; });
  await page.locator('#snapshot-recovery-apply').click();
  await page.waitForFunction(() => document.querySelector('#snapshot-recovery-status').textContent.includes('backup unavailable'));
  assert.equal(await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json'].resume.markdown), '# Resume a');
  await page.evaluate(() => { window.__fixture.failSnapshotBackup = false; window.__fixture.loseRootAck = true; });
  await page.locator('#snapshot-recovery-review').click();
  await page.waitForFunction(() => !document.querySelector('#snapshot-recovery-apply').disabled);
  await finishRecovery(page);
  const rootWrites = await page.evaluate(() => window.__fixture.calls.filter(c => c.method === 'workspace.writeText' && c.params.path === 'job-hunt-panel.json'));
  assert.equal(rootWrites.length, 1);
});

test('downloaded portable backup can be reviewed and restored through the file picker', { timeout: 90000 }, async t => {
  const page = await fixture(t); await ready(page);
  const path = await seedRecoveryBackup(page);
  await chooseRecovery(page, path);
  const downloaded = page.waitForEvent('download'); await page.locator('#snapshot-recovery-download').click();
  const source = await readFile(await (await downloaded).path());
  await page.locator('#snapshot-recovery-close').click();
  await page.locator('#snapshot-recovery-open').click();
  await page.waitForFunction(() => !document.querySelector('#snapshot-recovery-file').disabled);
  await page.locator('#snapshot-recovery-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: source });
  await page.waitForFunction(() => !document.querySelector('#snapshot-recovery-apply').disabled);
  await finishRecovery(page);
  assert.equal(await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json'].resume.markdown), '# Restored backup');
});

test('late old-project restore cannot clear a new preview or write the new project', { timeout: 90000 }, async t => {
  const page = await fixture(t); await ready(page);
  const path = await seedRecoveryBackup(page);
  await chooseRecovery(page, path);
  await page.evaluate(() => { window.__fixture.hold = 'workspace.writeText'; });
  await page.locator('#snapshot-recovery-apply').click();
  await page.waitForFunction(() => Boolean(window.__fixture.release));
  await page.evaluate(() => { window.__fixture.hold = null; window.__fixture.switch('b'); });
  await ready(page);
  const pathB = await seedRecoveryBackup(page);
  await page.locator('#snapshot-recovery-refresh').click();
  await page.waitForFunction(() => !document.querySelector('#snapshot-recovery-source').disabled);
  await page.locator('#snapshot-recovery-source').selectOption(pathB);
  await page.waitForFunction(() => !document.querySelector('#snapshot-recovery-apply').disabled);
  await page.evaluate(() => window.__fixture.release());
  await page.waitForTimeout(100);
  await finishRecovery(page);
  assert.equal(await page.evaluate(() => window.__fixture.projects.b.files['job-hunt-panel.json'].resume.markdown), '# Restored backup');
  assert.equal(await page.evaluate(() => window.__fixture.projects.a.files['job-hunt-panel.json'].resume.markdown), '# Resume a');
  const writes = await page.evaluate(() => window.__fixture.calls.filter(c => c.method === 'workspace.writeText' && c.params.path === 'job-hunt-panel.json'));
  assert.deepEqual(writes.map(w => w.id), ['b']);
});
