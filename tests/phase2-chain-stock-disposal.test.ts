import assert from 'node:assert/strict';
import test from 'node:test';
import { routeConfirmedFillLifecycle, type FillLifecycleContext } from '../src/execution/broker-fill-lifecycle-router.js';
import { allocateStockDisposal, type OpenStockLot } from '../src/execution/stock-lot-allocation.js';

const lot = (id: string, shares: number, basis: number | null, acquiredAt: string | null = '2026-09-01T15:00:00.000Z'): OpenStockLot =>
  ({ stockLotId: id, shares, economicBasisPerShare: basis, acquiredAt });

const sale = (shares: number, lots: readonly OpenStockLot[], extra: Partial<FillLifecycleContext> = {}): FillLifecycleContext => ({
  action: 'SELL_STOCK', orderStatus: 'FILLED', orderQuantity: shares, chainId: 'chain', decisionId: 'decision', optionLegId: null,
  optionContractId: null, stockLotId: null, multiplier: null, entryCreditDebit: null, economicBasisPerShare: null, nextState: 'CLOSED',
  openStockLots: lots,
  fills: [{ providerFillId: 'f1', providerActivityRefHash: 'a'.repeat(64), quantity: shares, pricePerShare: 190, occurredAt: '2026-10-02T15:00:00Z', fees: null }],
  ...extra,
});

// ------------------------------------------------------------------------------------------------ allocator

test('single lot sold in full: exact allocation with that lot basis (a realized loss is kept, not blended)', () => {
  const result = allocateStockDisposal({ lots: [lot('a', 100, 195)], disposedShares: 100, pricePerShare: 190 });
  assert.equal(result.state, 'ALLOCATED');
  if (result.state !== 'ALLOCATED') return;
  assert.equal(result.mode, 'FULL_POSITION');
  assert.deepEqual(result.allocations.map((a) => [a.stockLotId, a.shares, a.realizedPnl]), [['a', 100, -500]]);
  assert.equal(result.totalRealizedPnl, -500);
  assert.equal(result.hasPartialLot, false);
});

test('250 sold shares never land on one 100-share lot: a three-lot full position allocates each lot with its own basis', () => {
  const lots = [lot('c', 50, 210, '2026-09-03T15:00:00.000Z'), lot('a', 100, 195, '2026-09-01T15:00:00.000Z'), lot('b', 100, 200, '2026-09-02T15:00:00.000Z')];
  const result = allocateStockDisposal({ lots, disposedShares: 250, pricePerShare: 190 });
  assert.equal(result.state, 'ALLOCATED');
  if (result.state !== 'ALLOCATED') return;
  assert.deepEqual(result.allocations.map((a) => [a.stockLotId, a.shares]), [['a', 100], ['b', 100], ['c', 50]], 'deterministic order: acquired time then id');
  assert.deepEqual(result.allocations.map((a) => a.realizedPnl), [-500, -1000, -1000]);
  assert.equal(result.totalShares, 250);
  assert.equal(result.totalRealizedPnl, -2500);
  assert.equal(result.allocations.reduce((s, a) => s + a.proceeds, 0), 250 * 190, 'proceeds allocated exactly once');
  assert.equal(result.allocations.reduce((s, a) => s + a.costBasis, 0), 100 * 195 + 100 * 200 + 50 * 210, 'cost basis allocated exactly once');
  assert.ok(result.allocations.every((a) => a.remainingLotShares === 0 && a.shares <= a.lotShares));
});

test('a partial position needs an owner lot-selection policy: no policy is invented, nothing is allocated', () => {
  const two = [lot('a', 100, 195), lot('b', 100, 200, '2026-09-02T15:00:00.000Z')];
  for (const shares of [1, 50, 100, 150, 199]) {
    const result = allocateStockDisposal({ lots: two, disposedShares: shares, pricePerShare: 190 });
    assert.equal(result.state, 'UNKNOWN'); assert.equal(result.reason, 'LOT_SELECTION_POLICY_REQUIRED'); assert.equal(result.allocations, null);
  }
  // one lot partly sold needs lot-split accounting that the ledger does not have
  const one = allocateStockDisposal({ lots: [lot('a', 100, 195)], disposedShares: 40, pricePerShare: 190 });
  assert.equal(one.state, 'UNKNOWN'); assert.equal(one.reason, 'PARTIAL_LOT_SPLIT_REQUIRED');
});

