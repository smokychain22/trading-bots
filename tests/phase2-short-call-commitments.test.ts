import assert from 'node:assert/strict';
import test from 'node:test';
import { readCommittedShortCallContracts, terminalOrderIntentStates } from '../src/execution/management-chain-inflight.js';
import { freeSellableShares } from '../src/theta/stock-share-reconciliation.js';

// A small in-memory model of the four tables the commitment reader consults. Each query handler applies the same filters as
// the real SQL (status sets, side, action, symbol, fill time vs the reconciliation snapshot) so lifecycle release is checked.

interface Plan { id: string; status: string; action: string; symbol: string; quantity: number }
interface Intent { id: string; status: string; symbol: string; side: string; intent: string | null; quantity: number }
interface Fill { intentId: string; quantity: number; filledAt: string }
interface Position { symbol: string; quantity: number; side: string; assetClass: string | null }

const SNAPSHOT_AT = '2026-10-13T14:00:00.000Z';
const CALL_A = 'AAPL261120C00205000';
const CALL_B = 'AAPL261120C00210000';

function model(seed: { plans?: Plan[]; intents?: Intent[]; fills?: Fill[]; positions?: Position[]; snapshotAt?: string | null }) {
  const plans = seed.plans ?? [], intents = seed.intents ?? [], fills = seed.fills ?? [], positions = seed.positions ?? [];
  const snapshotAt = seed.snapshotAt === undefined ? SNAPSHOT_AT : seed.snapshotAt;
  return { query: async (sql: string, values: unknown[] = []) => {
    if (/broker_reconciliation_snapshot/.test(sql)) return { rows: snapshotAt === null ? [] : [{ observed_at: snapshotAt }] };
    if (/trade\.fill/.test(sql)) {
      const terminal = values[1] as string[], after = Date.parse(String(values[2]));
      return { rows: intents.filter((i) => terminal.includes(i.status) && i.side === 'sell').flatMap((i) => {
        const late = fills.filter((f) => f.intentId === i.id && Date.parse(f.filledAt) > after);
        return late.length === 0 ? [] : [{ id: i.id, broker_symbol: i.symbol, side: i.side, position_intent: i.intent,
          quantity: late.reduce((sum, f) => sum + f.quantity, 0), status: i.status }];
      }) };
    }
    if (/broker_position_snapshot/.test(sql)) {
      return { rows: positions.map((p) => ({ symbol: p.symbol, quantity: p.quantity, side: p.side, asset_class: p.assetClass })) };
    }
    if (/master_paper_action_plan/.test(sql)) {
      return { rows: plans.filter((p) => ['READY', 'CLAIMED', 'WAITING_GATE'].includes(p.status) && ['OPEN_CC', 'ROLL_CC_OPEN'].includes(p.action))
        .map((p) => ({ id: p.id, symbol: p.symbol, quantity: p.quantity })) };
    }
    const terminal = values[1] as string[];
    return { rows: intents.filter((i) => !terminal.includes(i.status) && i.side === 'sell')
      .map((i) => ({ id: i.id, broker_symbol: i.symbol, side: i.side, position_intent: i.intent, quantity: i.quantity, status: i.status })) };
  } };
}

const read = (seed: Parameters<typeof model>[0], externalOrUnknownCount = 0) => readCommittedShortCallContracts(model(seed) as never,
  { executionAccountId: 'acct', reconciliationSnapshotId: 'snap', underlying: 'AAPL', externalOrUnknownCount });

test('every non-terminal publication state counts, terminal states release deterministically', async () => {
  for (const status of ['READY', 'CLAIMED', 'WAITING_GATE']) {
    assert.equal(await read({ plans: [{ id: 'p', status, action: 'OPEN_CC', symbol: CALL_A, quantity: 1 }] }), 1, `plan ${status}`);
  }
  for (const status of ['SUBMITTED', 'TERMINAL', 'QUARANTINED']) {
    assert.equal(await read({ plans: [{ id: 'p', status, action: 'OPEN_CC', symbol: CALL_A, quantity: 1 }] }), 0, `plan ${status} is represented by its order intent or released`);
  }
  for (const status of ['READY', 'SUBMITTING', 'SUBMITTED', 'WORKING', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'UNKNOWN_SUBMISSION', 'RECONCILING']) {
    assert.equal(await read({ intents: [{ id: 'i', status, symbol: CALL_A, side: 'sell', intent: 'sell_to_open', quantity: 2 }] }), 2, `intent ${status}`);
  }
  for (const status of terminalOrderIntentStates) {
    assert.equal(await read({ intents: [{ id: 'i', status, symbol: CALL_A, side: 'sell', intent: 'sell_to_open', quantity: 2 }] }), 0, `terminal intent ${status} releases capacity`);
  }
  assert.equal(await read({ plans: [{ id: 'p', status: 'READY', action: 'OPEN_CSP', symbol: 'AAPL261120P00190000', quantity: 3 }] }), 0, 'a put plan never commits shares');
});

