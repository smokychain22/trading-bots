import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  resolveCommand5aFrontierUnderlying,
  scheduleCommand5aFromCanonicalFrontier,
} from '../src/research/command5a-local-scheduling.js';
import { selectSeriousResearchSubjects } from '../src/research/serious-subject-policy.js';
import { buildShadowEpisodeContract } from '../src/research/shadow-episode-contract.js';
import type { CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { LocalObservationJobScheduler } from '../src/storage/local-observation-job-scheduler.js';

const frontier: CanonicalStrategyFrontier = {
  contractVersion: 'theta-canonical-strategy-frontier-v1', snapshotId: 'snapshot-1',
  timestamp: '2026-09-25T14:30:00.000Z', strategyVersion: 'strategy-v1',
  decisionAuthorityVersion: 'theta-canonical-decision-authority-v1',
  branches: [{ branch: 'THETA_CONVENTIONAL', strategyVersion: 'q-v1', status: 'SHADOW',
    applicable: true, evaluated: true, routeReasons: [], evaluationState: 'EVALUATED', candidateCount: 1,
    mechanicallyRejected: 0, enumerationTruncated: false, hardVetoed: 0, softRanked: 1,
    dataInsufficient: 0, candidates: [{ candidateId: 'candidate-1', branch: 'THETA_CONVENTIONAL',
      action: 'OPEN_CSP', underlying: 'SPY', legs: [{ positionIntent: 'SELL_TO_OPEN',
        optionSymbol: 'SPY261120P00500000', optionType: 'PUT', strike: 500,
        expiration: '2026-11-20', multiplier: 100, bid: 2, ask: 2.1,
        quoteTimestamp: '2026-09-25T14:29:59Z' }], dte: 56, delta: -0.2, moneyness: 0.91,
      spreadPct: 0.05, liquidity: { volume: 10, openInterest: 100 },
      economics: { premiumPerShare: 2, grossPremium: 200, collateral: 50_000, maxProfit: 200,
        maxLoss: 49_800, breakEven: 498, downsideCushion: 0.1, retainedUpside: null,
        callAwayProceeds: null, wholeChainPnlAtCallAway: null, capitalDayYield: 0.001,
        expectedAfterCostEv: null }, assignmentCapacityQty: 1, aegisState: 'ALLOW_FULL',
      hardBlockers: [], softEvidence: [], unknownEvidence: [], structurallyFeasible: true,
      riskFeasible: true, sizing: { quantity: 1, bindingConstraint: 'BROKER', reasons: [] },
      paretoRank: 1, dominatedBy: [], executionAuthorized: false }],
    bestCandidateId: 'candidate-1', secondBestCandidateId: null, bestRejectedCandidateId: null,
    empiricalEconomicsReady: false, executionAuthorized: false }],
  branchesConsidered: ['THETA_CONVENTIONAL'], branchesEvaluated: ['THETA_CONVENTIONAL'],
  selectedBranch: null, selectedCandidateId: null, primaryAction: 'GLOBAL_WAIT', selectedQuantity: 0,
  empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED', secondBestCandidateId: null,
  nearMissCandidateId: 'candidate-1', bestRejectedCandidateId: 'candidate-1', globalWaitEarned: true,
  globalWaitReasons: ['ACCOUNT_CAPACITY'], empiricalEconomicsReady: false, executionAuthorized: false,
  optionomicsContext: null, definedRiskLockedPlan: { state: 'NOT_APPLICABLE', plan: null, reasons: [] },
  contentHash: 'f'.repeat(64),
};

const sessions = [
  { date: '2026-09-25', openAt: '2026-09-25T13:30:00Z', closeAt: '2026-09-25T20:00:00Z', source: 'ALPACA_CALENDAR' as const },
  { date: '2026-09-28', openAt: '2026-09-28T13:30:00Z', closeAt: '2026-09-28T20:00:00Z', source: 'ALPACA_CALENDAR' as const },
  { date: '2026-09-29', openAt: '2026-09-29T13:30:00Z', closeAt: '2026-09-29T20:00:00Z', source: 'ALPACA_CALENDAR' as const },
  { date: '2026-09-30', openAt: '2026-09-30T13:30:00Z', closeAt: '2026-09-30T20:00:00Z', source: 'ALPACA_CALENDAR' as const },
  { date: '2026-10-01', openAt: '2026-10-01T13:30:00Z', closeAt: '2026-10-01T20:00:00Z', source: 'ALPACA_CALENDAR' as const },
  { date: '2026-10-02', openAt: '2026-10-02T13:30:00Z', closeAt: '2026-10-02T20:00:00Z', source: 'ALPACA_CALENDAR' as const },
  { date: '2026-11-20', openAt: '2026-11-20T14:30:00Z', closeAt: '2026-11-20T21:00:00Z', source: 'ALPACA_CALENDAR' as const },
];

test('canonical frontier creates restart-safe candidate jobs and preserves WAIT without fake legs', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-schedule-'));
  const path = join(root, 'jobs.sqlite');
  try {
    const scheduler = new LocalObservationJobScheduler(path);
    const input = { scheduler, frontier, decisionCycleId: 'cycle-1', decisionId: 'decision-1',
      underlying: 'SPY', featureSnapshotHash: 'a'.repeat(64), riskVersion: 'risk-v1',
      costVersion: 'cost-v1', executionModelVersion: 'execution-v1', sourceSha: 'b'.repeat(40),
      workerSha: 'b'.repeat(40), sessions,
      horizonPolicy: { version: 'theta-strategy-learning-horizons-v1' as const,
        primaryCommonHorizon: '1_TRADING_DAY' as const, tradingDayTarget: 'SESSION_CLOSE' as const } };
    const first = scheduleCommand5aFromCanonicalFrontier(input);
    const second = scheduleCommand5aFromCanonicalFrontier(input);
    assert.equal(first.candidateSubjectCount, 1);
    assert.equal(first.waitSubjectCount, 1);
    assert.equal(first.t0OnlySubjectCount, 1);
    assert.equal(first.existingSubjectCount, 0);
    assert.equal(first.scheduledJobCount, 8);
    assert.equal(first.existingJobCount, 0);
    assert.equal(first.unscheduledJobCount, 0);
    assert.equal(second.existingSubjectCount, 2);
    assert.equal(second.scheduledJobCount, 0);
    assert.equal(second.existingJobCount, 8);
    assert.equal(scheduler.subjectCount(), 2);
    assert.equal(Object.values(scheduler.counts()).reduce((sum, value) => sum + value, 0), 8);
    scheduler.close();

    const reopened = new LocalObservationJobScheduler(path);
    assert.equal(reopened.subjectCount(), 2);
    assert.equal(reopened.getSubject(first.subjectIds[0] as string).brokerAuthority, false);
    reopened.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('restart repairs a subject registered before its jobs were scheduled', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-schedule-'));
  const path = join(root, 'jobs.sqlite');
  try {
    const scheduler = new LocalObservationJobScheduler(path);
    const selected = selectSeriousResearchSubjects(frontier).subjects.find((subject) => subject.kind === 'CANDIDATE');
    assert.ok(selected?.kind === 'CANDIDATE');
    const episode = buildShadowEpisodeContract({ subject: selected, decisionId: 'decision-1',
      featureSnapshotHash: 'a'.repeat(64), strategyVersion: frontier.strategyVersion,
      frontierContentHash: frontier.contentHash, optionomicsContextHash: 'b'.repeat(64),
      riskVersion: 'risk-v1', costVersion: 'cost-v1', executionModelVersion: 'execution-v1',
      sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40) });
    scheduler.registerSubject({ decisionCycleId: 'cycle-1', underlying: 'SPY', episode });
    assert.deepEqual(scheduler.jobsForSubject(selected.subjectId), []);
    const receipt = scheduleCommand5aFromCanonicalFrontier({ scheduler, frontier,
      decisionCycleId: 'cycle-1', decisionId: 'decision-1', underlying: 'SPY',
      featureSnapshotHash: 'a'.repeat(64), riskVersion: 'risk-v1', costVersion: 'cost-v1',
      executionModelVersion: 'execution-v1', sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40),
      sessions, horizonPolicy: { version: 'theta-strategy-learning-horizons-v1',
        primaryCommonHorizon: '1_TRADING_DAY', tradingDayTarget: 'SESSION_CLOSE' } });
    assert.equal(receipt.existingSubjectCount, 1);
    assert.equal(receipt.scheduledJobCount, 8);
    assert.equal(receipt.existingJobCount, 0);
    assert.equal(scheduler.jobsForSubject(selected.subjectId).length, 8);
    scheduler.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('repeated decisions in one governed bucket retain the first immutable T0 subject', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-schedule-'));
  const scheduler = new LocalObservationJobScheduler(join(root, 'jobs.sqlite'));
  const input = { scheduler, frontier, decisionCycleId: 'cycle-1', decisionId: 'decision-1',
    underlying: 'SPY', featureSnapshotHash: 'a'.repeat(64), riskVersion: 'risk-v1',
    costVersion: 'cost-v1', executionModelVersion: 'execution-v1', sourceSha: 'b'.repeat(40),
    workerSha: 'b'.repeat(40), sessions,
    horizonPolicy: { version: 'theta-strategy-learning-horizons-v1' as const,
      primaryCommonHorizon: '1_TRADING_DAY' as const, tradingDayTarget: 'SESSION_CLOSE' as const } };
  try {
    const first = scheduleCommand5aFromCanonicalFrontier(input);
    const candidateSubjectId = first.subjectIds[0] as string;
    const firstEpisode = scheduler.getSubject(candidateSubjectId).episode;
    const repeatedFrontier = { ...frontier, timestamp: '2026-09-25T14:31:00.000Z' };
    const repeated = scheduleCommand5aFromCanonicalFrontier({ ...input, frontier: repeatedFrontier,
      decisionCycleId: 'cycle-2', decisionId: 'decision-2' });
    assert.equal(repeated.existingSubjectCount, 2);
    assert.equal(repeated.scheduledJobCount, 0);
    assert.equal(repeated.existingJobCount, 8);
    assert.equal(scheduler.getSubject(candidateSubjectId).episode.decisionId, firstEpisode.decisionId);
    assert.equal(scheduler.getSubject(candidateSubjectId).episode.decisionAt, firstEpisode.decisionAt);
  } finally { scheduler.close(); rmSync(root, { recursive: true, force: true }); }
});

test('a complete zero-candidate WAIT retains its underlying from the immutable snapshot', () => {
  const waitFrontier: CanonicalStrategyFrontier = {
    ...frontier,
    branches: frontier.branches.map((branch) => ({ ...branch, candidates: [], candidateCount: 0,
      bestCandidateId: null, secondBestCandidateId: null, bestRejectedCandidateId: null,
      softRanked: 0 })),
    nearMissCandidateId: null,
    bestRejectedCandidateId: null,
  };
  assert.equal(resolveCommand5aFrontierUnderlying(waitFrontier, {
    underlyingState: { symbol: 'SPY' },
  }), 'SPY');
  assert.equal(resolveCommand5aFrontierUnderlying(frontier, {
    underlyingState: { symbol: 'QQQ' },
  }), null);
});

test('stock-only recovery candidates persist as T0-only subjects without fake option jobs', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-schedule-'));
  const scheduler = new LocalObservationJobScheduler(join(root, 'jobs.sqlite'));
  const recoveryCandidate = {
    ...frontier.branches[0]?.candidates[0],
    candidateId: 'THETA_RECOVERY:SPY:RECOVERY_WAIT',
    branch: 'THETA_RECOVERY' as const,
    action: 'RECOVERY_WAIT' as const,
    legs: [],
  };
  assert.ok(recoveryCandidate.underlying);
  const recoveryFrontier: CanonicalStrategyFrontier = {
    ...frontier,
    branches: [{ ...frontier.branches[0]!, branch: 'THETA_RECOVERY',
      candidates: [recoveryCandidate], candidateCount: 1, bestCandidateId: recoveryCandidate.candidateId,
      secondBestCandidateId: null, bestRejectedCandidateId: null }],
    branchesConsidered: ['THETA_RECOVERY'],
    branchesEvaluated: ['THETA_RECOVERY'],
    nearMissCandidateId: recoveryCandidate.candidateId,
    bestRejectedCandidateId: recoveryCandidate.candidateId,
  };
  try {
    const receipt = scheduleCommand5aFromCanonicalFrontier({ scheduler, frontier: recoveryFrontier,
      decisionCycleId: 'cycle-recovery', decisionId: 'decision-recovery', underlying: 'SPY',
      featureSnapshotHash: 'a'.repeat(64), riskVersion: 'risk-v1', costVersion: 'cost-v1',
      executionModelVersion: 'execution-v1', sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40),
      sessions, horizonPolicy: { version: 'theta-strategy-learning-horizons-v1',
        primaryCommonHorizon: '1_TRADING_DAY', tradingDayTarget: 'SESSION_CLOSE' } });
    assert.equal(receipt.candidateSubjectCount, 1);
    assert.equal(receipt.t0OnlySubjectCount, 2);
    assert.equal(receipt.scheduledJobCount, 0);
    assert.equal(scheduler.subjectCount(), 2);
    assert.deepEqual(scheduler.counts(), {});
  } finally { scheduler.close(); rmSync(root, { recursive: true, force: true }); }
});
