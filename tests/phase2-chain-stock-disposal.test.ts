import assert from 'node:assert/strict';
import test from 'node:test';
import { routeConfirmedFillLifecycle, type FillLifecycleContext } from '../src/execution/broker-fill-lifecycle-router.js';

const sale = (shares: number, extra: Partial<FillLifecycleContext> = {}): FillLifecycleContext => ({
  action: 'SELL_STOCK', orderStatus: 'FILLED', orderQuantity: shares, chainId: 'chain', decisionId: 'decision', optionLegId: null,
  optionContractId: null, stockLotId: 'lot-1', multiplier: null, entryCreditDebit: null, economicBasisPerShare: 195, nextState: 'CLOSED',
  stockLotShares: shares, openStockLotCount: 1,
  fills: [{ providerFillId: 'f1', providerActivityRefHash: 'a'.repeat(64), quantity: shares, pricePerShare: 190, occurredAt: '2026-10-02T15:00:00Z', fees: null }],
  ...extra,
});

test('selling exactly the single open lot records the disposal with that lot basis (a realized loss is kept, not blended)', () => {
  const result = routeConfirmedFillLifecycle(sale(100));
  assert.equal(result.state, 'CONFIRMED');
  assert.equal(result.application?.eventKind, 'STOCK_DISPOSAL');
  if (result.application?.eventKind === 'STOCK_DISPOSAL') assert.equal(result.application.realizedStockPnl, (190 - 195) * 100);
});

test('a sale that does not equal the single open lot, or that spans several lots, is UNKNOWN: one basis must never be applied across lots', () => {
  for (const context of [sale(100, { stockLotShares: 300 }), sale(300, { stockLotShares: 100 }), sale(200, { openStockLotCount: 2 }),
    sale(100, { openStockLotCount: 0 }), sale(100, { stockLotShares: null }), sale(100, { openStockLotCount: null })]) {
    const result = routeConfirmedFillLifecycle(context);
    assert.equal(result.state, 'UNKNOWN');
    assert.equal(result.reasonCode, 'STOCK_DISPOSAL_LOT_COVERAGE_MISMATCH');
    assert.equal(result.application, null);
  }
  assert.equal(routeConfirmedFillLifecycle({ ...sale(100), stockLotShares: undefined }).state, 'UNKNOWN');
});
