import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStrategyEconomicsReceipt, diagnoseLowCapitalEfficiency, economicRankingForCspCandidates, evaluateEconomicHurdles,
  parseEconomicsGateMode, type CspContractEvidence, type StrategyEconomicsInput,
} from '../src/theta/strategy-economics.js';
import { assembleNewRiskDecision, type CandidateFrontierResult, type NewRiskDecisionInput } from '../src/theta/decision-assembly.js';
import type { NormalizedOptionContract } from '../src/theta/option-contract.js';
import { riskFamilySchema, type AegisAssessmentResponse } from '../src/theta/aegis-contract.js';

// Fixture: the two Q finalists of the 2026-10-07 13:32:07Z XLE decision, as recorded in the durable decision receipt
// (structuralTopTwo NEAR_TIE: grossPremium 27 vs 155, collateral 5700 vs 6300, spreadPct 0.0714 vs 0.0380, spot 64.36).
// The 63P delta/IV are not in durable evidence and stay null (UNKNOWN), never invented.
const NOW = '2026-10-07T13:32:07.901Z';
const xle57: CspContractEvidence = { underlying: 'XLE', optionSymbol: 'XLE261120P00057000', strike: 57, expiration: '2026-11-20', dte: 44,
  multiplier: 100, bid: 0.27, ask: 0.29, delta: -0.0913, iv: 0.2834, volume: null, openInterest: null, underlyingReferencePrice: 64.36 };
const xle63: CspContractEvidence = { ...xle57, optionSymbol: 'XLE261120P00063000', strike: 63, bid: 1.55, ask: 1.61, delta: null, iv: null };
const config = { strategyClass: 'THETA_CONVENTIONAL' as const, openingCostPerContractUsd: null, stressGapPct: 0.05, opportunityCostAnnualRate: null };

const cspInput = (overrides: Partial<StrategyEconomicsInput> = {}): StrategyEconomicsInput => ({
  candidateId: 'XLE261120P00057000', strategyClass: 'THETA_CONVENTIONAL', structure: 'CASH_SECURED_PUT', underlying: 'XLE',
  expiration: '2026-11-20', dte: 44, multiplier: 100,
  shortLeg: { optionSymbol: 'XLE261120P00057000', strike: 57, bid: 0.26, ask: 0.28, delta: -0.0913, iv: 0.2834, volume: null, openInterest: null },
  spot: 64.36, creditPerShare: 0.28, creditBasis: 'CONFIRMED_FILL', openingCostsUsd: null, realizedVolatility: null, ivRank: null,
  eventInWindow: null, stressGapPct: 0.05, opportunityCostAnnualRate: null, ...overrides,
});
const v = (item: { state: string; value?: number }): number => { assert.equal(item.state, 'KNOWN'); return item.value as number; };

test('XLE 57P fill economics: $28 max profit on $5,700 collateral is a 0.49% / 44-day trade', () => {
  const r = buildStrategyEconomicsReceipt(cspInput());
  assert.equal(v(r.grossCreditUsd), 28);
  assert.equal(v(r.capitalRequiredUsd), 5700);
  assert.equal(v(r.maxProfitUsd), 28);
  assert.equal(v(r.maxLossUsd), 5672);
  assert.equal(v(r.breakeven), 56.72);
  assert.ok(Math.abs(v(r.returnOnCapital) - 28 / 5700) < 1e-9);
  assert.ok(Math.abs(v(r.annualizedReturnOnCapital) - (28 / 5700) * 365 / 44) < 1e-7);
  assert.ok(Math.abs(v(r.distanceToStrikePct) - (64.36 - 57) / 64.36) < 1e-6);
  // Missing inputs are typed UNKNOWN, never zero.
  assert.deepEqual(r.netCreditUsd, { state: 'UNKNOWN', reason: 'OPENING_COSTS_UNKNOWN' });
  assert.deepEqual(r.ivMinusRealizedVol, { state: 'UNKNOWN', reason: 'REALIZED_VOLATILITY_UNKNOWN' });
  assert.deepEqual(r.expectedValueUsd, { state: 'UNKNOWN', reason: 'EV_MODEL_NOT_EMPIRICALLY_READY' });
  assert.equal(r.eventRisk, 'UNKNOWN');
  // |delta| is labelled a proxy, never a probability of profit.
  assert.equal(r.assignmentProbabilityProxy.state === 'KNOWN' && r.assignmentProbabilityProxy.provenance, 'ABS_DELTA_RISK_NEUTRAL_ITM_PROXY_NOT_PROBABILITY_OF_PROFIT');
  // A 5% gap leaves the 57P out of the money; the two-implied-sigma move does not.
  assert.equal(v(r.stressLossUsd), 0);
  assert.ok(v(r.impliedTwoSigmaMoveLossUsd) > 300);
  assert.ok(v(r.rewardToStressRisk) < 0.1);
});

