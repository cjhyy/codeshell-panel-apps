import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
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
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.addInitScript(options => {
    const projects = { a: { storage: {}, files: {} }, b: { storage: {}, files: {} } };
    for (const [id, project] of Object.entries(projects)) {
      project.files['job-hunt-panel.json'] = { schemaVersion: 2, updatedAt: '2026-01-01T00:00:00Z',
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
      failRead: options.failRead, hold: null, release: null };
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
        if (method === 'workspace.info') return { name: id, cwd: '/workspace' };
        if (method === 'workspace.list') return { entries: [] };
        if (method === 'workspace.readText') {
          if (!(params.path in project.files)) throw new Error('ENOENT');
          const record = await snapshot(project.files, params.path);
          return { content: JSON.stringify(record.value), revision: record.revision, modifiedAt: 1 };
        }
        if (method === 'workspace.writeText') {
          project.files[params.path] = JSON.parse(params.content);
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
  }, options);
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
