import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeManagementCounterfactuals } from '../src/research/management-counterfactual-analysis.js';
import {
  buildCoveredCallCohortReport, buildCoveredCallObservation, buildLifecycleManagementCounterfactualInput,
  buildRecoveryCohortReport, buildRecoveryObservation,
  type CoveredCallObservationInput, type RecoveryObservationInput,
} from '../src/research/recovery-covered-call-cohort.js';
import { r6OutcomeLabelVersion, type R6Label, type R6OutcomeLabelSet } from '../src/research/r6-outcome-labels.js';
import { wholeChainEconomicsVersion, type EffectiveStockBasisResult } from '../src/theta/whole-chain-economics.js';

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
  assignmentOccurred: known(true), recoveryDurationDays: known(12), recoverySuccess: known(true),
  coveredCallPremiumContribution: known(80), stockPnlContribution: known(60), calledAwayOccurred: known(false),
  executionSlippage: known(2), fillRate: known(1), timeToFillSeconds: known(3),
  resolvedPositive: known(true), brokerAuthority: false, ...overrides,
});

const basis = (overrides: Partial<EffectiveStockBasisResult> = {}): EffectiveStockBasisResult => ({
  contractVersion: wholeChainEconomicsVersion, effectiveStockBasisPerShare: 190, complete: true, missingComponents: [], ...overrides,
});

const recoveryInput = (overrides: Partial<RecoveryObservationInput> = {}): RecoveryObservationInput => ({
  snapshotId: 'snap-1', decisionId: 'dec-1', chainId: 'chain-1', episodeId: null, independentUnitId: null,
  strategyVersion: 'theta-recovery-1.0.0-research', environment: 'SHADOW', executionKind: 'SHADOW_CANDIDATE',
  asOf: '2026-09-19T14:00:00Z', underlying: 'AAPL', selectedAction: 'RECOVERY_WAIT', assignedAt: '2026-09-18T20:00:00Z',
  basis: basis(), currentStockPriceAtDecision: 192, stockSharesHeld: 100, capitalAmount: 19000,
  ownershipScore: 0.6, eventRisk: 'ABSENT_VERIFIED', impliedVolatility: 0.3, realizedVolatility: 0.25, ivMinusRv: 0.05,
  resolvedLabels: null, ...overrides,
});

const ccInput = (overrides: Partial<CoveredCallObservationInput> = {}): CoveredCallObservationInput => ({
  snapshotId: 'snap-1', candidateId: 'cc-1', decisionId: 'dec-1', chainId: 'chain-1', episodeId: null, independentUnitId: null,
  strategyVersion: 'theta-covered-call-1.0.0-research', environment: 'SHADOW', executionKind: 'SHADOW_CANDIDATE',
  asOf: '2026-09-19T14:00:00Z', underlying: 'AAPL', optionSymbol: 'AAPL260925C00200000', expiration: '2026-09-25',
  dte: 6, delta: 0.28, strike: 200, managementAction: 'SELL_CC',
  sharesHeld: 100, quantity: 1, multiplier: 100, premiumPerShare: 1.2, premiumPerContract: 120, positionPremium: 120,
  bid: 1.15, ask: 1.25, spreadPct: 0.08, openInterest: 400, volume: 80,
  stockPriceAtDecision: 195, basis: basis(), expectedMoveDollars: 5, impliedVolatility: 0.26, ivRank: 0.35,
  realizedVolatility: 0.22, ivMinusRv: 0.04, skew25Delta: 0.02, termSlope: -0.01, eventRisk: 'ABSENT_VERIFIED',
  recordedAegisState: 'PERMITTED', resolvedLabels: null, ...overrides,
});

// --------------------- Recovery observation tests ---------------------

