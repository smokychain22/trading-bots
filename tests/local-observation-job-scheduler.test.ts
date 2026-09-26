import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildStrategyLearningObservationSchedule } from '../src/research/strategy-learning-horizon.js';
import { LocalObservationJobScheduler } from '../src/storage/local-observation-job-scheduler.js';

function scheduledJob() {
  const jobs = buildStrategyLearningObservationSchedule({
    subjectId: 'a'.repeat(64), decisionAt: '2026-09-25T14:30:00Z', decisionSessionDate: '2026-09-25',
    expirationDate: '2026-09-29',
    sessions: [
      { date: '2026-09-25', openAt: '2026-09-25T13:30:00Z', closeAt: '2026-09-25T20:00:00Z', source: 'ALPACA_CALENDAR' },
      { date: '2026-09-28', openAt: '2026-09-28T13:30:00Z', closeAt: '2026-09-28T20:00:00Z', source: 'ALPACA_CALENDAR' },
      { date: '2026-09-29', openAt: '2026-09-29T13:30:00Z', closeAt: '2026-09-29T20:00:00Z', source: 'ALPACA_CALENDAR' },
    ],
    policy: { version: 'theta-strategy-learning-horizons-v1', primaryCommonHorizon: '1H',
      tradingDayTarget: 'SESSION_CLOSE' },
  });
  const job = jobs.find((candidate) => candidate.horizonCode === '15M');
  assert.ok(job);
  return job;
}

test('jobs survive scheduler restart, claim once, and resolve without broker authority', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-observation-jobs-'));
  const path = join(root, 'jobs.sqlite');
  try {
    const first = new LocalObservationJobScheduler(path);
    const scheduled = first.schedule({ job: scheduledJob(), sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40) });
    const replay = first.schedule({ job: scheduledJob(), sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40) });
    assert.deepEqual(replay, scheduled);
    first.close();

    const second = new LocalObservationJobScheduler(path);
    const claims = second.claimDue({ asOf: '2026-09-25T14:45:00Z', claimedBy: 'worker-1',
      claimTtlSeconds: 60 });
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.state, 'IN_PROGRESS');
    assert.equal(second.claimDue({ asOf: '2026-09-25T14:45:30Z', claimedBy: 'worker-2',
      claimTtlSeconds: 60 }).length, 0);
    const resolved = second.resolve({ observationJobId: scheduled.observationJobId, claimedBy: 'worker-1',
      state: 'OBSERVED', resolvedAt: '2026-09-25T14:46:00Z', reasonCode: null });
    assert.equal(resolved.state, 'OBSERVED');
    assert.equal(resolved.brokerAuthority, false);
    second.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('expired claims recover after restart and provider deferral stays typed', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-observation-jobs-'));
  const path = join(root, 'jobs.sqlite');
  try {
    const first = new LocalObservationJobScheduler(path);
    const scheduled = first.schedule({ job: scheduledJob(), sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40) });
    first.claimDue({ asOf: '2026-09-25T14:45:00Z', claimedBy: 'worker-1', claimTtlSeconds: 30 });
    first.close();

    const second = new LocalObservationJobScheduler(path);
    const recovered = second.claimDue({ asOf: '2026-09-25T14:46:00Z', claimedBy: 'worker-2',
      claimTtlSeconds: 30 });
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.attempts, 2);
    const deferred = second.defer({ observationJobId: scheduled.observationJobId, claimedBy: 'worker-2',
      state: 'DEFERRED_PROVIDER', asOf: '2026-09-25T14:46:01Z', reasonCode: 'ALPACA_READ_UNAVAILABLE' });
    assert.equal(deferred.state, 'DEFERRED_PROVIDER');
    assert.equal(deferred.reasonCode, 'ALPACA_READ_UNAVAILABLE');
    assert.equal(second.counts().DEFERRED_PROVIDER, 1);
    second.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('same job identity with changed source lineage fails closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-observation-jobs-'));
  const scheduler = new LocalObservationJobScheduler(join(root, 'jobs.sqlite'));
  try {
    scheduler.schedule({ job: scheduledJob(), sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40) });
    assert.throws(() => scheduler.schedule({ job: scheduledJob(), sourceSha: 'c'.repeat(40),
      workerSha: 'b'.repeat(40) }), /LOCAL_OBSERVATION_JOB_IDENTITY_CONFLICT/);
  } finally { scheduler.close(); rmSync(root, { recursive: true, force: true }); }
});

test('claim boundary rejects malformed clocks and limits before querying the queue', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-observation-jobs-'));
  const scheduler = new LocalObservationJobScheduler(join(root, 'jobs.sqlite'));
  try {
    assert.throws(() => scheduler.claimDue({ asOf: 'not-a-time', claimedBy: 'worker-1', claimTtlSeconds: 30 }),
      /LOCAL_OBSERVATION_JOB_AS_OF_INVALID/);
    assert.throws(() => scheduler.claimDue({ asOf: '2026-09-25T14:45:00Z', claimedBy: 'worker-1',
      claimTtlSeconds: 30, limit: 0 }), /LOCAL_OBSERVATION_JOB_LIMIT_INVALID/);
  } finally { scheduler.close(); rmSync(root, { recursive: true, force: true }); }
});
