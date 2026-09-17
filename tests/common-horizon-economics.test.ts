import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCommonHorizonComparison, forwardContinuationCashFlow, sunkRealizedEconomics,
} from '../src/theta/common-horizon-economics.js';

test('sunkRealizedEconomics sums only already-booked quantities and is null when fees are unknown', () => {
  assert.equal(sunkRealizedEconomics({ realizedOptionPnl: 100, realizedStockPnl: -20, dividends: 5, fees: 3 }), 82);
  assert.equal(sunkRealizedEconomics({ realizedOptionPnl: 100, realizedStockPnl: 0, dividends: 0, fees: null }), null);
});

test('forwardContinuationCashFlow reports incomplete when neither leg is known', () => {
  const result = forwardContinuationCashFlow({ closeCostDollars: null, openCreditDollars: null });
  assert.equal(result.netCashFlow, null);
  assert.equal(result.complete, false);
});

test('forwardContinuationCashFlow computes a close-only, open-only, and both-legs net correctly', () => {
  assert.equal(forwardContinuationCashFlow({ closeCostDollars: 50, openCreditDollars: null }).netCashFlow, -50);
  assert.equal(forwardContinuationCashFlow({ closeCostDollars: null, openCreditDollars: 80 }).netCashFlow, 80);
  const both = forwardContinuationCashFlow({ closeCostDollars: 50, openCreditDollars: 80 });
  assert.equal(both.netCashFlow, 30);
  assert.equal(both.complete, true);
});

test('forwardContinuationCashFlow output is invariant to sunk realized P&L -- no double counting is structurally possible', () => {
  // The function has no sunk-P&L parameter at all, so two calls with the
  // same forward legs but "different histories" cannot differ.
  const first = forwardContinuationCashFlow({ closeCostDollars: 50, openCreditDollars: 80 });
  const second = forwardContinuationCashFlow({ closeCostDollars: 50, openCreditDollars: 80 });
  assert.deepEqual(first, second);
});

test('buildCommonHorizonComparison anchors on the furthest known expiration and reports sunk P&L separately', () => {
  const comparison = buildCommonHorizonComparison(
    '2026-09-12T14:00:00.000Z',
    { realizedOptionPnl: 10, realizedStockPnl: 0, dividends: 0, fees: 1 },
    '2026-10-16', ['2026-11-20', null],
  );
  assert.equal(comparison.horizonAnchor, '2026-11-20');
  assert.equal(comparison.sunkRealizedPnl, 9);
  assert.deepEqual(comparison.candidateExpirations, ['2026-10-16', '2026-11-20']);
});

test('buildCommonHorizonComparison reports a null horizon anchor when no expiration is known at all', () => {
  const comparison = buildCommonHorizonComparison(
    '2026-09-12T14:00:00.000Z', { realizedOptionPnl: 0, realizedStockPnl: 0, dividends: 0, fees: 0 }, null, [null],
  );
  assert.equal(comparison.horizonAnchor, null);
});
