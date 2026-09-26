import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWholeChainOutcomeRow } from '../src/research/whole-chain-outcome-builder.js';
import type { WholeChainComponents } from '../src/theta/whole-chain-economics.js';

function baseComponents(overrides: Partial<WholeChainComponents> = {}): WholeChainComponents {
  return {
    cashflowBasis: 'ACTUAL_FILL_CASHFLOW', initialPutPremium: 100, putCloseCosts: 0,
    rollCredits: 0, rollCloseCosts: 0, assignmentStrike: null, stockSharesAssigned: 0,
    dividends: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0, stockSaleOrCallAwayProceeds: null,
    fees: 0, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: 0,
    currentStockMarkPerShare: null, openStockShares: 0, ...overrides,
  };
}

test('a resolved chain with complete components is FACTUAL_OBSERVED', () => {
  const row = buildWholeChainOutcomeRow({
    chainId: 'wc1', strategyFamily: 'THETA_CONVENTIONAL', rollCount: 0,
    components: baseComponents(), dailyCapital: [], observationCutoffAt: '2026-09-25T00:00:00Z', isResolved: true,
  });
  assert.equal(row.state, 'CHAIN_RESOLVED');
  assert.equal(row.identifiabilityStatus, 'FACTUAL_OBSERVED');
  assert.equal(row.pnl.wholeChainPnl, 100);
});

test('an unresolved chain at cutoff is CHAIN_CENSORED, never dropped, identifiability NOT_IDENTIFIABLE', () => {
  const row = buildWholeChainOutcomeRow({
    chainId: 'wc2', strategyFamily: 'THETA_CONVENTIONAL', rollCount: 1,
    components: baseComponents(), dailyCapital: [], observationCutoffAt: '2026-09-25T00:00:00Z', isResolved: false,
  });
  assert.equal(row.state, 'CHAIN_CENSORED');
  assert.equal(row.identifiabilityStatus, 'NOT_IDENTIFIABLE');
});

test('CORE CLAIM: a roll is preserved as a separate credit/cost, never netting away a prior realized loss', () => {
  const row = buildWholeChainOutcomeRow({
    chainId: 'wc3', strategyFamily: 'THETA_CONVENTIONAL', rollCount: 1,
    components: baseComponents({ initialPutPremium: 100, putCloseCosts: 300, rollCredits: 50, rollCloseCosts: 0 }),
    dailyCapital: [], observationCutoffAt: '2026-09-25T00:00:00Z', isResolved: true,
  });
  // Old-leg loss (100 - 300 = -200) is still present in the total even though a roll credit exists.
  assert.equal(row.pnl.wholeChainPnl, 100 - 300 + 50);
});

test('rollCount is reported, never used to fabricate independent trade counts', () => {
  const row = buildWholeChainOutcomeRow({
    chainId: 'wc4', strategyFamily: 'THETA_DEFINED_RISK', rollCount: 3,
    components: baseComponents(), dailyCapital: [], observationCutoffAt: '2026-09-25T00:00:00Z', isResolved: true,
  });
  assert.equal(row.rollCount, 3);
  assert.equal(row.chainId, 'wc4');
});
