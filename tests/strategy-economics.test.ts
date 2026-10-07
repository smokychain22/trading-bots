import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStrategyEconomicsReceipt, rankEconomically, requiredEconomicUnknowns, diagnoseLowCapitalEfficiency, economicRankingForCspCandidates, evaluateEconomicHurdles,
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
// SYNTHETIC completion of the 63P (delta/IV are NOT in durable evidence): used only to exercise the comparator on a
// complete pair. Never cited as what 63P's Greeks were.
const xle63Synthetic: CspContractEvidence = { ...xle63, delta: -0.30, iv: 0.29 };
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
  // Missing IV removes the two-sigma scenario, so reward-to-stress is UNKNOWN rather than computed from the gap alone.
  assert.deepEqual(buildStrategyEconomicsReceipt(cspInput({ shortLeg: { ...cspInput().shortLeg, iv: null } })).rewardToStressRisk,
    { state: 'UNKNOWN', reason: 'PROFIT_OR_A_STRESS_SCENARIO_UNKNOWN' });
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

test('BA: missing risk evidence never improves rank -- the durable 63P (no IV/delta) ranks after the complete 57P', () => {
  const { ranked } = economicRankingForCspCandidates([{ candidateId: 'XLE261120P00057000', contract: xle57 },
    { candidateId: 'XLE261120P00063000', contract: xle63 }], { ...config, mode: 'SHADOW', policy: null, scenarioVolatility: null });
  assert.deepEqual(ranked.map((r) => r.receipt.candidateId), ['XLE261120P00057000', 'XLE261120P00063000']);
  assert.equal(ranked[0]?.decidedBy, 'REQUIRED_EVIDENCE_COMPLETE');
  // The shared (nearest-ATM) scenario volatility gives 63P a stress scenario; its own delta is still missing.
  assert.deepEqual(ranked[1]?.requiredUnknowns, ['assignmentProbabilityProxy']);
  // With no scenario volatility at all, stress is UNKNOWN and reward-to-stress is never computed from the 5% gap alone.
  const blind = buildStrategyEconomicsReceipt(cspInput({ candidateId: 'B', shortLeg: { ...cspInput().shortLeg, iv: null }, scenarioVolatility: null }));
  const seen = buildStrategyEconomicsReceipt(cspInput({ candidateId: 'A' }));
  assert.equal(blind.rewardToStressRisk.state, 'UNKNOWN');
  const order = rankEconomically([{ receipt: blind, verdict: 'NOT_CONFIGURED' }, { receipt: seen, verdict: 'NOT_CONFIGURED' }]);
  assert.deepEqual(order.map((r) => r.receipt.candidateId), ['A', 'B']);
  assert.deepEqual(order[1]?.requiredUnknowns, ['breakevenCushionSigmas', 'impliedTwoSigmaMoveLossUsd', 'rewardToStressRisk']);
});

test('AZ: two economically different contracts with no EV are ordered by an economic key, never by OCC symbol', () => {
  const { ranked } = economicRankingForCspCandidates([{ candidateId: 'XLE261120P00057000', contract: xle57 },
    { candidateId: 'XLE261120P00063000', contract: xle63Synthetic }], { ...config, mode: 'SHADOW', policy: null, scenarioVolatility: 0.2834 });
  assert.equal(ranked[0]?.receipt.candidateId, 'XLE261120P00063000');
  assert.notEqual(ranked[0]?.decidedBy, 'EXACT_ECONOMIC_TIE_CANDIDATE_ID');
  assert.deepEqual(ranked.map((r) => r.paretoRank), [1, 1]); // a genuine trade-off: 57P has the larger cushion
  assert.equal(ranked[0]?.decidedBy, 'TIE_BREAK_rewardToStressRisk');
  // Renaming so the OCC order flips cannot change the economic order.
  const renamed = economicRankingForCspCandidates([{ candidateId: 'Z_57P', contract: xle57 }, { candidateId: 'A_63P', contract: xle63Synthetic }],
    { ...config, mode: 'SHADOW', policy: null, scenarioVolatility: 0.2834 });
  const renamedFlip = economicRankingForCspCandidates([{ candidateId: 'A_57P', contract: xle57 }, { candidateId: 'Z_63P', contract: xle63Synthetic }],
    { ...config, mode: 'SHADOW', policy: null, scenarioVolatility: 0.2834 });
  assert.equal(renamed.ranked[0]?.receipt.candidateId, 'A_63P');
  assert.equal(renamedFlip.ranked[0]?.receipt.candidateId, 'Z_63P');
  // A cushion hurdle (constraint first) reverses it: 63P's 4.5% cushion fails a 6% floor.
  const cushioned = economicRankingForCspCandidates([{ candidateId: 'XLE261120P00057000', contract: xle57 },
    { candidateId: 'XLE261120P00063000', contract: xle63Synthetic }], { ...config, mode: 'SHADOW', policy: { policyVersion: 't', minBreakevenCushionPct: 0.06 }, scenarioVolatility: 0.2834 });
  assert.equal(cushioned.ranked[0]?.receipt.candidateId, 'XLE261120P00057000');
  assert.equal(cushioned.ranked[0]?.decidedBy, 'HURDLE_VERDICT');
});

