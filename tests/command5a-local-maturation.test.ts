import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildShadowEpisodeContract } from '../src/research/shadow-episode-contract.js';
import type { SeriousCandidateSubject } from '../src/research/serious-subject-policy.js';
import { buildContractPathObservationReceipt } from '../src/research/contract-path-observation-runtime.js';
import { archiveContractPathObservation } from '../src/storage/contract-path-local-archive.js';
import { LocalObservationJobScheduler } from '../src/storage/local-observation-job-scheduler.js';
import { LocalResearchHistorySpool } from '../src/storage/local-research-history-spool.js';
import { matureCommand5aLocalObservations } from '../src/research/command5a-local-maturation.js';

const SOURCE_SHA = 'a'.repeat(40);
const SUBJECT_ID = 'b'.repeat(64);
const DECISION_AT = '2026-09-25T14:00:00.000Z';
const TARGET_AT = '2026-09-25T15:00:00.000Z';
const OBSERVED_AT = '2026-09-25T15:00:05.000Z';

const subject: SeriousCandidateSubject = {
  subjectId: SUBJECT_ID,
  kind: 'CANDIDATE',
  snapshotId: 'snapshot-1',
  decisionAt: DECISION_AT,
  decisionBucketAt: DECISION_AT,
  candidateId: 'SPY261016P00500000',
  branch: 'THETA_CONVENTIONAL',
  rankAtDecision: 1,
  selected: true,
  selectionReasons: ['CANONICAL_SELECTED'],
  candidate: {
    candidateId: 'SPY261016P00500000', branch: 'THETA_CONVENTIONAL', action: 'OPEN_CSP', underlying: 'SPY',
    legs: [{ positionIntent: 'SELL_TO_OPEN', optionSymbol: 'SPY261016P00500000', optionType: 'PUT',
      strike: 500, expiration: '2026-10-16', multiplier: 100, bid: 2, ask: 2.1,
      quoteTimestamp: '2026-09-25T13:59:59.000Z' }],
    dte: 21, delta: -0.2, moneyness: 0.9, spreadPct: 0.048,
    liquidity: { volume: 10, openInterest: 100 },
    economics: { premiumPerShare: 2, grossPremium: 200, collateral: 50_000, maxProfit: 200, maxLoss: 49_800,
      breakEven: 498, downsideCushion: 0.1, retainedUpside: null, callAwayProceeds: null,
      wholeChainPnlAtCallAway: null, capitalDayYield: 0.00019, expectedAfterCostEv: null },
    assignmentCapacityQty: 1, aegisState: 'ALLOW_FULL', hardBlockers: [], softEvidence: [], unknownEvidence: [],
    structurallyFeasible: true, riskFeasible: true,
    sizing: { quantity: 1, bindingConstraint: 'BROKER', reasons: [] }, paretoRank: 1,
    dominatedBy: [], executionAuthorized: false,
  },
  subjectSelectionPolicyVersion: 'theta-serious-subject-selection-v2',
  shadowOnly: true, brokerAuthority: false, orderSubmitted: false, brokerFill: false,
};

function setup(targetAt = TARGET_AT) {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-mature-'));
  const schedulerPath = join(root, 'jobs.sqlite');
  const spoolPath = join(root, 'research.sqlite');
  const scheduler = new LocalObservationJobScheduler(schedulerPath);
  const episode = buildShadowEpisodeContract({ subject, decisionId: 'decision-1',
    featureSnapshotHash: 'c'.repeat(64), strategyVersion: 'strategy-v1', riskVersion: 'risk-v1',
    frontierContentHash: 'd'.repeat(64), optionomicsContextHash: 'e'.repeat(64),
    costVersion: 'cost-v1', executionModelVersion: 'execution-v1', sourceSha: SOURCE_SHA, workerSha: SOURCE_SHA });
  scheduler.registerSubject({ decisionCycleId: 'cycle-1', underlying: 'SPY', episode });
  const job = scheduler.schedule({
    job: { observationJobId: 'job-primary', subjectId: SUBJECT_ID,
      horizonPolicyVersion: 'theta-strategy-learning-horizons-v1', horizonCode: 'PRIMARY_COMMON_HORIZON',
      targetAt, targetSessionDate: '2026-09-25', targetState: 'SCHEDULED',
      derivedFromHorizonCode: '1_TRADING_DAY', brokerAuthority: false },
    sourceSha: SOURCE_SHA, workerSha: SOURCE_SHA,
  });
  return { scheduler, spoolPath, job };
}