test('with an explicitly injected policy the allocator splits deterministically and flags partially consumed lots', () => {
  const lots = [lot('a', 100, 195, '2026-09-01T15:00:00.000Z'), lot('b', 100, 200, '2026-09-02T15:00:00.000Z'), lot('c', 60, 205, '2026-09-03T15:00:00.000Z')];
  const fifo = allocateStockDisposal({ lots, disposedShares: 130, pricePerShare: 190, policy: 'FIFO' });
  assert.equal(fifo.state, 'ALLOCATED');
  if (fifo.state !== 'ALLOCATED') return;
  assert.deepEqual(fifo.allocations.map((a) => [a.stockLotId, a.shares, a.remainingLotShares]), [['a', 100, 0], ['b', 30, 70]], 'partial final lot');
  assert.equal(fifo.hasPartialLot, true); assert.equal(fifo.mode, 'POLICY_SELECTED');
  const lifo = allocateStockDisposal({ lots, disposedShares: 130, pricePerShare: 190, policy: 'LIFO' });
  assert.equal(lifo.state, 'ALLOCATED');
  if (lifo.state !== 'ALLOCATED') return;
  assert.deepEqual(lifo.allocations.map((a) => [a.stockLotId, a.shares, a.remainingLotShares]), [['c', 60, 0], ['b', 70, 30]]);
  // partial FIRST lot (disposal smaller than the first lot)
  const small = allocateStockDisposal({ lots, disposedShares: 40, pricePerShare: 190, policy: 'FIFO' });
  assert.equal(small.state === 'ALLOCATED' && small.allocations.length === 1 && small.allocations[0]?.remainingLotShares === 60, true);
  // the policy never changes a FULL position
  const full = allocateStockDisposal({ lots, disposedShares: 260, pricePerShare: 190, policy: 'LIFO' });
  assert.equal(full.state === 'ALLOCATED' && full.mode === 'FULL_POSITION' && !full.hasPartialLot, true);
});

test('invalid, oversized and unknown-basis disposals are UNKNOWN, never coerced', () => {
  const cases: readonly [string, Parameters<typeof allocateStockDisposal>[0], string][] = [
    ['more than open', { lots: [lot('a', 100, 195)], disposedShares: 101, pricePerShare: 190 }, 'FILLED_EXCEEDS_OPEN_SHARES'],
    ['external mismatch (no open lots)', { lots: [], disposedShares: 100, pricePerShare: 190 }, 'NO_OPEN_LOTS'],
    ['zero shares', { lots: [lot('a', 100, 195)], disposedShares: 0, pricePerShare: 190 }, 'DISPOSED_SHARES_INVALID'],
    ['fractional shares', { lots: [lot('a', 100, 195)], disposedShares: 99.5, pricePerShare: 190 }, 'DISPOSED_SHARES_INVALID'],
    ['negative price', { lots: [lot('a', 100, 195)], disposedShares: 100, pricePerShare: -1 }, 'DISPOSAL_PRICE_INVALID'],
    ['NaN price', { lots: [lot('a', 100, 195)], disposedShares: 100, pricePerShare: Number.NaN }, 'DISPOSAL_PRICE_INVALID'],
    ['unknown basis', { lots: [lot('a', 100, null)], disposedShares: 100, pricePerShare: 190 }, 'LOT_BASIS_UNKNOWN'],
    ['one unknown basis among several', { lots: [lot('a', 100, 195), lot('b', 100, null, '2026-09-02T15:00:00.000Z')], disposedShares: 200, pricePerShare: 190 }, 'LOT_BASIS_UNKNOWN'],
    ['fractional lot', { lots: [lot('a', 100.5, 195)], disposedShares: 100, pricePerShare: 190 }, 'LOT_SHARES_INVALID'],
    ['duplicate lot id', { lots: [lot('a', 100, 195), lot('a', 100, 195)], disposedShares: 200, pricePerShare: 190 }, 'DUPLICATE_LOT'],
  ];
  for (const [label, input, reason] of cases) {
    const result = allocateStockDisposal(input);
    assert.equal(result.state, 'UNKNOWN', label); assert.equal(result.state === 'UNKNOWN' && result.reason, reason, label);
  }
  // a zero disposal price is a real (worthless) sale, not unknown
  assert.equal(allocateStockDisposal({ lots: [lot('a', 100, 195)], disposedShares: 100, pricePerShare: 0 }).state, 'ALLOCATED');
});

