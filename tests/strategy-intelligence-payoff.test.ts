import assert from 'node:assert/strict';
import test from 'node:test';
import { blackScholes, expiryProfile, pnlAtHorizon, positionGreeks, type PayoffLeg } from '../src/theta/strategy-intelligence/option-payoff.js';

const T = 30 / 365;
let n = 0;
const leg = (kind: PayoffLeg['kind'], side: PayoffLeg['side'], strike: number | undefined, price: number, extra: Partial<PayoffLeg> = {}): PayoffLeg => ({
  id: `L${n++}`, kind, side, quantity: 1, multiplier: kind === 'STOCK' ? 1 : 100, entryPrice: price,
  ...(strike === undefined ? {} : { strike, expiryYears: T }), ...extra,
});
const at = (legs: readonly PayoffLeg[], spot: number) => Number(pnlAtHorizon(legs, spot).toFixed(6));
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('long and short call/put: below, at, above strike; bounds and breakevens', () => {
  const lc = [leg('CALL', 'LONG', 100, 3)];
  assert.equal(at(lc, 50), -300); assert.equal(at(lc, 100), -300); assert.equal(at(lc, 110), 700);
  const p = expiryProfile(lc, { spot: 100 });
  assert.equal(p.maxProfit, 'UNBOUNDED'); assert.equal(p.maxLoss, 300); assert.deepEqual(p.breakevens, [103]);
  const sc = [leg('CALL', 'SHORT', 100, 3)];
  const ps = expiryProfile(sc, { spot: 100 });
  assert.equal(ps.maxLoss, 'UNBOUNDED'); assert.equal(ps.maxProfit, 300); assert.equal(ps.minPnl, '-UNBOUNDED');
  const lp = [leg('PUT', 'LONG', 100, 2)];
  assert.equal(at(lp, 0), 9800); assert.equal(at(lp, 100), -200); assert.equal(at(lp, 150), -200);
  const sp = expiryProfile([leg('PUT', 'SHORT', 100, 2)], { spot: 105 });
  assert.equal(sp.maxProfit, 200); assert.equal(sp.maxLoss, 9800); assert.deepEqual(sp.breakevens, [98]);
});

test('verticals: bull call, bear call, put credit spread, call credit spread', () => {
  const bull = [leg('CALL', 'LONG', 100, 4), leg('CALL', 'SHORT', 110, 1)];
  const b = expiryProfile(bull, { spot: 100 });
  assert.equal(b.maxLoss, 300); assert.equal(b.maxProfit, 700); assert.deepEqual(b.breakevens, [103]); assert.equal(b.entryCashflow, -300);
  assert.equal(at(bull, 105), 200);
  const bearCall = expiryProfile([leg('CALL', 'SHORT', 100, 4), leg('CALL', 'LONG', 110, 1)], { spot: 95 });
  assert.equal(bearCall.maxProfit, 300); assert.equal(bearCall.maxLoss, 700); assert.deepEqual(bearCall.breakevens, [103]);
  const pcs = [leg('PUT', 'SHORT', 100, 2.5), leg('PUT', 'LONG', 95, 1)];
  const q = expiryProfile(pcs, { spot: 105 });
  assert.equal(q.maxProfit, 150); assert.equal(q.maxLoss, 350); assert.deepEqual(q.breakevens, [98.5]);
  assert.equal(at(pcs, 95), -350); assert.equal(at(pcs, 97.5), -100); assert.equal(at(pcs, 1000), 150);
  const ccs = expiryProfile([leg('CALL', 'SHORT', 110, 2), leg('CALL', 'LONG', 115, 0.5)], { spot: 105 });
  assert.equal(ccs.maxProfit, 150); assert.equal(ccs.maxLoss, 350); assert.deepEqual(ccs.breakevens, [111.5]);
});