test('builds a valid unresolved RECOVERY_WAIT observation with correct stock geometry', () => {
  const observation = buildRecoveryObservation(recoveryInput());
  assert.equal(observation.resolutionState, 'UNRESOLVED');
  assert.equal(observation.geometry.stockPriceMinusBasisPerShare, 2); // 192 - 190
  assert.ok(Math.abs((observation.geometry.stockReturnSinceAssignmentPercent as number) - (2 / 190)) < 1e-9);
  assert.equal(observation.basisEvidenceState, 'KNOWN');
  assert.equal(observation.brokerAuthority, false);
});

test('a resolved SELL_STOCK observation is accepted when chainId matches and label timestamp is later', () => {
  const observation = buildRecoveryObservation(recoveryInput({
    selectedAction: 'SELL_STOCK', resolvedLabels: resolvedLabels({ chainId: 'chain-1' }),
  }));
  assert.equal(observation.resolutionState, 'RESOLVED');
});

test('a resolved SELL_CC recovery action is accepted', () => {
  const observation = buildRecoveryObservation(recoveryInput({
    selectedAction: 'SELL_CC', resolvedLabels: resolvedLabels({ chainId: 'chain-1' }),
  }));
  assert.equal(observation.resolutionState, 'RESOLVED');
  assert.equal(observation.selectedAction, 'SELL_CC');
});

test('same chain duplicate protection: duplicate snapshotId+decisionId is rejected in the cohort builder', () => {
  const o1 = buildRecoveryObservation(recoveryInput({ snapshotId: 'dup-snap', decisionId: 'dup-dec' }));
  const o2 = buildRecoveryObservation(recoveryInput({ snapshotId: 'dup-snap', decisionId: 'dup-dec' }));
  assert.throws(
    () => buildRecoveryCohortReport([{ observation: o1 }, { observation: o2 }], 1),
    /RECOVERY_COHORT_DUPLICATE_OBSERVATION_IDENTITY/,
  );
});

test('different chains report distinctChainCount correctly', () => {
  const o1 = buildRecoveryObservation(recoveryInput({ decisionId: 'd1', chainId: 'chain-A' }));
  const o2 = buildRecoveryObservation(recoveryInput({ decisionId: 'd2', chainId: 'chain-B' }));
  const report = buildRecoveryCohortReport([{ observation: o1 }, { observation: o2 }], 1);
  assert.equal(report.distinctChainCount, 2);
});

test('independentUnitId known for every resolved chain yields a real independentN per action', () => {
  const o1 = buildRecoveryObservation(recoveryInput({
    decisionId: 'd1', chainId: 'chain-A', independentUnitId: 'unit-1', resolvedLabels: resolvedLabels({ chainId: 'chain-A' }),
  }));
  const o2 = buildRecoveryObservation(recoveryInput({
    decisionId: 'd2', chainId: 'chain-B', independentUnitId: 'unit-2', resolvedLabels: resolvedLabels({ chainId: 'chain-B' }),
  }));
  const report = buildRecoveryCohortReport([{ observation: o1 }, { observation: o2 }], 2);
  const waitAction = report.actionBreakdown.find((row) => row.action === 'RECOVERY_WAIT');
  assert.equal(waitAction?.independentN, 2);
  assert.equal(waitAction?.sampleSizeState, 'SUFFICIENT');
});

test('independentUnitId missing for a resolved chain makes independentN null (NOT_ASSESSED), never inferred from chain count', () => {
  const o1 = buildRecoveryObservation(recoveryInput({
    decisionId: 'd1', chainId: 'chain-A', independentUnitId: null, resolvedLabels: resolvedLabels({ chainId: 'chain-A' }),
  }));
  const report = buildRecoveryCohortReport([{ observation: o1 }], 1);
  const waitAction = report.actionBreakdown.find((row) => row.action === 'RECOVERY_WAIT');
  assert.equal(waitAction?.independentN, null);
  assert.equal(waitAction?.sampleSizeState, 'NOT_ASSESSED');
});

