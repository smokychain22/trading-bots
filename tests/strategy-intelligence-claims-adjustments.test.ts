import assert from 'node:assert/strict';
import test from 'node:test';
import type { PayoffLeg } from '../src/theta/strategy-intelligence/option-payoff.js';
import { evaluateNoLossClaim } from '../src/theta/strategy-intelligence/no-loss-claims.js';
import { buildAdjustmentProposal, buildProfitLockProposal } from '../src/theta/strategy-intelligence/adjustment-proposals.js';

const T = 30 / 365;
let n = 0;
const leg = (kind: PayoffLeg['kind'], side: PayoffLeg['side'], strike: number | undefined, price: number, extra: Partial<PayoffLeg> = {}): PayoffLeg => ({
  id: `L${n++}`, kind, side, quantity: 1, multiplier: kind === 'STOCK' ? 1 : 100, entryPrice: price, iv: 0.3,
  ...(strike === undefined ? {} : { strike, expiryYears: T }), ...extra,
});

test('profit lock: a profitable long call plus a protective put has a positive minimum lifetime payoff (math reproduced)', () => {
  const call = leg('CALL', 'LONG', 100, 2); const put = leg('PUT', 'LONG', 110, 1.5);
  const locked = evaluateNoLossClaim('LOCKED_MINIMUM_PROFIT', [call, put], { spot: 115 });
  assert.equal(locked.verdict, 'REPRODUCED');
  assert.equal(locked.staticEvidence.minExpiryPnl, 650);
  assert.equal(evaluateNoLossClaim('STATIC_NO_LOSS_AT_EXPIRY', [call, put], { spot: 115 }).verdict, 'REPRODUCED');
  // Path risk is separate and still reported: mark-to-market scenarios exist, costs reduce the floor.
  const withCosts = evaluateNoLossClaim('LOCKED_MINIMUM_PROFIT', [call, put], { spot: 115, costPerContractUsd: 2 });
  assert.equal(withCosts.pathRisk.minExpiryPnlAfterCosts, 646);
  assert.equal(withCosts.pathRisk.scenarios, 42);
  assert.ok(withCosts.pathRisk.worstMarkToMarketPnl !== null);
  const lock = buildProfitLockProposal([call], put, 115);
  assert.equal(lock.locksProfit, true); assert.equal(lock.minimumLockedPayoff, 650); assert.equal(lock.remainingUpside, 'UNBOUNDED');
  assert.equal(lock.hedgeCost, 150); assert.equal(lock.proposal.verdict, 'IMPROVES_UNDER_STATED_EVIDENCE');
});

test('converting a profitable long call into a bull call spread locks a floor equal to credit minus cost', () => {
  const r = evaluateNoLossClaim('LOCKED_MINIMUM_PROFIT', [leg('CALL', 'LONG', 100, 2), leg('CALL', 'SHORT', 120, 6)], { spot: 125 });
  assert.equal(r.verdict, 'REPRODUCED'); assert.equal(r.staticEvidence.minExpiryPnl, 400);
  assert.ok(r.pathRisk.earlyAssignmentExposure.some((x) => x.startsWith('SHORT_AMERICAN_CALL_120')));
});

test('a short put is not no-loss but is limited-loss; unknown IV makes path risk UNKNOWN, never zero', () => {
  const sp = [leg('PUT', 'SHORT', 57, 0.28)];
  assert.equal(evaluateNoLossClaim('STATIC_NO_LOSS_AT_EXPIRY', sp, { spot: 64 }).verdict, 'NOT_REPRODUCED');
  assert.equal(evaluateNoLossClaim('LIMITED_LOSS', sp, { spot: 64 }).verdict, 'REPRODUCED');
  const noIv = evaluateNoLossClaim('LIMITED_LOSS', [{ ...leg('PUT', 'SHORT', 57, 0.28), iv: null }], { spot: 64 });
  assert.equal(noIv.pathRisk.worstMarkToMarketPnl, null); assert.ok(noIv.pathRisk.unknownReasons.length > 0);
  assert.equal(evaluateNoLossClaim('LIMITED_LOSS', [leg('CALL', 'SHORT', 70, 1)], { spot: 64 }).verdict, 'NOT_REPRODUCED');
});

