import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRecoveryCoveredCallExperiment,
  type RecoveryCoveredCallAlternativeInput,
} from '../src/research/recovery-covered-call-experiment.js';
import type { WholeChainComponents } from '../src/theta/whole-chain-economics.js';

const decisionAt = '2026-09-22T14:00:00Z';
const horizonAt = '2026-10-22T20:00:00Z';

const components = (overrides: Partial<WholeChainComponents> = {}): WholeChainComponents => ({
  cashflowBasis: 'ACTUAL_FILL_CASHFLOW', initialPutPremium: 500, putCloseCosts: 0,
  rollCredits: 0, rollCloseCosts: 0, assignmentStrike: 100, stockSharesAssigned: 100,
  dividends: 0, coveredCallPremium: 200, coveredCallCloseCosts: 0,
  stockSaleOrCallAwayProceeds: 11_000, fees: 5, executionCostNotEmbeddedInCashflows: 0,
  tcaExecutionShortfall: 2, currentStockMarkPerShare: null, openStockShares: 0,
  ...overrides,
});

const alternative = (
  overrides: Partial<RecoveryCoveredCallAlternativeInput> = {},
): RecoveryCoveredCallAlternativeInput => ({
  action: 'SELL_STOCK', commonFutureHorizonAt: horizonAt, resolution: 'RESOLVED',
  basisComponents: components({ stockSaleOrCallAwayProceeds: null, currentStockMarkPerShare: 102, openStockShares: 100 }),
  outcomeComponents: components(), dividendEvidenceState: 'KNOWN', eventEvidenceState: 'KNOWN',
  ccRollCost: null, callAwayStrike: null, retainedUpside: 0, lostUpside: 0,
  remainingDownside: 0, capitalDays: 30, slippage: 3, evidenceIds: ['outcome-1'],
  labelAvailableAt: horizonAt, ...overrides,
});

const experiment = (overrides: Partial<Parameters<typeof buildRecoveryCoveredCallExperiment>[0]> = {}) => ({
  experimentId: 'experiment-1', chainId: 'chain-1', decisionId: 'decision-1', decisionAt,
  commonFutureHorizonAt: horizonAt, stage: 'ASSIGNED_STOCK' as const,
  alternatives: [alternative()], ...overrides,
});

test('produces a descriptive research comparison with no selected action or broker authority', () => {
  const result = buildRecoveryCoveredCallExperiment(experiment());
  assert.equal(result.comparisonState, 'DESCRIPTIVE_NO_RANKING');
  assert.equal(result.brokerAuthority, false);
  assert.ok(!('selectedAction' in result));
  assert.ok(!('winner' in result));
});

test('positive covered-call premium alone cannot select SELL_CC', () => {
  const result = buildRecoveryCoveredCallExperiment(experiment({ alternatives: [alternative({
    action: 'SELL_CC',
    outcomeComponents: components({ coveredCallPremium: 1_000 }),
  })] }));
  assert.equal(result.alternatives[0]?.ccPremium, 1_000);
  assert.ok(!('selected' in (result.alternatives[0] ?? {})));
  assert.ok(!('score' in (result.alternatives[0] ?? {})));
});

test('lost and retained upside are explicit rather than hidden inside premium', () => {
  const result = buildRecoveryCoveredCallExperiment(experiment({ alternatives: [alternative({
    action: 'SELL_CC', retainedUpside: 500, lostUpside: 800, remainingDownside: 1_500,
  })] }));
  assert.equal(result.alternatives[0]?.retainedUpside, 500);
  assert.equal(result.alternatives[0]?.lostUpside, 800);
  assert.equal(result.alternatives[0]?.remainingDownside, 1_500);
});

test('call-away requires and preserves strike, proceeds, and stock PnL economics', () => {
  const result = buildRecoveryCoveredCallExperiment(experiment({
    stage: 'COVERED_CALL_OPEN',
    alternatives: [alternative({
      action: 'ALLOW_CALL_AWAY', callAwayStrike: 110,
      outcomeComponents: components({ stockSaleOrCallAwayProceeds: 11_000 }),
    })],
  }));
  assert.equal(result.alternatives[0]?.callAwayStrike, 110);
  assert.equal(result.alternatives[0]?.stockPnl, 1_000);
  assert.equal(result.alternatives[0]?.wholeChain?.wholeChainPnl, 1_695);
});