test('partial metric missingness reports PARTIAL data quality, never a fabricated zero for the missing metric', () => {
  const o1 = buildRecoveryObservation(recoveryInput({
    decisionId: 'd1', chainId: 'chain-A',
    resolvedLabels: resolvedLabels({ chainId: 'chain-A', mfe: unk(), mae: unk() }),
  }));
  const report = buildRecoveryCohortReport([{ observation: o1 }], 1);
  const waitAction = report.actionBreakdown.find((row) => row.action === 'RECOVERY_WAIT');
  assert.equal(waitAction?.dataQualityState, 'PARTIAL');
  assert.equal(waitAction?.mfe.mean, null);
  assert.equal(waitAction?.mfe.missingCount, 1);
});

test('UNKNOWN event/vol fields remain UNKNOWN, never coerced', () => {
  const observation = buildRecoveryObservation(recoveryInput({ eventRisk: 'UNKNOWN', realizedVolatility: null }));
  assert.equal(observation.eventRisk, 'UNKNOWN');
  assert.equal(observation.realizedVolatility, null);
});

test('an invalid timestamp is rejected with no silent sorting', () => {
  assert.throws(() => buildRecoveryObservation(recoveryInput({ asOf: 'not-a-date' })), /RECOVERY_TIMESTAMP_INVALID/);
  assert.throws(() => buildRecoveryObservation(recoveryInput({ assignedAt: 'garbage' })), /RECOVERY_ASSIGNED_AT_INVALID/);
  assert.throws(
    () => buildRecoveryObservation(recoveryInput({ asOf: '2026-09-18T10:00:00Z', assignedAt: '2026-09-19T10:00:00Z' })),
    /RECOVERY_ASSIGNED_AT_AFTER_DECISION/,
  );
});

test('a resolved chainId mismatch is rejected', () => {
  assert.throws(
    () => buildRecoveryObservation(recoveryInput({ chainId: 'chain-1', resolvedLabels: resolvedLabels({ chainId: 'chain-2' }) })),
    /RECOVERY_RESOLVED_CHAIN_ID_MISMATCH/,
  );
});

test('environment separation: a PAPER_ACTUAL execution kind requires PAPER environment', () => {
  assert.throws(
    () => buildRecoveryObservation(recoveryInput({ executionKind: 'PAPER_ACTUAL', environment: 'SHADOW' })),
    /RECOVERY_PAPER_ACTUAL_ENVIRONMENT_MISMATCH/,
  );
});

test('actual vs counterfactual separation: buildLifecycleManagementCounterfactualInput assembles without validating, and the canonical engine still enforces leakage', () => {
  const counterfactualInput = buildLifecycleManagementCounterfactualInput({
    decisionId: 'dec-1', chainId: 'chain-1', decidedAt: '2026-09-19T14:00:00Z', featureCutoff: '2026-09-19T15:00:00Z',
    selectedAction: 'RECOVERY_WAIT',
    actualOutcome: {
      action: 'RECOVERY_WAIT', source: 'BROKER_ACTUAL', state: 'RESOLVED', labelAvailableAt: '2026-09-25T14:00:00Z',
      wholeChainNetPnl: 100, returnPerCapitalDay: 0.01, maxAdverseExcursion: -20, executionCost: 0,
      fillModelVersion: null, evidenceId: 'actual-1',
    },
    alternativeOutcomes: [{
      action: 'SELL_STOCK', source: 'DEFENSIBLE_REPLAY', state: 'RESOLVED', labelAvailableAt: '2026-09-25T14:00:00Z',
      wholeChainNetPnl: 80, returnPerCapitalDay: 0.008, maxAdverseExcursion: -10, executionCost: 5,
      fillModelVersion: 'replay-v1', evidenceId: 'alt-1',
    }],
  });
  // Feature cutoff AFTER decidedAt is future leakage -- the canonical engine, not this adapter, must catch it.
  assert.throws(() => analyzeManagementCounterfactuals(counterfactualInput), /FEATURE_LEAKAGE/);
});

// --------------------- Covered-Call observation tests ---------------------

