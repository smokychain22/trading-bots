import assert from 'node:assert/strict';
import test from 'node:test';
import { buildThetaEntryOutcomeRow, type ThetaEntryOutcomeRow, type SourcedFeature } from '../src/research/theta-entry-outcome-dataset.js';
import { buildManagedEpisodeOutcomeDistribution } from '../src/research/managed-episode-outcome-distribution.js';

const DECISION_AT = '2026-09-22T14:00:00Z';

function known<T>(value: T, unit: string, overrides: Partial<SourcedFeature<T>> = {}): SourcedFeature<T> {
  return {
    value, unit, state: 'KNOWN', source: 'test', observedAt: '2026-09-22T13:59:00Z',
    availableAt: '2026-09-22T13:59:00Z', methodologyVersion: 'v1', pitStatus: 'CURRENT_ONLY', ...overrides,
  };
}
function unknown<T>(unit: string): SourcedFeature<T> {
  return { value: null, unit, state: 'UNKNOWN', source: 'test', observedAt: null, availableAt: null, methodologyVersion: 'v1', pitStatus: 'UNKNOWN_PIT' };
}

function baseRow(overrides: Partial<Omit<ThetaEntryOutcomeRow, 'contractVersion'>> = {}): Omit<ThetaEntryOutcomeRow, 'contractVersion'> {
  return {
    datasetRowId: 'row-1', cycleId: 'cycle-1', decisionId: 'dec-1', candidateId: 'cand-1', chainId: null,
    candidateObservedAt: '2026-09-22T13:58:00Z', featureAvailableAt: '2026-09-22T13:59:00Z', decisionAt: DECISION_AT, labelAvailableAt: null,
    canonicalSourceSha: 'sha1', releaseSha: null, policyVersion: 'v1', featureSchemaVersion: 'v1',
    underlying: {
      symbol: 'AAPL', underlyingPrice: known(190, 'USD'), dollarVolume: known(1e9, 'USD'),
      liquidityState: known('LIQUID', 'STATE'), trendState: unknown('STATE'), regimeState: unknown('STATE'), ownershipState: known('ELIGIBLE', 'STATE'),
    },
    contract: {
      optionType: 'PUT', expiration: '2026-10-17', calendarDte: 25, tradingSessionHorizon: unknown('SESSIONS'),
      strike: 185, signedDelta: known(-0.22, 'DECIMAL'), absoluteDelta: known(0.22, 'DECIMAL'), moneyness: known(0.026, 'DECIMAL'),
      multiplier: known(100, 'SHARES'),
    },
    execution: {
      bid: known(1.5, 'USD'), ask: known(1.6, 'USD'), mid: known(1.55, 'USD'), absoluteSpread: known(0.1, 'USD'), relativeSpread: known(0.065, 'DECIMAL'),
      quoteProviderTimestamp: '2026-09-22T13:59:30Z', quoteReceivedAt: '2026-09-22T13:59:45Z', quoteAgeAtDecisionSeconds: 15,
      feed: 'OPRA', quoteQuality: 'GOOD', executabilityState: 'EXECUTABLE',
    },
    volatility: {
      atmIv: known(0.28, 'DECIMAL'), rv20: known(0.22, 'DECIMAL'), vrp20: known(0.06, 'DECIMAL'),
      skew: unknown('DECIMAL'), termStructure: unknown('DECIMAL'), derivedExpectedMoveV1: known(8.5, 'USD'),
      gex: unknown('USD'), flow: unknown('DECIMAL'),
    },
    economics: {
      executableCredit: known(150, 'USD'), collateral: known(18500, 'USD'), premiumToCollateral: known(0.0081, 'DECIMAL'),
      breakeven: known(183.5, 'USD'), downsideCushion: known(0.034, 'DECIMAL'), estimatedCapitalDays: known(2500, 'USD_DAYS'),
    },
    events: {
      macroEventState: known('CLEAR', 'STATE'), earningsDistanceInSessions: known(30, 'SESSIONS'),
      earningsEvidenceState: 'KNOWN_EVENT_DISTANCE', earningsCoverageState: 'PARTIAL_COVERAGE',
      corporateActionState: unknown('STATE'), corporateActionCoverageState: 'PROVIDER_LIMITED',
    },
    portfolio: {
      buyingPower: known(10000, 'USD'), assignmentCapacity: known(2, 'CONTRACTS'), concentration: unknown('DECIMAL'),
      correlationState: unknown('STATE'), severeDownsideState: unknown('STATE'), aegisState: known('ALLOW_FULL', 'STATE'),
      selectedQty: 1, bindingSizingConstraint: 'ASSIGNMENT_CAPACITY',
    },
    censoredEpisode: false, outcome: null, ...overrides,
  };
}

test('accepts a real, well-formed entry row', () => {
  const row = buildThetaEntryOutcomeRow(baseRow());
  assert.equal(row.contractVersion, 'theta-entry-outcome-dataset-v1');
});

test('ADVERSARIAL: a future feature observedAt (after decisionAt) is rejected', () => {
  assert.throws(() => buildThetaEntryOutcomeRow(baseRow({
    execution: { ...baseRow().execution, bid: known(1.5, 'USD', { observedAt: '2026-09-22T15:00:00Z' }) },
  })), /ENTRY_ROW_FUTURE_FEATURE_TIMESTAMP/);
});

test('ADVERSARIAL: labelAvailableAt before decisionAt is rejected', () => {
  assert.throws(() => buildThetaEntryOutcomeRow(baseRow({ labelAvailableAt: '2026-09-22T10:00:00Z' })), /ENTRY_ROW_LABEL_AVAILABLE_BEFORE_DECISION/);
});

