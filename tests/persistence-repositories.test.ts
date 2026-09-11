import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InMemoryFusionSnapshotRepository,
  InMemoryManagementDecisionReceiptRepository,
  InMemoryLifecycleEpisodeRepository,
  InMemorySchedulerCheckpointRepository,
} from '../src/theta/persistence-repositories-memory.js';

const NOW = new Date().toISOString();

test('FusionSnapshotRepository round-trips by id and by content hash', async () => {
  const repo = new InMemoryFusionSnapshotRepository();
  await repo.save({
    fusionSnapshotId: 'fs-1', botInstanceId: 'bot-1', decisionTime: NOW, triggerType: 'SCHEDULED',
    contentHash: 'a'.repeat(64), snapshotJson: {}, unknownFeatures: [],
  });
  assert.ok((await repo.findById('fs-1')) !== null);
  assert.ok((await repo.findByContentHash('bot-1', 'a'.repeat(64))) !== null);
  assert.equal(await repo.findByContentHash('bot-1', 'b'.repeat(64)), null);
});

test('ManagementDecisionReceiptRepository finds records by chain', async () => {
  const repo = new InMemoryManagementDecisionReceiptRepository();
  await repo.save({
    decisionId: 'd1', fusionSnapshotId: 'fs-1', chainId: 'chain-1', lifecycleStateAtDecision: 'CSP_OPEN',
    route: 'SHORT_PUT', selectedAction: 'CLOSE', holdAdvantage: -20, valuationsJson: [], aegisState: 'ALLOW_FULL',
    executionQualityAcceptable: true, failClosedReason: null, policyVersion: 'v1', modelVersions: { management: 'v1' },
    decidedAt: NOW,
  });
  await repo.save({
    decisionId: 'd2', fusionSnapshotId: 'fs-1', chainId: 'chain-2', lifecycleStateAtDecision: 'CC_OPEN',
    route: 'COVERED_CALL', selectedAction: 'HOLD_CC', holdAdvantage: null, valuationsJson: [], aegisState: 'ALLOW_FULL',
    executionQualityAcceptable: null, failClosedReason: null, policyVersion: 'v1', modelVersions: { management: 'v1' },
    decidedAt: NOW,
  });
  const chain1Records = await repo.findByChain('chain-1');
  assert.equal(chain1Records.length, 1);
  assert.equal(chain1Records[0].decisionId, 'd1');
});

test('LifecycleEpisodeRepository tracks open episodes and applies transitions', async () => {
  const repo = new InMemoryLifecycleEpisodeRepository();
  await repo.save({ chainId: 'chain-1', botInstanceId: 'bot-1', underlying: 'SPY', lifecycleState: 'CSP_OPEN', openedAt: NOW, closedAt: null });
  await repo.save({ chainId: 'chain-2', botInstanceId: 'bot-1', underlying: 'QQQ', lifecycleState: 'CLOSED', openedAt: NOW, closedAt: NOW });

  const open = await repo.findOpenByBotInstance('bot-1');
  assert.equal(open.length, 1);
  assert.equal(open[0].chainId, 'chain-1');

  await repo.appendTransition('chain-1', 'BTC_CLOSE', NOW);
  const updated = await repo.findById('chain-1');
  assert.equal(updated?.lifecycleState, 'BTC_CLOSE');
  assert.equal(updated?.closedAt, null);

  await repo.appendTransition('chain-1', 'CLOSED', NOW);
  const closed = await repo.findById('chain-1');
  assert.equal(closed?.closedAt, NOW);
});

test('appendTransition on an unknown chain throws rather than silently creating one', async () => {
  const repo = new InMemoryLifecycleEpisodeRepository();
  await assert.rejects(() => repo.appendTransition('does-not-exist', 'CLOSED', NOW));
});

test('SchedulerCheckpointRepository lease acquisition is mutually exclusive between owners', async () => {
  const repo = new InMemorySchedulerCheckpointRepository();
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(await repo.tryAcquireLease('job-1', 'owner-a', future), true);
  assert.equal(await repo.tryAcquireLease('job-1', 'owner-b', future), false);
});

test('a released lease can be re-acquired by a different owner', async () => {
  const repo = new InMemorySchedulerCheckpointRepository();
  const future = new Date(Date.now() + 60_000).toISOString();
  await repo.tryAcquireLease('job-1', 'owner-a', future);
  await repo.releaseLease('job-1', 'owner-a');
  assert.equal(await repo.tryAcquireLease('job-1', 'owner-b', future), true);
});

test('an expired lease is reported by findExpiredLeases and can be re-acquired', async () => {
  const repo = new InMemorySchedulerCheckpointRepository();
  const past = new Date(Date.now() - 60_000).toISOString();
  await repo.tryAcquireLease('job-1', 'owner-a', past);
  const expired = await repo.findExpiredLeases(new Date().toISOString());
  assert.equal(expired.length, 1);
  assert.equal(expired[0].jobId, 'job-1');
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(await repo.tryAcquireLease('job-1', 'owner-b', future), true);
});

test('releasing a lease you do not own is a silent no-op, never a forced takeover', async () => {
  const repo = new InMemorySchedulerCheckpointRepository();
  const future = new Date(Date.now() + 60_000).toISOString();
  await repo.tryAcquireLease('job-1', 'owner-a', future);
  await repo.releaseLease('job-1', 'owner-b');
  const record = await repo.findById('job-1');
  assert.equal(record?.status, 'LEASED');
  assert.equal(record?.leaseOwner, 'owner-a');
});