test('credit-financed long vol: a 1x2 call backspread for a credit has long gamma and an unbounded wing', () => {
  const back = [leg('CALL', 'SHORT', 100, 5), { ...leg('CALL', 'LONG', 110, 2), quantity: 2 }];
  const r = evaluateNoLossClaim('CREDIT_FINANCED_LONG_VOL', back, { spot: 106 });
  assert.equal(r.verdict, 'REPRODUCED', r.detail);
  assert.equal(evaluateNoLossClaim('ZERO_NET_DEBIT', back, { spot: 106 }).verdict, 'REPRODUCED');
  assert.equal(evaluateNoLossClaim('STATIC_NO_LOSS_AT_EXPIRY', back, { spot: 106 }).verdict, 'NOT_REPRODUCED'); // loss valley at 110
  const valley = evaluateNoLossClaim('STATIC_NO_LOSS_AT_EXPIRY', back, { spot: 106 }).staticEvidence;
  assert.equal(valley.lossShape, 'LOSS_VALLEY_PRESENT'); // never labelled NO_LOSS
  assert.equal(valley.worstSpot, 110);
  assert.equal(valley.minExpiryPnl, -900);
  assert.equal(evaluateNoLossClaim('LIMITED_LOSS', [leg('CALL', 'LONG', 100, 3)], { spot: 100 }).staticEvidence.lossShape, 'LOSS_TAIL');
  assert.equal(evaluateNoLossClaim('NON_NEGATIVE_STATIC_PAYOFF', back, { spot: 106 }).verdict, 'NOT_REPRODUCED');
  assert.equal(evaluateNoLossClaim('NON_NEGATIVE_STATIC_PAYOFF', [leg('CALL', 'LONG', 100, 3)], { spot: 100 }).verdict, 'REPRODUCED');
});

test('delta-hedged local range: long gamma hedged to neutral holds locally, short gamma does not; margin is never inferred', () => {
  const straddle = [leg('CALL', 'LONG', 100, 3.4), leg('PUT', 'LONG', 100, 3.4)];
  const ctx = { spot: 100, localBandPct: 0.02, deltaToleranceShares: 10 };
  assert.equal(evaluateNoLossClaim('DELTA_HEDGED_LOCAL_RANGE', straddle, ctx).verdict, 'REPRODUCED');
  const short = straddle.map((l) => ({ ...l, side: 'SHORT' as const }));
  assert.equal(evaluateNoLossClaim('DELTA_HEDGED_LOCAL_RANGE', short, ctx).verdict, 'NOT_REPRODUCED');
  assert.equal(evaluateNoLossClaim('DELTA_HEDGED_LOCAL_RANGE', straddle, { spot: 100 }).verdict, 'UNDETERMINED');
  assert.equal(evaluateNoLossClaim('BROKER_MARGIN_REDUCTION', straddle, { spot: 100 }).verdict, 'UNDETERMINED');
});

test('short strangle -> iron condor bounds the loss; wrong-direction wings are INVALID', () => {
  const sc = leg('CALL', 'SHORT', 110, 1.5); const sp = leg('PUT', 'SHORT', 90, 1.5);
  const p = buildAdjustmentProposal({ variant: 'SHORT_STRANGLE_TO_IRON_CONDOR', current: [sc, sp], close: [], spot: 100,
    open: [leg('CALL', 'LONG', 115, 0.5), leg('PUT', 'LONG', 85, 0.5)], objective: { kind: 'REDUCE_MAX_LOSS' } });
  assert.equal(p.verdict, 'IMPROVES_UNDER_STATED_EVIDENCE'); assert.equal(p.before.maxLoss, 'UNBOUNDED'); assert.equal(p.after.maxLoss, 300);
  assert.equal(p.additionalCapital, 'REDUCED_FROM_UNBOUNDED'); assert.equal(p.adjustmentCashflow, -100);
  assert.equal(p.expectedValueChange.state, 'UNKNOWN');
  const bad = buildAdjustmentProposal({ variant: 'ADD_CALL_WING', current: [sc, sp], close: [], spot: 100,
    open: [leg('CALL', 'SHORT', 115, 0.5)], objective: { kind: 'REDUCE_MAX_LOSS' } });
  assert.equal(bad.verdict, 'INVALID');
});

