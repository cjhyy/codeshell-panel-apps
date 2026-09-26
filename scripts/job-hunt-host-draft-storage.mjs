import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createDraftStorage } from '../apps/job-hunt-hq/app/draft-storage.mjs';
if (process.argv.length !== 3) throw new Error('Usage: node scripts/job-hunt-host-draft-storage.mjs <built-server-package-directory>');
const serverRoot = resolve(process.argv[2]);
assert.equal(JSON.parse(await readFile(join(serverRoot, 'package.json'), 'utf8')).name, '@cjhyy/code-shell-server');
const { PanelRuntimeServices } = await import(pathToFileURL(join(serverRoot, 'dist/panels/runtime-services.js')).href);
const root = await mkdtemp(join(tmpdir(), 'job-hunt-real-storage-'));
try {
  const project = join(root, 'workspace'), other = join(root, 'other');
  await mkdir(project); await mkdir(other);
  let authorized = true;
  const scope = { appId: 'job-hunt-hq', cwd: project, projectPath: project,
    permissions: ['storage'], isAuthorized: async () => authorized };
  const records = new Map();
  const storage = { get length() { return records.size; }, key: i => [...records.keys()][i],
    getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const create = (runtime, bound = scope) => createDraftStorage({
    call: (method, params) => runtime.call(bound, method, params),
    methods: ['storage.getSnapshot', 'storage.compareAndSet'], storage,
    check() {}, randomId: () => randomBytes(16).toString('hex'),
  });
  const dataDir = join(root, 'host');
  const a = create(new PanelRuntimeServices({ dataDir }));
  const b = create(new PanelRuntimeServices({ dataDir }));
  await Promise.all([a.load(), b.load()]); assert.equal(a.owner, b.owner);
  a.retain({ interviewDraft: { answer: 'A' } }); b.retain({ interviewDraft: { answer: 'B' } });
  assert.equal(a.backup().records.length, 2);
  const writes = await Promise.allSettled([a.save({ answer: 'A' }), b.save({ answer: 'B' })]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  const saved = writes[0].status === 'fulfilled' ? 'A' : 'B';
  const restarted = create(new PanelRuntimeServices({ dataDir }));
  assert.equal((await restarted.load()).saved.answer, saved); assert.equal(restarted.owner, a.owner);
  const separate = create(new PanelRuntimeServices({ dataDir }), { ...scope, cwd: other, projectPath: other });
  assert.equal((await separate.load()).recovery, null); assert.notEqual(separate.owner, a.owner);
  // A different cloud runtime may expose exactly the same project path.
  const samePathOtherHost = create(new PanelRuntimeServices({ dataDir: join(root, 'second-host') }));
  assert.equal((await samePathOtherHost.load()).recovery, null); assert.notEqual(samePathOtherHost.owner, a.owner);
  authorized = false;
  await assert.rejects(restarted.save({ answer: 'revoked' }));
  authorized = true;
  assert.equal((await create(new PanelRuntimeServices({ dataDir })).load()).saved.answer, saved);
  console.log('PASS: actual Node Host project identity, competing initialization/writes, distinct writer backups, same-path cloud isolation, restart and revoked writes');
} finally { await rm(root, { recursive: true, force: true }); }
