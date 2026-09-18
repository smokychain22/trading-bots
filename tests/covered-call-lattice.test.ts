import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOOTSTRAP_NEUTRAL_CC_WEIGHT_PROVENANCE, bestCoveredCallCandidate, computeCoveredCallUtility, evaluateCoveredCallCandidates,
  nondominatedCoveredCallCandidates, selectableCoveredCallCandidates,
  type CoveredCallCandidate, type CoveredCallUtilityWeights,
} from '../src/theta/covered-call-lattice.js';
import type { WholeChainComponents } from '../src/theta/whole-chain-economics.js';

const wholeChainBase: Omit<WholeChainComponents, 'coveredCallPremium' | 'coveredCallCloseCosts' | 'stockSaleOrCallAwayProceeds' | 'currentStockMarkPerShare' | 'openStockShares'> = {
  initialPutPremium: 200, rollCredits: 0, rollCloseCosts: 0, assignmentStrike: 195, stockSharesAssigned: 100,
  dividends: 0, fees: 2, slippage: 0,
};

const inertWeights: CoveredCallUtilityWeights = {
  upsideSacrificePerDollarWeight: 0, spreadPerDollarWeight: 0, eventRiskPenalty: 0,
  dividendExDateRiskPenalty: 0, belowBasisPenalty: 0, provenance: BOOTSTRAP_NEUTRAL_CC_WEIGHT_PROVENANCE,
};

const justifiedWeights: CoveredCallUtilityWeights = {
  upsideSacrificePerDollarWeight: 1, spreadPerDollarWeight: 3, eventRiskPenalty: 500,
  dividendExDateRiskPenalty: 100, belowBasisPenalty: 1000,
  provenance: {
    policyVersion: 'test-policy-v1', configurationId: 'TEST_JUSTIFIED_WEIGHTS',
    effectiveVersion: 'test-policy-v1', sourceReason: 'TEST_FIXTURE_JUSTIFIED_NON_ZERO_WEIGHTS',
  },
};

const candidate = (overrides: Partial<CoveredCallCandidate> = {}): CoveredCallCandidate => ({
  symbol: 'AAPL261016C00200000', optionContractId: 'cc-1', strike: 200, expiration: '2026-10-16', delta: 0.3,
  bid: 1, ask: 1.1, multiplier: 100, quantity: 1, openInterest: 500, volume: 100,
  dividendExDateRisk: 'ABSENT_VERIFIED', eventRisk: 'ABSENT_VERIFIED', ...overrides,
});

test('computes premium income (bid-side, conservative, never midpoint), call-away price, and both whole-chain P&L scenarios for an at/above-basis candidate', () => {
  const [assessment] = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [candidate()], inertWeights);
  assert.ok(assessment !== undefined);
  // bid=1, ask=1.1, multiplier=100 -> premiumIncomeDollars is the BID-side
  // reference (100), never the midpoint (105) -- midReferenceDollars keeps
  // the midpoint available as an analytical-only figure.
  assert.equal(assessment.premiumIncomeDollars, 100);
  assert.equal(assessment.midReferenceDollars, 105);
  assert.equal(assessment.callAwayPriceDollars, 200 * 100);
  assert.equal(assessment.belowBasis, false);
  assert.notEqual(assessment.wholeChainPnlIfCalledAway, null);
  assert.notEqual(assessment.wholeChainPnlIfNotCalled, null);
  assert.notEqual(assessment.wholeChainPnlIfCalledAway, assessment.wholeChainPnlIfNotCalled);
});

test('wholeChainPnlIfCalledAway correctly nets the assignment acquisition cost against the call-away proceeds', () => {
  // assignmentStrike=195, stockSharesAssigned=100 -> $19,500 acquisition.
  // Called away at strike=200 -> proceeds $20,000. Stock leg must be net
  // ($20,000 - $19,500 = $500), never the raw $20,000 proceeds alone.
  const [assessment] = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [candidate({ strike: 200 })], inertWeights);
  const premium = assessment?.premiumIncomeDollars as number;
  // wholeChainPnlIfCalledAway = initialPutPremium(200) + premium - fees(2) + stockLeg(500)
  const expected = 200 + premium - 2 + 500;
  assert.equal(assessment?.wholeChainPnlIfCalledAway, expected);
});