test('signed delta and absolute delta are preserved as distinct, independent fields', () => {
  const row = buildThetaEntryOutcomeRow(baseRow());
  assert.equal(row.contract.signedDelta.value, -0.22);
  assert.equal(row.contract.absoluteDelta.value, 0.22);
});

test('multiplier is a real SourcedFeature, never a hardcoded literal 100 in the type', () => {
  const row = buildThetaEntryOutcomeRow(baseRow({
    contract: { ...baseRow().contract, multiplier: known(10, 'SHARES') }, // a real non-standard multiplier
  }));
  assert.equal(row.contract.multiplier.value, 10);
});

test('calendarDte and tradingSessionHorizon are distinct fields, never conflated', () => {
  const row = buildThetaEntryOutcomeRow(baseRow({
    contract: { ...baseRow().contract, calendarDte: 25, tradingSessionHorizon: known(18, 'SESSIONS') },
  }));
  assert.equal(row.contract.calendarDte, 25);
  assert.equal(row.contract.tradingSessionHorizon.value, 18);
  assert.notEqual(row.contract.calendarDte, row.contract.tradingSessionHorizon.value);
});

test('a missing soft feature (skew/term/GEX/flow) remains an explicit UNKNOWN state, never a fabricated number', () => {
  const row = buildThetaEntryOutcomeRow(baseRow());
  assert.equal(row.volatility.skew.state, 'UNKNOWN');
  assert.equal(row.volatility.skew.value, null);
  assert.equal(row.volatility.gex.state, 'UNKNOWN');
});

test('CORE CLAIM: a censored episode stays censored -- outcome must itself report CENSORED, not a resolved number', () => {
  const censoredOutcome = buildManagedEpisodeOutcomeDistribution({
    episodeId: 'ep-1', asOf: DECISION_AT, censoredEpisode: true, outOfDomain: false,
    effectiveIndependentN: 100, minimumEffectiveN: 30, featureSchemaVersion: 'v1', modelVersion: 'v1',
    trainingStart: null, trainingEnd: null, sourceDatasetHash: null,
  });
  const row = buildThetaEntryOutcomeRow(baseRow({ censoredEpisode: true, outcome: censoredOutcome, labelAvailableAt: DECISION_AT }));
  assert.equal(row.outcome?.expectedNetPnl.state, 'CENSORED');
});

test('ADVERSARIAL: a censored row cannot carry a resolved (non-CENSORED) outcome', () => {
  const resolvedOutcome = buildManagedEpisodeOutcomeDistribution({
    episodeId: 'ep-1', asOf: DECISION_AT, censoredEpisode: false, outOfDomain: false,
    effectiveIndependentN: 100, minimumEffectiveN: 30, featureSchemaVersion: 'v1', modelVersion: 'v1',
    trainingStart: null, trainingEnd: null, sourceDatasetHash: null,
    realValues: { expectedNetPnl: 100 },
  });
  assert.throws(() => buildThetaEntryOutcomeRow(baseRow({
    censoredEpisode: true, outcome: resolvedOutcome, labelAvailableAt: DECISION_AT,
  })), /ENTRY_ROW_CENSORED_BUT_OUTCOME_NOT_CENSORED/);
});

test('missing earnings coverage can never become CLEAR -- structurally impossible per the EarningsEvidenceState type', () => {
  const row = buildThetaEntryOutcomeRow(baseRow({
    events: {
      ...baseRow().events, earningsEvidenceState: 'UNKNOWN', earningsCoverageState: 'UNKNOWN',
      earningsDistanceInSessions: unknown('SESSIONS'),
    },
  }));
  assert.equal(row.events.earningsEvidenceState, 'UNKNOWN');
  assert.notEqual(row.events.earningsEvidenceState as string, 'CLEAR');
});

test('ADVERSARIAL: no missing numeric silently becomes 0 -- UNKNOWN features carry value=null, never 0', () => {
  const row = buildThetaEntryOutcomeRow(baseRow());
  assert.equal(row.underlying.trendState.value, null);
  assert.notEqual(row.underlying.trendState.value, 0);
  assert.equal(row.volatility.flow.value, null);
});

test('ADVERSARIAL: no future label leakage -- an outcome requires labelAvailableAt to be present and not before decisionAt', () => {
  const resolvedOutcome = buildManagedEpisodeOutcomeDistribution({
    episodeId: 'ep-1', asOf: DECISION_AT, censoredEpisode: false, outOfDomain: false,
    effectiveIndependentN: 100, minimumEffectiveN: 30, featureSchemaVersion: 'v1', modelVersion: 'v1',
    trainingStart: null, trainingEnd: null, sourceDatasetHash: null, realValues: { expectedNetPnl: 50 },
  });
  assert.throws(() => buildThetaEntryOutcomeRow(baseRow({ outcome: resolvedOutcome, labelAvailableAt: null })),
    /ENTRY_ROW_OUTCOME_WITHOUT_LABEL_AVAILABLE_AT/);
});

test('ADVERSARIAL: a KNOWN feature with a null value is rejected -- state and value must agree', () => {
  assert.throws(() => buildThetaEntryOutcomeRow(baseRow({
    underlying: { ...baseRow().underlying, underlyingPrice: { ...known(190, 'USD'), value: null } },
  })), /ENTRY_ROW_KNOWN_FEATURE_WITH_NULL_VALUE/);
});

test('ADVERSARIAL: candidateObservedAt after decisionAt is rejected', () => {
  assert.throws(() => buildThetaEntryOutcomeRow(baseRow({ candidateObservedAt: '2026-09-22T15:00:00Z' })), /ENTRY_ROW_FUTURE_CANDIDATE_OBSERVED_AT/);
});