test('roll = close old + open new: the closed leg realized P&L is immutable and carried, not absorbed', () => {
  const old = leg('PUT', 'SHORT', 95, 1.5);
  const p = buildAdjustmentProposal({ variant: 'ROLL_WINNING_SIDE', current: [old], close: [{ legId: old.id, exitPrice: 0.2 }], spot: 103,
    open: [leg('PUT', 'SHORT', 100, 1.1, { expiryYears: 45 / 365 })], objective: { kind: 'RAISE_MIN_PAYOFF' }, maxAdditionalCapital: 1e6 });
  assert.deepEqual(p.closed, [{ legId: old.id, exitPrice: 0.2, realizedPnl: 130 }]);
  assert.equal(p.after.realizedPnl, 130); assert.equal(p.adjustmentCashflow, 90);
  assert.equal(p.verdict, 'DOES_NOT_IMPROVE'); // a higher strike lowers the minimum payoff: rolling "because winning" is not an improvement
  const bigger = buildAdjustmentProposal({ variant: 'ROLL_WINNING_SIDE', current: [old], close: [{ legId: old.id, exitPrice: 0.2 }], spot: 103,
    open: [{ ...leg('PUT', 'SHORT', 100, 1.1), quantity: 2 }], objective: { kind: 'RAISE_MIN_PAYOFF' } });
  assert.equal(bigger.verdict, 'INVALID');
});

test('an adjustment that costs more than it helps under the stated evidence range does not improve', () => {
  const sp = leg('PUT', 'SHORT', 95, 1.5);
  const p = buildAdjustmentProposal({ variant: 'SHORT_PREMIUM_TO_CREDIT_SPREAD', current: [sp], close: [], spot: 100,
    open: [leg('PUT', 'LONG', 90, 0.6)], objective: { kind: 'IMPROVE_RANGE_PNL', low: 96, high: 104, evidence: 'fixture expected move' } });
  assert.equal(p.verdict, 'DOES_NOT_IMPROVE'); assert.ok(p.reasons.includes('OBJECTIVE_NOT_IMPROVED'));
  const risk = buildAdjustmentProposal({ variant: 'SHORT_PREMIUM_TO_CREDIT_SPREAD', current: [sp], close: [], spot: 100,
    open: [leg('PUT', 'LONG', 90, 0.6)], objective: { kind: 'REDUCE_MAX_LOSS' } });
  assert.equal(risk.verdict, 'IMPROVES_UNDER_STATED_EVIDENCE'); assert.equal(risk.after.maxLoss, 410);
});

test('conversion to butterfly must produce an exact 1:-2:1 same-expiry structure; no naked call may be created', () => {
  const lc = leg('CALL', 'LONG', 100, 3);
  const ok = buildAdjustmentProposal({ variant: 'CONVERT_TO_BUTTERFLY', current: [lc], close: [], spot: 106,
    open: [{ ...leg('CALL', 'SHORT', 105, 3.5), quantity: 2 }, leg('CALL', 'LONG', 110, 1.6)], objective: { kind: 'RAISE_MIN_PAYOFF' } });
  assert.equal(ok.verdict, 'IMPROVES_UNDER_STATED_EVIDENCE'); assert.equal(ok.after.minExpiryPnl, 240);
  const naked = buildAdjustmentProposal({ variant: 'CONVERT_TO_BUTTERFLY', current: [lc], close: [], spot: 106,
    open: [{ ...leg('CALL', 'SHORT', 105, 3.5), quantity: 2 }], objective: { kind: 'RAISE_MIN_PAYOFF' } });
  assert.equal(naked.verdict, 'INVALID');
  assert.ok(naked.legDirectionViolations.includes('ADJUSTMENT_CREATES_NAKED_SHORT_CALL'));
});

test('delta hedge and calendar hedge are structurally checked', () => {
  const sc = leg('CALL', 'SHORT', 100, 3);
  const hedge = buildAdjustmentProposal({ variant: 'DELTA_HEDGE', current: [sc], close: [], spot: 100,
    open: [{ ...leg('STOCK', 'LONG', undefined, 100), quantity: 52 }], objective: { kind: 'REDUCE_ABS_DELTA' }, maxAdditionalCapital: 1e9 });
  assert.equal(hedge.verdict, 'IMPROVES_UNDER_STATED_EVIDENCE');
  const cal = buildAdjustmentProposal({ variant: 'CALENDAR_HEDGE', current: [sc], close: [], spot: 100,
    open: [leg('CALL', 'LONG', 100, 4.5, { expiryYears: 60 / 365 })], objective: { kind: 'REDUCE_MAX_LOSS' }, maxAdditionalCapital: 0 });
  assert.equal(cal.verdict, 'IMPROVES_UNDER_STATED_EVIDENCE'); assert.equal(cal.before.maxLoss, 'UNBOUNDED');
  const wrongCal = buildAdjustmentProposal({ variant: 'CALENDAR_HEDGE', current: [sc], close: [], spot: 100,
    open: [leg('CALL', 'LONG', 100, 4.5)], objective: { kind: 'REDUCE_MAX_LOSS' } });
  assert.equal(wrongCal.verdict, 'INVALID');
});