test('builds a valid SELL_CC observation with correct OCC identity and strike geometry', () => {
  const observation = buildCoveredCallObservation(ccInput());
  assert.equal(observation.resolutionState, 'UNRESOLVED');
  assert.equal(observation.geometry.strikeMinusStockPrice, 5); // 200 - 195
  assert.equal(observation.geometry.strikeMinusBasisPerShare, 10); // 200 - 190
  assert.equal(observation.liquidityEvidenceState, 'KNOWN');
});

test('insufficient covered shares is rejected as a research-record consistency defect', () => {
  assert.throws(
    () => buildCoveredCallObservation(ccInput({ quantity: 2, multiplier: 100, sharesHeld: 100 })), // needs 200, has 100
    /COVERED_CALL_INSUFFICIENT_SHARE_COVERAGE/,
  );
});

test('an OCC symbol that is not a CALL is rejected for a covered-call observation', () => {
  assert.throws(
    () => buildCoveredCallObservation(ccInput({ optionSymbol: 'AAPL260925P00200000' })),
    /COVERED_CALL_CONTRACT_NOT_CALL/,
  );
});

test('a normal CC close is a valid CLOSE_CC observation', () => {
  const observation = buildCoveredCallObservation(ccInput({ managementAction: 'CLOSE_CC' }));
  assert.equal(observation.managementAction, 'CLOSE_CC');
});

test('a CC roll is a valid ROLL_CC observation, distinguishable from a fresh SELL_CC', () => {
  const observation = buildCoveredCallObservation(ccInput({
    candidateId: 'cc-roll-1', managementAction: 'ROLL_CC', strike: 205, optionSymbol: 'AAPL260925C00205000',
  }));
  assert.equal(observation.managementAction, 'ROLL_CC');
});

test('worthless expiry maps to CLOSE_CC/ALLOW_CALL_AWAY vocabulary and does not force whole-chain resolution', () => {
  const observation = buildCoveredCallObservation(ccInput({ managementAction: 'ALLOW_CALL_AWAY', resolvedLabels: null }));
  assert.equal(observation.resolutionState, 'UNRESOLVED'); // chain may continue -- no forced resolution
});

test('a call-away observation is a valid ALLOW_CALL_AWAY row', () => {
  const observation = buildCoveredCallObservation(ccInput({
    managementAction: 'ALLOW_CALL_AWAY', resolvedLabels: resolvedLabels({ chainId: 'chain-1', calledAwayOccurred: known(true) }),
  }));
  assert.equal(observation.resolvedLabels?.calledAwayOccurred.value, true);
});

test('unknown premium is treated as UNKNOWN, never fabricated', () => {
  const observation = buildCoveredCallObservation(ccInput({ premiumPerShare: null, premiumPerContract: null, positionPremium: null }));
  assert.equal(observation.premiumPerShare, null);
});

test('a nonstandard multiplier is supported and premium unit consistency is enforced against it', () => {
  const observation = buildCoveredCallObservation(ccInput({ multiplier: 10, premiumPerShare: 1.2, premiumPerContract: 12, positionPremium: 12 }));
  assert.equal(observation.multiplier, 10);
  assert.throws(
    () => buildCoveredCallObservation(ccInput({ multiplier: 10, premiumPerShare: 1.2, premiumPerContract: 120 })),
    /COVERED_CALL_PREMIUM_PER_CONTRACT_UNIT_MISMATCH/,
  );
});

test('a duplicate CC observation identity is rejected in the cohort builder', () => {
  const o1 = buildCoveredCallObservation(ccInput({ snapshotId: 'dup', candidateId: 'dup-cand' }));
  const o2 = buildCoveredCallObservation(ccInput({ snapshotId: 'dup', candidateId: 'dup-cand' }));
  assert.throws(
    () => buildCoveredCallCohortReport([{ observation: o1 }, { observation: o2 }], 1),
    /COVERED_CALL_COHORT_DUPLICATE_OBSERVATION_IDENTITY/,
  );
});