test('a call sell filled AFTER the reconciliation snapshot still commits shares; one filled before it is shown by the snapshot instead', async () => {
  const filled: Intent = { id: 'i', status: 'FILLED', symbol: CALL_A, side: 'sell', intent: 'sell_to_open', quantity: 1 };
  assert.equal(await read({ intents: [filled], fills: [{ intentId: 'i', quantity: 1, filledAt: '2026-10-13T14:00:05.000Z' }] }), 1);
  assert.equal(await read({ intents: [filled], fills: [{ intentId: 'i', quantity: 1, filledAt: '2026-10-13T13:59:59.000Z' }] }), 0, 'before the snapshot: not double counted');
  assert.equal(await read({ intents: [filled], fills: [{ intentId: 'i', quantity: 1, filledAt: '2026-10-13T13:59:59.000Z' }],
    positions: [{ symbol: CALL_A, quantity: -1, side: 'short', assetClass: 'us_option' }] }), 1, 'counted once, from the position');
  // part-filled then cancelled: only the filled part commits
  assert.equal(await read({ intents: [{ ...filled, status: 'CANCELED', quantity: 3 }], fills: [{ intentId: 'i', quantity: 1, filledAt: '2026-10-13T14:00:05.000Z' }] }), 1);
  // a snapshot with no observed time cannot prove the post-snapshot gap is empty
  assert.equal(await read({ snapshotAt: null }), null);
});

test('positions: short calls count, bought-back / expired calls (no position row) release, null asset class OCC rows count', async () => {
  assert.equal(await read({ positions: [{ symbol: CALL_A, quantity: -2, side: 'short', assetClass: 'us_option' }] }), 2);
  assert.equal(await read({ positions: [] }), 0, 'call bought back or expired');
  assert.equal(await read({ positions: [{ symbol: CALL_A, quantity: -1, side: 'short', assetClass: null }] }), 1);
  assert.equal(await read({ positions: [{ symbol: CALL_A, quantity: 1, side: 'long', assetClass: 'us_option' }] }), 0, 'a long call commits nothing');
  assert.equal(await read({ positions: [{ symbol: 'AAPL', quantity: 100, side: 'long', assetClass: 'us_equity' }] }), 0);
});

test('unknown broker facts never read as zero', async () => {
  assert.equal(await read({}, 1), null, 'external or unknown broker orders');
  assert.equal(await read({ intents: [{ id: 'i', status: 'WORKING', symbol: CALL_A, side: 'sell', intent: null, quantity: 1 }] }), null, 'sell of a call with no position intent');
  assert.equal(await read({ positions: [{ symbol: 'GARBAGE', quantity: -1, side: 'short', assetClass: 'us_option' }] }), null);
});

test('same-cycle siblings: chain B sees chain A published call plan; free sellable shares follow the total commitment, and release when A terminates', async () => {
  const published: Plan = { id: 'a', status: 'READY', action: 'OPEN_CC', symbol: CALL_A, quantity: 1 };
  const seenByB = await read({ plans: [published] });
  assert.equal(seenByB, 1);
  assert.equal(freeSellableShares(200, seenByB).freeShares, 100);
  assert.equal(freeSellableShares(100, seenByB).freeShares, 0);
  const afterA = await read({ plans: [{ ...published, status: 'TERMINAL' }] });
  assert.equal(afterA, 0, 'a cancelled/terminal plan releases the capacity');
  assert.equal(freeSellableShares(100, afterA).freeShares, 100);
  // plan + its order intent both visible during a transition: conservative over-block, never an under-count
  const both = await read({ plans: [{ ...published, status: 'CLAIMED' }], intents: [{ id: 'i', status: 'SUBMITTED', symbol: CALL_A, side: 'sell', intent: 'sell_to_open', quantity: 1 }] });
  assert.ok(both !== null && both >= 1);
  const mixed = await read({ plans: [published], intents: [{ id: 'i', status: 'WORKING', symbol: CALL_B, side: 'sell', intent: 'sell_to_open', quantity: 1 }],
    positions: [{ symbol: CALL_A, quantity: -1, side: 'short', assetClass: 'us_option' }] });
  assert.equal(mixed, 3);
});