test('long and short butterfly are exact 1:-2:1 mirrors', () => {
  const body = (side: 'LONG' | 'SHORT') => {
    const inv = side === 'LONG' ? 'SHORT' : 'LONG';
    return [leg('CALL', side, 95, 7), { ...leg('CALL', inv, 100, 4), quantity: 2 }, leg('CALL', side, 105, 2)];
  };
  const lb = expiryProfile(body('LONG'), { spot: 100 });
  assert.equal(lb.entryCashflow, -100); assert.equal(lb.maxProfit, 400); assert.equal(lb.maxLoss, 100);
  assert.deepEqual(lb.breakevens, [96, 104]); assert.equal(lb.upsideSlope, 0);
  const sb = expiryProfile(body('SHORT'), { spot: 100 });
  assert.equal(sb.maxProfit, 100); assert.equal(sb.maxLoss, 400); assert.equal(sb.minPnlAtSpot, 100);
  for (const s of [50, 95, 97.5, 100, 102.5, 105, 300]) assert.equal(at(body('LONG'), s), -at(body('SHORT'), s));
});

test('straddles, short strangle, iron condor', () => {
  const ls = [leg('CALL', 'LONG', 100, 3), leg('PUT', 'LONG', 100, 3)];
  const p = expiryProfile(ls, { spot: 100 });
  assert.equal(p.maxLoss, 600); assert.equal(p.maxProfit, 'UNBOUNDED'); assert.deepEqual(p.breakevens, [94, 106]);
  const ss = expiryProfile([leg('CALL', 'SHORT', 100, 3), leg('PUT', 'SHORT', 100, 3)], { spot: 100 });
  assert.equal(ss.maxProfit, 600); assert.equal(ss.maxLoss, 'UNBOUNDED');
  const strangle = expiryProfile([leg('CALL', 'SHORT', 110, 1.5), leg('PUT', 'SHORT', 90, 1.5)], { spot: 100 });
  assert.equal(strangle.maxProfit, 300); assert.equal(strangle.maxLoss, 'UNBOUNDED'); assert.deepEqual(strangle.breakevens, [87, 113]);
  const ic = [leg('PUT', 'LONG', 85, 0.5), leg('PUT', 'SHORT', 90, 1.5), leg('CALL', 'SHORT', 110, 1.5), leg('CALL', 'LONG', 115, 0.5)];
  const c = expiryProfile(ic, { spot: 100 });
  assert.equal(c.maxProfit, 200); assert.equal(c.maxLoss, 300); assert.deepEqual(c.breakevens, [88, 112]);
  assert.equal(at(ic, 0), -300); assert.equal(at(ic, 1e4), -300); assert.equal(at(ic, 100), 200);
});

test('backspreads (1x2) have a loss valley and convex wing', () => {
  const cb = [leg('CALL', 'SHORT', 100, 5), { ...leg('CALL', 'LONG', 110, 2), quantity: 2 }];
  const p = expiryProfile(cb, { spot: 100 });
  assert.equal(p.entryCashflow, 100); assert.equal(p.maxProfit, 'UNBOUNDED'); assert.equal(p.maxLoss, 900);
  assert.equal(p.minPnlAtSpot, 110); assert.deepEqual(p.breakevens, [101, 119]); assert.equal(at(cb, 50), 100);
  const pb = [leg('PUT', 'SHORT', 100, 5), { ...leg('PUT', 'LONG', 90, 2), quantity: 2 }];
  const q = expiryProfile(pb, { spot: 100 });
  assert.equal(q.maxLoss, 900); assert.equal(q.minPnlAtSpot, 90); assert.deepEqual(q.breakevens, [81, 99]);
  assert.equal(q.maxProfit, 8100); // bounded at spot 0: 2*90 - 100 + 1 credit = 81 per share
});