test('Command-5A maturation archives a selected shadow path without fabricating factual P&L', () => {
  const { scheduler, spoolPath, job } = setup();
  try {
    const claimed = scheduler.claimDue({ asOf: OBSERVED_AT, claimedBy: 'test-worker', claimTtlSeconds: 60 });
    assert.equal(claimed.length, 1);
    const observation = buildContractPathObservationReceipt({
      observationJobId: job.observationJobId, subjectId: SUBJECT_ID, checkpoint: 'PRIMARY_COMMON_HORIZON',
      targetAt: TARGET_AT, actualObservedAt: OBSERVED_AT,
      expectedLegs: [{ optionSymbol: subject.candidateId, side: 'SHORT', optionType: 'PUT',
        expiration: '2026-10-16', strike: 500, multiplier: 100 }],
      quotes: [{ optionSymbol: subject.candidateId, bid: 1.5, ask: 1.6,
        providerTimestamp: '2026-09-25T15:00:00.000Z', receivedAt: OBSERVED_AT,
        impliedVolatility: 0.25, delta: -0.15, gamma: 0.01, theta: -0.04, vega: 0.1,
        provider: 'ALPACA', feed: 'OPRA', quality: 'GOOD', reasonCodes: [] }],
      underlying: { symbol: 'SPY', price: 602, providerTimestamp: '2026-09-25T15:00:00.000Z',
        receivedAt: OBSERVED_AT, provider: 'ALPACA', purpose: 'RESEARCH_REFERENCE_ONLY' },
      sourceSha: SOURCE_SHA, workerSha: SOURCE_SHA,
    });
    archiveContractPathObservation({ spoolPath, decisionCycleId: 'cycle-1', observation });
    scheduler.resolve({ observationJobId: job.observationJobId, claimedBy: 'test-worker',
      state: 'OBSERVED', resolvedAt: OBSERVED_AT, reasonCode: null });

    const first = matureCommand5aLocalObservations({ scheduler, spoolPath, asOf: OBSERVED_AT });
    assert.equal(first.materialized, 1);
    assert.equal(first.failedRetryable, 0);
    const spool = new LocalResearchHistorySpool(spoolPath);
    try {
      const batches = spool.readDecisionCycleBatches<{ dataset: { identifiabilityStatus: string; path: unknown[] } }>({
        decisionCycleId: 'cycle-1', family: 'CONTRACT_PATH_DATASET',
      });
      assert.equal(batches.length, 1);
      assert.equal(batches[0]?.payload[0]?.dataset.identifiabilityStatus, 'NOT_IDENTIFIABLE');
      assert.equal(batches[0]?.payload[0]?.dataset.path.length, 1);
    } finally { spool.close(); }
    const second = matureCommand5aLocalObservations({ scheduler, spoolPath,
      asOf: '2026-09-25T16:00:00.000Z' });
    assert.equal(second.materialized, 0);
    assert.equal(second.alreadyMaterialized, 1);
    const replaySpool = new LocalResearchHistorySpool(spoolPath);
    try {
      assert.equal(replaySpool.readDecisionCycleBatches({
        decisionCycleId: 'cycle-1', family: 'CONTRACT_PATH_DATASET',
      }).length, 1);
    } finally { replaySpool.close(); }
  } finally { scheduler.close(); }
});

