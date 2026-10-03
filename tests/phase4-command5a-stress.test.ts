// Phase 4: Command-5A observation scheduler under a large backlog: fresh-checkpoint starvation, duplicate scheduling, exclusive claims, restart, full drain.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildStrategyLearningObservationSchedule } from '../src/research/strategy-learning-horizon.js';
import { LocalObservationJobScheduler } from '../src/storage/local-observation-job-scheduler.js';

const SHA = 'b'.repeat(40);
const sessions = [
  { date: '2026-09-25', openAt: '2026-09-25T13:30:00Z', closeAt: '2026-09-25T20:00:00Z', source: 'ALPACA_CALENDAR' as const },
  { date: '2026-09-28', openAt: '2026-09-28T13:30:00Z', closeAt: '2026-09-28T20:00:00Z', source: 'ALPACA_CALENDAR' as const },
  { date: '2026-09-29', openAt: '2026-09-29T13:30:00Z', closeAt: '2026-09-29T20:00:00Z', source: 'ALPACA_CALENDAR' as const },
];
function job15m(index: number, decisionAt: string) {
  const jobs = buildStrategyLearningObservationSchedule({
    subjectId: createHash('sha256').update(`subject-${index}`).digest('hex'), decisionAt, decisionSessionDate: '2026-09-25', expirationDate: '2026-09-29', sessions,
    policy: { version: 'theta-strategy-learning-horizons-v1', primaryCommonHorizon: '1H', tradingDayTarget: 'SESSION_CLOSE' },
  });
  const job = jobs.find((candidate) => candidate.horizonCode === '15M');
  assert.ok(job);
  return job;
}
const at = (minutes: number) => new Date(Date.parse('2026-09-25T13:40:00Z') + minutes * 60_000).toISOString();

