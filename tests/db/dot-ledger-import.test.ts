import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { DotCanonicalLedgerReader } from '../../src/lab/ledger-import.js';
import type { DotLabIdentity } from '../../src/lab/contracts.js';

test('real disposable PostgreSQL validates account-scoped ledger SQL, fees, multiplier and mixed-chain isolation', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const identity: DotLabIdentity = { version: 'dot-strategy-lab-v1', providerAccountId: randomUUID(),
    executionAccountId: randomUUID(), workspaceId: randomUUID(), accountNumber: 'SYNTHETIC',
    confirmedAt: '2026-10-08T12:00:00.000Z', environment: 'PAPER', brokerExecutionEnabled: false, workerEnabled: false };
  const chain = randomUUID(), contract = randomUUID(), intent = randomUUID(), broker = randomUUID();
  let releases = 0;
  // Keep fixture facts fully rolled back. Map the reader's transaction to a savepoint
  // in this fixture only. The ordinary read-only BEGIN/COMMIT contract is tested separately.
  const adapter = { connect: async () => ({ query: (sql: string, params?: unknown[]) => client.query(
    sql.startsWith('BEGIN ISOLATION') ? 'SAVEPOINT dot_reader' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT dot_reader'
      : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT dot_reader' : sql, params), release: () => releases++ }) } as unknown as Pool;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role='replica'");
    await client.query(`INSERT INTO trade.execution_account(execution_account_id,account_kind,provider_account_ref_hash,
      provider_account_ref_masked) VALUES($1,'MASTER_API_KEY',encode(digest($2,'sha256'),'hex'),'synthetic')`,
    [identity.executionAccountId, identity.providerAccountId]);
    await client.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at,closed_at)
      VALUES($1,$2,$3,'CLOSED','2026-10-01T12:00Z','2026-10-07T12:00Z')`, [chain, randomUUID(), randomUUID()]);
    await client.query(`INSERT INTO market.option_contract(option_contract_id,contract_symbol,underlying_id,option_type,strike,
      expiration_date,multiplier,status) VALUES($1,$2,$3,'PUT',57,'2026-11-20',100,'active')`, [contract, randomUUID(), randomUUID()]);
    await client.query(`INSERT INTO trade.order_intent(order_intent_id,chain_id,execution_account_id,client_order_id,status,
      instrument_type,side,position_intent,quantity,canonical_quantity,paper_evidence_quantity,created_at)
      VALUES($1,$2,$3,$4,'FILLED','OPTION','sell','SELL_TO_OPEN',1,1,1,'2026-10-01T12:00Z')`,
    [intent, chain, identity.executionAccountId, randomUUID()]);
    await client.query(`INSERT INTO trade.broker_order(broker_order_id,order_intent_id,provider_order_id) VALUES($1,$2,$3)`,
    [broker, intent, randomUUID()]);
    await client.query(`INSERT INTO trade.fill(broker_order_id,provider_fill_id,quantity,price_per_share,filled_at,fees)
      VALUES($1,$2,1,1,'2026-10-01T12:01Z',1)`, [broker, randomUUID()]);
    await client.query(`INSERT INTO trade.option_leg(chain_id,option_contract_id,side,quantity,opened_at,closed_at,close_reason,
      realized_pnl) VALUES($1,$2,'SHORT',1,'2026-10-01T12:01Z','2026-10-07T12:00Z','BTC_CLOSE',100)`, [chain, contract]);
    const closingIntent = randomUUID(), closingBroker = randomUUID();
    await client.query(`INSERT INTO trade.order_intent(order_intent_id,chain_id,execution_account_id,option_contract_id,client_order_id,
      status,instrument_type,side,position_intent,quantity,canonical_quantity,paper_evidence_quantity,created_at)
      VALUES($1,$2,$3,$4,$5,'FILLED','OPTION','buy','BUY_TO_CLOSE',1,1,1,'2026-10-07T12:00Z')`,
    [closingIntent, chain, identity.executionAccountId, contract, randomUUID()]);
    await client.query(`INSERT INTO trade.broker_order(broker_order_id,order_intent_id,provider_order_id) VALUES($1,$2,$3)`,
    [closingBroker, closingIntent, randomUUID()]);
    await client.query(`INSERT INTO trade.fill(broker_order_id,provider_fill_id,quantity,price_per_share,filled_at,fees)
      VALUES($1,$2,1,0.5,'2026-10-07T12:00Z',0)`, [closingBroker, randomUUID()]);
    const reader = new DotCanonicalLedgerReader(adapter, identity, 'a'.repeat(40));
    const unknown = await reader.read('2026-10-08T15:00:00.000Z');
    assert.equal(unknown.outcomes[0]?.resolution.state, 'BLOCKED');
    assert.equal(unknown.legs[0]?.multiplier, '100.00000000');
    await client.query(`INSERT INTO trade.fee_event(chain_id,fee_type,amount,incurred_at) VALUES($1,'execution',1,'2026-10-01T12:01Z')`, [chain]);
    const known = await reader.read('2026-10-08T15:00:00.000Z');
    assert.equal(known.outcomes[0]?.resolution.state, 'RESOLVED');
    if (known.outcomes[0]?.resolution.state === 'RESOLVED') assert.equal(known.outcomes[0].resolution.wholeChainNetPnl, 99);
    const other = randomUUID();
    await client.query(`INSERT INTO trade.order_intent(chain_id,execution_account_id,client_order_id,instrument_type,side,position_intent,
      quantity,canonical_quantity,paper_evidence_quantity)
      VALUES($1,$2,$3,'OPTION','sell','SELL_TO_OPEN',1,1,1)`, [chain, other, randomUUID()]);
    await assert.rejects(reader.read('2026-10-08T15:00:00.000Z'), /DOT_LEDGER_MIXED_ACCOUNT_CHAIN/);
    assert.equal(releases, 3);
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); await pool.end(); }
  }
});
