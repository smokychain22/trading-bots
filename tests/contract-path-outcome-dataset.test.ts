import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWholeChainOutcomeRow } from '../src/research/whole-chain-outcome-builder.js';
import {
  buildContractPathOutcomeRow, classifyRejectedCandidateFavorablePath, type PathStatistics,
} from '../src/research/contract-path-outcome-dataset.js';

const EMPTY_STATS: PathStatistics = {
  maximumAdverseExcursion: null, maximumFavorableExcursion: null, peakProfit: null, worstProfit: null,
  giveback: null, timeToPeakSeconds: null, capitalDays: null, assignmentState: null, recoveryState: null, terminalState: null,
};

test('CORE CLAIM (directive central rule): SPY 590P rejected, SPY rises later -- this alone is NOT_IDENTIFIABLE, never a missed win', () => {
  const status = classifyRejectedCandidateFavorablePath({ hasMatchedCohortEvidence: false, hasModelBasedEstimate: false });
  assert.equal(status, 'NOT_IDENTIFIABLE');
});

test('with real matched-cohort evidence, the same rejected candidate becomes MATCHED_ESTIMABLE, still never FACTUAL', () => {
  const status = classifyRejectedCandidateFavorablePath({ hasMatchedCohortEvidence: true, hasModelBasedEstimate: false });
  assert.equal(status, 'MATCHED_ESTIMABLE');
});

test('ADVERSARIAL: an unselected candidate cannot be constructed with FACTUAL_OBSERVED regardless of its path', () => {
  assert.throws(() => buildContractPathOutcomeRow({
    subjectId: 'c1', decisionAt: '2026-09-26T14:00:00Z', wasSelected: false, wasShadowOnly: false,
    identifiabilityStatus: 'FACTUAL_OBSERVED', path: [], statistics: EMPTY_STATS,
  }), /CONTRACT_PATH_UNSELECTED_CANDIDATE_CANNOT_BE_FACTUAL_OBSERVED/);
});

test('a selected, resolved candidate can be FACTUAL_OBSERVED', () => {
  const wholeChain = buildWholeChainOutcomeRow({ chainId: 'wc1', strategyFamily: 'Q', rollCount: 0, dailyCapital: [], observationCutoffAt: '2026-09-27T00:00:00Z', isResolved: true,
    components: { cashflowBasis: 'ACTUAL_FILL_CASHFLOW', initialPutPremium: 100, putCloseCosts: 0, rollCredits: 0, rollCloseCosts: 0, assignmentStrike: null, stockSharesAssigned: 0, dividends: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0, stockSaleOrCallAwayProceeds: null, fees: 0, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: 0, currentStockMarkPerShare: null, openStockShares: 0 } });
  const row = buildContractPathOutcomeRow({
    subjectId: 'c2', decisionAt: '2026-09-26T14:00:00Z', wasSelected: true, wasShadowOnly: false,
    identifiabilityStatus: 'FACTUAL_OBSERVED', path: [], statistics: { ...EMPTY_STATS, terminalState: 'CHAIN_RESOLVED' },
    factualOutcome: { subjectId: 'c2', wholeChain },
  });
  assert.equal(row.identifiabilityStatus, 'FACTUAL_OBSERVED');
  assert.throws(() => buildContractPathOutcomeRow({ subjectId: row.subjectId, decisionAt: row.decisionAt, wasSelected: true, wasShadowOnly: false,
    identifiabilityStatus: 'FACTUAL_OBSERVED', path: [], statistics: row.statistics }), /FACTUAL_WHOLE_CHAIN_EVIDENCE_REQUIRED/);
});

test('ADVERSARIAL: a shadow-only prediction cannot claim OBSERVED_PARALLEL', () => {
  assert.throws(() => buildContractPathOutcomeRow({
    subjectId: 'c3', decisionAt: '2026-09-26T14:00:00Z', wasSelected: false, wasShadowOnly: true,
    identifiabilityStatus: 'OBSERVED_PARALLEL', path: [], statistics: EMPTY_STATS,
  }), /SHADOW_PREDICTION_CANNOT_BE_OBSERVED_PARALLEL/);
});
