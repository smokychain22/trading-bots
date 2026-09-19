import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHoldStrikeCandidateObservation, buildHoldStrikeCohortReport, pairHoldStrikeWithConventional,
  type HoldStrikeCandidateObservationInput, type HoldStrikeConventionalCandidateFacts,
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

const conventionalFacts = (overrides: Partial<HoldStrikeConventionalCandidateFacts> = {}): HoldStrikeConventionalCandidateFacts => ({
  snapshotId: 'snap-1', candidateId: 'conventional-1', asOf: '2026-09-19T14:00:00Z', executionKind: 'SHADOW_CANDIDATE' as const,
  underlying: 'AAPL', strike: 195, breakEven: 192, premiumPerShare: 2, dte: 30, delta: -0.28, capitalAmount: 19500,
  ...overrides,
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
  assert.throws(() => buildHoldStrikeCandidateObservation(candidateInput({ optionSymbol: 'INVALID' })), /HOLD_STRIKE_OPTION_SYMBOL_INVALID/);
  assert.throws(() => buildHoldStrikeCandidateObservation(candidateInput({ underlying: 'MSFT' })), /HOLD_STRIKE_CONTRACT_UNDERLYING_MISMATCH/);
  assert.throws(() => buildHoldStrikeCandidateObservation(candidateInput({ expiration: '2026-10-02' })), /HOLD_STRIKE_CONTRACT_EXPIRATION_MISMATCH/);
});

test('non-shadow actual observations require a chain identity', () => {
  assert.throws(() => buildHoldStrikeCandidateObservation(candidateInput({ executionKind: 'PAPER_ACTUAL' })),
    /HOLD_STRIKE_ACTUAL_REQUIRES_CHAIN_ID/);
  assert.throws(() => buildHoldStrikeCandidateObservation(candidateInput({ executionKind: 'PAPER_ACTUAL', chainId: 'chain-1' })),
    /HOLD_STRIKE_PAPER_ACTUAL_ENVIRONMENT_MISMATCH/);
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
  assert.equal(report.independentN, 0); // unresolved candidates are not an empirical sample
  assert.equal(report.sampleSizeState, 'NONE');
});

test('unresolved distinct chains report distinctChainCount but empirical independent N remains zero', () => {
  const o1 = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'c1', chainId: 'chain-A' }));
  const o2 = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'c2', chainId: 'chain-B' }));
  const report = buildHoldStrikeCohortReport([{ observation: o1 }, { observation: o2 }], 1);
  assert.equal(report.distinctChainCount, 2);
  assert.equal(report.independentN, 0);
});

test('independentN is reported only when every observation carries a non-null independentUnitId', () => {
  const o1 = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'c1', chainId: 'chain-A', independentUnitId: 'unit-1',
    resolvedLabels: resolvedLabels({ chainId: 'chain-A' }) }));
  const o2 = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'c2', chainId: 'chain-A', independentUnitId: 'unit-1',
    resolvedLabels: resolvedLabels({ chainId: 'chain-A' }) }));
  const o3 = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'c3', chainId: 'chain-B', independentUnitId: 'unit-2',
    resolvedLabels: resolvedLabels({ chainId: 'chain-B' }) }));
  const report = buildHoldStrikeCohortReport([{ observation: o1 }, { observation: o2 }, { observation: o3 }], 2);
  assert.equal(report.independentN, 2); // unit-1, unit-2
  assert.equal(report.resolvedObservationCount, 3);
  assert.equal(report.resolvedChainCount, 2);
  assert.equal(report.sampleSizeState, 'SUFFICIENT');
});

test('a resolved chain without justified independence keeps independentN UNKNOWN', () => {
  const resolved = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'resolved', chainId: 'chain-A',
    independentUnitId: null, resolvedLabels: resolvedLabels({ chainId: 'chain-A' }) }));
  const report = buildHoldStrikeCohortReport([{ observation: resolved }], 1);
  assert.equal(report.resolvedChainCount, 1);
  assert.equal(report.independentN, null);
  assert.equal(report.sampleSizeState, 'NOT_ASSESSED');
});

test('invalid numeric evidence becomes UNKNOWN and crossed quotes do not claim known liquidity', () => {
  const observation = buildHoldStrikeCandidateObservation(candidateInput({
    dte: -1, delta: 0.4, underlyingPriceAtDecision: -200, expectedMoveDollars: -6,
    bid: 2, ask: 1, spreadPct: -0.5, openInterest: -1, volume: 1.5,
    impliedVolatility: -0.2, realizedVolatility: -0.1, multiplier: 0, quantity: 1.5, capitalAmount: -1,
  }));
  assert.equal(observation.dte, null);
  assert.equal(observation.delta, null);
  assert.equal(observation.underlyingPriceAtDecision, null);
  assert.equal(observation.expectedMoveDollars, null);
  assert.equal(observation.liquidityEvidenceState, 'UNKNOWN');
  assert.equal(observation.spreadPct, null);
  assert.equal(observation.openInterest, null);
  assert.equal(observation.volume, null);
  assert.equal(observation.impliedVolatility, null);
  assert.equal(observation.realizedVolatility, null);
  assert.equal(observation.multiplier, null);
  assert.equal(observation.quantity, null);
  assert.equal(observation.capitalAmount, null);
});

