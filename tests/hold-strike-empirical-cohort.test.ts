import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHoldStrikeCandidateObservation, buildHoldStrikeCohortReport, pairHoldStrikeWithConventional,
  type HoldStrikeCandidateObservationInput,
} from '../src/research/hold-strike-empirical-cohort.js';
import { r6OutcomeLabelVersion, type R6Label, type R6OutcomeLabelSet } from '../src/research/r6-outcome-labels.js';

function known<T>(value: T): R6Label<T> {
  return { value, unit: 'USD', definition: 'test label', state: 'KNOWN' };
}
function unk<T>(): R6Label<T> {
  return { value: null, unit: 'USD', definition: 'test label', state: 'UNKNOWN' };
}

const resolvedLabels = (overrides: Partial<R6OutcomeLabelSet> = {}): R6OutcomeLabelSet => ({
  labelVersion: r6OutcomeLabelVersion, chainId: 'chain-1', asOf: '2026-09-25T14:00:00Z',
  legRealizedPnl: known(150), positionRealizedPnl: known(150), managedEpisodePnl: known(150),
  wholeChainPnl: known(150), wholeChainAfterCostPnl: known(140),
  unrealizedMtm: unk(), capitalDays: known(500), returnPerCapitalDay: known(0.28),
  mfe: known(200), mae: known(-50), maxDrawdown: known(60),
  assignmentOccurred: known(false), recoveryDurationDays: unk(), recoverySuccess: unk(),
  coveredCallPremiumContribution: unk(), stockPnlContribution: unk(), calledAwayOccurred: unk(),
  executionSlippage: known(2), fillRate: known(1), timeToFillSeconds: known(3),
  resolvedPositive: known(true), brokerAuthority: false, ...overrides,
});

const candidateInput = (overrides: Partial<HoldStrikeCandidateObservationInput> = {}): HoldStrikeCandidateObservationInput => ({
  snapshotId: 'snap-1', candidateId: 'cand-1', decisionId: 'dec-1', chainId: null, episodeId: null,
  independentUnitId: null, strategyVersion: 'theta-hold-strike-1.0.0-research', environment: 'SHADOW',
  executionKind: 'SHADOW_CANDIDATE', asOf: '2026-09-19T14:00:00Z',
  underlying: 'AAPL', optionSymbol: 'AAPL260925P00190000', expiration: '2026-09-25', dte: 6, delta: -0.22,
  strike: 190, underlyingPriceAtDecision: 200, breakEven: 188.5, expectedMoveDollars: 6,
  premiumPerShare: 1.5, premiumPerContract: 150, positionPremium: 150, multiplier: 100, quantity: 1, capitalAmount: 19000,
  ownershipScore: 0.65, eventRisk: 'ABSENT_VERIFIED',
  bid: 1.45, ask: 1.55, spreadPct: 0.065, openInterest: 500, volume: 120,
  impliedVolatility: 0.28, ivRank: 0.4, ivPercentile: 0.45, realizedVolatility: 0.22, ivMinusRv: 0.06,
  skew25Delta: 0.03, termSlope: -0.01, recordedAegisState: 'PERMITTED', resolvedLabels: null, ...overrides,
});

test('builds a valid unresolved shadow candidate observation with correct geometry', () => {
  const observation = buildHoldStrikeCandidateObservation(candidateInput());
  assert.equal(observation.resolutionState, 'UNRESOLVED');
  assert.equal(observation.brokerAuthority, false);
  assert.equal(observation.geometry.strikeMinusSpot, -10); // 190 - 200
  assert.equal(observation.geometry.breakEvenMinusSpot, -11.5); // 188.5 - 200
  assert.ok(Math.abs((observation.geometry.strikeDistancePercent as number) - (-0.05)) < 1e-9);
  assert.ok(Math.abs((observation.geometry.strikeDistanceFromExpectedMove as number) - (10 / 6)) < 1e-9);
  assert.equal(observation.ownershipEvidenceState, 'KNOWN');
  assert.equal(observation.liquidityEvidenceState, 'KNOWN');
});

