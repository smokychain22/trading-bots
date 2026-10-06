import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { actualClosingDebitPerShare, actualOpeningEconomics, assessDefinedRiskState, computeDefinedRiskExposure, type DefinedRiskStateInput } from '../src/execution/defined-risk-position.js';
import { computeDefinedRiskWholeChainAccounting } from '../src/execution/defined-risk-lifecycle.js';
import type { BrokerOrderSnapshot } from '../src/execution/broker.js';

const base: DefinedRiskStateInput = { shortOpened: 1, longOpened: 1, shortClosed: 0, longClosed: 0, requestedSpreads: 1, openOrderWorking: false, closeOrderWorking: false,
  events: { assignedContracts: 0, exercisedContracts: 0, expirationRecorded: false } };

test('a hedged spread is OPEN; no fills is PENDING_OPEN; a partial hedged fill with a working order stays PENDING_OPEN, never OPEN', () => {
  assert.equal(assessDefinedRiskState(base).state, 'OPEN');
  assert.equal(assessDefinedRiskState({ ...base, shortOpened: 0, longOpened: 0 }).state, 'PENDING_OPEN');
  assert.equal(assessDefinedRiskState({ ...base, shortOpened: 1, longOpened: 1, requestedSpreads: 3, openOrderWorking: true }).state, 'PENDING_OPEN');
  assert.equal(assessDefinedRiskState({ ...base, requestedSpreads: 3 }).state, 'OPEN', 'a terminal partial fill is an OPEN position of the smaller quantity');
  assert.deepEqual(assessDefinedRiskState({ ...base, requestedSpreads: 3 }).reasons, ['OPEN_FILLED_BELOW_REQUESTED_QUANTITY']);
});

test('SAFETY: any unhedged short exposure or short-stock outcome is an emergency regardless of how it arose', () => {
  assert.equal(assessDefinedRiskState({ ...base, longOpened: 0 }).state, 'DIVERGED_EMERGENCY');
  // long leg closed first (someone/something sold the hedge while the short remains)
  assert.equal(assessDefinedRiskState({ ...base, longClosed: 1 }).state, 'DIVERGED_EMERGENCY');
  assert.equal(assessDefinedRiskState({ ...base, shortClosed: 1, longClosed: 1, events: { assignedContracts: 0, exercisedContracts: 1, expirationRecorded: false } }).state, 'DIVERGED_EMERGENCY');
  // the reverse (short closed, long remains) is not an emergency: limited, premium-paid exposure
  assert.equal(assessDefinedRiskState({ ...base, shortClosed: 1 }).state, 'ASYMMETRIC_OPEN');
});

test('terminal outcomes come only from broker events and only when no leg remains open', () => {
  const expired = assessDefinedRiskState({ ...base, shortClosed: 1, longClosed: 1, events: { assignedContracts: 0, exercisedContracts: 0, expirationRecorded: true } });
  assert.equal(expired.state, 'EXPIRED_WORTHLESS');
  const assigned = assessDefinedRiskState({ ...base, shortClosed: 1, longClosed: 1, events: { assignedContracts: 1, exercisedContracts: 0, expirationRecorded: true } });
  assert.equal(assigned.state, 'STOCK_FROM_ASSIGNMENT');
  assert.equal(assigned.netStockContracts, 1);
  const flat = assessDefinedRiskState({ ...base, shortClosed: 1, longClosed: 1, events: { assignedContracts: 1, exercisedContracts: 1, expirationRecorded: false } });
  assert.equal(flat.state, 'CLOSED');
  // an "expiration" with no leg actually removed is NOT terminal: the broker still shows the spread
  assert.equal(assessDefinedRiskState({ ...base, events: { assignedContracts: 0, exercisedContracts: 0, expirationRecorded: true } }).state, 'OPEN');
});