test('property: seeded random lots - allocated shares equal disposed shares, no lot goes negative, P&L equals the sum of lot P&L', () => {
  let seed = 20261002;
  const next = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const integer = (low: number, high: number): number => low + Math.floor(next() * (high - low + 1));
  for (let episode = 0; episode < 2000; episode += 1) {
    const lots = Array.from({ length: integer(1, 6) }, (_, index) => lot(`lot-${index}`, integer(1, 400), integer(1000, 30000) / 100,
      new Date(Date.UTC(2026, 8, 1 + integer(0, 20))).toISOString()));
    const open = lots.reduce((sum, item) => sum + item.shares, 0);
    const price = integer(0, 40000) / 100;
    const policy = (['FIFO', 'LIFO', null] as const)[integer(0, 2)] as 'FIFO' | 'LIFO' | null;
    const shares = integer(1, open);
    const result = allocateStockDisposal({ lots, disposedShares: shares, pricePerShare: price, policy });
    if (result.state === 'UNKNOWN') { assert.ok(shares < open && policy === null, `episode ${episode}: only a policy-less partial may be unknown`); continue; }
    assert.equal(result.allocations.reduce((sum, a) => sum + a.shares, 0), shares);
    for (const a of result.allocations) { assert.ok(a.shares > 0 && a.shares <= a.lotShares && a.remainingLotShares >= 0 && a.remainingLotShares === a.lotShares - a.shares); }
    assert.equal(new Set(result.allocations.map((a) => a.stockLotId)).size, result.allocations.length, 'a lot is used once');
    const lotPnl = result.allocations.reduce((sum, a) => sum + (price - a.economicBasisPerShare) * a.shares, 0);
    assert.ok(Math.abs(lotPnl - result.totalRealizedPnl) < 1e-6);
    assert.ok(Math.abs(result.allocations.reduce((s, a) => s + a.proceeds, 0) - price * shares) < 1e-6);
    if (shares === open) { assert.equal(result.mode, 'FULL_POSITION'); assert.equal(result.hasPartialLot, false); }
  }
});

// ------------------------------------------------------------------------------------------------ router

test('selling exactly the single open lot records the disposal with that lot basis (a realized loss is kept, not blended)', () => {
  const result = routeConfirmedFillLifecycle(sale(100, [lot('lot-1', 100, 195)]));
  assert.equal(result.state, 'CONFIRMED');
  assert.equal(result.application?.eventKind, 'STOCK_DISPOSAL');
  if (result.application?.eventKind === 'STOCK_DISPOSAL') {
    assert.equal(result.application.realizedStockPnl, (190 - 195) * 100);
    assert.equal(result.application.additionalStockLots, undefined);
  }
});

test('a full-position sale across several lots is ONE application carrying every lot with its own basis', () => {
  const lots = [lot('lot-1', 100, 195), lot('lot-2', 150, 200, '2026-09-02T15:00:00.000Z')];
  const result = routeConfirmedFillLifecycle(sale(250, lots));
  assert.equal(result.state, 'CONFIRMED');
  if (result.application?.eventKind !== 'STOCK_DISPOSAL') throw new Error('disposal expected');
  assert.equal(result.application.stockLotId, 'lot-1');
  assert.equal(result.application.realizedStockPnl, -500);
  assert.deepEqual(result.application.additionalStockLots, [{ stockLotId: 'lot-2', realizedStockPnl: (190 - 200) * 150 }]);
  const total = result.application.realizedStockPnl + (result.application.additionalStockLots ?? []).reduce((s, l) => s + l.realizedStockPnl, 0);
  assert.equal(total, (190 - 195) * 100 + (190 - 200) * 150);
});

test('a sale that is not the whole position, exceeds it, has an unknown basis, or has no lots is UNKNOWN with a typed reason', () => {
  const two = [lot('lot-1', 100, 195), lot('lot-2', 100, 200, '2026-09-02T15:00:00.000Z')];
  const expectations: readonly [FillLifecycleContext, string][] = [
    [sale(100, two), 'STOCK_DISPOSAL_LOT_SELECTION_POLICY_REQUIRED'],
    [sale(300, two), 'STOCK_DISPOSAL_FILLED_EXCEEDS_OPEN_SHARES'],
    [sale(50, [lot('lot-1', 100, 195)]), 'STOCK_DISPOSAL_PARTIAL_LOT_SPLIT_REQUIRED'],
    [sale(100, [lot('lot-1', 100, null)]), 'STOCK_DISPOSAL_LOT_BASIS_UNKNOWN'],
    [sale(100, []), 'STOCK_DISPOSAL_NO_OPEN_LOTS'],
  ];
  for (const [context, reason] of expectations) {
    const result = routeConfirmedFillLifecycle(context);
    assert.equal(result.state, 'UNKNOWN', reason); assert.equal(result.reasonCode, reason); assert.equal(result.application, null);
  }
  assert.equal(routeConfirmedFillLifecycle({ ...sale(100, two), openStockLots: undefined }).state, 'UNKNOWN', 'absent lot facts are never an earliest-lot fallback');
  assert.equal(routeConfirmedFillLifecycle({ ...sale(100, two), openStockLots: null }).state, 'UNKNOWN');
});