test('a resolved observation requires chainId, matching resolvedLabels.chainId, and no PIT leakage', () => {
  assert.throws(
    () => buildHoldStrikeCandidateObservation(candidateInput({ resolvedLabels: resolvedLabels() })),
    /HOLD_STRIKE_RESOLVED_REQUIRES_CHAIN_ID/,
  );
  assert.throws(
    () => buildHoldStrikeCandidateObservation(candidateInput({ chainId: 'chain-1', resolvedLabels: resolvedLabels({ chainId: 'chain-2' }) })),
    /HOLD_STRIKE_RESOLVED_CHAIN_ID_MISMATCH/,
  );
  assert.throws(
    () => buildHoldStrikeCandidateObservation(candidateInput({
      chainId: 'chain-1', asOf: '2026-09-25T15:00:00Z',
      resolvedLabels: resolvedLabels({ chainId: 'chain-1', asOf: '2026-09-25T14:00:00Z' }),
    })),
    /HOLD_STRIKE_RESOLVED_LABEL_TIME_LEAKAGE/,
  );
});

test('a resolved observation with correct chainId and a later label timestamp is accepted and marked RESOLVED', () => {
  const observation = buildHoldStrikeCandidateObservation(candidateInput({
    chainId: 'chain-1', resolvedLabels: resolvedLabels({ chainId: 'chain-1' }),
  }));
  assert.equal(observation.resolutionState, 'RESOLVED');
  assert.equal(observation.resolvedLabels?.wholeChainAfterCostPnl.value, 140);
});

test('required identity fields are rejected when blank, and strike must be finite and positive', () => {
  assert.throws(() => buildHoldStrikeCandidateObservation(candidateInput({ snapshotId: '' })), /HOLD_STRIKE_SNAPSHOT_ID_REQUIRED/);
  assert.throws(() => buildHoldStrikeCandidateObservation(candidateInput({ candidateId: '  ' })), /HOLD_STRIKE_CANDIDATE_ID_REQUIRED/);
  assert.throws(() => buildHoldStrikeCandidateObservation(candidateInput({ strike: 0 })), /HOLD_STRIKE_STRIKE_INVALID/);
  assert.throws(() => buildHoldStrikeCandidateObservation(candidateInput({ strike: Number.NaN })), /HOLD_STRIKE_STRIKE_INVALID/);
  assert.throws(() => buildHoldStrikeCandidateObservation(candidateInput({ asOf: 'not-a-date' })), /HOLD_STRIKE_TIMESTAMP_INVALID/);
});

test('an out-of-range or non-finite ownership score is treated as UNKNOWN, never a fabricated clamp', () => {
  const outOfRange = buildHoldStrikeCandidateObservation(candidateInput({ ownershipScore: 1.4 }));
  assert.equal(outOfRange.ownershipScore, null);
  assert.equal(outOfRange.ownershipEvidenceState, 'UNKNOWN');
  const nanScore = buildHoldStrikeCandidateObservation(candidateInput({ ownershipScore: Number.NaN }));
  assert.equal(nanScore.ownershipEvidenceState, 'UNKNOWN');
});

test('missing underlyingPriceAtDecision makes all geometry fields UNKNOWN, never a fabricated distance', () => {
  const observation = buildHoldStrikeCandidateObservation(candidateInput({ underlyingPriceAtDecision: null }));
  assert.equal(observation.geometry.strikeMinusSpot, null);
  assert.equal(observation.geometry.strikeDistancePercent, null);
  assert.equal(observation.geometry.breakEvenMinusSpot, null);
});

test('an empty cohort is valid: zero counts, no fake averages, NONE sample size', () => {
  const report = buildHoldStrikeCohortReport([], 2);
  assert.equal(report.rawObservationCount, 0);
  assert.equal(report.distinctChainCount, 0);
  assert.equal(report.distinctEpisodeCount, null);
  assert.equal(report.sampleSizeState, 'NONE');
  assert.equal(report.dataQualityState, 'NO_ECONOMIC_METRICS');
  assert.equal(report.wholeChainAfterCostPnl.mean, null);
  assert.equal(report.brokerAuthority, false);
});