test('a later expiration observation cannot rewrite the frozen primary-horizon episode', () => {
  const { scheduler, spoolPath, job } = setup();
  try {
    const expirationJob = scheduler.schedule({
      job: { observationJobId: 'job-expiration', subjectId: SUBJECT_ID,
        horizonPolicyVersion: 'theta-strategy-learning-horizons-v1', horizonCode: 'EXPIRATION',
        targetAt: '2026-10-16T20:00:00.000Z', targetSessionDate: '2026-10-16', targetState: 'SCHEDULED',
        derivedFromHorizonCode: null, brokerAuthority: false },
      sourceSha: SOURCE_SHA, workerSha: SOURCE_SHA,
    });
    const primaryClaim = scheduler.claimDue({ asOf: OBSERVED_AT, claimedBy: 'primary-worker', claimTtlSeconds: 60 });
    assert.deepEqual(primaryClaim.map((row) => row.observationJobId), [job.observationJobId]);
    const buildObservation = (observationJobId: string, checkpoint: 'PRIMARY_COMMON_HORIZON' | 'EXPIRATION',
      targetAt: string, observedAt: string) => buildContractPathObservationReceipt({
      observationJobId, subjectId: SUBJECT_ID, checkpoint, targetAt, actualObservedAt: observedAt,
      expectedLegs: [{ optionSymbol: subject.candidateId, side: 'SHORT', optionType: 'PUT',
        expiration: '2026-10-16', strike: 500, multiplier: 100 }],
      quotes: [{ optionSymbol: subject.candidateId, bid: 1.5, ask: 1.6,
        providerTimestamp: targetAt, receivedAt: observedAt,
        impliedVolatility: 0.25, delta: -0.15, gamma: 0.01, theta: -0.04, vega: 0.1,
        provider: 'ALPACA', feed: 'OPRA', quality: 'GOOD', reasonCodes: [] }],
      underlying: { symbol: 'SPY', price: 602, providerTimestamp: targetAt,
        receivedAt: observedAt, provider: 'ALPACA', purpose: 'RESEARCH_REFERENCE_ONLY' },
      sourceSha: SOURCE_SHA, workerSha: SOURCE_SHA,
    });
    const primaryObservation = buildObservation(job.observationJobId, 'PRIMARY_COMMON_HORIZON', TARGET_AT, OBSERVED_AT);
    archiveContractPathObservation({ spoolPath, decisionCycleId: 'cycle-1', observation: primaryObservation });
    scheduler.resolve({ observationJobId: job.observationJobId, claimedBy: 'primary-worker',
      state: 'OBSERVED', resolvedAt: OBSERVED_AT, reasonCode: null });
    const first = matureCommand5aLocalObservations({ scheduler, spoolPath, asOf: OBSERVED_AT });
    assert.equal(first.materialized, 1);

    const expirationObservedAt = '2026-10-16T20:00:05.000Z';
    const expirationClaim = scheduler.claimDue({ asOf: expirationObservedAt,
      claimedBy: 'expiration-worker', claimTtlSeconds: 60 });
    assert.deepEqual(expirationClaim.map((row) => row.observationJobId), [expirationJob.observationJobId]);
    const expirationObservation = buildObservation(expirationJob.observationJobId, 'EXPIRATION',
      expirationJob.targetAt, expirationObservedAt);
    archiveContractPathObservation({ spoolPath, decisionCycleId: 'cycle-1', observation: expirationObservation });
    scheduler.resolve({ observationJobId: expirationJob.observationJobId, claimedBy: 'expiration-worker',
      state: 'OBSERVED', resolvedAt: expirationObservedAt, reasonCode: null });

    const replay = matureCommand5aLocalObservations({ scheduler, spoolPath, asOf: expirationObservedAt });
    assert.equal(replay.materialized, 0);
    assert.equal(replay.alreadyMaterialized, 1);
    const spool = new LocalResearchHistorySpool(spoolPath);
    try {
      const batches = spool.readDecisionCycleBatches<{ observationIds: string[]; dataset: { path: unknown[] } }>({
        decisionCycleId: 'cycle-1', family: 'CONTRACT_PATH_DATASET',
      });
      assert.equal(batches.length, 1);
      assert.deepEqual(batches[0]?.payload[0]?.observationIds, [primaryObservation.observationId]);
      assert.equal(batches[0]?.payload[0]?.dataset.path.length, 1);
    } finally { spool.close(); }
  } finally { scheduler.close(); }
});

test('Command-5A maturation preserves pending and missing-archive states instead of creating labels', () => {
  const pendingSetup = setup('2026-09-26T15:00:00.000Z');
  try {
    const pending = matureCommand5aLocalObservations({ scheduler: pendingSetup.scheduler,
      spoolPath: pendingSetup.spoolPath, asOf: OBSERVED_AT });
    assert.equal(pending.pending, 1);
    assert.equal(pending.materialized, 0);
  } finally { pendingSetup.scheduler.close(); }

  const missingSetup = setup();
  try {
    missingSetup.scheduler.claimDue({ asOf: OBSERVED_AT, claimedBy: 'test-worker', claimTtlSeconds: 60 });
    missingSetup.scheduler.resolve({ observationJobId: missingSetup.job.observationJobId, claimedBy: 'test-worker',
      state: 'OBSERVED', resolvedAt: OBSERVED_AT, reasonCode: null });
    const missing = matureCommand5aLocalObservations({ scheduler: missingSetup.scheduler,
      spoolPath: missingSetup.spoolPath, asOf: OBSERVED_AT });
    assert.equal(missing.failedRetryable, 1);
    assert.equal(missing.materialized, 0);
    assert.deepEqual(missing.reasonCounts, { COMMAND5A_OBSERVED_JOB_ARCHIVE_MISSING: 1 });
    assert.equal(missing.reasonCounts.MATURATION_FAILED_RETRYABLE, undefined);
  } finally { missingSetup.scheduler.close(); }
});

