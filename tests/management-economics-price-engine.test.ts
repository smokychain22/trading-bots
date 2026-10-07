import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStrategyEconomicsReceipt } from '../src/theta/strategy-economics.js';
import {
  minimumAcceptableCredit, planBuyToCloseLadder, planSellToOpenLadder, revalidateSellStep, tickFor, type PriceEngineBounds,
} from '../src/theta/management-economics/entry-price-engine.js';

const receiptAt = (credit: number) => buildStrategyEconomicsReceipt({
  candidateId: 'XLE261120P00063000', strategyClass: 'THETA_CONVENTIONAL', structure: 'CASH_SECURED_PUT', underlying: 'XLE',
  expiration: '2026-11-20', dte: 44, multiplier: 100,
  shortLeg: { optionSymbol: 'XLE261120P00063000', strike: 63, bid: 1.55, ask: 1.61, delta: -0.37, iv: 0.3, volume: null, openInterest: null },
  spot: 64.36, creditPerShare: credit, creditBasis: 'LIMIT_PRICE', openingCostsUsd: null, realizedVolatility: null, ivRank: null,
  eventInWindow: null, stressGapPct: 0.05, opportunityCostAnnualRate: null, scenarioVolatility: 0.2988,
});
const bounds = (over: Partial<PriceEngineBounds> = {}): PriceEngineBounds => ({
  decisionAt: '2026-10-07T13:32:07.000Z', decisionTtlMs: 45_000, quoteAt: '2026-10-07T13:32:07.000Z', maxQuoteAgeMs: 45_000,
  mutationFenceMs: 150_000, stepIntervalMs: 8_000, maxSteps: 5, ...over,
});

test('minimum acceptable credit: hurdle-derived when configured, decision reward-to-stress tolerance otherwise', () => {
  const byHurdle = minimumAcceptableCredit({ receiptAt, ask: 1.61, policy: { policyVersion: 't', minReturnOnCapital: 0.024 }, decisionRewardToStress: null, tolerance: 0 });
  assert.equal(byHurdle.basis, 'CONFIGURED_HURDLES_PASS');
  assert.equal(byHurdle.credit, 1.52); // 0.024 x $6,300 = $151.20 -> first cent at or above
  const decisionR2s = (receiptAt(1.55).rewardToStressRisk as { value: number }).value;
  const byTolerance = minimumAcceptableCredit({ receiptAt, ask: 1.61, policy: null, decisionRewardToStress: decisionR2s, tolerance: 0.05 });
  assert.ok((byTolerance.credit as number) < 1.55 && (byTolerance.credit as number) > 1.4);
  const impossible = minimumAcceptableCredit({ receiptAt, ask: 1.61, policy: { policyVersion: 't', minReturnOnCapital: 0.5 }, decisionRewardToStress: null, tolerance: 0 });
  assert.equal(impossible.credit, null);
});

test('SELL_TO_OPEN ladder: ask -> mid -> toward bid, never below the minimum credit, bounded in steps', () => {
  const plan = planSellToOpenLadder({ bid: 1.55, ask: 1.61, minCredit: 1.57, bounds: bounds(), now: '2026-10-07T13:32:08.000Z' });
  assert.equal(plan.authority, 'NO_SUBMIT_PLAN_ONLY');
  assert.equal(plan.steps[0]?.limitPrice, 1.61);
  assert.equal(plan.steps[1]?.limitPrice, 1.58);
  assert.ok(plan.steps.every((s) => s.limitPrice >= 1.57));
  assert.equal(plan.stopReason, 'NEXT_STEP_BELOW_MIN_ACCEPTABLE_CREDIT');
  assert.ok(plan.steps.length <= 5);
  assert.deepEqual(planSellToOpenLadder({ bid: 1.55, ask: 1.61, minCredit: null, bounds: bounds(), now: '2026-10-07T13:32:08.000Z' }).stopReason,
    'NO_ECONOMIC_CREDIT_EXISTS');
});