test('only a genuinely exact economic tie falls to the candidate ID', () => {
  const { ranked } = economicRankingForCspCandidates([{ candidateId: 'B', contract: xle57 }, { candidateId: 'A', contract: xle57 }],
    { ...config, mode: 'SHADOW', policy: null, scenarioVolatility: 0.2834 });
  assert.deepEqual(ranked.map((r) => r.receipt.candidateId), ['A', 'B']);
  assert.equal(ranked[0]?.decidedBy, 'EXACT_ECONOMIC_TIE_CANDIDATE_ID');
});

test('BB: raw yield alone cannot select a high-delta near-ATM put over a lower-risk put with stronger risk-adjusted economics', () => {
  const atm: CspContractEvidence = { ...xle57, optionSymbol: 'ATM', strike: 64, bid: 1.9, ask: 1.95, delta: -0.48, iv: 0.28 };
  const safer: CspContractEvidence = { ...xle57, optionSymbol: 'SAFER', strike: 60, bid: 1.4, ask: 1.45, delta: -0.22, iv: 0.33 };
  const rows = [atm, safer].map((c) => ({ candidateId: c.optionSymbol, contract: c }));
  const { ranked } = economicRankingForCspCandidates(rows, { ...config, mode: 'SHADOW', policy: null, scenarioVolatility: 0.28 });
  const byId = new Map(ranked.map((r) => [r.receipt.candidateId, r.receipt]));
  const yieldOf = (id: string) => v(byId.get(id)?.annualizedReturnOnCapital as never);
  assert.ok(yieldOf('ATM') > yieldOf('SAFER'), 'fixture: ATM has the larger raw annualized yield');
  assert.ok(v(byId.get('SAFER')?.rewardToStressRisk as never) > v(byId.get('ATM')?.rewardToStressRisk as never), 'fixture: SAFER pays more per unit of tail loss');
  assert.equal(ranked[0]?.receipt.candidateId, 'SAFER');
});

test('H ranks by cushion in implied moves before yield, and annualized ROC is never a ranking key', () => {
  const near: CspContractEvidence = { ...xle57, optionSymbol: 'NEAR', strike: 63.5, bid: 0.45, ask: 0.47, delta: -0.40, iv: 0.3, dte: 2 };
  const far: CspContractEvidence = { ...xle57, optionSymbol: 'FAR', strike: 62, bid: 0.08, ask: 0.09, delta: -0.10, iv: 0.3, dte: 2 };
  const rows = [near, far].map((c) => ({ candidateId: c.optionSymbol, contract: { ...c, expiration: '2026-10-09' } }));
  const h = economicRankingForCspCandidates(rows, { ...config, strategyClass: 'THETA_HOLD_STRIKE', mode: 'SHADOW', policy: null, scenarioVolatility: 0.3 });
  const q = economicRankingForCspCandidates(rows, { ...config, mode: 'SHADOW', policy: null, scenarioVolatility: 0.3 });
  assert.equal(h.ranked[0]?.receipt.candidateId, 'FAR');
  assert.equal(h.ranked[0]?.decidedBy.startsWith('TIE_BREAK_breakevenCushionSigmas') || h.ranked[0]?.decidedBy === 'PARETO_RANK', true);
  assert.ok(q.ranked.length === 2);
  assert.throws(() => rankEconomically([...h.ranked, ...q.ranked]), /MIXED_STRATEGY_CLASSES/);
});

