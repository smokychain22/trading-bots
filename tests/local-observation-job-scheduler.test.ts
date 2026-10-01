import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
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

test('primary jobs preserve their factual horizon across scheduler restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-observation-jobs-'));
  const path = join(root, 'jobs.sqlite');
  try {
    const jobs = buildStrategyLearningObservationSchedule({
      subjectId: 'a'.repeat(64), decisionAt: '2026-09-25T14:30:00Z',
      decisionSessionDate: '2026-09-25', expirationDate: '2026-09-29',
      sessions: [{ date: '2026-09-25', openAt: '2026-09-25T13:30:00Z',
        closeAt: '2026-09-25T20:00:00Z', source: 'ALPACA_CALENDAR' }],
      policy: { version: 'theta-strategy-learning-horizons-v1', primaryCommonHorizon: 'EOD',
        tradingDayTarget: 'SESSION_CLOSE' },
    });
    const primary = jobs.find((job) => job.horizonCode === 'PRIMARY_COMMON_HORIZON');
    assert.ok(primary);
    const first = new LocalObservationJobScheduler(path);
    first.schedule({ job: primary, sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40) });
    first.close();
    const second = new LocalObservationJobScheduler(path);
    assert.equal(second.get(primary.observationJobId).derivedFromHorizonCode, 'EOD');
    second.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('scheduler upgrades a legacy job hash without losing its durable state', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-observation-jobs-'));
  const path = join(root, 'jobs.sqlite');
  try {
    const job = scheduledJob();
    const first = new LocalObservationJobScheduler(path);
    first.schedule({ job, sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40) });
    first.close();
    const legacyHash = createHash('sha256').update(canonicalJson({
      observationJobId: job.observationJobId,
      subjectId: job.subjectId,
      horizonCode: job.horizonCode,
      targetAt: new Date(job.targetAt as string).toISOString(),
      targetSessionDate: job.targetSessionDate,
      sourceSha: 'b'.repeat(40),
      workerSha: 'b'.repeat(40),
    })).digest('hex');
    const raw = new DatabaseSync(path);
    raw.prepare(`UPDATE observation_job SET derived_from_horizon_code=NULL,content_hash=?
      WHERE observation_job_id=?`).run(legacyHash, job.observationJobId);
    raw.close();
    const upgraded = new LocalObservationJobScheduler(path);
    const receipt = upgraded.schedule({ job, sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40) });
    assert.equal(receipt.state, 'PENDING');
    assert.equal(receipt.derivedFromHorizonCode, null);
    assert.notEqual(receipt.contentHash, legacyHash);
    upgraded.close();
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
    assert.throws(() => scheduler.claimDue({ asOf: '2026-09-25T14:45:00Z', claimedBy: 'worker-1',
      claimTtlSeconds: 30, priorityTargetWindowSeconds: 0 }),
    /LOCAL_OBSERVATION_JOB_PRIORITY_WINDOW_INVALID/);
  } finally { scheduler.close(); rmSync(root, { recursive: true, force: true }); }
});

test('fresh exact checkpoints are not starved behind an irrecoverable historical backlog', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-observation-jobs-'));
  const scheduler = new LocalObservationJobScheduler(join(root, 'jobs.sqlite'));
  try {
    const makeJob = (subjectId: string, decisionAt: string) => {
      const jobs = buildStrategyLearningObservationSchedule({
        subjectId, decisionAt, decisionSessionDate: '2026-09-25', expirationDate: null,
        sessions: [{ date: '2026-09-25', openAt: '2026-09-25T13:30:00Z',
          closeAt: '2026-09-25T20:00:00Z', source: 'ALPACA_CALENDAR' }],
        policy: { version: 'theta-strategy-learning-horizons-v1', primaryCommonHorizon: '15M',
          tradingDayTarget: 'SESSION_CLOSE' },
      });
      const job = jobs.find((candidate) => candidate.horizonCode === '15M');
      assert.ok(job);
      return job;
    };
    const historical = makeJob('b'.repeat(64), '2026-09-25T13:30:00Z');
    const current = makeJob('c'.repeat(64), '2026-09-25T14:45:00Z');
    scheduler.schedule({ job: historical, sourceSha: 'd'.repeat(40), workerSha: 'd'.repeat(40) });
    scheduler.schedule({ job: current, sourceSha: 'd'.repeat(40), workerSha: 'd'.repeat(40) });

    const first = scheduler.claimDue({ asOf: '2026-09-25T15:00:00Z', claimedBy: 'current-worker',
      claimTtlSeconds: 30, limit: 1, priorityTargetWindowSeconds: 900 });
    assert.equal(first[0]?.observationJobId, current.observationJobId);
    const second = scheduler.claimDue({ asOf: '2026-09-25T15:00:00Z', claimedBy: 'backlog-worker',
      claimTtlSeconds: 30, limit: 1, priorityTargetWindowSeconds: 900 });
    assert.equal(second[0]?.observationJobId, historical.observationJobId,
      'old work must continue draining after the current exact mark is protected');
  } finally { scheduler.close(); rmSync(root, { recursive: true, force: true }); }
});

