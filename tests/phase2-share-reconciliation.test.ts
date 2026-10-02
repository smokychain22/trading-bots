import assert from 'node:assert/strict';
import test from 'node:test';
import { brokerStockInventoryEvidence } from '../src/theta/management-input-state.js';
import { freeSellableShares, reconcileStockShares, stockShareBlockClass, type BrokerStockInventoryEvidence } from '../src/theta/stock-share-reconciliation.js';

const NOW = '2026-10-13T14:00:00.000Z';
const known = (quantity: number, observedAt = NOW): BrokerStockInventoryEvidence => ({ state: 'KNOWN', quantity, observedAt, reason: null });
const rec = (ledger: number | null, broker: BrokerStockInventoryEvidence | null, quality: string | null = 'GOOD') =>
  reconcileStockShares({ ledgerShares: ledger, broker, reconciliationQuality: quality, now: NOW });

test('ledger vs broker matrix: only exact agreement under GOOD, fresh evidence reconciles', () => {
  assert.equal(rec(100, known(100)).state, 'RECONCILED');
  assert.equal(rec(100, known(100)).reconciledShares, 100);
  for (const [ledger, broker, reason] of [[100, 99, 'LEDGER_AHEAD_OF_BROKER'], [100, 0, 'LEDGER_AHEAD_OF_BROKER'],
    [0, 100, 'BROKER_AHEAD_OF_LEDGER'], [100, 250, 'BROKER_AHEAD_OF_LEDGER']] as const) {
    const result = rec(ledger, known(broker));
    assert.equal(result.state, 'MISMATCH'); assert.equal(result.reason, reason); assert.equal(result.reconciledShares, null);
    assert.ok(result.candidateCauses.includes('EXTERNAL_OR_MANUAL_ACTIVITY'), 'causes are hints, never asserted');
    assert.equal(result.blockClass, 'REQUIRES_RECONCILIATION');
  }
  assert.equal(rec(100, null).reason, 'BROKER_UNAVAILABLE');
  assert.equal(rec(100, { state: 'UNKNOWN', quantity: null, observedAt: null, reason: 'BROKER_POSITION_UNAVAILABLE' }).state, 'UNKNOWN');
  assert.equal(rec(100, known(100, '2026-10-13T13:50:00.000Z')).reason, 'BROKER_EVIDENCE_STALE');
  assert.equal(rec(100, known(100, '2026-10-13T14:05:00.000Z')).reason, 'BROKER_EVIDENCE_FROM_FUTURE');
  assert.equal(rec(100, known(100), 'DEGRADED').reason, 'RECONCILIATION_NOT_GOOD');
  assert.equal(rec(100, known(100), null).state, 'UNKNOWN');
  assert.equal(rec(100, known(-100)).reason, 'BROKER_SHORT_STOCK_POSITION');
  assert.equal(rec(100, known(100.5)).reason, 'BROKER_SHARES_NOT_WHOLE');
  assert.equal(rec(null, known(100)).reason, 'LEDGER_SHARES_INVALID');
  assert.equal(rec(100.5, known(100)).state, 'UNKNOWN');
  assert.equal(rec(-1, known(100)).state, 'UNKNOWN');
  // multiple lots whose ledger total equals the broker quantity reconcile (the ledger figure is the lot total)
  assert.equal(rec(40 + 60 + 150, known(250)).state, 'RECONCILED');
  // every reason maps to exactly one recovery class
  for (const klass of Object.values(stockShareBlockClass)) {
    assert.ok(['TRANSIENT_RETRYABLE', 'REQUIRES_RECONCILIATION', 'REQUIRES_NEW_DECISION', 'OWNER_POLICY', 'TERMINAL'].includes(klass));
  }
});

test('FREE_SELLABLE_SHARES = reconciled - 100 x committed short-call contracts; unknown or over-committed fail closed', () => {
  const free = (shares: number | null, committed: number | null | undefined) => freeSellableShares(shares, committed);
  assert.equal(free(100, 1).freeShares, 0);
  assert.equal(free(200, 1).freeShares, 100);
  assert.equal(free(250, 2).freeShares, 50);
  assert.equal(free(100, 0).freeShares, 100);
  assert.equal(free(0, 0).freeShares, 0);
  assert.equal(free(99, 1).state, 'UNKNOWN'); assert.equal(free(99, 1).reason, 'OVERCOMMITTED_INVALID_STATE');
  assert.equal(free(100, 2).state, 'UNKNOWN');
  assert.equal(free(100, null).reason, 'COMMITTED_SHORT_CALLS_UNKNOWN');
  assert.equal(free(100, undefined).state, 'UNKNOWN');
  assert.equal(free(null, 0).reason, 'SHARES_NOT_RECONCILED');
  assert.equal(free(100, -1).state, 'UNKNOWN');
  assert.equal(free(100, 1.5).state, 'UNKNOWN');
  assert.equal(freeSellableShares(100, 0, 0).reason, 'MULTIPLIER_INVALID');
  // property: every valid state stays within [0, shares] and free + committed = shares
  for (let shares = 0; shares <= 600; shares += 50) for (let contracts = 0; contracts <= 7; contracts += 1) {
    const result = free(shares, contracts);
    if (contracts * 100 <= shares) {
      assert.equal(result.state, 'KNOWN');
      assert.equal((result.freeShares as number) + (result.committedShares as number), shares);
      assert.ok((result.freeShares as number) >= 0);
    } else assert.equal(result.state, 'UNKNOWN');
  }
});

test('broker inventory from the reconciliation row: missing row is KNOWN zero, unreadable row is UNKNOWN', () => {
  const base = { reconciliation_observed_at: NOW, position_observed_at: NOW, broker_stock_quantity: '100', broker_stock_side: 'long', broker_position: { currentPrice: 1 } };
  assert.deepEqual(brokerStockInventoryEvidence(base), { state: 'KNOWN', quantity: 100, observedAt: NOW, reason: null });
  assert.equal(brokerStockInventoryEvidence({ ...base, broker_stock_side: 'short' }).quantity, -100);
  assert.equal(brokerStockInventoryEvidence({ ...base, broker_stock_side: null }).reason, 'BROKER_POSITION_SIDE_UNKNOWN');
  assert.equal(brokerStockInventoryEvidence({ ...base, broker_stock_quantity: 'abc' }).reason, 'BROKER_POSITION_QUANTITY_INVALID');
  assert.equal(brokerStockInventoryEvidence({ ...base, broker_stock_asset_class: 'us_option' }).state, 'UNKNOWN');
  assert.deepEqual(brokerStockInventoryEvidence({ reconciliation_observed_at: NOW, broker_position: null }), { state: 'KNOWN', quantity: 0, observedAt: NOW, reason: null });
  assert.equal(brokerStockInventoryEvidence({ broker_position: null }).state, 'UNKNOWN', 'no reconciliation time means no proof of a zero position');
});
