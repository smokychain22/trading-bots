// The production archive backend contract: one conformance suite run against EVERY backend (in-memory, local filesystem, remote object store over a reference client, and the
// remote backend under injected faults), plus the two-authority purge rule. A real provider adapter is accepted when it passes this same suite.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArchiveBackendError, InMemoryArchiveBackend, LocalFilesystemArchiveBackend } from '../src/storage/data-platform/archive-backend.js';
import { FaultyObjectStoreClient, InMemoryObjectStoreClient, RemoteObjectArchiveBackend, type ProductionArchiveBackend } from '../src/storage/data-platform/archive-remote.js';
import { sha256Hex, type DataPlatformArchiveManifest } from '../src/storage/data-platform/archive-manifest.js';
import { evaluatePurgeDurability, purgeDurabilityCheck } from '../src/storage/data-platform/durability-policy.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const noSleep = async (): Promise<void> => undefined;
const fast = { sleep: noSleep, baseDelayMs: 1, timeoutMs: 40, attempts: 4 };

function conformance(name: string, make: () => { backend: ProductionArchiveBackend; cleanup?: () => void }): void {
  test(`CONTRACT [${name}]: immutable idempotent put, get, head, list, verify, key safety`, async () => {
    const { backend, cleanup } = make();
    try {
      const body = bytes('hello archive');
      const first = await backend.put('data/a/1.archive', body);
      assert.deepEqual([first.created, first.sha256], [true, sha256Hex(body)]);
      const again = await backend.put('data/a/1.archive', body);
      assert.equal(again.created, false, 'the same bytes under the same key are idempotent');
      await assert.rejects(backend.put('data/a/1.archive', bytes('different')), (error: unknown) => error instanceof ArchiveBackendError && error.code === 'ARCHIVE_KEY_CONFLICT');
      assert.deepEqual([...(await backend.get('data/a/1.archive')) as Uint8Array], [...body], 'an existing object is never overwritten');
      assert.equal(await backend.get('data/a/missing.archive'), null);
      assert.equal(await backend.exists('data/a/1.archive'), true);
      assert.equal(await backend.exists('data/a/missing.archive'), false);
      const stat = await backend.head('data/a/1.archive');
      assert.ok(stat !== null && stat.size === body.length && stat.sha256 === sha256Hex(body));
      assert.equal(await backend.head('data/a/missing.archive'), null);
      for (const key of ['data/a/2.archive', 'data/a/3.archive', 'data/b/1.archive']) await backend.put(key, bytes(key));
      assert.deepEqual((await backend.list('data/a/')).map((entry) => entry.key), ['data/a/1.archive', 'data/a/2.archive', 'data/a/3.archive'], 'list by prefix, in key order, across pages');
      assert.equal((await backend.list('data/')).length, 4);
      assert.equal((await backend.verify('data/a/1.archive', sha256Hex(body))).ok, true);
      assert.equal((await backend.verify('data/a/1.archive', sha256Hex(bytes('other')))).reason, 'HASH_MISMATCH_METADATA');
      assert.equal((await backend.verify('data/a/missing.archive', sha256Hex(body))).reason, 'MISSING');
      for (const bad of ['../escape', '/absolute', 'a//b', 'has space', '']) await assert.rejects(backend.put(bad, body), (error: unknown) => error instanceof ArchiveBackendError && error.code === 'ARCHIVE_KEY_INVALID', bad);
      assert.match(backend.identity(), /\S/); assert.match(backend.locate('data/a/1.archive'), /1\.archive/);
    } finally { cleanup?.(); }
  });
}

conformance('IN_MEMORY', () => ({ backend: new InMemoryArchiveBackend() }));
conformance('LOCAL_FILESYSTEM', () => { const root = mkdtempSync(join(tmpdir(), 'theta-archive-contract-')); return { backend: new LocalFilesystemArchiveBackend(root), cleanup: () => rmSync(root, { recursive: true, force: true }) }; });
conformance('REMOTE_OBJECT_STORE', () => ({ backend: new RemoteObjectArchiveBackend(new InMemoryObjectStoreClient('test-bucket'), fast) }));

test('classes: the laptop disk is LOCAL_DISK and never an off-machine copy; the remote backend is REMOTE_OBJECT_STORE', () => {
  assert.equal(new InMemoryArchiveBackend().durabilityClass, 'LOCAL_DISK');
  assert.equal(new RemoteObjectArchiveBackend(new InMemoryObjectStoreClient(), fast).durabilityClass, 'REMOTE_OBJECT_STORE');
});