test('a put credit spread uses width, max loss as capital, and the worst leg spread', () => {
  const r = buildStrategyEconomicsReceipt(cspInput({ candidateId: 'D', structure: 'PUT_CREDIT_SPREAD', strategyClass: 'THETA_DEFINED_RISK',
    longLeg: { optionSymbol: 'XLE261120P00055000', strike: 55, bid: 0.12, ask: 0.16, delta: -0.05, iv: 0.3, volume: 10, openInterest: 100 },
    creditPerShare: 0.14, creditBasis: 'LIMIT_PRICE', openingCostsUsd: 3.4 }));
  assert.equal(v(r.spreadWidthUsd), 200);
  assert.equal(v(r.capitalRequiredUsd), 186);
  assert.equal(v(r.maxLossUsd), 189.4);
  assert.equal(v(r.netCreditUsd), 10.6);
  assert.equal(v(r.maxProfitUsd), 10.6);
  assert.ok(Math.abs(v(r.bidAskSpreadPct) - 0.04 / 0.14) < 1e-6);
  assert.throws(() => buildStrategyEconomicsReceipt(cspInput({ structure: 'PUT_CREDIT_SPREAD' })), /SPREAD_LEGS_INVALID/);
});

test('hurdles: unconfigured is NOT_CONFIGURED, unknown input is UNDETERMINED, and SHADOW never claims enforcement', () => {
  const r = buildStrategyEconomicsReceipt(cspInput());
  assert.equal(evaluateEconomicHurdles(r, null, 'SHADOW').verdict, 'NOT_CONFIGURED');
  const fail = evaluateEconomicHurdles(r, { policyVersion: 't', minAnnualizedReturnOnCapital: 0.1 }, 'SHADOW');
  assert.equal(fail.verdict, 'FAIL');
  assert.equal(fail.effect, 'OBSERVE_ONLY');
  assert.equal(evaluateEconomicHurdles(r, { policyVersion: 't', minIvRvEdge: 0.02 }, 'SHADOW').verdict, 'UNDETERMINED');
  assert.equal(evaluateEconomicHurdles(r, { policyVersion: 't', minExpectedReturnUsd: 1 }, 'ENFORCED').effect, 'ENFORCEMENT_NOT_CERTIFIED');
  assert.equal(evaluateEconomicHurdles(r, { policyVersion: 't', minMaxProfitUsd: 25, maxEventRisk: 'NO_EVENT_IN_WINDOW' }, 'SHADOW').verdict, 'UNDETERMINED');
  assert.equal(parseEconomicsGateMode('bogus'), 'SHADOW');
});

test('LOW_CAPITAL_EFFICIENCY_SUSPECTED is a diagnostic only and needs an explicit reference', () => {
  const r = buildStrategyEconomicsReceipt(cspInput());
  assert.equal(diagnoseLowCapitalEfficiency(r, null).state, 'UNDETERMINED');
  const d = diagnoseLowCapitalEfficiency(r, { referenceVersion: 'sensitivity', smallProfitUsd: 100, largeCapitalUsd: 5000,
    annualizedReturnFloor: 0.08, rewardToStressFloor: 0.25 });
  assert.equal(d.state, 'LOW_CAPITAL_EFFICIENCY_SUSPECTED');
  assert.deepEqual(d.signals, ['SMALL_PROFIT_ON_LARGE_CAPITAL', 'ANNUALIZED_RETURN_BELOW_REFERENCE', 'REWARD_SMALL_RELATIVE_TO_STRESS_LOSS']);
  assert.equal(d.authority, 'DIAGNOSTIC_ONLY_NOT_A_REJECTION');
});