test('the ladder never runs past the decision TTL, quote age or mutation fence', () => {
  const late = planSellToOpenLadder({ bid: 1.0, ask: 1.4, minCredit: 1.0, bounds: bounds({ stepIntervalMs: 20_000 }), now: '2026-10-07T13:32:08.000Z' });
  assert.equal(late.stopReason, 'DEADLINE_DECISION_TTL_QUOTE_AGE_OR_FENCE');
  assert.ok(late.steps.every((s) => Date.parse(s.notBefore) < Date.parse('2026-10-07T13:32:52.000Z')));
  const staleQuote = planSellToOpenLadder({ bid: 1.0, ask: 1.4, minCredit: 1.0, bounds: bounds({ maxQuoteAgeMs: 10_000 }), now: '2026-10-07T13:32:08.000Z' });
  assert.ok(staleQuote.steps.length <= 2);
  assert.throws(() => planSellToOpenLadder({ bid: 1, ask: 1.2, minCredit: 1, bounds: bounds({ maxSteps: 1000 }), now: '2026-10-07T13:32:08.000Z' }), /BOUNDS_INVALID/);
});

test('BUY_TO_CLOSE: bid -> mid -> toward ask within max debit; only typed risk reduction may pay up to the ask', () => {
  const normal = planBuyToCloseLadder({ bid: 0.30, ask: 0.40, maxDebit: 0.36, urgency: { kind: 'NONE' }, bounds: bounds(), now: '2026-10-07T13:32:08.000Z' });
  assert.equal(normal.steps[0]?.limitPrice, 0.3);
  assert.ok(normal.steps.every((s) => s.limitPrice <= 0.36));
  assert.equal(normal.stopReason, 'NEXT_STEP_ABOVE_MAX_ACCEPTABLE_DEBIT');
  const urgent = planBuyToCloseLadder({ bid: 0.30, ask: 0.40, maxDebit: 0.36, urgency: { kind: 'RISK_REDUCTION', reason: 'THESIS_INVALIDATED' },
    bounds: bounds(), now: '2026-10-07T13:32:08.000Z' });
  assert.equal(urgent.boundKind, 'URGENT_RISK_REDUCTION_CAP');
  assert.equal(urgent.steps.at(-1)?.limitPrice, 0.4);
  assert.ok(urgent.steps.every((s) => s.limitPrice <= 0.4 && s.reason.startsWith('URGENT_RISK_REDUCTION')));
});

test('per-step revalidation against a fresh quote invalidates stale or uneconomic steps; tick sizes', () => {
  const step = { index: 1, limitPrice: 1.58, notBefore: '2026-10-07T13:32:16.000Z', reason: 'MIDPOINT' };
  const ok = revalidateSellStep({ step, freshBid: 1.55, freshAsk: 1.61, freshQuoteAt: '2026-10-07T13:32:15.000Z', now: '2026-10-07T13:32:16.000Z', maxQuoteAgeMs: 5_000, minCredit: 1.57 });
  assert.equal(ok.state, 'PROCEED');
  assert.equal(revalidateSellStep({ step, freshBid: 1.4, freshAsk: 1.5, freshQuoteAt: '2026-10-07T13:32:15.000Z', now: '2026-10-07T13:32:16.000Z', maxQuoteAgeMs: 5_000, minCredit: 1.57 }).reason,
    'MARKET_MOVED_ASK_BELOW_MIN_CREDIT');
  assert.equal(revalidateSellStep({ step, freshBid: 1.55, freshAsk: 1.61, freshQuoteAt: '2026-10-07T13:32:00.000Z', now: '2026-10-07T13:32:16.000Z', maxQuoteAgeMs: 5_000, minCredit: 1.57 }).reason,
    'QUOTE_STALE');
  assert.deepEqual([tickFor(2.99), tickFor(3)], [0.01, 0.05]);
});
