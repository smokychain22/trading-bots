import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeWholeChainPnl,
  optionLegSchema,
  stockLotSchema,
  type DividendEvent,
  type FeeEvent,
  type OptionLeg,
  type StockLot,
} from '../src/theta/ledger-contract.js';

const NOW = new Date().toISOString();

const closedLeg = (overrides: Partial<OptionLeg> = {}): OptionLeg => ({
  optionLegId: 'leg-1', chainId: 'chain-1', side: 'SHORT', quantity: 1,
  entryCreditDebit: 60, openedAt: NOW, closedAt: NOW, closeReason: 'BTC_CLOSE',
  realizedPnl: -30, rolledFromOptionLegId: null, rolledToOptionLegId: null,
  ...overrides,
});

const openLeg = (overrides: Partial<OptionLeg> = {}): OptionLeg => ({
  optionLegId: 'leg-2', chainId: 'chain-1', side: 'SHORT', quantity: 1,
  entryCreditDebit: 80, openedAt: NOW, closedAt: null, closeReason: null,
  realizedPnl: null, rolledFromOptionLegId: 'leg-1', rolledToOptionLegId: null,
  ...overrides,
});

const disposedLot = (overrides: Partial<StockLot> = {}): StockLot => ({
  stockLotId: 'lot-1', chainId: 'chain-1', shares: 100, economicBasisPerShare: 49.40,
  brokerBasisPerShare: null, assignmentOptionLegId: 'leg-2', acquiredAt: NOW,
  disposedAt: NOW, disposedPricePerShare: 45.0, realizedPnl: -440, currentPricePerShare: null,
  ...overrides,
});

const openLot = (overrides: Partial<StockLot> = {}): StockLot => ({
  stockLotId: 'lot-2', chainId: 'chain-1', shares: 100, economicBasisPerShare: 49.40,
  brokerBasisPerShare: null, assignmentOptionLegId: 'leg-2', acquiredAt: NOW,
  disposedAt: null, disposedPricePerShare: null, realizedPnl: null, currentPricePerShare: 40.0,
  ...overrides,
});

test('a closed option leg without closeReason/realizedPnl fails validation', () => {
  assert.throws(() => optionLegSchema.parse({ ...closedLeg(), closeReason: null }));
  assert.throws(() => optionLegSchema.parse({ ...closedLeg(), realizedPnl: null }));
});

test('an open option leg must not carry a realizedPnl', () => {
  assert.throws(() => optionLegSchema.parse({ ...openLeg(), realizedPnl: 10 }));
});

test('a valid closed leg and a valid open leg both parse cleanly', () => {
  assert.doesNotThrow(() => optionLegSchema.parse(closedLeg()));
  assert.doesNotThrow(() => optionLegSchema.parse(openLeg()));
});

test('a disposed stock lot without realizedPnl fails validation -- disposal is never a silent non-event', () => {
  assert.throws(() => stockLotSchema.parse({ ...disposedLot(), realizedPnl: null }));
});

test('an open stock lot must not carry a realizedPnl', () => {
  assert.throws(() => stockLotSchema.parse({ ...openLot(), realizedPnl: -10 }));
});

test('WholeChainPnl sums realized option + realized stock + unrealized stock + dividends - fees', () => {
  const legs = [closedLeg({ realizedPnl: -30 })];
  const lots = [disposedLot({ realizedPnl: -440, shares: 100 })];
  const dividends: DividendEvent[] = [{ stockLotId: 'lot-1', exDate: '2026-09-01', amountPerShare: 0.5 }];
  const fees: FeeEvent[] = [{ chainId: 'chain-1', feeType: 'COMMISSION', amount: 5, incurredAt: NOW }];

  const result = computeWholeChainPnl(legs, lots, dividends, fees);
  assert.equal(result.realizedOptionPnl, -30);
  assert.equal(result.realizedStockPnl, -440);
  assert.equal(result.dividends, 50); // 100 shares * $0.50/share, scaled by the paying lot's share count
  assert.equal(result.fees, 5);
  assert.equal(result.wholeChainPnl, result.realizedStockPnl + result.unrealizedStockPnl + result.realizedOptionPnl + result.dividends - result.fees);
});

test('a dividend referencing an unknown lot is excluded, never guessed', () => {
  const dividends: DividendEvent[] = [{ stockLotId: 'nonexistent-lot', exDate: '2026-09-01', amountPerShare: 0.5 }];
  const result = computeWholeChainPnl([], [], dividends, []);
  assert.equal(result.dividends, 0);
});

test('an open stock lot contributes unrealized MTM, and old realized roll loss is never erased', () => {
  const legs = [closedLeg({ realizedPnl: -30 }), openLeg()]; // the roll's old and new legs, both present
  const lots = [openLot({ economicBasisPerShare: 49.40, currentPricePerShare: 40.0, shares: 100 })];
  const result = computeWholeChainPnl(legs, lots, [], []);

  // Old leg's -30 realized loss must still be counted even though a new
  // leg (from the roll) is also present and open.
  assert.equal(result.realizedOptionPnl, -30);
  // Unrealized stock: (40 - 49.40) * 100 = -940, a real underwater position, visible.
  assert.ok(Math.abs(result.unrealizedStockPnl - -940) < 1e-6);
  assert.equal(result.hasUnresolvedOpenPositions, true);
});

test('an unknown current price on an open lot is excluded, never assumed to be zero loss', () => {
  const lots = [openLot({ currentPricePerShare: null })];
  const result = computeWholeChainPnl([], lots, [], []);
  assert.equal(result.unrealizedStockPnl, 0); // excluded contribution, not a fabricated MTM
  assert.equal(result.hasUnresolvedOpenPositions, true);
});

test('a fully resolved chain (all legs closed, all lots disposed) reports hasUnresolvedOpenPositions=false', () => {
  const legs = [closedLeg()];
  const lots = [disposedLot()];
  const result = computeWholeChainPnl(legs, lots, [], []);
  assert.equal(result.hasUnresolvedOpenPositions, false);
});

test('assignment is never an automatic win: a just-assigned open lot contributes only its real unrealized MTM', () => {
  // Assigned at basis 49.40, current price below basis -- a real loss,
  // never hidden or treated as a win because "assignment happened."
  const lots = [openLot({ economicBasisPerShare: 49.40, currentPricePerShare: 45.0, shares: 100 })];
  const result = computeWholeChainPnl([], lots, [], []);
  assert.equal(result.unrealizedStockPnl, (45.0 - 49.40) * 100);
  assert.ok(result.unrealizedStockPnl < 0);
});