test('economic order ranks XLE 63P above 57P; the OCC-symbol order did the opposite', () => {
  const { ranking } = economicRankingForCspCandidates([{ candidateId: 'XLE261120P00057000', contract: xle57 },
    { candidateId: 'XLE261120P00063000', contract: xle63 }], { ...config, mode: 'SHADOW', policy: null });
  assert.deepEqual(ranking.orderedCandidateIds, ['XLE261120P00063000', 'XLE261120P00057000']);
  // A hurdle verdict outranks yield: with a breakeven-cushion floor the 63P (4.5% cushion) falls behind the 57P.
  const cushioned = economicRankingForCspCandidates([{ candidateId: 'XLE261120P00057000', contract: xle57 },
    { candidateId: 'XLE261120P00063000', contract: xle63 }], { ...config, mode: 'SHADOW', policy: { policyVersion: 't', minBreakevenCushionPct: 0.06 } });
  assert.deepEqual(cushioned.ranking.orderedCandidateIds, ['XLE261120P00057000', 'XLE261120P00063000']);
});

const aegis = (): AegisAssessmentResponse => ({
  contractVersion: 'theta-aegis-runtime-v1', decisionId: 'd1', snapshotId: 's1', timestamp: NOW, policyVersion: 'v1', compoundStressHoldCount: 2,
  policyConfigurationHash: 'a'.repeat(64), families: riskFamilySchema.options.map((family) => ({ family, state: 'ALLOW_REDUCED', reasons: [] })),
  newRiskState: 'ALLOW_REDUCED', reasons: [], permittedActions: ['OPEN_CSP_REDUCED'],
});
const normalized = (c: CspContractEvidence): NormalizedOptionContract => ({
  contractVersion: 'theta-option-contract-v1', underlying: c.underlying, optionSymbol: c.optionSymbol, occSymbol: null, optionType: 'PUT',
  strike: c.strike, expiration: c.expiration, dte: c.dte, multiplier: c.multiplier,
  underlyingBid: null, underlyingAsk: null, underlyingLast: c.underlyingReferencePrice, underlyingReferencePrice: c.underlyingReferencePrice, underlyingTimestamp: NOW,
  bid: c.bid, ask: c.ask, bidSize: null, askSize: null, lastTradePrice: null, lastTradeSize: null, quoteTimestamp: NOW, tradeTimestamp: null,
  midpointReference: null, spread: null, spreadPct: null, moneyness: null, distanceToStrikePct: null, breakEven: null,
  volume: null, volumeSource: null, openInterest: null, openInterestSource: null,
  iv: c.iv, delta: c.delta, gamma: null, theta: null, vega: null, rho: null, greeksTimestamp: NOW, greeksSource: 'ALPACA',
  source: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD', receivedAt: NOW, dataAgeSeconds: 1, executable: true, nonExecutableReason: null,
});
const bootstrapFinalist = (c: CspContractEvidence): CandidateFrontierResult => ({
  candidateId: c.optionSymbol, contract: normalized(c), disposition: 'OPEN_REDUCED', waitReason: null, rejectionReason: null,
  evNet: null, returnPerCapitalDay: null, paperBootstrapEligible: true, aegis: aegis(),
  sizing: { contractVersion: 'theta-sizing-runtime-v1', decisionId: 'd1', snapshotId: 's1', timestamp: NOW, policyVersion: 'v1',
    quantity: 1, capitalRequired: c.strike * 100, bindingConstraint: 'AEGIS_ALLOW_REDUCED', reasons: [] },
  executionQuality: { contractVersion: 'theta-execution-quality-runtime-v3', decisionId: 'd1', snapshotId: 's1', timestamp: NOW, policyVersion: 'v1',
    positionIntent: 'SELL_TO_OPEN', utilityEvidenceState: 'EMPIRICAL_ESTIMATE', spreadPct: 0.05, fillProbability: 0.8,
    expectedSlippagePerShare: 0.01, acceptable: true, recommendedAction: 'SUBMIT', reasons: [] },
});
const decisionInput = (overrides: Partial<NewRiskDecisionInput>): NewRiskDecisionInput => ({
  snapshotId: 's1', fusionSnapshotHash: 'a'.repeat(64), timestamp: NOW, underlying: 'XLE',
  ownership: { contractVersion: 'theta-ownership-runtime-v1', snapshotId: 's1', underlyingSymbol: 'XLE', timestamp: NOW, policyVersion: 'v1',
    ownability: null, components: [], thesisInvalidated: false, reasons: [] },
  regime: { contractVersion: 'theta-regime-runtime-v1', snapshotId: 's1', timestamp: NOW, policyVersion: 'v1', trendState: 'BULL',
    volatilityState: 'NORMAL', eventState: 'NONE', liquidityState: 'NORMAL', stressState: 'NORMAL', confidence: 1, reasons: [] },
  candidates: [bootstrapFinalist(xle57), bootstrapFinalist(xle63)], policyVersion: 'v1', modelVersions: {}, requiredModelVersions: {},
  providerStateGood: true, ...overrides,
});