test('multiple option chains: a chain only ever allocates against ITS OWN lots (the caller supplies one chain lot set)', () => {
  const chainA = routeConfirmedFillLifecycle(sale(100, [lot('a-1', 100, 195)], { chainId: 'chain-a' }));
  const chainB = routeConfirmedFillLifecycle(sale(200, [lot('b-1', 200, 180)], { chainId: 'chain-b' }));
  assert.equal(chainA.application?.chainId, 'chain-a'); assert.equal(chainB.application?.chainId, 'chain-b');
  if (chainA.application?.eventKind === 'STOCK_DISPOSAL' && chainB.application?.eventKind === 'STOCK_DISPOSAL') {
    assert.equal(chainA.application.stockLotId, 'a-1'); assert.equal(chainB.application.stockLotId, 'b-1');
  }
  // a fill sized for chain B can never be satisfied by chain A's lots
  assert.equal(routeConfirmedFillLifecycle(sale(200, [lot('a-1', 100, 195)], { chainId: 'chain-a' })).state, 'UNKNOWN');
});

test('a sale already applied (its lots are all disposed) is a duplicate, not a permanently unresolved fact; an unapplied one stays unresolved', async () => {
  const { applyConfirmedFillLifecycle } = await import('../src/execution/postgres-broker-fill-lifecycle-orchestrator.js');
  const row = { order_intent_id: 'intent-1', chain_id: 'chain', bot_instance_id: 'bot', decision_id: 'decision', theta_action: 'SELL_STOCK', status: 'FILLED',
    order_quantity: 100, underlying_symbol: 'AAPL', option_contract_id: null, open_stock_lots: [], fill_ids: ['fill-1'],
    fills: [{ provider_fill_id: 'fill-1', quantity: 100, price_per_share: 190, filled_at: '2026-10-02T15:00:00Z', fees: 0 }] };
  const run = async (alreadyApplied: boolean) => {
    const lookups: unknown[][] = [];
    const pool = { query: async (sql: string, values: unknown[]) => {
      if (sql.includes('FROM trade.order_intent oi')) return { rows: [row], rowCount: 1 };
      if (sql.includes('trade.lifecycle_application')) { lookups.push(values); return { rows: alreadyApplied ? [{ '?column?': 1 }] : [], rowCount: alreadyApplied ? 1 : 0 }; }
      throw new Error('unexpected query');
    } };
    return { report: await applyConfirmedFillLifecycle(pool as never, 'connection', '2026-10-02T16:00:00Z'), lookups };
  };
  const applied = await run(true);
  assert.equal(applied.report.unresolved, 0); assert.equal(applied.report.duplicates, 1);
  assert.equal(applied.lookups.length, 1); assert.equal(applied.lookups[0]?.[1], 'chain');
  const missing = await run(false);
  assert.equal(missing.report.unresolved, 1); assert.equal(missing.report.duplicates, 0);
});

test('a coded domain rejection for one chain is reported as unresolved and does not stop the other chains; infrastructure errors still abort the cycle', async () => {
  const { applyConfirmedFillLifecycle } = await import('../src/execution/postgres-broker-fill-lifecycle-orchestrator.js');
  const { LifecycleEvidenceError } = await import('../src/theta/postgres-lifecycle-application-store.js');
  const { EventEmitter } = await import('node:events');
  const rowFor = (chain: string, intent: string) => ({ order_intent_id: intent, chain_id: chain, bot_instance_id: 'bot', decision_id: 'decision', theta_action: 'SELL_STOCK', status: 'FILLED',
    order_quantity: 100, underlying_symbol: 'AAPL', option_contract_id: null, fill_ids: ['f-' + intent],
    open_stock_lots: [{ stock_lot_id: 'lot-' + chain, shares: 100, economic_basis_per_share: 195, acquired_at: '2026-09-01T15:00:00Z' }],
    fills: [{ provider_fill_id: 'fill-' + intent, quantity: 100, price_per_share: 190, filled_at: '2026-10-02T15:00:00Z', fees: 0 }] });
  const run = async (error: Error) => {
    const applied: string[] = [];
    const client = Object.assign(new EventEmitter(), { release() { /* noop */ }, async query(sql: string) {
      if (sql.includes('pg_advisory_xact_lock')) { applied.push('attempt'); throw error; }
      return { rows: [], rowCount: 0 };
    } });
    const pool = { query: async () => ({ rows: [rowFor('chain-1', 'intent-1'), rowFor('chain-2', 'intent-2')], rowCount: 2 }), connect: async () => client };
    const report = await applyConfirmedFillLifecycle(pool as never, 'connection', '2026-10-02T16:00:00Z');
    return { report, attempts: applied.length };
  };
  const coded = await run(new LifecycleEvidenceError('STOCK_DISPOSAL_LEAVES_OPEN_LOTS'));
  assert.equal(coded.report.unresolved, 2, 'both chains reported unresolved');
  assert.equal(coded.attempts, 2, 'the second chain was still attempted after the first was rejected');
  await assert.rejects(run(new Error('connection terminated unexpectedly')), /connection terminated/);
  await assert.rejects(run(new Error('POSTGRES_CHECKED_OUT_CLIENT_LOST')), /POSTGRES_CHECKED_OUT_CLIENT_LOST/);
});
