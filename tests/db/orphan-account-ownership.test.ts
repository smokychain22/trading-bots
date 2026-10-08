import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { loadBrokerConfirmedOrphanCandidates } from '../../src/execution/postgres-broker-orphan-recovery.js';

test('orphan ownership cannot be supplied by another account or by a leg without an account-linked intent', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL as string);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'disposable localhost only');
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Synthetic fixture isolation only. All writes are rolled back and no broker is used.
    await client.query("SET LOCAL session_replication_role='replica'");
    const snapshot = randomUUID(), connection = randomUUID(), otherConnection = randomUUID();
    const account = randomUUID(), otherAccount = randomUUID(), underlying = randomUUID(), contract = randomUUID();
    const chain = randomUUID(), intent = randomUUID(), leg = randomUUID(), workspace = randomUUID();
    const reference = `synthetic-${randomUUID()}`, symbol = `V${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    await client.query(`INSERT INTO copy.follower_account(follower_account_id,workspace_id,provider_account_ref,oauth_secret_ref)
      VALUES($1,$2,$3,'synthetic'),($4,$2,$5,'synthetic')`, [connection, workspace, reference, otherConnection, `${reference}-other`]);
    await client.query(`INSERT INTO trade.execution_account(execution_account_id,account_kind,provider_account_ref_hash,provider_account_ref_masked)
      VALUES($1,'MASTER_API_KEY',encode(digest($2,'sha256'),'hex'),'synthetic'),
      ($3,'MASTER_API_KEY',encode(digest($4,'sha256'),'hex'),'synthetic')`, [account, reference, otherAccount, `${reference}-other`]);
    await client.query(`INSERT INTO trade.broker_reconciliation_snapshot(reconciliation_snapshot_id,connection_id,correlation_id,environment,
      broker_host,observed_at,data_quality,payload_hash) VALUES($1,$2,'orphan-ownership-test','PAPER','paper-api.alpaca.markets',now(),'GOOD',$3)`,
    [snapshot, connection, 'a'.repeat(64)]);
    await client.query(`INSERT INTO trade.broker_position_snapshot(reconciliation_snapshot_id,connection_id,symbol,quantity,side,asset_class,
      observed_at,payload_hash,average_entry_price) VALUES($1,$2,$3,-1,'short','us_option',now(),$4,1)`,
    [snapshot, connection, symbol, 'a'.repeat(64)]);
    await client.query(`INSERT INTO market.underlying(underlying_id,symbol,asset_type) VALUES($1,$2,'EQUITY')`, [underlying, symbol]);
    await client.query(`INSERT INTO market.option_contract(option_contract_id,underlying_id,contract_symbol,option_type,strike,expiration_date,multiplier,status)
      VALUES($1,$2,$3,'PUT',100,'2026-11-20',100,'ACTIVE')`, [contract, underlying, symbol]);
    await client.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at)
      VALUES($1,$2,$3,'CSP_OPEN',now())`, [chain, randomUUID(), underlying]);
    await client.query(`INSERT INTO trade.option_leg(option_leg_id,chain_id,option_contract_id,side,quantity,opened_at)
      VALUES($1,$2,$3,'SHORT',1,now())`, [leg, chain, contract]);
    const read = (executionAccountId = account) => loadBrokerConfirmedOrphanCandidates(client, { reconciliationSnapshotId: snapshot, executionAccountId });
    assert.equal((await read()).length, 1, 'a leg without an order intent is not proof of account ownership');
    assert.deepEqual(await read(otherAccount), [], 'a different account cannot read this snapshot as its own');
    await client.query(`INSERT INTO trade.order_intent(order_intent_id,chain_id,execution_account_id,client_order_id,status,instrument_type,
      option_contract_id,underlying_id,side,quantity,theta_action,position_intent,canonical_quantity,paper_evidence_quantity)
      VALUES($1,$2,$3,$4,'FILLED','OPTION',$5,$6,'sell',1,'OPEN_CSP','SELL_TO_OPEN',1,1)`, [intent, chain, otherAccount, `synthetic-${intent}`, contract, underlying]);
    assert.equal((await read()).length, 1, 'another account holding the same contract must not hide this orphan');
    await client.query('UPDATE trade.order_intent SET execution_account_id=$2 WHERE order_intent_id=$1', [intent, account]);
    assert.deepEqual(await read(), [], 'an exact account/contract/chain-owned leg is excluded');
    await client.query('UPDATE trade.order_intent SET execution_account_id=$2 WHERE order_intent_id=$1', [intent, otherAccount]);
    const spreadChain = randomUUID(), spreadIntent = randomUUID(), longContract = randomUUID(), longSymbol = `${symbol}L`;
    await client.query(`INSERT INTO market.option_contract(option_contract_id,underlying_id,contract_symbol,option_type,strike,expiration_date,multiplier,status)
      VALUES($1,$2,$3,'PUT',95,'2026-11-20',100,'ACTIVE')`, [longContract, underlying, longSymbol]);
    await client.query(`INSERT INTO trade.broker_position_snapshot(reconciliation_snapshot_id,connection_id,symbol,quantity,side,asset_class,
      observed_at,payload_hash,average_entry_price) VALUES($1,$2,$3,1,'long','us_option',now(),$4,0.5)`, [snapshot, connection, longSymbol, 'b'.repeat(64)]);
    assert.equal((await read()).length, 2, 'an unowned long option is visible as well');
    await client.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at,chain_kind)
      VALUES($1,$2,$3,'WAIT',now(),'DEFINED_RISK')`, [spreadChain, randomUUID(), underlying]);
    await client.query(`INSERT INTO trade.order_intent(order_intent_id,chain_id,execution_account_id,client_order_id,status,instrument_type,
      underlying_id,side,quantity,theta_action,order_class,package_identity,credit_debit_direction,canonical_quantity,paper_evidence_quantity)
      VALUES($1,$2,$3,$4,'FILLED','OPTION',$5,'sell',1,'OPEN_DEFINED_RISK','mleg','synthetic-package','CREDIT',1,1)`,
    [spreadIntent, spreadChain, otherAccount, `synthetic-${spreadIntent}`, underlying]);
    await client.query(`INSERT INTO trade.order_intent_leg(order_intent_id,leg_index,option_contract_id,provider_contract_id,occ_symbol,
      option_type,position_intent,ratio_quantity,expiration,strike,multiplier,deliverable_identity)
      VALUES($1,1,$2,'synthetic-short',$3,'PUT','sell_to_open',1,'2026-11-20',100,100,'synthetic-standard'),
      ($1,2,$4,'synthetic-long',$5,'PUT','buy_to_open',1,'2026-11-20',95,100,'synthetic-standard')`,
    [spreadIntent, contract, symbol, longContract, longSymbol]);
    await client.query(`INSERT INTO trade.defined_risk_position(order_intent_id,chain_id,underlying_id,quantity,multiplier,expiration,short_strike,long_strike,state)
      VALUES($1,$2,$3,1,100,'2026-11-20',100,95,'OPEN')`, [spreadIntent, spreadChain, underlying]);
    assert.equal((await read()).length, 2, 'a different account spread cannot own either broker leg');
    await client.query('UPDATE trade.order_intent SET execution_account_id=$2 WHERE order_intent_id=$1', [spreadIntent, account]);
    assert.deepEqual(await read(), [], 'both legs of this account registered spread belong to the D manager');
    await client.query("UPDATE trade.defined_risk_position SET state='CLOSED',closed_at=now() WHERE order_intent_id=$1", [spreadIntent]);
    assert.equal((await read()).length, 2, 'terminal spread ownership cannot hide renewed broker exposure');
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); await pool.end(); }
  }
});