test('REGRESSION 2026-10-07 XLE: without calibrated EV the legacy tie-break picks the lowest OCC symbol (57P)', () => {
  assert.equal(assembleNewRiskDecision(decisionInput({})).selectedCandidateId, 'XLE261120P00057000');
});

test('SHADOW economic ranking records the divergence and leaves the Production selection and quantity unchanged', () => {
  const { ranking } = economicRankingForCspCandidates([xle57, xle63].map((c) => ({ candidateId: c.optionSymbol, contract: c })),
    { ...config, mode: 'SHADOW', policy: null });
  const decision = assembleNewRiskDecision(decisionInput({ economicRanking: ranking }));
  assert.equal(decision.selectedCandidateId, 'XLE261120P00057000');
  assert.equal(decision.quantity, 1);
  assert.deepEqual(decision.economicRanking && {
    legacy: decision.economicRanking.legacyOrderSelectedCandidateId, economic: decision.economicRanking.economicOrderSelectedCandidateId,
    diverges: decision.economicRanking.diverges, applied: decision.economicRanking.appliedToSelection,
  }, { legacy: 'XLE261120P00057000', economic: 'XLE261120P00063000', diverges: true, applied: false });
});

test('ENFORCED without a configured risk hurdle is downgraded to SHADOW (yield alone sells the most risk)', () => {
  const { ranking } = economicRankingForCspCandidates([xle57, xle63].map((c) => ({ candidateId: c.optionSymbol, contract: c })),
    { ...config, mode: 'ENFORCED', policy: null });
  assert.equal(ranking.mode, 'SHADOW');
  assert.ok(ranking.basis.includes('ENFORCEMENT_DOWNGRADED_NO_RISK_HURDLE_CONFIGURED'));
  assert.equal(assembleNewRiskDecision(decisionInput({ economicRanking: ranking })).selectedCandidateId, 'XLE261120P00057000');
});

test('ENFORCED economic ranking replaces only the ID tie-break; quantity and eligibility are untouched', () => {
  const { ranking } = economicRankingForCspCandidates([xle57, xle63].map((c) => ({ candidateId: c.optionSymbol, contract: c })),
    { ...config, mode: 'ENFORCED', policy: { policyVersion: 't', maxStressLossUsd: 1_000_000 } });
  assert.equal(ranking.mode, 'ENFORCED');
  const decision = assembleNewRiskDecision(decisionInput({ economicRanking: ranking }));
  assert.equal(decision.selectedCandidateId, 'XLE261120P00063000');
  assert.equal(decision.quantity, 1);
  assert.equal(decision.economicRanking?.appliedToSelection, true);
  // A candidate that is not qualified (sizing zero) can never be chosen by the economic order.
  const zero: CandidateFrontierResult = { ...bootstrapFinalist(xle63), sizing: { contractVersion: 'theta-sizing-runtime-v1', decisionId: 'd1',
    snapshotId: 's1', timestamp: NOW, policyVersion: 'v1', quantity: 0, capitalRequired: 0, bindingConstraint: 'AEGIS_ALLOW_REDUCED', reasons: [] } };
  const guarded = assembleNewRiskDecision(decisionInput({ candidates: [bootstrapFinalist(xle57), zero], economicRanking: ranking }));
  assert.equal(guarded.selectedCandidateId, 'XLE261120P00057000');
  // Calibrated EV-backed return per capital-day still outranks the economic proxy order.
  const calibrated = { ...bootstrapFinalist(xle57), evNet: 5, returnPerCapitalDay: 0.0001 };
  assert.equal(assembleNewRiskDecision(decisionInput({ candidates: [calibrated, bootstrapFinalist(xle63)], economicRanking: ranking })).selectedCandidateId,
    'XLE261120P00057000');
});