test('scheduler health exposes overdue, expired, and retry-stalled work without hiding it as empty', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-observation-jobs-'));
  const scheduler = new LocalObservationJobScheduler(join(root, 'jobs.sqlite'));
  try {
    const scheduled = scheduler.schedule({ job: scheduledJob(), sourceSha: 'b'.repeat(40),
      workerSha: 'b'.repeat(40) });
    scheduler.claimDue({ asOf: '2026-09-25T14:45:00Z', claimedBy: 'worker-1', claimTtlSeconds: 30 });
    scheduler.defer({ observationJobId: scheduled.observationJobId, claimedBy: 'worker-1',
      state: 'DEFERRED_PROVIDER', asOf: '2026-09-25T14:45:01Z', reasonCode: 'ALPACA_READ_UNAVAILABLE' });
    scheduler.claimDue({ asOf: '2026-09-25T14:46:00Z', claimedBy: 'worker-2', claimTtlSeconds: 30 });
    const health = scheduler.health({ asOf: '2026-09-25T15:15:00Z',
      overdueWarningSeconds: 1_800, retryStalledAttemptThreshold: 2 });
    assert.equal(health.jobCount, 1);
    assert.equal(health.unresolvedCount, 1);
    assert.equal(health.dueCount, 1);
    assert.equal(health.overdueCount, 1);
    assert.equal(health.expiredClaimCount, 1);
    assert.equal(health.retryStalledCount, 1);
    assert.equal(health.oldestUnresolvedTargetAt, '2026-09-25T14:45:00.000Z');
    assert.equal(health.oldestOverdueSeconds, 1_800);
    assert.equal(health.backlogState, 'RETRY_STALLED');
    assert.equal(health.brokerAuthority, false);
  } finally { scheduler.close(); rmSync(root, { recursive: true, force: true }); }
});

test('scheduler health distinguishes an empty queue from current future work', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-observation-jobs-'));
  const scheduler = new LocalObservationJobScheduler(join(root, 'jobs.sqlite'));
  try {
    assert.equal(scheduler.health({ asOf: '2026-09-25T14:00:00Z' }).backlogState, 'EMPTY');
    scheduler.schedule({ job: scheduledJob(), sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40) });
    const health = scheduler.health({ asOf: '2026-09-25T14:40:00Z' });
    assert.equal(health.backlogState, 'CURRENT');
    assert.equal(health.dueCount, 0);
    assert.equal(health.oldestOverdueSeconds, null);
    assert.equal(health.sourceCursor, null);
  } finally { scheduler.close(); rmSync(root, { recursive: true, force: true }); }
});

test('read-only health inspection does not initialize or mutate the scheduler', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-observation-jobs-'));
  const path = join(root, 'jobs.sqlite');
  try {
    assert.throws(() => new LocalObservationJobScheduler(path, { readOnly: true }));
    const writer = new LocalObservationJobScheduler(path);
    writer.schedule({ job: scheduledJob(), sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40) });
    const reader = new LocalObservationJobScheduler(path, { readOnly: true });
    try {
      assert.equal(reader.health({ asOf: '2026-09-25T14:40:00Z' }).jobCount, 1);
      assert.throws(() => reader.advanceSourceCursor({ readyAt: '2026-09-25T14:00:00Z',
        frontierId: '11111111-1111-4111-8111-111111111111' }));
    } finally { reader.close(); writer.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('frontier source cursor survives restart and can only advance', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-observation-jobs-'));
  const path = join(root, 'jobs.sqlite');
  try {
    const first = new LocalObservationJobScheduler(path);
    assert.equal(first.sourceCursor(), null);
    first.advanceSourceCursor({ readyAt: '2026-09-25T14:00:00Z',
      frontierId: '11111111-1111-4111-8111-111111111111' });
    first.close();
    const second = new LocalObservationJobScheduler(path);
    assert.deepEqual(second.sourceCursor(), { readyAt: '2026-09-25T14:00:00.000Z',
      frontierId: '11111111-1111-4111-8111-111111111111' });
    assert.throws(() => second.advanceSourceCursor({ readyAt: '2026-09-25T13:59:59Z',
      frontierId: '22222222-2222-4222-8222-222222222222' }),
    /LOCAL_OBSERVATION_SOURCE_CURSOR_REGRESSION/);
    second.advanceSourceCursor({ readyAt: '2026-09-25T14:00:00Z',
      frontierId: '22222222-2222-4222-8222-222222222222' });
    assert.equal(second.sourceCursor()?.frontierId, '22222222-2222-4222-8222-222222222222');
    assert.deepEqual(second.health({ asOf: '2026-09-25T14:01:00Z' }).sourceCursor,
      second.sourceCursor());
    second.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