test('REMOTE retries transient failures with bounded backoff and fails closed after the attempt budget', async () => {
  const flaky = new FaultyObjectStoreClient(new InMemoryObjectStoreClient(), { failFirst: { put: { times: 2, kind: 'THROTTLED' }, head: { times: 1, kind: 'UNAVAILABLE' } } });
  const delays: number[] = [];
  const backend = new RemoteObjectArchiveBackend(flaky, { ...fast, sleep: async (ms) => { delays.push(ms); } });
  assert.equal((await backend.put('k/1', bytes('x'))).created, true);
  assert.equal(flaky.calls.put, 3, 'two throttled attempts then success');
  assert.ok(delays.length >= 3 && (delays[1] ?? 0) >= (delays[0] ?? 0) * 0.9, 'exponential backoff');
  const down = new RemoteObjectArchiveBackend(new FaultyObjectStoreClient(new InMemoryObjectStoreClient(), { failFirst: { put: { times: 99, kind: 'UNAVAILABLE' } } }), fast);
  await assert.rejects(down.put('k/2', bytes('y')), (error: unknown) => error instanceof ArchiveBackendError && error.code === 'ARCHIVE_BACKEND_UNAVAILABLE');
});

test('REMOTE aborts a hung provider call at the timeout instead of stalling', async () => {
  const hung = new RemoteObjectArchiveBackend(new FaultyObjectStoreClient(new InMemoryObjectStoreClient(), { hang: { get: true } }), { ...fast, attempts: 2, timeoutMs: 15 });
  const started = Date.now();
  await assert.rejects(hung.get('k/1'), (error: unknown) => error instanceof ArchiveBackendError && /TIMEOUT/.test(error.message));
  assert.ok(Date.now() - started < 1_000);
});

test('REMOTE detects corruption: a GET whose bytes do not match the recorded hash is an error, never data; verify reports it', async () => {
  const store = new InMemoryObjectStoreClient();
  await new RemoteObjectArchiveBackend(store, fast).put('k/1', bytes('0123456789'));
  const corrupting = new RemoteObjectArchiveBackend(new FaultyObjectStoreClient(store, { corruptGet: true }), fast);
  await assert.rejects(corrupting.get('k/1'), (error: unknown) => error instanceof ArchiveBackendError && error.code === 'ARCHIVE_OBJECT_CORRUPT');
  assert.equal((await corrupting.verify('k/1', sha256Hex(bytes('0123456789')))).reason, 'HASH_MISMATCH_CONTENT');
  // damage inside the store itself (bit rot): metadata still claims the original hash
  const rotted = new InMemoryObjectStoreClient(); const good = new RemoteObjectArchiveBackend(rotted, fast); await good.put('k/2', bytes('abcdef'));
  const object = rotted.objects.get('k/2'); assert.ok(object !== undefined); object.bytes = bytes('abXdef');
  assert.equal((await good.verify('k/2', sha256Hex(bytes('abcdef')))).reason, 'HASH_MISMATCH_CONTENT');
});

test('REMOTE verifies after writing: a provider that acknowledges a put but silently drops it is caught immediately', async () => {
  const dropping = new RemoteObjectArchiveBackend(new FaultyObjectStoreClient(new InMemoryObjectStoreClient(), { dropPut: true }), fast);
  await assert.rejects(dropping.put('k/1', bytes('x')), (error: unknown) => error instanceof ArchiveBackendError && error.code === 'ARCHIVE_WRITE_NOT_VERIFIED');
});

test('REMOTE put is idempotent after a lost acknowledgement and refuses a conflicting overwrite', async () => {
  const store = new InMemoryObjectStoreClient();
  const backend = new RemoteObjectArchiveBackend(store, fast);
  await backend.put('k/1', bytes('same'));
  assert.equal((await backend.put('k/1', bytes('same'))).created, false);
  await assert.rejects(backend.put('k/1', bytes('changed')), (error: unknown) => error instanceof ArchiveBackendError && error.code === 'ARCHIVE_KEY_CONFLICT');
  assert.equal((await store.headObject('k/1'))?.versionId, 'v1', 'the original version is untouched');
});

// ---- the two-authority purge rule -------------------------------------------------------------------------------------------------------------------------------

const manifest = (fileHash: string, createdAt = '2026-10-05T00:00:00Z'): DataPlatformArchiveManifest => ({ archiveId: 'a'.repeat(40), dataset: 'cycle-evidence-blob', partition: '2026-10-05', fileHash, createdAt } as unknown as DataPlatformArchiveManifest);
const keyFor = (m: DataPlatformArchiveManifest): string => `data/${m.dataset}/${m.partition}/${m.fileHash}.archive`;
const dr = (startedAt: string, verified = true) => async () => ({ startedAt, verifiedAt: verified ? '2026-10-06T01:00:00Z' : null });