function withScheduler(body: (path: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'theta-c5a-stress-'));
  try { body(join(root, 'jobs.sqlite')); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('a 600-job stale backlog never starves the fresh checkpoints: priority-window claims take current work first, then continue the backlog', () => {
  withScheduler((path) => {
    const scheduler = new LocalObservationJobScheduler(path);
    const stale = Array.from({ length: 600 }, (_, index) => scheduler.schedule({ job: job15m(index, at(index % 60)), sourceSha: SHA, workerSha: SHA }));
    const fresh = Array.from({ length: 12 }, (_, index) => scheduler.schedule({ job: job15m(1000 + index, at(180 + index)), sourceSha: SHA, workerSha: SHA }));
    const freshIds = new Set(fresh.map((receipt) => receipt.observationJobId));
    const lastFresh = fresh[11];
    assert.ok(lastFresh);
    const now = lastFresh.targetAt; // every fresh job is due within the next minutes; the stale ones were due hours earlier
    const asOf = new Date(Date.parse(lastFresh.targetAt) + 30_000).toISOString();
    assert.ok(Date.parse(asOf) > Date.parse(now));
    const claimed = scheduler.claimDue({ asOf, claimedBy: 'worker-1', claimTtlSeconds: 120, limit: 12, priorityTargetWindowSeconds: 3600 });
    assert.equal(claimed.length, 12);
    const freshClaimed = claimed.filter((receipt) => freshIds.has(receipt.observationJobId)).length;
    assert.equal(freshClaimed, 12, `fresh checkpoints must be claimed before the backlog (got ${freshClaimed}/12)`);
    assert.equal(stale.length, 600);
    const next = scheduler.claimDue({ asOf, claimedBy: 'worker-1', claimTtlSeconds: 120, limit: 64, priorityTargetWindowSeconds: 3600 });
    assert.equal(next.length, 64, 'the backlog continues to be worked after the fresh jobs');
    assert.ok(next.every((receipt) => !freshIds.has(receipt.observationJobId)), 'a claimed job is never claimed again while its claim is live');
    scheduler.close();
  });
});

test('duplicate scheduling is idempotent: re-scheduling the same 300 jobs (and restarting) never creates a second job or resets state', () => {
  withScheduler((path) => {
    let scheduler = new LocalObservationJobScheduler(path);
    const first = Array.from({ length: 300 }, (_, index) => scheduler.schedule({ job: job15m(index, at(index % 30)), sourceSha: SHA, workerSha: SHA }));
    const countsBefore = scheduler.counts();
    const asOf = at(400);
    const [claimed] = scheduler.claimDue({ asOf, claimedBy: 'worker-1', claimTtlSeconds: 600, limit: 1 });
    assert.ok(claimed);
    for (let pass = 0; pass < 3; pass += 1) {
      for (let index = 0; index < 300; index += 1) {
        const replay = scheduler.schedule({ job: job15m(index, at(index % 30)), sourceSha: SHA, workerSha: SHA });
        assert.equal(replay.observationJobId, first[index]?.observationJobId);
      }
      scheduler.close();
      scheduler = new LocalObservationJobScheduler(path);
    }
    const counts = scheduler.counts();
    const total = (record: Readonly<Record<string, number>>) => Object.values(record).reduce((sum, value) => sum + value, 0);
    assert.equal(total(counts), total(countsBefore), 'no duplicate job was created');
    assert.equal(scheduler.get(claimed.observationJobId).state, 'IN_PROGRESS', 'a re-schedule never resets a claimed job');
    scheduler.close();
  });
});

test('two workers draining one 400-job backlog in alternation resolve every job exactly once; an expired claim is re-claimable, a live claim is not; restarts lose nothing', () => {
  withScheduler((path) => {
    let scheduler = new LocalObservationJobScheduler(path);
    const jobs = Array.from({ length: 400 }, (_, index) => scheduler.schedule({ job: job15m(index, at(index % 90)), sourceSha: SHA, workerSha: SHA }));
    const resolvedBy = new Map<string, string[]>();
    let clock = Date.parse(at(600));
    // a worker that crashes after claiming 5 jobs: its claims expire and are re-claimed, and the dead worker's late resolve is rejected
    const crashed = scheduler.claimDue({ asOf: new Date(clock).toISOString(), claimedBy: 'worker-crash', claimTtlSeconds: 30, limit: 5 });
    assert.equal(crashed.length, 5);
    assert.equal(scheduler.claimDue({ asOf: new Date(clock + 10_000).toISOString(), claimedBy: 'worker-a', claimTtlSeconds: 30, limit: 128 })
      .some((receipt) => crashed.some((job) => job.observationJobId === receipt.observationJobId)), false, 'a live claim must not be taken');
    clock += 600_000;
    for (let round = 0; round < 200 && (resolvedBy.size < jobs.length); round += 1) {
      const worker = round % 2 === 0 ? 'worker-a' : 'worker-b';
      const batch = scheduler.claimDue({ asOf: new Date(clock).toISOString(), claimedBy: worker, claimTtlSeconds: 30, limit: 40 });
      for (const receipt of batch) {
        const resolved = scheduler.resolve({ observationJobId: receipt.observationJobId, claimedBy: worker, state: 'OBSERVED', resolvedAt: new Date(clock).toISOString(), reasonCode: null });
        assert.equal(resolved.brokerAuthority, false);
        resolvedBy.set(receipt.observationJobId, [...(resolvedBy.get(receipt.observationJobId) ?? []), worker]);
      }
      if (round % 7 === 0) { scheduler.close(); scheduler = new LocalObservationJobScheduler(path); }
      clock += 1_000;
    }
    assert.equal(resolvedBy.size, 400, 'every job was resolved');
    for (const [id, workers] of resolvedBy) assert.equal(workers.length, 1, `job ${id} was resolved ${workers.length} times`);
    assert.throws(() => scheduler.resolve({ observationJobId: crashed[0]?.observationJobId ?? '', claimedBy: 'worker-crash', state: 'OBSERVED', resolvedAt: new Date(clock).toISOString(), reasonCode: null }),
      /CLAIM_OWNER_MISMATCH|STATE|TRANSITION|NOT_/, 'a crashed worker cannot resolve a job another worker already resolved');
    assert.equal(scheduler.counts().OBSERVED, 400);
    scheduler.close();
  });
});