test('call-away rejects gross proceeds inconsistent with strike and shares', () => {
  assert.throws(() => buildRecoveryCoveredCallExperiment(experiment({
    stage: 'COVERED_CALL_OPEN',
    alternatives: [alternative({
      action: 'ALLOW_CALL_AWAY', callAwayStrike: 110,
      outcomeComponents: components({ stockSaleOrCallAwayProceeds: 10_900 }),
    })],
  })), /RECOVERY_CC_CALL_AWAY_PROCEEDS_IDENTITY_FAILED/);
});

test('initial CSP premium participates in canonical effective stock basis', () => {
  const withPremium = buildRecoveryCoveredCallExperiment(experiment()).alternatives[0];
  const withoutPremium = buildRecoveryCoveredCallExperiment(experiment({ alternatives: [alternative({
    basisComponents: components({
      initialPutPremium: 0, stockSaleOrCallAwayProceeds: null, currentStockMarkPerShare: 102, openStockShares: 100,
    }),
  })] })).alternatives[0];
  assert.equal(withPremium?.initialCspPremium, 500);
  assert.equal(withPremium?.effectiveStockBasis, 95.05);
  assert.equal(withoutPremium?.effectiveStockBasis, 100.05);
});

test('censored recovery stays censored and cannot carry future outcome values', () => {
  const censored = alternative({
    action: 'RECOVERY_WAIT', resolution: 'CENSORED', outcomeComponents: null,
    retainedUpside: null, lostUpside: null, remainingDownside: null, capitalDays: null,
    slippage: null, evidenceIds: [], labelAvailableAt: null,
  });
  const result = buildRecoveryCoveredCallExperiment(experiment({ alternatives: [censored] }));
  assert.equal(result.alternatives[0]?.wholeChain, null);
  assert.throws(() => buildRecoveryCoveredCallExperiment(experiment({ alternatives: [{
    ...censored, lostUpside: 10,
  }] })), /RECOVERY_CC_CENSORED_OUTCOME_HAS_FUTURE_VALUES/);
});

test('unknown dividend or event context remains partial and cannot claim resolution', () => {
  const partialComponents = components({ dividends: null });
  const result = buildRecoveryCoveredCallExperiment(experiment({ alternatives: [alternative({
    resolution: 'PARTIAL', outcomeComponents: partialComponents,
    basisComponents: components({
      dividends: null, stockSaleOrCallAwayProceeds: null, currentStockMarkPerShare: 102, openStockShares: 100,
    }),
    dividendEvidenceState: 'UNKNOWN', eventEvidenceState: 'UNKNOWN',
  })] }));
  assert.equal(result.alternatives[0]?.resolution, 'PARTIAL');
  assert.equal(result.alternatives[0]?.dividends, null);
  assert.throws(() => buildRecoveryCoveredCallExperiment(experiment({ alternatives: [alternative({
    dividendEvidenceState: 'UNKNOWN', eventEvidenceState: 'UNKNOWN',
  })] })), /RECOVERY_CC_UNKNOWN_DIVIDEND_HAS_VALUE|RECOVERY_CC_RESOLVED_WITH_UNKNOWN_CONTEXT/);
});

test('ROLL_CC has a separate roll cost and only applies in the covered-call stage', () => {
  const result = buildRecoveryCoveredCallExperiment(experiment({
    stage: 'COVERED_CALL_OPEN', alternatives: [alternative({ action: 'ROLL_CC', ccRollCost: 90 })],
  }));
  assert.equal(result.alternatives[0]?.ccRollCost, 90);
  assert.throws(() => buildRecoveryCoveredCallExperiment(experiment({
    alternatives: [alternative({ action: 'ROLL_CC', ccRollCost: 90 })],
  })), /RECOVERY_CC_ACTION_NOT_APPLICABLE_TO_STAGE/);
});

test('alternatives share one common future horizon and cannot duplicate actions', () => {
  assert.throws(() => buildRecoveryCoveredCallExperiment(experiment({ alternatives: [alternative({
    commonFutureHorizonAt: '2026-11-22T20:00:00Z',
  })] })), /RECOVERY_CC_HORIZON_MISMATCH/);
  assert.throws(() => buildRecoveryCoveredCallExperiment(experiment({ alternatives: [alternative(), alternative()] })),
    /RECOVERY_CC_DUPLICATE_ACTION/);
});