test('protective put and covered call with stock legs (multiplier per share)', () => {
  const stock = { ...leg('STOCK', 'LONG', undefined, 100), quantity: 100 };
  const pp = expiryProfile([stock, leg('PUT', 'LONG', 95, 2)], { spot: 100 });
  assert.equal(pp.maxLoss, 700); assert.equal(pp.maxProfit, 'UNBOUNDED'); assert.deepEqual(pp.breakevens, [102]);
  const cc = expiryProfile([stock, leg('CALL', 'SHORT', 105, 2)], { spot: 100 });
  assert.equal(cc.maxProfit, 700); assert.equal(cc.maxLoss, 9800); assert.deepEqual(cc.breakevens, [98]); assert.equal(cc.upsideSlope, 0);
});

test('multiplier is exact and never defaulted', () => {
  const adjusted = [{ ...leg('PUT', 'SHORT', 50, 1), multiplier: 105 }];
  assert.equal(at(adjusted, 40), (1 - 10) * 105);
  assert.throws(() => expiryProfile([{ ...leg('PUT', 'SHORT', 50, 1), multiplier: 0 }], { spot: 50 }), /MULTIPLIER_REQUIRED/);
});

test('calendar and diagonal: front-expiry horizon values the back leg with Black-Scholes (separate math)', () => {
  const back = 60 / 365;
  const cal = [leg('CALL', 'SHORT', 100, 2.3), leg('CALL', 'LONG', 100, 3.6, { expiryYears: back, iv: 0.25 })];
  const p = expiryProfile(cal, { spot: 100 });
  assert.equal(p.method, 'FRONT_EXPIRY_WITH_BLACK_SCHOLES_BACK_LEGS_NUMERIC');
  const peak = (blackScholes('CALL', 100, 100, back - T, 0.25).price - 1.3) * 100;
  close(at(cal, 100), Number(peak.toFixed(6)));
  assert.equal(p.minPnlAtSpot === 0 || (p.minPnlAtSpot as number) > 400, true); // worst far from the strike
  assert.equal(p.maxLoss, 130); // net debit at the extremes
  assert.equal(p.breakevens.length, 2);
  assert.throws(() => expiryProfile([leg('CALL', 'SHORT', 100, 2), leg('CALL', 'LONG', 100, 3, { expiryYears: back })], { spot: 100 }), /BACK_LEG_UNVALUED/);
  const diag = [leg('CALL', 'SHORT', 105, 1.2), leg('CALL', 'LONG', 100, 4.5, { expiryYears: back, iv: 0.25 })];
  assert.equal(expiryProfile(diag, { spot: 100 }).upsideSlope, 0);
});

test('Black-Scholes: put-call parity, zero-vol and zero-time edges, Greeks recomputed on new state', () => {
  const c = blackScholes('CALL', 100, 95, 0.25, 0.3, 0.04); const p = blackScholes('PUT', 100, 95, 0.25, 0.3, 0.04);
  close(c.price - p.price, 100 - 95 * Math.exp(-0.04 * 0.25), 1e-5);
  close(c.delta - p.delta, 1, 1e-9);
  assert.deepEqual(blackScholes('PUT', 90, 95, 0, 0.3), { price: 5, delta: -1, gamma: 0, thetaPerDay: 0, vegaPerPoint: 0, rhoPerPoint: 0 });
  assert.equal(blackScholes('CALL', 100, 95, 0.25, 0).delta, 1);
  const pos = [leg('PUT', 'SHORT', 95, 1.5, { iv: 0.3 })];
  const now = positionGreeks(pos, { spot: 100 }); const down = positionGreeks(pos, { spot: 92, ivShift: 0.1, elapsedYears: 10 / 365 });
  assert.ok(now.state === 'KNOWN' && down.state === 'KNOWN');
  assert.ok(now.state === 'KNOWN' && now.thetaPerDay > 0 && now.vegaPerPoint < 0 && now.gamma < 0);
  assert.ok(now.state === 'KNOWN' && down.state === 'KNOWN' && down.delta > now.delta && down.pnl < now.pnl);
});