test('one unresolved candidate: raw N = 1, resolved N = 0, economic metrics UNKNOWN not zero', () => {
  const observation = buildHoldStrikeCandidateObservation(candidateInput());
  const report = buildHoldStrikeCohortReport([{ observation }], 1);
  assert.equal(report.rawObservationCount, 1);
  assert.equal(report.resolvedObservationCount, 0);
  assert.equal(report.unresolvedObservationCount, 1);
  assert.equal(report.wholeChainAfterCostPnl.mean, null);
  assert.equal(report.dataQualityState, 'NO_ECONOMIC_METRICS');
});

test('several observations from the same chain: raw N > 1, distinctChainCount = 1, independent N never inflated', () => {
  const o1 = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'c1', chainId: 'chain-A' }));
  const o2 = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'c2', chainId: 'chain-A' }));
  const report = buildHoldStrikeCohortReport([{ observation: o1 }, { observation: o2 }], 1);
  assert.equal(report.rawObservationCount, 2);
  assert.equal(report.distinctChainCount, 1);
  assert.equal(report.independentN, null); // no independentUnitId supplied
  assert.equal(report.sampleSizeState, 'NOT_ASSESSED');
});

test('distinct chains report distinctChainCount correctly but independent N stays null without independentUnitId', () => {
  const o1 = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'c1', chainId: 'chain-A' }));
  const o2 = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'c2', chainId: 'chain-B' }));
  const report = buildHoldStrikeCohortReport([{ observation: o1 }, { observation: o2 }], 1);
  assert.equal(report.distinctChainCount, 2);
  assert.equal(report.independentN, null);
});

test('independentN is reported only when every observation carries a non-null independentUnitId', () => {
  const o1 = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'c1', chainId: 'chain-A', independentUnitId: 'unit-1' }));
  const o2 = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'c2', chainId: 'chain-A', independentUnitId: 'unit-1' }));
  const o3 = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'c3', chainId: 'chain-B', independentUnitId: 'unit-2' }));
  const report = buildHoldStrikeCohortReport([{ observation: o1 }, { observation: o2 }, { observation: o3 }], 2);
  assert.equal(report.independentN, 2); // unit-1, unit-2
  assert.equal(report.sampleSizeState, 'SUFFICIENT');
});

test('a duplicate snapshotId+candidateId observation identity is rejected, never overweighted', () => {
  const o1 = buildHoldStrikeCandidateObservation(candidateInput({ snapshotId: 'snap-x', candidateId: 'dup' }));
  const o2 = buildHoldStrikeCandidateObservation(candidateInput({ snapshotId: 'snap-x', candidateId: 'dup' }));
  assert.throws(
    () => buildHoldStrikeCohortReport([{ observation: o1 }, { observation: o2 }], 1),
    /HOLD_STRIKE_COHORT_DUPLICATE_OBSERVATION_IDENTITY/,
  );
});

test('unknown ownership remains unknown in the observation, never classified as poor ownership', () => {
  const observation = buildHoldStrikeCandidateObservation(candidateInput({ ownershipScore: null }));
  assert.equal(observation.ownershipEvidenceState, 'UNKNOWN');
  assert.equal(observation.ownershipScore, null);
});

test('unknown event risk remains UNKNOWN, distinct from a verified-absent event', () => {
  const unknownEvent = buildHoldStrikeCandidateObservation(candidateInput({ eventRisk: 'UNKNOWN' }));
  const noEvent = buildHoldStrikeCandidateObservation(candidateInput({ eventRisk: 'ABSENT_VERIFIED' }));
  assert.equal(unknownEvent.eventRisk, 'UNKNOWN');
  assert.equal(noEvent.eventRisk, 'ABSENT_VERIFIED');
  assert.notEqual(unknownEvent.eventRisk, noEvent.eventRisk);
});

test('resolved positive and negative whole-chain outcomes are both represented faithfully in cohort means', () => {
  const positive = buildHoldStrikeCandidateObservation(candidateInput({
    candidateId: 'pos', chainId: 'chain-pos', resolvedLabels: resolvedLabels({ chainId: 'chain-pos', wholeChainAfterCostPnl: known(300) }),
  }));
  const negative = buildHoldStrikeCandidateObservation(candidateInput({
    candidateId: 'neg', chainId: 'chain-neg', resolvedLabels: resolvedLabels({ chainId: 'chain-neg', wholeChainAfterCostPnl: known(-100) }),
  }));
  const report = buildHoldStrikeCohortReport([{ observation: positive }, { observation: negative }], 1);
  assert.equal(report.wholeChainAfterCostPnl.mean, 100); // (300 + -100) / 2
  assert.equal(report.wholeChainAfterCostPnl.knownCount, 2);
});