test('a terminally missed primary mark creates one durable censored row without fake prices', () => {
  const missedSetup = setup();
  try {
    missedSetup.scheduler.claimDue({ asOf: OBSERVED_AT, claimedBy: 'test-worker', claimTtlSeconds: 60 });
    missedSetup.scheduler.resolve({ observationJobId: missedSetup.job.observationJobId,
      claimedBy: 'test-worker', state: 'MISSED', resolvedAt: OBSERVED_AT,
      reasonCode: 'EXACT_CONTRACT_SNAPSHOT_MISSING' });
    const first = matureCommand5aLocalObservations({ scheduler: missedSetup.scheduler,
      spoolPath: missedSetup.spoolPath, asOf: OBSERVED_AT });
    assert.equal(first.censored, 1);
    assert.equal(first.materialized, 0);
    const spool = new LocalResearchHistorySpool(missedSetup.spoolPath);
    try {
      const batches = spool.readDecisionCycleBatches<{
        executionTruthClass: string;
        observationIds: string[];
        dataset: { path: unknown[]; statistics: { terminalState: string; assignmentState: string } };
        unknownFields: { field: string; reason: string }[];
      }>({ decisionCycleId: 'cycle-1', family: 'CONTRACT_PATH_DATASET' });
      assert.equal(batches.length, 1);
      assert.equal(batches[0]?.payload[0]?.executionTruthClass, 'CENSORED_NO_MARKET_PATH');
      assert.deepEqual(batches[0]?.payload[0]?.observationIds, []);
      assert.deepEqual(batches[0]?.payload[0]?.dataset.path, []);
      assert.equal(batches[0]?.payload[0]?.dataset.statistics.terminalState, 'CHAIN_CENSORED');
      assert.equal(batches[0]?.payload[0]?.dataset.statistics.assignmentState, 'RIGHT_CENSORED');
      assert.deepEqual(batches[0]?.payload[0]?.unknownFields, [{ rowIndex: -1,
        field: 'primaryObservation', reason: 'EXACT_CONTRACT_SNAPSHOT_MISSING' }]);
    } finally { spool.close(); }
    const second = matureCommand5aLocalObservations({ scheduler: missedSetup.scheduler,
      spoolPath: missedSetup.spoolPath, asOf: '2026-09-25T16:00:00.000Z' });
    assert.equal(second.censored, 0);
    assert.equal(second.alreadyMaterialized, 1);
  } finally { missedSetup.scheduler.close(); }
});

test('maturation subject cursor advances and wraps so bounded runs cannot starve later subjects', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-cursor-'));
  const scheduler = new LocalObservationJobScheduler(join(root, 'jobs.sqlite'));
  try {
    for (const value of ['1', '2', '3']) {
      const episode = buildShadowEpisodeContract({ subject: { ...subject, subjectId: value.repeat(64) },
        decisionId: `decision-${value}`, featureSnapshotHash: value.repeat(64), strategyVersion: 'strategy-v1',
        frontierContentHash: 'd'.repeat(64), optionomicsContextHash: 'e'.repeat(64),
        riskVersion: 'risk-v1', costVersion: 'cost-v1', executionModelVersion: 'execution-v1',
        sourceSha: SOURCE_SHA, workerSha: SOURCE_SHA });
      scheduler.registerSubject({ decisionCycleId: `cycle-${value}`, underlying: 'SPY', episode });
    }
    assert.deepEqual(scheduler.nextMaturationSubjects(2).map((item) => item.subjectId),
      ['1'.repeat(64), '2'.repeat(64)]);
    assert.deepEqual(scheduler.nextMaturationSubjects(2).map((item) => item.subjectId), ['3'.repeat(64)]);
    assert.deepEqual(scheduler.nextMaturationSubjects(2).map((item) => item.subjectId),
      ['1'.repeat(64), '2'.repeat(64)]);
  } finally { scheduler.close(); }
});
