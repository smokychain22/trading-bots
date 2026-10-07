import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateEarningsVolatilityObservation, replicateEarningsVolatility,
  type EarningsVolatilityObservation, type EarningsVolatilityPolicy } from '../src/research/source-replication/earnings-volatility.js';

const policy: EarningsVolatilityPolicy = { version: 'fixture-policy', maximumTermSlopePerDay: -0.001,
  minimumAverageDailyVolume30d: 1_000_000, minimumIv30ToRv30: 1.2 };
const quote = (bid: number, ask: number) => ({ bid, ask });
const observation = (overrides: Partial<EarningsVolatilityObservation> = {}): EarningsVolatilityObservation => ({
  eventId: 'SPY-2026Q3', symbol: 'SPY', decisionAt: '2026-10-07T19:45:00.000Z',
  providerKnownAt: '2026-10-01T12:00:00.000Z', eventAt: '2026-10-07T20:05:00.000Z', exitAt: '2026-10-08T13:45:00.000Z',
  spotBefore: 100, spotAfter: 102, atmStrike: 100, multiplier: 100,
  frontExpiration: '2026-10-09', backExpiration: '2026-11-06', frontIv: 0.6, backIv: 0.4,
  iv30: 0.48, rv30: 0.3, averageDailyVolume30d: 5_000_000,
  entryFrontCall: quote(3, 3.1), entryFrontPut: quote(2.8, 2.9),
  exitFrontCall: quote(2.1, 2.2), exitFrontPut: quote(0.7, 0.8),
  entryBackOption: quote(5.1, 5.2), exitBackOption: quote(4.9, 5),
  entryFrontCalendarOption: quote(3, 3.1), exitFrontCalendarOption: quote(2.1, 2.2),
  totalStraddleCostsUsd: 8, totalCalendarCostsUsd: 6,
  ...overrides,
});

test('qualifying event uses executable bid-to-ask structure economics and preserves research-only authority', () => {
  const receipt = replicateEarningsVolatility([observation()], policy);
  assert.equal(receipt.qualifiedCount, 1);
  assert.equal(receipt.shortAtmStraddle.gross.cumulativePnlUsd, 280);
  assert.equal(receipt.shortAtmStraddle.net?.cumulativePnlUsd, 272);
  assert.equal(receipt.longCalendar.gross.cumulativePnlUsd, 50);
  assert.equal(receipt.longCalendar.net?.cumulativePnlUsd, 44);
  assert.equal(receipt.executionAuthorized, false);
  assert.equal(receipt.profitabilityStatus, 'EMPIRICALLY_UNPROVEN');
});

test('missing source thresholds block the episode instead of inventing policy', () => {
  const blocked = evaluateEarningsVolatilityObservation(observation(), { ...policy, minimumIv30ToRv30: null });
  assert.equal(blocked.state, 'BLOCKED_MISSING_POLICY');
  assert.deepEqual(blocked.reasons, ['MISSING_POLICY:MINIMUM_IV30_TO_RV30']);
  assert.equal(blocked.straddleGrossPnlUsd, null);
});

test('future-known event evidence is PIT unsafe and never enters metrics', () => {
  const unsafe = observation({ providerKnownAt: '2026-10-08T12:00:00.000Z' });
  const receipt = replicateEarningsVolatility([unsafe], policy);
  assert.equal(receipt.stateCounts.PIT_UNSAFE, 1);
  assert.equal(receipt.qualifiedCount, 0);
  assert.equal(receipt.shortAtmStraddle.gross.n, 0);
});

test('predictor failures remain explicit filtered outcomes', () => {
  const receipt = replicateEarningsVolatility([
    observation({ eventId: 'term', frontIv: 0.4, backIv: 0.39 }),
    observation({ eventId: 'volume', averageDailyVolume30d: 10 }),
    observation({ eventId: 'vrp', iv30: 0.31, rv30: 0.3 }),
  ], policy);
  assert.equal(receipt.qualifiedCount, 0);
  assert.equal(receipt.stateCounts.FILTERED_OUT, 3);
  assert.deepEqual(receipt.episodes.map((episode) => episode.reasons[0]),
    ['TERM_SLOPE_NOT_NEGATIVE_ENOUGH', 'VOLUME_BELOW_POLICY', 'IV30_RV30_BELOW_POLICY']);
});

test('tail metrics use chronological PnL and do not hide the loss', () => {
  const win = observation({ eventId: 'a' });
  const loss = observation({ eventId: 'b', decisionAt: '2026-10-08T19:45:00.000Z', eventAt: '2026-10-08T20:05:00.000Z',
    exitAt: '2026-10-09T13:45:00.000Z', exitFrontCall: quote(7, 7.2), exitFrontPut: quote(2, 2.2) });
  const receipt = replicateEarningsVolatility([win, loss], policy);
  assert.equal(receipt.shortAtmStraddle.net?.n, 2);
  assert.equal(receipt.shortAtmStraddle.net?.losses, 1);
  assert.ok((receipt.shortAtmStraddle.net?.maxDrawdownUsd ?? 0) < 0);
  assert.ok((receipt.shortAtmStraddle.net?.expectedShortfall5PctUsd ?? 0) < 0);
});
