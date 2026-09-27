import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  runCommand5aLocalObservationWorker,
  type Command5aReadOnlyObservationSource,
} from '../src/research/command5a-local-observation-worker.js';
import { buildShadowEpisodeContract } from '../src/research/shadow-episode-contract.js';
import { buildStrategyLearningObservationSchedule } from '../src/research/strategy-learning-horizon.js';
import type { SeriousCandidateSubject } from '../src/research/serious-subject-policy.js';
import { LocalObservationJobScheduler } from '../src/storage/local-observation-job-scheduler.js';
import { LocalResearchHistorySpool } from '../src/storage/local-research-history-spool.js';

const optionSymbol = 'SPY261120P00500000';
const subject: SeriousCandidateSubject = {
  subjectId: 'a'.repeat(64), kind: 'CANDIDATE', snapshotId: 'snapshot-1',
  decisionAt: '2026-09-25T14:30:00Z', decisionBucketAt: '2026-09-25T14:00:00Z',
  candidateId: 'candidate-1', branch: 'THETA_CONVENTIONAL', rankAtDecision: 1, selected: true,
  selectionReasons: ['CANONICAL_SELECTED'],
  candidate: {
    candidateId: 'candidate-1', branch: 'THETA_CONVENTIONAL', action: 'OPEN_CSP', underlying: 'SPY',
    legs: [{ positionIntent: 'SELL_TO_OPEN', optionSymbol, optionType: 'PUT', strike: 500,
      expiration: '2026-11-20', multiplier: 100, bid: 2, ask: 2.1,
      quoteTimestamp: '2026-09-25T14:29:59Z' }],
    dte: 56, delta: -0.2, moneyness: 0.91, spreadPct: 0.05,
    liquidity: { volume: 10, openInterest: 100 },
    economics: { premiumPerShare: 2, grossPremium: 200, collateral: 50_000, maxProfit: 200,
      maxLoss: 49_800, breakEven: 498, downsideCushion: 0.1, retainedUpside: null,
      callAwayProceeds: null, wholeChainPnlAtCallAway: null, capitalDayYield: 0.001,
      expectedAfterCostEv: null },
    assignmentCapacityQty: 1, aegisState: 'ALLOW_FULL', hardBlockers: [], softEvidence: [],
    unknownEvidence: [], structurallyFeasible: true, riskFeasible: true,
    sizing: { quantity: 1, bindingConstraint: 'BROKER', reasons: [] }, paretoRank: 1,
    dominatedBy: [], executionAuthorized: false,
  },
  subjectSelectionPolicyVersion: 'theta-serious-subject-selection-v1', shadowOnly: true,
  brokerAuthority: false, orderSubmitted: false, brokerFill: false,
};

function setup(root: string) {
  const scheduler = new LocalObservationJobScheduler(join(root, 'jobs.sqlite'));
  const episode = buildShadowEpisodeContract({ subject, decisionId: 'decision-1',
    featureSnapshotHash: 'b'.repeat(64), strategyVersion: 'strategy-v1', riskVersion: 'risk-v1',
    frontierContentHash: 'd'.repeat(64), optionomicsContextHash: 'e'.repeat(64),
    costVersion: 'cost-v1', executionModelVersion: 'execution-v1', sourceSha: 'c'.repeat(40),
    workerSha: 'c'.repeat(40) });
  scheduler.registerSubject({ decisionCycleId: 'cycle-1', underlying: 'SPY', episode });
  const jobs = buildStrategyLearningObservationSchedule({ subjectId: subject.subjectId,
    decisionAt: subject.decisionAt, decisionSessionDate: '2026-09-25', expirationDate: '2026-11-20',
    sessions: [{ date: '2026-09-25', openAt: '2026-09-25T13:30:00Z',
      closeAt: '2026-09-25T20:00:00Z', source: 'ALPACA_CALENDAR' }],
    policy: { version: 'theta-strategy-learning-horizons-v1', primaryCommonHorizon: '15M',
      tradingDayTarget: 'SESSION_CLOSE' } });
  const job = jobs.find((row) => row.horizonCode === '15M');
  assert.ok(job);
  scheduler.schedule({ job, sourceSha: episode.sourceSha, workerSha: episode.workerSha });
  return { scheduler, job };
}

