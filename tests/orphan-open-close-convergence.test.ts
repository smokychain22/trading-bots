import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { applyConfirmedFillLifecycle } from '../src/execution/postgres-broker-fill-lifecycle-orchestrator.js';
import { deterministicRuntimeUuid } from '../src/theta/postgres-theta-cycle-store.js';

// Drives the REAL fill-lifecycle orchestrator, REAL lifecycle-application store and REAL copy planner against an in-memory
// emulation of the rows they touch. Scenario (generic orphan): the OPEN_CSP fill's lifecycle registration was blocked, the position
// was then closed by a risk close, and registration recovers. Synthetic identifiers only (public repository).
const id = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const chainId = id(1), openIntent = id(2), closeIntent = id(3), contract = id(4), underlying = id(5), openDecision = id(6), closeDecision = id(7);
const openFill = id(8), closeFill = id(9), bot = id(10);
const legId = deterministicRuntimeUuid(`option-leg:${openIntent}`);

function emulatedDatabase() {
  const db = {
    chainState: 'WAIT',
    legs: new Map<string, { quantity: number; entryCreditDebit: number; openedAt: string; closedAt: string | null; realizedPnl: number | null }>(),
    applications: new Map<string, { id: string; chainId: string; eventKind: string; path: unknown }>(),
    copyEvents: new Map<string, string>(),
    transitions: [] as string[],
  };
  const fillRow = (fill: string, quantity: number, price: number, at: string) =>
    ({ provider_fill_id: `provider-${fill}`, quantity, price_per_share: price, filled_at: at, fees: 0 });
  const intentRows = () => {
    const leg = db.legs.get(legId);
    const common = { chain_id: chainId, bot_instance_id: bot, status: 'FILLED', order_quantity: 1, option_contract_id: contract,
      underlying_id: underlying, contract_symbol: 'XLE261120P00057000', underlying_symbol: 'XLE', multiplier: 100,
      partial_closed_quantity: 0, partial_realized_pnl: 0, open_stock_lots: [] };
    // The orchestrator's lateral join only finds a leg that exists when the query runs (opened before the close intent).
    const legColumns = leg === undefined ? { option_leg_id: null, entry_credit_debit: null, original_leg_quantity: null }
      : { option_leg_id: legId, entry_credit_debit: leg.entryCreditDebit, original_leg_quantity: leg.quantity };
    return [
      { ...common, ...legColumns, order_intent_id: openIntent, decision_id: openDecision, theta_action: 'OPEN_CSP',
        fills: [fillRow(openFill, 1, 0.28, '2026-10-07T13:47:57.000Z')], fill_ids: [openFill] },
      { ...common, ...legColumns, order_intent_id: closeIntent, decision_id: closeDecision, theta_action: 'CLOSE_CSP',
        fills: [fillRow(closeFill, 1, 0.86, '2026-10-07T17:05:00.000Z')], fill_ids: [closeFill] },
    ];
  };
  const handle = (sql: string, values: readonly unknown[]): { rows: unknown[]; rowCount: number } => {
    const one = (row: unknown) => ({ rows: [row], rowCount: 1 });
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM trade.order_intent oi JOIN trade.execution_account')) { const rows = intentRows(); return { rows, rowCount: rows.length }; }
    if (sql.includes('FROM trade.lifecycle_application WHERE evidence_key=$1')) {
      const found = db.applications.get(String(values[0]));
      return found === undefined ? { rows: [], rowCount: 0 } : one({ lifecycle_application_id: found.id, chain_id: found.chainId,
        event_kind: found.eventKind, transition_path_json: found.path, result_hash: 'x' });
    }
    if (sql.includes('SELECT lifecycle_state FROM trade.economic_chain')) return one({ lifecycle_state: db.chainState });
    if (sql.includes('CROSS JOIN trade.economic_chain')) return one({ option_type: 'PUT', multiplier: 100,
      contract_underlying_id: underlying, chain_underlying_id: underlying });
    if (sql.includes('INSERT INTO trade.option_leg')) {
      if (db.legs.has(String(values[0]))) throw Object.assign(new Error('duplicate option_leg'), { code: '23505' });
      db.legs.set(String(values[0]), { quantity: Number(values[4]), entryCreditDebit: Number(values[6]), openedAt: String(values[7]),
        closedAt: null, realizedPnl: null });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM trade.option_leg l') && sql.includes('JOIN market.option_contract oc')) {
      const leg = db.legs.get(String(values[0]));
      if (leg === undefined || (leg.closedAt !== null && values[2] !== true)) return { rows: [], rowCount: 0 };
      return one({ side: 'SHORT', quantity: leg.quantity, entry_credit_debit: leg.entryCreditDebit, option_contract_id: contract,
        option_type: 'PUT', strike: 57, multiplier: 100, partial_closed_quantity: 0, partial_realized_pnl: 0, partial_closing_debit: 0,
        contract_underlying_id: underlying, chain_underlying_id: underlying });
    }
    if (sql.includes('UPDATE trade.option_leg SET closed_at')) {
      const leg = db.legs.get(String(values[0]));
      if (leg === undefined || leg.closedAt !== null) return { rows: [], rowCount: 0 };
      leg.closedAt = String(values[1]); leg.realizedPnl = Number(values[4]);
      return one({ option_leg_id: values[0] });
    }
    if (sql.includes('INSERT INTO trade.lifecycle_transition')) { db.transitions.push(`${values[1]}->${values[2]}`); return { rows: [], rowCount: 1 }; }
    if (sql.includes('UPDATE trade.economic_chain SET lifecycle_state')) { db.chainState = String(values[1]); return { rows: [], rowCount: 1 }; }
    if (sql.includes('INSERT INTO trade.lifecycle_application')) {
      const key = String(values[1]);
      if (db.applications.has(key)) throw Object.assign(new Error('duplicate evidence_key'), { code: '23505' });
      db.applications.set(key, { id: String(values[0]), chainId: String(values[2]), eventKind: String(values[3]), path: JSON.parse(String(values[5])) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SELECT 1 FROM trade.fill f')) return one({ '?column?': 1 });
    if (sql.includes('INSERT INTO copy.master_copy_event')) {
      if (!db.copyEvents.has(String(values[0]))) db.copyEvents.set(String(values[0]), String(values[13]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SELECT payload_hash FROM copy.master_copy_event')) return one({ payload_hash: db.copyEvents.get(String(values[0])) });
    return { rows: [], rowCount: 0 };
  };
  const client = () => Object.assign(new EventEmitter(), { release() { /* emulated */ },
    async query(sql: string, values: readonly unknown[] = []) { return handle(sql, values); } });
  const pool = { query: async (sql: string, values: readonly unknown[] = []) => handle(sql, values), connect: async () => client() };
  return { db, pool };
}

test('open-then-close replay converges in ONE cycle: exactly one SHORT_PUT_OPEN and one OPTION_CLOSE, premium counted once', async () => {
  const { db, pool } = emulatedDatabase();
  const report = await applyConfirmedFillLifecycle(pool as never, id(11), '2026-10-07T20:05:00.000Z');
  const kinds = [...db.applications.values()].map((application) => application.eventKind).sort();
  assert.deepEqual(kinds, ['OPTION_CLOSE', 'SHORT_PUT_OPEN']);
  assert.equal(report.unresolved, 0);
  assert.equal(report.applied, 2);
  assert.equal(db.chainState, 'REDEPLOY');
  assert.equal(db.legs.size, 1, 'one option leg: the premium is recorded once');
  const leg = db.legs.get(legId);
  assert.ok(Math.abs((leg?.entryCreditDebit ?? 0) - 28) < 1e-9);
  assert.equal(leg?.closedAt, '2026-10-07T17:05:00.000Z');
  assert.ok(Math.abs((leg?.realizedPnl ?? 0) - (28 - 86)) < 1e-9, 'realized option P&L = opening credit - closing debit');
  assert.equal(db.copyEvents.size, 2, 'one master fill event per fill, no duplicates');

  // Every later cycle (restart, retry) is a pure duplicate: no new event, leg, transition or copy event.
  const transitions = db.transitions.length;
  for (let run = 0; run < 3; run += 1) {
    const replay = await applyConfirmedFillLifecycle(pool as never, id(11), '2026-10-07T20:10:00.000Z');
    assert.deepEqual([replay.applied, replay.duplicates, replay.unresolved], [0, 2, 0]);
  }
  assert.equal(db.applications.size, 2);
  assert.equal(db.legs.size, 1);
  assert.equal(db.transitions.length, transitions);
  assert.equal(db.copyEvents.size, 2);
});
