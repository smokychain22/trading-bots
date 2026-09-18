import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { persistLocalDurableEvidence } from '../tools/write-local-durable-evidence.mjs';

async function fixture(root: string, dataset: unknown = { rows: [{ symbol: 'AAPL', chainId: 'chain-1' }] }) {
  const source = join(root, 'source');
  await mkdir(source, { recursive: true });
  const values: Record<string, unknown> = {
    'dataset.json': dataset,
    'manifest.json': { datasetHash: 'a'.repeat(64), schemaVersion: 'v1', featureSetVersion: 'f1', sourceWindow: { start: '2026-09-18T00:00:00Z', end: '2026-09-18T01:00:00Z' } },
    'data-quality.json': { ready: false },
    'handoff.json': { state: 'RESEARCH_ONLY' },
  };
  await Promise.all(Object.entries(values).map(([name, value]) => writeFile(join(source, name), `${JSON.stringify(value)}\n`)));
  return source;
}

test('local durable evidence is content addressed and supports symbols without gaining authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theta-local-evidence-'));
  try {
    const source = await fixture(root);
    const destination = join(root, 'durable');
    const first = await persistLocalDurableEvidence(source, destination);
    const second = await persistLocalDurableEvidence(source, destination);
    assert.equal(second.bundleHash, first.bundleHash);
    const receipt = JSON.parse(await readFile(join(destination, first.path, 'bundle-receipt.json'), 'utf8'));
    assert.equal(receipt.authority, 'RECOVERY_AND_RESEARCH_SUPPORT_ONLY');
    assert.equal(receipt.transactionalAuthority, 'AIVEN');
    assert.equal(receipt.files.length, 4);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local durable evidence rejects secret-shaped keys and connection strings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theta-local-evidence-'));
  try {
    const secretKeySource = await fixture(root, { apiKey: 'must-never-persist' });
    await assert.rejects(persistLocalDurableEvidence(secretKeySource, join(root, 'durable')), /SECRET_KEY_REJECTED/);
    const secretValueSource = await fixture(join(root, 'second'), { note: 'postgresql://user:password@host.invalid/db' });
    await assert.rejects(persistLocalDurableEvidence(secretValueSource, join(root, 'durable-2')), /SECRET_VALUE_REJECTED/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