test('PURGE RULE: primary verified AND a second authority AND an off-machine copy; each missing piece blocks the purge with a named reason', async () => {
  const body = bytes('partition bytes'); const m = manifest(sha256Hex(body));
  const localPrimary = new InMemoryArchiveBackend(); await localPrimary.put(keyFor(m), body);
  const remote = new RemoteObjectArchiveBackend(new InMemoryObjectStoreClient(), fast); await remote.put(keyFor(m), body);
  const remotePrimary = new RemoteObjectArchiveBackend(new InMemoryObjectStoreClient(), fast); await remotePrimary.put(keyFor(m), body);

  // laptop only (local primary + local DR backup): the second authority exists but the laptop is the sole holder
  const laptopOnly = await evaluatePurgeDurability(m, { primary: localPrimary, keyFor, drBackup: dr('2026-10-05T12:00:00Z') });
  assert.equal(laptopOnly.eligible, false); assert.ok(laptopOnly.reasons.some((reason) => reason.startsWith('OFF_MACHINE_COPY_REQUIRED')));
  // local primary + remote second copy: eligible
  const withRemote = await evaluatePurgeDurability(m, { primary: localPrimary, keyFor, secondary: remote, secondaryKeyFor: keyFor });
  assert.equal(withRemote.eligible, true, withRemote.reasons.join('|'));
  // remote primary alone is not enough: a second authority is required
  const remoteAlone = await evaluatePurgeDurability(m, { primary: remotePrimary, keyFor });
  assert.equal(remoteAlone.eligible, false); assert.ok(remoteAlone.reasons.some((reason) => reason.startsWith('SECOND_AUTHORITY_MISSING')));
  // remote primary + verified DR backup newer than the archive: eligible
  assert.equal((await evaluatePurgeDurability(m, { primary: remotePrimary, keyFor, drBackup: dr('2026-10-05T12:00:00Z') })).eligible, true);
  // a DR backup OLDER than the archive does not contain the partition: not a second authority
  assert.equal((await evaluatePurgeDurability(m, { primary: remotePrimary, keyFor, drBackup: dr('2026-10-04T12:00:00Z') })).eligible, false);
  // an unverified DR backup is not an authority
  assert.equal((await evaluatePurgeDurability(m, { primary: remotePrimary, keyFor, drBackup: dr('2026-10-05T12:00:00Z', false) })).eligible, false);
  // a corrupt primary blocks everything
  const rotten = new InMemoryArchiveBackend(); await rotten.put(keyFor(m), bytes('corrupt!!'));
  const corrupt = await evaluatePurgeDurability(m, { primary: rotten, keyFor, secondary: remote, secondaryKeyFor: keyFor });
  assert.equal(corrupt.eligible, false); assert.ok(corrupt.reasons.some((reason) => reason.startsWith('PRIMARY_ARCHIVE_NOT_VERIFIED')));
  // a corrupt second copy is not an authority
  const rottenRemote = new RemoteObjectArchiveBackend(new InMemoryObjectStoreClient(), fast); await rottenRemote.put(keyFor(m), bytes('different content'));
  assert.equal((await evaluatePurgeDurability(m, { primary: localPrimary, keyFor, secondary: rottenRemote, secondaryKeyFor: keyFor })).eligible, false);
  // an unreachable verifier is a failed verification, never a pass
  const unreachable = new RemoteObjectArchiveBackend(new FaultyObjectStoreClient(new InMemoryObjectStoreClient(), { failFirst: { head: { times: 99, kind: 'UNAVAILABLE' } } }), fast);
  const verdict = await evaluatePurgeDurability(m, { primary: localPrimary, keyFor, secondary: unreachable, secondaryKeyFor: keyFor });
  assert.equal(verdict.eligible, false);
  // the explicit development policy can waive the off-machine requirement only when stated
  assert.equal((await evaluatePurgeDurability(m, { primary: localPrimary, keyFor, drBackup: dr('2026-10-05T12:00:00Z'), policy: { requireOffMachineCopy: false } })).eligible, true);
  const check = purgeDurabilityCheck({ primary: localPrimary, keyFor, secondary: remote, secondaryKeyFor: keyFor });
  assert.deepEqual(await check(m), { ok: true, reason: 'TWO_AUTHORITIES_VERIFIED' });
});
