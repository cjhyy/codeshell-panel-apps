import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDraftBackup, MAX_DRAFT_BACKUP_BYTES } from '../../../apps/job-hunt-hq/app/draft-backup.mjs';
import { compactPanelLocalState } from '../../../apps/job-hunt-hq/app/storage-model.mjs';

test('backup parses each selectable source without importing unrelated state', () => {
  const source = { resumeDraft: { markdown: '# Resume', resumeVersionId: 'foreign' }, profile: { name: 'must not import' } };
  const result = parseDraftBackup(JSON.stringify({ format: 'codeshell.job-hunt.draft-backup', version: 1,
    current: { cwd: '/a', drafts: source }, detached: [{ cwd: '/b', drafts: source }],
    stored: { hostState: source, records: [{ raw: JSON.stringify({ version: 2, owner: 'a'.repeat(32), drafts: source }) }, { raw: '{broken' }] },
    legacyRaw: JSON.stringify({ interviewDraft: { answer: 'Legacy answer', practiceSessionId: 'foreign-session' } }),
  }));
  assert.equal(result.candidates.length, 5);
  assert.equal(result.issues.length, 1);
  assert.equal(result.candidates[0].cwd, '/a');
  assert.equal(result.candidates[1].cwd, '/b');
  assert.equal('profile' in result.candidates[0].drafts, false);
  assert.equal(result.candidates[4].drafts.interviewDraft.answer, 'Legacy answer');
});

test('unknown formats, oversized text and malformed field types cannot be normalized into an import', () => {
  for (const input of [ 'null', '{}', '{broken', JSON.stringify({ format: 'foreign', resumeDraft: { markdown: 'x' } }),
    JSON.stringify({ format: 'codeshell.job-hunt.draft-backup', version: 2 }),
    JSON.stringify({ resumeDraft: { markdown: 'x'.repeat(50001) } }),
    JSON.stringify({ interviewDraft: { answer: { malicious: 'object' } } }),
    ' '.repeat(MAX_DRAFT_BACKUP_BYTES + 1) ]) assert.throws(() => parseDraftBackup(input));
});

test('legacy content remains unassigned, and text-only restoration policy survives Host cache compaction', () => {
  const result = parseDraftBackup(JSON.stringify({ resumeDraft: { markdown: '# Legacy' } }));
  assert.equal(result.candidates[0].owner, ''); assert.equal(result.candidates[0].cwd, '');
  const saved = compactPanelLocalState({ resumeDraft: { markdown: '# Imported', textOnly: true } });
  assert.equal(saved.resumeDraft.textOnly, true);
});