test('assignment can coexist with a positive whole-chain result and is never treated as failure', () => {
  const assignedButProfitable = buildHoldStrikeCandidateObservation(candidateInput({
    candidateId: 'assigned', chainId: 'chain-assigned',
    resolvedLabels: resolvedLabels({ chainId: 'chain-assigned', assignmentOccurred: known(true), wholeChainAfterCostPnl: known(250) }),
  }));
  const report = buildHoldStrikeCohortReport([{ observation: assignedButProfitable }], 1);
  assert.equal(report.assignmentOccurredCount, 1);
  assert.equal(report.wholeChainAfterCostPnl.mean, 250);
});

test('same snapshot + underlying pairing is allowed; a different snapshot is not paired', () => {
  const holdStrike = buildHoldStrikeCandidateObservation(candidateInput({ snapshotId: 'snap-1', underlying: 'AAPL' }));
  const pairable = pairHoldStrikeWithConventional(holdStrike, {
    snapshotId: 'snap-1', underlying: 'AAPL', strike: 195, breakEven: 192, premiumPerShare: 2, dte: 30, delta: -0.28, capitalAmount: 19500,
  });
  assert.equal(pairable.pairable, true);
  const strikeDiff = pairable.differences.find((row) => row.dimension === 'strike');
  assert.equal(strikeDiff?.difference, -5); // 190 - 195

  const unpairable = pairHoldStrikeWithConventional(holdStrike, {
    snapshotId: 'snap-2', underlying: 'AAPL', strike: 195, breakEven: null, premiumPerShare: null, dte: null, delta: null, capitalAmount: null,
  });
  assert.equal(unpairable.pairable, false);
  assert.equal(unpairable.unpairableReason, 'SNAPSHOT_MISMATCH');
  assert.equal(unpairable.differences.length, 0);
});

test('a different underlying at the same snapshot is not paired, and no pairing output ever carries a winner field', () => {
  const holdStrike = buildHoldStrikeCandidateObservation(candidateInput({ snapshotId: 'snap-1', underlying: 'AAPL' }));
  const result = pairHoldStrikeWithConventional(holdStrike, {
    snapshotId: 'snap-1', underlying: 'MSFT', strike: 300, breakEven: null, premiumPerShare: null, dte: null, delta: null, capitalAmount: null,
  });
  assert.equal(result.pairable, false);
  assert.equal(result.unpairableReason, 'UNDERLYING_MISMATCH');

  const pairedResult = pairHoldStrikeWithConventional(holdStrike, {
    snapshotId: 'snap-1', underlying: 'AAPL', strike: 195, breakEven: null, premiumPerShare: null, dte: null, delta: null, capitalAmount: null,
  });
  const keys = pairedResult.differences.flatMap((row) => Object.keys(row));
  for (const forbidden of ['winner', 'preferred', 'recommended', 'better']) {
    assert.ok(!keys.map((key) => key.toLowerCase()).includes(forbidden));
  }
});

test('no observation, cohort report, or pairing output carries any decision-shaped field name', () => {
  const observation = buildHoldStrikeCandidateObservation(candidateInput());
  const report = buildHoldStrikeCohortReport([{ observation }], 1);
  const forbiddenNames = ['winner', 'preferredcandidate', 'recommendation', 'shouldtrade', 'eligible', 'applicable',
    'beststrike', 'bestdte', 'optimaldelta', 'targetownership', 'openaction'];
  const observationKeys = Object.keys(observation).map((key) => key.toLowerCase());
  const reportKeys = Object.keys(report).map((key) => key.toLowerCase());
  for (const forbidden of forbiddenNames) {
    assert.ok(!observationKeys.includes(forbidden), `observation must not carry: ${forbidden}`);
    assert.ok(!reportKeys.includes(forbidden), `report must not carry: ${forbidden}`);
  }
  assert.equal(observation.brokerAuthority, false);
  assert.equal(report.brokerAuthority, false);
});
