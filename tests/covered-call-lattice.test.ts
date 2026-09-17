import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateCoveredCallCandidates, selectableCoveredCallCandidates, type CoveredCallCandidate,
} from '../src/theta/covered-call-lattice.js';
import type { WholeChainComponents } from '../src/theta/whole-chain-economics.js';

const wholeChainBase: Omit<WholeChainComponents, 'coveredCallPremium' | 'coveredCallCloseCosts' | 'stockSaleOrCallAwayProceeds' | 'currentStockMarkPerShare' | 'openStockShares'> = {
  initialPutPremium: 200, rollCredits: 0, rollCloseCosts: 0, assignmentStrike: 195, stockSharesAssigned: 100,
  dividends: 0, fees: 2, slippage: 0,
};

const candidate = (overrides: Partial<CoveredCallCandidate> = {}): CoveredCallCandidate => ({
  symbol: 'AAPL261016C00200000', optionContractId: 'cc-1', strike: 200, expiration: '2026-10-16', delta: 0.3,
  bid: 1, ask: 1.1, multiplier: 100, quantity: 1, openInterest: 500, volume: 100,
  dividendExDateRisk: false, eventRisk: false, ...overrides,
});

test('computes premium income, call-away price, and both whole-chain P&L scenarios for an at/above-basis candidate', () => {
  const [assessment] = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [candidate()]);
  assert.ok(assessment !== undefined);
  assert.equal(assessment.premiumIncomeDollars, 105);
  assert.equal(assessment.callAwayPriceDollars, 200 * 100);
  assert.equal(assessment.belowBasis, false);
  assert.notEqual(assessment.wholeChainPnlIfCalledAway, null);
  assert.notEqual(assessment.wholeChainPnlIfNotCalled, null);
  assert.notEqual(assessment.wholeChainPnlIfCalledAway, assessment.wholeChainPnlIfNotCalled);
});

test('flags a below-basis candidate but does not discard it from the assessment list', () => {
  const [assessment] = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [candidate({ strike: 190 })]);
  assert.equal(assessment?.belowBasis, true);
  assert.ok(assessment?.reasons.includes('BELOW_BASIS_REJECTED_BY_DEFAULT_CONSERVATIVE_POSTURE'));
});

test('selectableCoveredCallCandidates excludes below-basis candidates by default but includes them when explicitly allowed', () => {
  const assessments = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase,
    [candidate({ optionContractId: 'above', strike: 200 }), candidate({ optionContractId: 'below', strike: 190 })]);
  const defaultSelectable = selectableCoveredCallCandidates(assessments);
  assert.equal(defaultSelectable.length, 1);
  assert.equal(defaultSelectable[0]?.candidate.optionContractId, 'above');

  const allowedSelectable = selectableCoveredCallCandidates(assessments, true);
  assert.equal(allowedSelectable.length, 2);
});

test('never fabricates upsideSacrificed without a caller-supplied reference price', () => {
  const [assessment] = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [candidate()]);
  assert.equal(assessment?.upsideSacrificedDollars, null);
});

test('computes upsideSacrificed honestly once a reference price is supplied', () => {
  const [assessment] = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [candidate({ strike: 200 })], 220);
  assert.equal(assessment?.upsideSacrificedDollars, (220 - 200) * 100);
});

test('a candidate with no usable quote reports QUOTE_UNKNOWN and never fabricates a premium', () => {
  const [assessment] = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [candidate({ bid: null, ask: null })]);
  assert.equal(assessment?.premiumIncomeDollars, null);
  assert.ok(assessment?.reasons.includes('QUOTE_UNKNOWN'));
  const selectable = selectableCoveredCallCandidates([assessment as ReturnType<typeof evaluateCoveredCallCandidates>[number]]);
  assert.equal(selectable.length, 0);
});