test('flags a below-basis candidate with the exact required reason code, but does not discard it from the list', () => {
  const [assessment] = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [candidate({ strike: 190 })], inertWeights);
  assert.equal(assessment?.belowBasis, true);
  assert.ok(assessment?.reasons.includes('BELOW_BASIS_CC_REJECTED_BY_BOOTSTRAP_POLICY'));
});

test('selectableCoveredCallCandidates excludes below-basis candidates by default but includes them when explicitly allowed', () => {
  const assessments = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase,
    [candidate({ optionContractId: 'above', strike: 200 }), candidate({ optionContractId: 'below', strike: 190 })], inertWeights);
  const defaultSelectable = selectableCoveredCallCandidates(assessments);
  assert.equal(defaultSelectable.length, 1);
  assert.equal(defaultSelectable[0]?.candidate.optionContractId, 'above');

  const allowedSelectable = selectableCoveredCallCandidates(assessments, true);
  assert.equal(allowedSelectable.length, 2);
});

test('never fabricates upsideSacrificed without a caller-supplied reference price', () => {
  const [assessment] = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [candidate()], inertWeights);
  assert.equal(assessment?.upsideSacrificedDollars, null);
});

test('computes upsideSacrificed honestly once a reference price is supplied', () => {
  const [assessment] = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [candidate({ strike: 200 })], inertWeights, 220);
  assert.equal(assessment?.upsideSacrificedDollars, (220 - 200) * 100);
});

test('a candidate with no usable quote reports QUOTE_UNKNOWN, never fabricates a premium, and has a null (unrankable) utility', () => {
  const [assessment] = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [candidate({ bid: null, ask: null })], inertWeights);
  assert.equal(assessment?.premiumIncomeDollars, null);
  assert.ok(assessment?.reasons.includes('QUOTE_UNKNOWN'));
  assert.equal(assessment?.utility.utility, null);
  const selectable = selectableCoveredCallCandidates([assessment as ReturnType<typeof evaluateCoveredCallCandidates>[number]]);
  assert.equal(selectable.length, 0);
});

test('a crossed quote (bid > ask) is treated as unknown, never used to compute a nonsensical negative premium', () => {
  const [assessment] = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [candidate({ bid: 2, ask: 1 })], inertWeights);
  assert.equal(assessment?.premiumIncomeDollars, null);
  assert.equal(assessment?.midReferenceDollars, null);
  assert.ok(assessment?.reasons.includes('QUOTE_UNKNOWN'));
});

test('computeCoveredCallUtility never fabricates the premium-unknown case and names every unknown component', () => {
  const result = computeCoveredCallUtility(
    { premiumIncomeDollars: null, upsideSacrificedDollars: null, spreadDollars: null, belowBasis: false, eventRisk: 'ABSENT_VERIFIED', dividendExDateRisk: 'ABSENT_VERIFIED' },
    inertWeights,
  );
  assert.equal(result.utility, null);
  assert.deepEqual(result.reasons, ['PREMIUM_UNKNOWN_CANNOT_RANK']);
});

test('with inert (all-zero) weights, CCUtility reduces to pure premium income -- the honest no-information default', () => {
  const result = computeCoveredCallUtility(
    { premiumIncomeDollars: 100, upsideSacrificedDollars: 500, spreadDollars: 50, belowBasis: false, eventRisk: 'PRESENT', dividendExDateRisk: 'PRESENT' },
    inertWeights,
  );
  assert.equal(result.utility, 100);
  assert.equal(result.weightsProvenance, BOOTSTRAP_NEUTRAL_CC_WEIGHT_PROVENANCE);
});

test('an UNKNOWN event/ex-date risk never applies a fabricated penalty, but is named explicitly as an uncertainty signal, never silently treated as safe', () => {
  const result = computeCoveredCallUtility(
    { premiumIncomeDollars: 100, upsideSacrificedDollars: null, spreadDollars: null, belowBasis: false, eventRisk: 'UNKNOWN', dividendExDateRisk: 'UNKNOWN' },
    justifiedWeights,
  );
  assert.equal(result.utility, 100);
  assert.ok(result.reasons.includes('EVENT_RISK_UNKNOWN_NOT_TREATED_AS_SAFE'));
  assert.ok(result.reasons.includes('EX_DATE_RISK_UNKNOWN_NOT_TREATED_AS_SAFE'));
});