test('premium unit mismatches are structural evidence errors, never silently aggregated', () => {
  assert.throws(() => buildHoldStrikeCandidateObservation(candidateInput({ premiumPerContract: 149 })),
    /HOLD_STRIKE_PREMIUM_PER_CONTRACT_UNIT_MISMATCH/);
  assert.throws(() => buildHoldStrikeCandidateObservation(candidateInput({ quantity: 2, positionPremium: 150 })),
    /HOLD_STRIKE_POSITION_PREMIUM_UNIT_MISMATCH/);
});

test('repeated resolved observations for one chain contribute exactly one economic outcome', () => {
  const early = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'early', chainId: 'chain-A', independentUnitId: 'unit-1',
    resolvedLabels: resolvedLabels({ chainId: 'chain-A', asOf: '2026-09-24T14:00:00Z', wholeChainAfterCostPnl: known(100) }) }));
  const final = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'final', chainId: 'chain-A', independentUnitId: 'unit-1',
    resolvedLabels: resolvedLabels({ chainId: 'chain-A', asOf: '2026-09-25T14:00:00Z', wholeChainAfterCostPnl: known(140) }) }));
  const report = buildHoldStrikeCohortReport([{ observation: early }, { observation: final }], 1);
  assert.equal(report.resolvedObservationCount, 2);
  assert.equal(report.resolvedChainCount, 1);
  assert.equal(report.wholeChainAfterCostPnl.knownCount, 1);
  assert.equal(report.wholeChainAfterCostPnl.mean, 140);
});

test('conflicting outcomes for the same chain and resolution timestamp are rejected', () => {
  const first = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'first', chainId: 'chain-A',
    resolvedLabels: resolvedLabels({ chainId: 'chain-A', wholeChainAfterCostPnl: known(100) }) }));
  const conflicting = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'conflicting', chainId: 'chain-A',
    resolvedLabels: resolvedLabels({ chainId: 'chain-A', wholeChainAfterCostPnl: known(200) }) }));
  assert.throws(() => buildHoldStrikeCohortReport([{ observation: first }, { observation: conflicting }], 1),
    /HOLD_STRIKE_COHORT_CONFLICTING_CHAIN_OUTCOME/);
});

test('SHADOW and ACTUAL evidence cannot be silently pooled into one cohort', () => {
  const shadow = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'shadow' }));
  const actual = buildHoldStrikeCandidateObservation(candidateInput({ candidateId: 'actual', chainId: 'actual-chain',
    executionKind: 'PAPER_ACTUAL', environment: 'PAPER' }));
  assert.throws(() => buildHoldStrikeCohortReport([{ observation: shadow }, { observation: actual }], 1),
    /HOLD_STRIKE_COHORT_MIXED_EXECUTION_KIND/);
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
  const pairable = pairHoldStrikeWithConventional(holdStrike, conventionalFacts());
  assert.equal(pairable.pairable, true);
  assert.equal(pairable.brokerAuthority, false);
  const strikeDiff = pairable.differences.find((row) => row.dimension === 'strike');
  assert.equal(strikeDiff?.difference, -5); // 190 - 195

  const unpairable = pairHoldStrikeWithConventional(holdStrike, conventionalFacts({ snapshotId: 'snap-2' }));
  assert.equal(unpairable.pairable, false);
  assert.equal(unpairable.unpairableReason, 'SNAPSHOT_MISMATCH');
  assert.equal(unpairable.differences.length, 0);
});

test('pairing refuses timestamp or execution-evidence-class mismatch', () => {
  const holdStrike = buildHoldStrikeCandidateObservation(candidateInput());
  const timeMismatch = pairHoldStrikeWithConventional(holdStrike, conventionalFacts({ asOf: '2026-09-19T14:00:01Z' }));
  assert.equal(timeMismatch.unpairableReason, 'AS_OF_MISMATCH');
  const kindMismatch = pairHoldStrikeWithConventional(holdStrike, conventionalFacts({ executionKind: 'PAPER_ACTUAL' }));
  assert.equal(kindMismatch.unpairableReason, 'EXECUTION_KIND_MISMATCH');
});

test('a different underlying at the same snapshot is not paired, and no pairing output ever carries a winner field', () => {
  const holdStrike = buildHoldStrikeCandidateObservation(candidateInput({ snapshotId: 'snap-1', underlying: 'AAPL' }));
  const result = pairHoldStrikeWithConventional(holdStrike, conventionalFacts({ underlying: 'MSFT' }));
  assert.equal(result.pairable, false);
  assert.equal(result.unpairableReason, 'UNDERLYING_MISMATCH');

  const pairedResult = pairHoldStrikeWithConventional(holdStrike, conventionalFacts({
    breakEven: null, premiumPerShare: null, dte: null, delta: null, capitalAmount: null,
  }));
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