test('same chain, multiple CC episodes (SELL then ROLL): chain-level final outcome is not double counted', () => {
  const sellEpisode = buildCoveredCallObservation(ccInput({
    candidateId: 'cc-sell', managementAction: 'SELL_CC', chainId: 'chain-X', resolvedLabels: null,
  }));
  const rollEpisode = buildCoveredCallObservation(ccInput({
    candidateId: 'cc-roll', managementAction: 'ROLL_CC', chainId: 'chain-X',
    resolvedLabels: resolvedLabels({ chainId: 'chain-X' }),
  }));
  const report = buildCoveredCallCohortReport([{ observation: sellEpisode }, { observation: rollEpisode }], 1);
  const rollAction = report.actionBreakdown.find((row) => row.action === 'ROLL_CC');
  assert.equal(rollAction?.resolvedChainCount, 1); // one chain, one resolved outcome
  assert.equal(report.distinctChainCount, 1);
  assert.equal(report.rawObservationCount, 2); // both episodes still counted as raw rows
});

test('PIT failure: a resolved label timestamped at or before the decision is rejected', () => {
  assert.throws(
    () => buildCoveredCallObservation(ccInput({
      asOf: '2026-09-25T15:00:00Z', resolvedLabels: resolvedLabels({ chainId: 'chain-1', asOf: '2026-09-25T14:00:00Z' }),
    })),
    /COVERED_CALL_RESOLVED_LABEL_TIME_LEAKAGE/,
  );
});

test('environment separation: mixing SHADOW and PAPER observations remains explicit per-observation, never averaged silently', () => {
  const shadow = buildCoveredCallObservation(ccInput({ candidateId: 'cc-shadow', environment: 'SHADOW', executionKind: 'SHADOW_CANDIDATE' }));
  const paperActual = buildCoveredCallObservation(ccInput({
    candidateId: 'cc-paper', environment: 'PAPER', executionKind: 'PAPER_ACTUAL',
  }));
  assert.notEqual(shadow.environment, paperActual.environment);
  assert.notEqual(shadow.executionKind, paperActual.executionKind);
});

test('a PAPER_ACTUAL covered call requires the PAPER environment', () => {
  assert.throws(
    () => buildCoveredCallObservation(ccInput({ executionKind: 'PAPER_ACTUAL', environment: 'SHADOW' })),
    /COVERED_CALL_PAPER_ACTUAL_ENVIRONMENT_MISMATCH/,
  );
});

test('no cohort report or observation from this module carries a decision-shaped field name', () => {
  const recoveryObservation = buildRecoveryObservation(recoveryInput());
  const recoveryReport = buildRecoveryCohortReport([{ observation: recoveryObservation }], 1);
  const ccObservation = buildCoveredCallObservation(ccInput());
  const ccReport = buildCoveredCallCohortReport([{ observation: ccObservation }], 1);
  const forbidden = ['bestrecoveryaction', 'recommendedaction', 'shouldsellcc', 'winner', 'preferred', 'eligible', 'applicable'];
  for (const object of [recoveryObservation, recoveryReport, ccObservation, ccReport]) {
    const keys = Object.keys(object).map((key) => key.toLowerCase());
    for (const name of forbidden) assert.ok(!keys.includes(name), `must not carry: ${name}`);
  }
  assert.equal(recoveryReport.brokerAuthority, false);
  assert.equal(ccReport.brokerAuthority, false);
});

test('an empty cohort for either module is valid with zero counts and no fabricated averages', () => {
  const recoveryReport = buildRecoveryCohortReport([], 1);
  assert.equal(recoveryReport.rawObservationCount, 0);
  assert.equal(recoveryReport.actionBreakdown.every((row) => row.sampleSizeState === 'NONE'), true);
  const ccReport = buildCoveredCallCohortReport([], 1);
  assert.equal(ccReport.rawObservationCount, 0);
});