test('with justified non-zero weights, a large upside-sacrifice/spread/event-risk candidate is penalized below a modest one', () => {
  const richButRisky = computeCoveredCallUtility(
    { premiumIncomeDollars: 400, upsideSacrificedDollars: 1000, spreadDollars: 50, belowBasis: false, eventRisk: 'PRESENT', dividendExDateRisk: 'ABSENT_VERIFIED' },
    justifiedWeights,
  );
  const modestButSafe = computeCoveredCallUtility(
    { premiumIncomeDollars: 100, upsideSacrificedDollars: 20, spreadDollars: 2, belowBasis: false, eventRisk: 'ABSENT_VERIFIED', dividendExDateRisk: 'ABSENT_VERIFIED' },
    justifiedWeights,
  );
  assert.ok((modestButSafe.utility as number) > (richButRisky.utility as number));
});

test('bestCoveredCallCandidate selects a farther-OTM, lower-premium candidate over a near-the-money, high-premium one when the latter carries event risk and a wide spread', () => {
  const assessments = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [
    candidate({ optionContractId: 'near-rich-risky', strike: 196, bid: 4, ask: 4.6, eventRisk: 'PRESENT' }),
    candidate({ optionContractId: 'far-modest-safe', strike: 210, bid: 0.5, ask: 0.55 }),
  ], justifiedWeights, 215);
  const best = bestCoveredCallCandidate(assessments);
  assert.equal(best?.candidate.optionContractId, 'far-modest-safe');
});

test('nondominatedCoveredCallCandidates never removes a candidate merely for lower premium when it is better on another known dimension', () => {
  const assessments = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [
    candidate({ optionContractId: 'near-rich-risky', strike: 196, bid: 4, ask: 4.6, eventRisk: 'PRESENT' }),
    candidate({ optionContractId: 'far-modest-safe', strike: 210, bid: 0.5, ask: 0.55 }),
  ], justifiedWeights, 215);
  const nondominated = nondominatedCoveredCallCandidates(assessments);
  assert.ok(nondominated.some((assessment) => assessment.candidate.optionContractId === 'far-modest-safe'));
});

test('nondominatedCoveredCallCandidates removes a candidate that is worse on every known dimension and better on none', () => {
  const assessments = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [
    candidate({ optionContractId: 'strictly-worse', strike: 200, bid: 0.4, ask: 0.7 }),
    candidate({ optionContractId: 'strictly-better', strike: 200, bid: 1, ask: 1.1 }),
  ], inertWeights);
  const nondominated = nondominatedCoveredCallCandidates(assessments);
  assert.equal(nondominated.length, 1);
  assert.equal(nondominated[0]?.candidate.optionContractId, 'strictly-better');
});

test('nondominatedCoveredCallCandidates never lets an UNKNOWN event-risk dimension create false dominance', () => {
  const assessments = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [
    candidate({ optionContractId: 'unknown-risk', strike: 200, bid: 1, ask: 1.1, eventRisk: 'UNKNOWN' }),
    candidate({ optionContractId: 'verified-absent', strike: 200, bid: 1, ask: 1.1, eventRisk: 'ABSENT_VERIFIED' }),
  ], inertWeights);
  const nondominated = nondominatedCoveredCallCandidates(assessments);
  // Identical on every other dimension; eventRiskOrdinal is null (skipped)
  // for the UNKNOWN one on this comparison, so neither dominates the other.
  assert.equal(nondominated.length, 2);
});

test('bestCoveredCallCandidate still prefers the higher-premium candidate when nothing else distinguishes them', () => {
  const assessments = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase, [
    candidate({ optionContractId: 'lower', bid: 0.5, ask: 0.6 }),
    candidate({ optionContractId: 'higher', bid: 1, ask: 1.1 }),
  ], inertWeights);
  const best = bestCoveredCallCandidate(assessments);
  assert.equal(best?.candidate.optionContractId, 'higher');
});

test('bestCoveredCallCandidate returns null when every candidate is unselectable', () => {
  const assessments = evaluateCoveredCallCandidates(195, 190, 100, wholeChainBase,
    [candidate({ bid: null, ask: null })], inertWeights);
  assert.equal(bestCoveredCallCandidate(assessments), null);
});
