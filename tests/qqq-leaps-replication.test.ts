import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseExpiration, chooseStrike, leapsMetrics, realizedVolProxy, simulateLeaps, sourceMechanicalVariant, type DailyBar,
} from '../src/research/source-replication/qqq-leaps.js';
import { blackScholes } from '../src/theta/strategy-intelligence/option-payoff.js';

const pricing = { volatilityAt: () => 0.2, rate: 0.04, halfSpreadPct: 0.01, commissionPerContractUsd: 0.65, multiplier: 100 };
const isoAdd = (start: string, n: number) => new Date(Date.parse(`${start}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const bars = (closes: readonly number[], start = '2024-01-02'): DailyBar[] => closes.map((c, i) => ({ date: isoAdd(start, i), open: c, close: c }));
const modelMark = (b: readonly DailyBar[]) => (i: number, strike: number, expiration: string) => {
  const bar = b[i] as DailyBar;
  const years = Math.max(0, (Date.parse(`${expiration}T00:00:00Z`) - Date.parse(`${bar.date}T00:00:00Z`)) / 86_400_000 / 365);
  return blackScholes('CALL', bar.close, strike, years, 0.2, 0.04).price;
};

test('expiry is the standard third-Friday monthly closest to ~12 months out', () => {
  assert.equal(chooseExpiration('2024-03-04', 365), '2025-02-21'); // 11 days from the target vs 17 for 03-21
  assert.equal(new Date('2025-02-21T00:00:00Z').getUTCDay(), 5);
});

test('strike is the $5-grid strike whose BS delta is closest to 0.60', () => {
  const { strike, delta } = chooseStrike(400, 1, 0.2, 0.04, 0.6);
  assert.ok(Math.abs(delta - 0.6) < 0.03, String(delta));
  assert.equal(strike % 5, 0);
  assert.ok(strike >= 400 && strike <= 430);
});

test('a -1% day buys one call; a rally hits the +50% target and books the P&L net of costs', () => {
  const closes = [400, 395, ...Array.from({ length: 120 }, (_, k) => 395 + k * 0.8)];
  const b = bars(closes);
  const result = simulateLeaps(b, sourceMechanicalVariant, pricing, modelMark(b));
  const metrics = leapsMetrics(result);
  assert.equal(result.trades.length, 1);
  const trade = result.trades[0];
  assert.equal(trade?.exitReason, 'PROFIT_TARGET');
  assert.ok((trade?.exitPrice ?? 0) >= (trade?.entryPrice ?? Infinity) * 1.5);
  assert.ok((trade?.pnlUsd ?? 0) > 0 && (trade?.pnlUsd ?? 0) < ((trade?.exitPrice ?? 0) - (trade?.entryPrice ?? 0)) * 100);
  assert.equal(metrics.wins, 1);
});

test('without a target the call is held to expiry and settles at intrinsic (no stop-loss, per source)', () => {
  const closes = [400, 395, ...Array.from({ length: 420 }, () => 392)]; // one trigger only (395 -> 392 is -0.76%)
  const b = bars(closes);
  const result = simulateLeaps(b, sourceMechanicalVariant, pricing, modelMark(b));
  const trade = result.trades[0];
  assert.equal(trade?.exitReason, 'EXPIRY');
  assert.ok((trade?.pnlUsd ?? 0) < 0);
  assert.equal(leapsMetrics(result).losses, 1);
});

test('cadence variants: every trigger stacks entries, monthly cap allows one per month, no-overlap waits for flat', () => {
  const closes = [400, 395, 390, 385, 380, ...Array.from({ length: 40 }, () => 380)];
  const b = bars(closes);
  const every = simulateLeaps(b, sourceMechanicalVariant, pricing, modelMark(b));
  const monthly = simulateLeaps(b, { ...sourceMechanicalVariant, cadence: 'MONTHLY_CAP' }, pricing, modelMark(b));
  const flat = simulateLeaps(b, { ...sourceMechanicalVariant, cadence: 'NO_OVERLAP' }, pricing, modelMark(b));
  assert.equal(every.trades.length, 4);
  assert.equal(monthly.trades.length, 1);
  assert.equal(flat.trades.length, 1);
  // Positions still open at the data end are reported, never counted as wins or losses.
  assert.equal(leapsMetrics(every).closedTrades, 0);
  assert.equal(leapsMetrics(every).openAtEnd, 4);
});

test('the SMA200 regime filter blocks dip entries in a downtrend', () => {
  const closes = [...Array.from({ length: 220 }, (_, k) => 500 - k), 270, 265];
  const b = bars(closes);
  const none = simulateLeaps(b, sourceMechanicalVariant, pricing, modelMark(b));
  const filtered = simulateLeaps(b, { ...sourceMechanicalVariant, regimeFilter: 'CLOSE_ABOVE_SMA200' }, pricing, modelMark(b));
  assert.ok(none.trades.length > 0);
  assert.equal(filtered.trades.length, 0);
});

test('realized-vol proxy is labelled bounded and null before the lookback', () => {
  const b = bars(Array.from({ length: 80 }, (_, k) => 100 * Math.exp(0.01 * Math.sin(k))));
  const vol = realizedVolProxy(b);
  assert.equal(vol(10), null);
  const v = vol(79) as number;
  assert.ok(v >= 0.12 && v <= 0.6);
});