test('PROPERTY: for every combination of leg fills the state is internally consistent (exhaustive over 0..2 contracts)', () => {
  for (let so = 0; so <= 2; so += 1) for (let lo = 0; lo <= 2; lo += 1) for (let sc = 0; sc <= so; sc += 1) for (let lc = 0; lc <= lo; lc += 1) for (const working of [false, true]) {
    const input: DefinedRiskStateInput = { shortOpened: so, longOpened: lo, shortClosed: sc, longClosed: lc, requestedSpreads: 2, openOrderWorking: working, closeOrderWorking: false,
      events: { assignedContracts: 0, exercisedContracts: 0, expirationRecorded: false } };
    const result = assessDefinedRiskState(input);
    const exposure = computeDefinedRiskExposure(input);
    // exposure arithmetic is conserved
    assert.equal(exposure.shortOpen, so - sc);
    assert.equal(exposure.longOpen, lo - lc);
    assert.equal(exposure.hedgedSpreads + exposure.nakedShortContracts, exposure.shortOpen);
    assert.equal(exposure.hedgedSpreads + exposure.excessLongContracts, exposure.longOpen);
    // naked short ALWAYS wins
    if (exposure.nakedShortContracts > 0) assert.equal(result.state, 'DIVERGED_EMERGENCY');
    // OPEN requires at least one hedged spread and nothing unhedged on either side
    if (result.state === 'OPEN') { assert.ok(exposure.hedgedSpreads > 0); assert.equal(exposure.nakedShortContracts, 0); assert.equal(exposure.excessLongContracts, 0); }
    // a spread is never reported CLOSED while any leg is open
    if (result.state === 'CLOSED') { assert.equal(exposure.shortOpen, 0); assert.equal(exposure.longOpen, 0); }
  }
});

test('inconsistent leg truth is rejected, never normalised (more contracts removed than were ever opened)', () => {
  assert.throws(() => computeDefinedRiskExposure({ shortOpened: 1, longOpened: 1, shortClosed: 2, longClosed: 0 }), /LEG_FILLS_INVALID/);
  assert.throws(() => computeDefinedRiskExposure({ shortOpened: -1, longOpened: 1, shortClosed: 0, longClosed: 0 }), /LEG_FILLS_INVALID/);
  assert.throws(() => assessDefinedRiskState({ ...base, requestedSpreads: 0 }), /REQUESTED_QUANTITY_INVALID/);
});

const parent = (intents: readonly [string, string], fills: readonly [number, number], prices: readonly [number | null, number | null]): BrokerOrderSnapshot => ({ id: 'p', clientOrderId: 'c', symbol: 'MLEG', qty: 1, filledQty: Math.min(...fills), filledAvgPrice: null,
  side: 'sell', positionIntent: null, status: 'filled', limitPrice: -1.1, submittedAt: '2026-10-06T15:00:00.000Z', replacedBy: null, replaces: null, orderClass: 'mleg', legs: intents.map((intent, index) => ({
    id: `l${index}`, symbol: `S${index}`, side: intent.startsWith('buy') ? 'buy' : 'sell', positionIntent: intent as 'buy_to_open', ratioQty: 1, qty: 1, filledQty: fills[index] as number, filledAvgPrice: prices[index] as number | null, status: 'filled' })) });

test('opening credit and closing debit come from the ACTUAL per-leg fills and stay UNKNOWN when a price is missing', () => {
  assert.deepEqual(actualOpeningEconomics(parent(['sell_to_open', 'buy_to_open'], [1, 1], [2.0, 0.9])), { netCreditPerShare: 1.1, reason: 'ACTUAL_LEG_FILLS' });
  assert.deepEqual(actualOpeningEconomics(parent(['sell_to_open', 'buy_to_open'], [1, 1], [2.0, null])), { netCreditPerShare: null, reason: 'LEG_FILL_PRICE_UNKNOWN' });
  assert.deepEqual(actualOpeningEconomics(parent(['sell_to_open', 'buy_to_open'], [1, 0], [2.0, null])), { netCreditPerShare: null, reason: 'NOT_FULLY_FILLED' });
  assert.equal(actualClosingDebitPerShare(parent(['buy_to_close', 'sell_to_close'], [1, 1], [1.0, 0.6])), 0.4);
  assert.equal(actualClosingDebitPerShare(parent(['buy_to_close', 'sell_to_close'], [1, 1], [1.0, null])), null);
});