function readySource(): Command5aReadOnlyObservationSource {
  return {
    brokerAuthority: false,
    async marketState() { return { providerAvailable: true, marketSessionOpen: true }; },
    async observe() {
      return { state: 'READY', observedAt: '2026-09-25T14:46:00Z', reasonCode: null,
        quotes: [{ optionSymbol, bid: 2.2, ask: 2.3, providerTimestamp: '2026-09-25T14:45:59Z',
          receivedAt: '2026-09-25T14:46:00Z', impliedVolatility: 0.21, delta: -0.2,
          gamma: 0.01, theta: -0.03, vega: 0.1, provider: 'ALPACA', feed: 'INDICATIVE',
          quality: 'GOOD', reasonCodes: [] }],
        underlying: { symbol: 'SPY', price: 550, providerTimestamp: '2026-09-25T14:45:58Z',
          receivedAt: '2026-09-25T14:46:00Z', provider: 'ALPACA', purpose: 'RESEARCH_REFERENCE_ONLY' } };
    },
  };
}

test('real market observation archives before OBSERVED resolution and remains mutation-free', async () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-worker-'));
  const spoolPath = join(root, 'research.sqlite');
  try {
    const { scheduler, job } = setup(root);
    const report = await runCommand5aLocalObservationWorker({ scheduler, source: readySource(), spoolPath,
      claimedBy: 'observer-1', asOf: '2026-09-25T14:45:00Z', claimTtlSeconds: 30 });
    assert.equal(report.observed, 1);
    assert.equal(report.orderSubmissions, 0);
    assert.equal(report.brokerMutations, 0);
    assert.equal(scheduler.get(job.observationJobId).state, 'OBSERVED');
    const spool = new LocalResearchHistorySpool(spoolPath);
    try {
      assert.equal(spool.stats().totalBatchCount, 1);
      assert.equal(spool.verify().valid, true);
    } finally { spool.close(); }
    scheduler.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fresh latest evidence resolves a session-close job immediately after the market closes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-worker-'));
  try {
    const { scheduler, job } = setup(root);
    const source: Command5aReadOnlyObservationSource = {
      ...readySource(),
      async marketState() { return { providerAvailable: true, marketSessionOpen: false }; },
    };
    const report = await runCommand5aLocalObservationWorker({ scheduler, source,
      spoolPath: join(root, 'research.sqlite'), claimedBy: 'observer-post-close',
      asOf: '2026-09-25T14:45:00Z', claimTtlSeconds: 30,
      allowClosedSessionLatestMark: true });
    assert.equal(report.observed, 1);
    assert.equal(report.deferredMarket, 0);
    assert.equal(report.brokerMutations, 0);
    assert.equal(scheduler.get(job.observationJobId).state, 'OBSERVED');
    scheduler.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('provider outage remains a typed deferral and cannot look like a missed market path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-worker-'));
  try {
    const { scheduler, job } = setup(root);
    const source: Command5aReadOnlyObservationSource = {
      brokerAuthority: false,
      async marketState() { return { providerAvailable: false, marketSessionOpen: null }; },
      async observe() { throw new Error('UNREACHABLE'); },
    };
    const report = await runCommand5aLocalObservationWorker({ scheduler, source,
      spoolPath: join(root, 'research.sqlite'), claimedBy: 'observer-1',
      asOf: '2026-09-25T14:45:00Z', claimTtlSeconds: 30 });
    assert.equal(report.deferredProvider, 1);
    assert.equal(report.missed, 0);
    assert.equal(scheduler.get(job.observationJobId).state, 'DEFERRED_PROVIDER');
    scheduler.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a persistent provider outage becomes censored after the governed retry limit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-worker-'));
  try {
    const { scheduler, job } = setup(root);
    const source: Command5aReadOnlyObservationSource = {
      brokerAuthority: false,
      async marketState() { return { providerAvailable: false, marketSessionOpen: null }; },
      async observe() { throw new Error('UNREACHABLE'); },
    };
    for (const asOf of ['2026-09-25T14:45:00Z', '2026-09-25T14:46:00Z']) {
      const deferred = await runCommand5aLocalObservationWorker({ scheduler, source,
        spoolPath: join(root, 'research.sqlite'), claimedBy: `provider-${asOf}`,
        asOf, claimTtlSeconds: 30, maximumAttempts: 3 });
      assert.equal(deferred.deferredProvider, 1);
    }
    const exhausted = await runCommand5aLocalObservationWorker({ scheduler, source,
      spoolPath: join(root, 'research.sqlite'), claimedBy: 'provider-terminal',
      asOf: '2026-09-25T14:47:00Z', claimTtlSeconds: 30, maximumAttempts: 3 });
    assert.equal(exhausted.deferredProvider, 0);
    assert.equal(exhausted.censoredRetryExhausted, 1);
    assert.equal(scheduler.get(job.observationJobId).state, 'CENSORED');
    assert.equal(scheduler.get(job.observationJobId).reasonCode,
      'MARKET_PROVIDER_UNAVAILABLE_RETRY_LIMIT_EXHAUSTED');
    scheduler.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('incomplete market evidence becomes a terminal typed miss rather than a retry loop', async () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-worker-'));
  try {
    const { scheduler, job } = setup(root);
    const source: Command5aReadOnlyObservationSource = {
      brokerAuthority: false,
      async marketState() { return { providerAvailable: true, marketSessionOpen: true }; },
      async observe() {
        return { state: 'MISSING', quotes: [], underlying: null,
          observedAt: '2026-09-25T14:46:00Z', reasonCode: 'ASK_MISSING' };
      },
    };
    const report = await runCommand5aLocalObservationWorker({ scheduler, source,
      spoolPath: join(root, 'research.sqlite'), claimedBy: 'observer-1',
      asOf: '2026-09-25T14:45:00Z', claimTtlSeconds: 30 });
    assert.equal(report.missed, 1);
    assert.equal(report.failedRetryable, 0);
    assert.deepEqual(report.reasonCounts, { ASK_MISSING: 1 });
    assert.equal(scheduler.get(job.observationJobId).state, 'MISSED');
    assert.equal(scheduler.get(job.observationJobId).reasonCode, 'ASK_MISSING');
    const second = await runCommand5aLocalObservationWorker({ scheduler, source,
      spoolPath: join(root, 'research.sqlite'), claimedBy: 'observer-2',
      asOf: '2026-09-25T14:47:00Z', claimTtlSeconds: 30 });
    assert.equal(second.claimed, 0);
    scheduler.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('failed fetch/archive attempt recovers after claim TTL without false OBSERVED state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-worker-'));
  try {
    const { scheduler, job } = setup(root);
    const failing: Command5aReadOnlyObservationSource = {
      brokerAuthority: false,
      async marketState() { return { providerAvailable: true, marketSessionOpen: true }; },
      async observe() { throw new Error('TRANSIENT_PROVIDER_FAILURE'); },
    };
    const first = await runCommand5aLocalObservationWorker({ scheduler, source: failing,
      spoolPath: join(root, 'research.sqlite'), claimedBy: 'observer-1',
      asOf: '2026-09-25T14:45:00Z', claimTtlSeconds: 30 });
    assert.equal(first.failedRetryable, 1);
    assert.equal(scheduler.get(job.observationJobId).state, 'IN_PROGRESS');
    const second = await runCommand5aLocalObservationWorker({ scheduler, source: readySource(),
      spoolPath: join(root, 'research.sqlite'), claimedBy: 'observer-2',
      asOf: '2026-09-25T14:46:00Z', claimTtlSeconds: 30 });
    assert.equal(second.observed, 1);
    assert.equal(scheduler.get(job.observationJobId).attempts, 2);
    scheduler.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('repeated provider failures terminate as censored instead of retrying forever', async () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-worker-'));
  try {
    const { scheduler, job } = setup(root);
    const failing: Command5aReadOnlyObservationSource = {
      brokerAuthority: false,
      async marketState() { return { providerAvailable: true, marketSessionOpen: true }; },
      async observe() { throw new Error('TRANSIENT_PROVIDER_FAILURE'); },
    };
    for (const asOf of ['2026-09-25T14:45:00Z', '2026-09-25T14:46:00Z']) {
      const retry = await runCommand5aLocalObservationWorker({ scheduler, source: failing,
        spoolPath: join(root, 'research.sqlite'), claimedBy: `observer-${asOf}`,
        asOf, claimTtlSeconds: 30, maximumAttempts: 3 });
      assert.equal(retry.failedRetryable, 1);
      assert.equal(retry.censoredRetryExhausted, 0);
    }
    const terminal = await runCommand5aLocalObservationWorker({ scheduler, source: failing,
      spoolPath: join(root, 'research.sqlite'), claimedBy: 'observer-terminal',
      asOf: '2026-09-25T14:47:00Z', claimTtlSeconds: 30, maximumAttempts: 3 });
    assert.equal(terminal.failedRetryable, 0);
    assert.equal(terminal.censoredRetryExhausted, 1);
    assert.equal(scheduler.get(job.observationJobId).state, 'CENSORED');
    assert.equal(scheduler.get(job.observationJobId).reasonCode, 'OBSERVATION_RETRY_LIMIT_EXHAUSTED');
    scheduler.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
