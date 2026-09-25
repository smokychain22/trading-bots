import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LocalResearchHistorySpool } from '../src/storage/local-research-history-spool.js';

const pythonProbe = spawnSync('python', ['-c', 'import duckdb'], { encoding: 'utf8' });
const testWithDuckDb = pythonProbe.status === 0 ? test : test.skip;

testWithDuckDb('Parquet compaction resumes after interruption without duplicate finalized archives', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-parquet-resume-'));
  const sqlite = join(root, 'research.sqlite');
  const destination = join(root, 'archives');
  const spool = new LocalResearchHistorySpool(sqlite);
  try {
    spool.append({
      batchId: 'batch-1', family: 'CANONICAL_STRATEGY_CANDIDATE_EVIDENCE', sourceSha: 'a'.repeat(40),
      decisionCycleId: 'cycle-1', snapshotId: 'snapshot-1', observedAt: '2026-09-25T14:30:00.000Z',
      rowCount: 1, payload: [{ recordType: 'BRANCH_CANDIDATE', candidateId: 'candidate-1' }],
    });
  } finally { spool.close(); }

  const script = resolve('tools/compact-local-research-spool.py');
  const interrupted = spawnSync('python', [script, '--sqlite', sqlite, '--destination', destination,
    '--simulate-interruption-after-parquet'], { encoding: 'utf8' });
  assert.notEqual(interrupted.status, 0);
  assert.match(interrupted.stderr, /SIMULATED_INTERRUPTION_AFTER_PARQUET/);

  const resumed = spawnSync('python', [script, '--sqlite', sqlite, '--destination', destination],
    { encoding: 'utf8' });
  assert.equal(resumed.status, 0, resumed.stderr);
  const receipt = JSON.parse(resumed.stdout) as Record<string, unknown>;
  assert.equal(receipt.state, 'VERIFIED_PARQUET_ARCHIVE');
  assert.equal(receipt.backlogStart, 1);
  assert.equal(receipt.backlogEnd, 0);
  assert.equal(receipt.backlogMonotonic, true);

  const database = new DatabaseSync(sqlite, { readOnly: true });
  try {
    const row = database.prepare('SELECT storage_state,archived_manifest_hash FROM research_batch').get() as {
      storage_state: string; archived_manifest_hash: string | null;
    };
    assert.equal(row.storage_state, 'ARCHIVED_PARQUET');
    assert.match(row.archived_manifest_hash ?? '', /^[0-9a-f]{64}$/);
  } finally { database.close(); }

  const finalized = readdirSync(destination, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
  assert.equal(finalized.length, 1);
  const again = spawnSync('python', [script, '--sqlite', sqlite, '--destination', destination],
    { encoding: 'utf8' });
  assert.equal(again.status, 0, again.stderr);
  assert.equal((JSON.parse(again.stdout) as Record<string, unknown>).state, 'NO_PENDING_BATCHES');
  rmSync(root, { recursive: true, force: true });
});