test('whole-chain accounting: unknown never becomes zero, before-fee and after-fee P&L are separate, one parent is counted once', () => {
  const closed = computeDefinedRiskWholeChainAccounting({ quantity: 2, multiplier: 100, openingNetCreditPerShare: 1.1, openingFees: null, closingNetDebitPerShare: 0.4, closingFees: null, assignmentExerciseCashFlow: 0, lifecycle: 'CLOSED' });
  assert.equal(closed.realizedPnlBeforeFees, 140);
  assert.equal(closed.realizedPnl, null);
  assert.equal(closed.pnlState, 'REALIZED_BEFORE_FEES');
  const withFees = computeDefinedRiskWholeChainAccounting({ quantity: 2, multiplier: 100, openingNetCreditPerShare: 1.1, openingFees: 1, closingNetDebitPerShare: 0.4, closingFees: 1, assignmentExerciseCashFlow: 0, lifecycle: 'CLOSED' });
  assert.equal(withFees.realizedPnl, 138);
  assert.equal(withFees.pnlState, 'REALIZED');
  const unknownPrice = computeDefinedRiskWholeChainAccounting({ quantity: 1, multiplier: 100, openingNetCreditPerShare: null, openingFees: 0, closingNetDebitPerShare: 0.4, closingFees: 0, assignmentExerciseCashFlow: 0, lifecycle: 'CLOSED' });
  assert.equal(unknownPrice.realizedPnl, null);
  assert.equal(unknownPrice.pnlState, 'UNKNOWN_INPUT');
  const assignedNetFlat = computeDefinedRiskWholeChainAccounting({ quantity: 1, multiplier: 100, openingNetCreditPerShare: 1.1, openingFees: 0, closingNetDebitPerShare: 0, closingFees: 0, assignmentExerciseCashFlow: -500, lifecycle: 'CLOSED' });
  assert.equal(assignedNetFlat.realizedPnl, -390, 'a full-width loss: credit 110 minus the 500 width');
  assert.throws(() => computeDefinedRiskWholeChainAccounting({ quantity: 0, multiplier: 100, openingNetCreditPerShare: 1, openingFees: 0, closingNetDebitPerShare: 0, closingFees: 0, assignmentExerciseCashFlow: 0, lifecycle: 'OPEN' }), /INPUT_INVALID/);
});

test('ISOLATION GUARD: every Wheel loader of open chains filters on chain_kind=WHEEL so a spread can never be managed as a single-leg Wheel chain', () => {
  const loaders: ReadonlyArray<[string, RegExp]> = [
    ['src/theta/management-input-state.ts', /WHERE ec\.closed_at IS NULL AND ec\.chain_kind='WHEEL'/],
    ['src/theta/production-paper-management-candidate-source.ts', /WHERE ec\.closed_at IS NULL AND ec\.chain_kind='WHEEL'/],
    ['src/execution/postgres-broker-lifecycle-orchestrator.ts', /ec\.closed_at IS NULL AND ec\.chain_kind='WHEEL' AND ec\.lifecycle_state IN/],
    ['src/research/outcome-resolver.ts', /ec\.closed_at IS NOT NULL AND ec\.chain_kind='WHEEL'/],
  ];
  for (const [file, pattern] of loaders) assert.match(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), pattern, `${file} must exclude DEFINED_RISK chains`);
  const outcome = readFileSync(new URL('../src/research/outcome-resolver.ts', import.meta.url), 'utf8');
  assert.equal(outcome.match(/ec\.chain_kind='WHEEL'/g)?.length, 2, 'both whole-chain outcome queries');
});