test('required unknowns are reported per class (D also needs reward-to-max-loss)', () => {
  const r = buildStrategyEconomicsReceipt(cspInput({ candidateId: 'D', structure: 'PUT_CREDIT_SPREAD', strategyClass: 'THETA_DEFINED_RISK',
    longLeg: { optionSymbol: 'L', strike: 55, bid: 0.12, ask: 0.16, delta: -0.05, iv: 0.3, volume: 10, openInterest: 100 },
    creditPerShare: null, creditBasis: 'LIMIT_PRICE' }));
  assert.ok(requiredEconomicUnknowns(r).includes('rewardToMaxLoss'));
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

const complete = [xle57, xle63Synthetic].map((c) => ({ candidateId: c.optionSymbol, contract: c }));
const certification = { ownerApproved: true as const, validationEvidenceIds: ['test-only-certification'] };

test('SHADOW economic ranking records the divergence and leaves the Production selection and quantity unchanged', () => {
  const { ranking } = economicRankingForCspCandidates(complete, { ...config, mode: 'SHADOW', policy: null, scenarioVolatility: 0.2834 });
  const decision = assembleNewRiskDecision(decisionInput({ candidates: [bootstrapFinalist(xle57), bootstrapFinalist(xle63Synthetic)], economicRanking: ranking }));
  assert.equal(decision.selectedCandidateId, 'XLE261120P00057000');
  assert.equal(decision.quantity, 1);
  assert.deepEqual(decision.economicRanking && {
    legacy: decision.economicRanking.legacyOrderSelectedCandidateId, economic: decision.economicRanking.economicOrderSelectedCandidateId,
    diverges: decision.economicRanking.diverges, applied: decision.economicRanking.appliedToSelection,
  }, { legacy: 'XLE261120P00057000', economic: 'XLE261120P00063000', diverges: true, applied: false });
});

test('ENFORCED is downgraded to SHADOW without a risk hurdle, and without certification even with one', () => {
  const none = economicRankingForCspCandidates(complete, { ...config, mode: 'ENFORCED', policy: null, scenarioVolatility: 0.2834 });
  assert.equal(none.ranking.mode, 'SHADOW');
  assert.ok(none.ranking.basis.includes('ENFORCEMENT_DOWNGRADED_NO_RISK_HURDLE_CONFIGURED'));
  const uncertified = economicRankingForCspCandidates(complete, { ...config, mode: 'ENFORCED', policy: { policyVersion: 't', maxStressLossUsd: 1_000_000 }, scenarioVolatility: 0.2834 });
  assert.equal(uncertified.ranking.mode, 'SHADOW');
  assert.ok(uncertified.ranking.basis.includes('ENFORCEMENT_DOWNGRADED_NOT_CERTIFIED'));
  assert.equal(assembleNewRiskDecision(decisionInput({ economicRanking: uncertified.ranking })).selectedCandidateId, 'XLE261120P00057000');
});

test('certified ENFORCED replaces only the ID tie-break; quantity and eligibility are untouched', () => {
  const { ranking } = economicRankingForCspCandidates(complete, { ...config, mode: 'ENFORCED',
    policy: { policyVersion: 't', maxStressLossUsd: 1_000_000 }, scenarioVolatility: 0.2834, enforcementCertification: certification });
  assert.equal(ranking.mode, 'ENFORCED');
  const finalists = [bootstrapFinalist(xle57), bootstrapFinalist(xle63Synthetic)];
  const decision = assembleNewRiskDecision(decisionInput({ candidates: finalists, economicRanking: ranking }));
  assert.equal(decision.selectedCandidateId, 'XLE261120P00063000');
  assert.equal(decision.quantity, 1);
  assert.equal(decision.economicRanking?.appliedToSelection, true);
  const zero: CandidateFrontierResult = { ...bootstrapFinalist(xle63Synthetic), sizing: { contractVersion: 'theta-sizing-runtime-v1', decisionId: 'd1',
    snapshotId: 's1', timestamp: NOW, policyVersion: 'v1', quantity: 0, capitalRequired: 0, bindingConstraint: 'AEGIS_ALLOW_REDUCED', reasons: [] } };
  assert.equal(assembleNewRiskDecision(decisionInput({ candidates: [bootstrapFinalist(xle57), zero], economicRanking: ranking })).selectedCandidateId,
    'XLE261120P00057000');
  const calibrated = { ...bootstrapFinalist(xle57), evNet: 5, returnPerCapitalDay: 0.0001 };
  assert.equal(assembleNewRiskDecision(decisionInput({ candidates: [calibrated, bootstrapFinalist(xle63Synthetic)], economicRanking: ranking })).selectedCandidateId,
    'XLE261120P00057000');
});
