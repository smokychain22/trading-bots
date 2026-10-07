import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFutureResearchStructure, type FutureResearchStructure }
  from '../src/research/source-replication/future-structure-research.js';
import type { PayoffLeg } from '../src/theta/strategy-intelligence/option-payoff.js';

const T = 30 / 365; let id = 0;
const leg = (kind: 'CALL' | 'PUT', side: 'LONG' | 'SHORT', strike: number, price: number,
  quantity = 1, expiryYears = T): PayoffLeg => ({ id: `L${id++}`, kind, side, strike, entryPrice: price,
    quantity, multiplier: 100, expiryYears, iv: 0.25 });
const evaluate = (structure: FutureResearchStructure, legs: readonly PayoffLeg[], extra: Record<string, unknown> = {}) =>
  evaluateFutureResearchStructure({ structure, legs, spot: 100, observedAt: '2026-10-07T15:00:00.000Z',
    providerKnownAt: '2026-10-07T15:00:00.000Z', totalEntryExitCostsUsd: 8, expectedMovePct: 0.04,
    absoluteDelta: 0.1, dte: 5, lotteryPolicy: { version: 'fixture', maximumLowDelta: 0.15,
      maximumShortDte: 7, requiredMoveToExpectedMoveRatio: 1.5 }, ...extra });

test('butterfly, calendar, diagonal, backspread and debit-spread geometry reuse the shared payoff engine', () => {
  const cases: [FutureResearchStructure, PayoffLeg[]][] = [
    ['LONG_BUTTERFLY', [leg('CALL', 'LONG', 95, 7), leg('CALL', 'SHORT', 100, 4, 2), leg('CALL', 'LONG', 105, 2)]],
    ['SHORT_BUTTERFLY', [leg('CALL', 'SHORT', 95, 7), leg('CALL', 'LONG', 100, 4, 2), leg('CALL', 'SHORT', 105, 2)]],
    ['CALENDAR', [leg('CALL', 'SHORT', 100, 2), leg('CALL', 'LONG', 100, 3.5, 1, 60 / 365)]],
    ['DIAGONAL', [leg('CALL', 'SHORT', 105, 1.2), leg('CALL', 'LONG', 100, 4.5, 1, 60 / 365)]],
    ['CALL_BACKSPREAD', [leg('CALL', 'SHORT', 100, 5), leg('CALL', 'LONG', 110, 2, 2)]],
    ['PUT_BACKSPREAD', [leg('PUT', 'SHORT', 100, 5), leg('PUT', 'LONG', 90, 2, 2)]],
    ['BULL_CALL_SPREAD', [leg('CALL', 'LONG', 100, 4), leg('CALL', 'SHORT', 110, 1)]],
  ];
  for (const [structure, legs] of cases) {
    const receipt = evaluate(structure, legs);
    assert.equal(receipt.state, 'COMPLETE', structure);
    assert.equal(receipt.geometryState, 'VALID', structure);
    assert.notEqual(receipt.maxLossUsd, null, structure);
    assert.equal(receipt.executionAuthorized, false);
  }
});

test('lottery-ticket diagnostic requires all governed conditions and never invents missing expected move', () => {
  const call = [leg('CALL', 'LONG', 110, 0.5)];
  const flagged = evaluate('LONG_CALL', call);
  assert.equal(flagged.state, 'COMPLETE');
  assert.equal(flagged.lotteryTicketOptionSuspected, true);
  assert.deepEqual(flagged.lotteryDiagnosticReasons.sort(), ['LOW_DELTA', 'REQUIRED_MOVE_EXCEEDS_EXPECTED_MOVE', 'SHORT_DTE']);
  const unknownExpectedMove = evaluate('LONG_CALL', call, { expectedMovePct: null });
  assert.equal(unknownExpectedMove.lotteryTicketOptionSuspected, false);
  assert.deepEqual(unknownExpectedMove.lotteryDiagnosticReasons.sort(), ['LOW_DELTA', 'SHORT_DTE']);
});

test('directional structures block without a policy and malformed geometry fails closed', () => {
  const missing = evaluate('LONG_PUT', [leg('PUT', 'LONG', 95, 1)], { lotteryPolicy: null });
  assert.equal(missing.state, 'BLOCKED_MISSING_POLICY');
  const malformed = evaluate('LONG_BUTTERFLY', [leg('CALL', 'LONG', 95, 7), leg('CALL', 'SHORT', 100, 4),
    leg('CALL', 'LONG', 106, 2)]);
  assert.equal(malformed.state, 'INVALID');
  assert.ok(malformed.reasons.includes('BUTTERFLY_RATIO_OR_SIDE_INVALID'));
  assert.ok(malformed.reasons.includes('BUTTERFLY_WINGS_NOT_EQUAL'));
});

test('future-known evidence fails PIT and unknown costs preserve after-cost bounds as null', () => {
  const future = evaluate('BULL_CALL_SPREAD', [leg('CALL', 'LONG', 100, 4), leg('CALL', 'SHORT', 110, 1)],
    { providerKnownAt: '2026-10-07T15:01:00.000Z' });
  assert.equal(future.state, 'PIT_UNSAFE');
  const unknownCost = evaluate('BULL_CALL_SPREAD', [leg('CALL', 'LONG', 100, 4), leg('CALL', 'SHORT', 110, 1)],
    { totalEntryExitCostsUsd: null });
  assert.equal(unknownCost.afterCostMaxProfitUsd, null);
  assert.equal(unknownCost.afterCostMaxLossUsd, null);
  assert.equal(unknownCost.profitabilityStatus, 'EMPIRICALLY_UNPROVEN');
});
