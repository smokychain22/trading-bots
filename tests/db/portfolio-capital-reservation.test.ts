import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresPortfolioCapitalStore, type CapitalTerminalEvidence } from '../../src/execution/postgres-portfolio-capital-store.js';
import type { CapitalEnvelope, CapitalProposal } from '../../src/execution/portfolio-capital-reservation.js';

const dims=(x:string)=>({CASH:x,BROKER:x,PORTFOLIO:x,ASSIGNMENT:x,'TICKER:XLE':x,'SECTOR:ENERGY':x,'CORRELATION:ENERGY':x});
const NOW='2026-10-08T13:30:00Z';
const proposal=(amount:string,strategy:CapitalProposal['strategy']='THETA_CONVENTIONAL'):CapitalProposal=>({reservationId:randomUUID(),
  proposalRef:randomUUID(),decisionId:randomUUID(),candidateRef:randomUUID(),strategy,quantity:1,canonicalMaximumQuantity:1,
  quoteExpiresAt:'2026-10-08T13:31:00Z',perUnit:dims(amount),authorityHash:'a'.repeat(64)});

async function cleanAccount(pool:Pool,account:string,hash:string,fixture?:{intent:string;broker:string}) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');await client.query("SET LOCAL session_replication_role='replica'");
    await client.query(`DELETE FROM trade.capital_reservation_event WHERE reservation_id IN
      (SELECT reservation_id FROM trade.capital_reservation WHERE provider_account_ref_hash=$1)`,[hash]);
    await client.query('DELETE FROM trade.capital_reservation WHERE provider_account_ref_hash=$1',[hash]);
    await client.query('DELETE FROM trade.capital_envelope WHERE provider_account_ref_hash=$1',[hash]);
    if(fixture!==undefined){
      await client.query('DELETE FROM trade.fill WHERE broker_order_id=$1',[fixture.broker]);
      await client.query('DELETE FROM trade.broker_order WHERE broker_order_id=$1',[fixture.broker]);
      await client.query('DELETE FROM trade.order_intent WHERE order_intent_id=$1',[fixture.intent]);
    }
    await client.query('DELETE FROM trade.execution_account WHERE execution_account_id=$1',[account]);
    await client.query('COMMIT');
  } catch(e) {await client.query('ROLLBACK');throw e;} finally{client.release();await pool.end();}
}

test('real PostgreSQL: intent binding, partial cancel, missing fill, terminal replay and ambiguous outcomes',
  {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const url=process.env.TEST_DATABASE_URL as string;
  assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname));
  const pool=new Pool({connectionString:url,max:2});
  const account=randomUUID(),hash=account.replaceAll('-','').repeat(2),intent=randomUUID(),broker=randomUUID();
  const p={...proposal('7000'),quantity:2,canonicalMaximumQuantity:2};
  const envelope:CapitalEnvelope={envelopeId:randomUUID(),executionAccountId:account,observedAt:NOW,
    expiresAt:'2026-10-08T13:31:00Z',evidenceHash:'b'.repeat(64),available:dims('25000'),reflected:{},policyVersion:'test-policy'};
  const store=new PostgresPortfolioCapitalStore(pool);
  try {
    await pool.query(`INSERT INTO trade.execution_account(execution_account_id,account_kind,provider_account_ref_hash,
      provider_account_ref_masked,account_ready) VALUES($1,'MASTER_API_KEY',$2,'synthetic',true)`,[account,hash]);
    // Only synthetic upstream decision/contract fixture construction bypasses
    // unrelated foreign keys. Reservation, binding and reconciliation execute
    // with normal PostgreSQL constraints on independent committed transactions.
    const setup=await pool.connect();
    try {
      await setup.query('BEGIN');await setup.query("SET LOCAL session_replication_role='replica'");
      await setup.query(`INSERT INTO trade.order_intent(order_intent_id,execution_account_id,decision_id,client_order_id,
        status,instrument_type,option_contract_id,side,quantity,theta_action,position_intent,canonical_quantity,paper_evidence_quantity)
        VALUES($1,$2,$3,$4,'UNKNOWN_SUBMISSION','OPTION',$5,'sell',2,'OPEN_CSP','SELL_TO_OPEN',2,2)`,
      [intent,account,p.decisionId,`synthetic-${intent}`,randomUUID()]);
      await setup.query(`INSERT INTO trade.broker_order(broker_order_id,order_intent_id,provider_order_id,broker_status)
        VALUES($1,$2,$3,'UNKNOWN_SUBMISSION')`,[broker,intent,`synthetic-${broker}`]);
      await setup.query('COMMIT');
    } catch(e) {await setup.query('ROLLBACK');throw e;} finally{setup.release();}
    await store.reserve(envelope,[p],NOW);
    const bind=await pool.connect();
    try {
      await bind.query('BEGIN');
      await store.bindIntentInTransaction(bind,account,p.reservationId,intent);
      await store.bindIntentInTransaction(bind,account,p.reservationId,intent);
      await bind.query('COMMIT');
    } catch(e) {await bind.query('ROLLBACK');throw e;} finally{bind.release();}
    const evidence:CapitalTerminalEvidence={eventId:randomUUID(),executionAccountId:account,reservationId:p.reservationId,
      observedAt:new Date(Date.now()+1000).toISOString(),brokerOrder:{id:`synthetic-${broker}`,clientOrderId:`synthetic-${intent}`,
        quantity:2,filledQuantity:1,status:'CANCELED',source:'ALPACA_PAPER_GET',responseHash:'c'.repeat(64)}};
    const quantity=async()=>Number((await pool.query('SELECT remaining_quantity FROM trade.capital_reservation WHERE reservation_id=$1',[p.reservationId])).rows[0].remaining_quantity);
    await assert.rejects(store.reconcileTerminal(evidence),/LEDGER_MISMATCH/,'ambiguous intent cannot release');
    assert.equal(await quantity(),2);
    await pool.query("UPDATE trade.order_intent SET status='CANCELED' WHERE order_intent_id=$1",[intent]);
    await assert.rejects(store.reconcileTerminal(evidence),/LEDGER_MISMATCH/,'missing fill is not zero');
    assert.equal(await quantity(),2);
    await pool.query(`INSERT INTO trade.fill(broker_order_id,provider_fill_id,quantity,price_per_share,filled_at,fees)
      VALUES($1,'synthetic-fill',1,1,now(),0.5)`,[broker]);
    await assert.rejects(store.reconcileTerminal({...evidence,brokerOrder:{...evidence.brokerOrder,filledQuantity:0}}),/LEDGER_MISMATCH/);
    await assert.rejects(store.reconcileTerminal({...evidence,brokerOrder:{...evidence.brokerOrder,id:'wrong-order'}}),/LEDGER_MISMATCH/);
    await assert.rejects(store.reconcileTerminal({...evidence,observedAt:'2020-01-01T00:00:00Z'}),/TIME_INVALID/);
    await store.reconcileTerminal(evidence);
    assert.equal(await quantity(),1,'only the unfilled canceled contract is released');
    await new PostgresPortfolioCapitalStore(pool).reconcileTerminal(evidence);
    assert.equal(await quantity(),1,'restart replay cannot release the remaining filled contract');
    await assert.rejects(store.reconcileTerminal({...evidence,brokerOrder:{...evidence.brokerOrder,filledQuantity:0}}),/IDEMPOTENCY_CONFLICT/);
    await assert.rejects(pool.query("UPDATE trade.capital_reservation SET remaining_quantity=2 WHERE reservation_id=$1",[p.reservationId]),/IDENTITY_IMMUTABLE/);
    await assert.rejects(pool.query('UPDATE trade.capital_reservation_event SET evidence_json=\'{}\' WHERE event_id=$1',[evidence.eventId]));
    // Exact unique broker fill identity rejects duplicate delivery.
    await assert.rejects(pool.query(`INSERT INTO trade.fill(broker_order_id,provider_fill_id,quantity,price_per_share,filled_at)
      VALUES($1,'synthetic-fill',1,1,now())`,[broker]),{code:'23505'});
  } finally {
    await cleanAccount(pool,account,hash,{intent,broker});
  }
});

test('real PostgreSQL: concurrent Q/H/D, duplicate requests, rollback, restart and stale budget cannot over-reserve',
  {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const url=process.env.TEST_DATABASE_URL as string;
  assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname),'Local disposable database only');
  const pool=new Pool({connectionString:url,max:3});
  const executionAccountId=randomUUID(),accountHash=executionAccountId.replaceAll('-','').repeat(2);
  const envelope:CapitalEnvelope={envelopeId:randomUUID(),executionAccountId,observedAt:NOW,expiresAt:'2026-10-08T13:31:00Z',
    evidenceHash:'b'.repeat(64),available:dims('24000'),reflected:{},policyVersion:'governed-test-policy'};
  const store=new PostgresPortfolioCapitalStore(pool);
  try{
    await pool.query(`INSERT INTO trade.execution_account(execution_account_id,account_kind,provider_account_ref_hash,
      provider_account_ref_masked,account_ready) VALUES($1,'MASTER_API_KEY',$2,'synthetic',true)`,[executionAccountId,accountHash]);
    const q=proposal('15000'),h=proposal('7000','THETA_HOLD_STRIKE'),d=proposal('3000','THETA_DEFINED_RISK');
    // Actual independent transactions on separate pool clients, not a mocked lock.
    const results=await Promise.all([q,h,d].map(p=>store.reserve(envelope,[p],NOW)));
    assert.equal(results.flat().filter(x=>x.state==='RESERVED').length,2);
    assert.equal(results.flat().filter(x=>x.state==='BLOCKED').length,1);
    const total=await pool.query(`SELECT sum((proposal_json->'perUnit'->>'CASH')::numeric*remaining_quantity)::text amount,
      count(*)::integer n FROM trade.capital_reservation WHERE provider_account_ref_hash=$1`,[accountHash]);
    assert.ok(Number(total.rows[0].amount)<=24000);
    assert.equal(total.rows[0].n,2);
    const accepted=[q,h,d].find(p=>results.flat().some(r=>r.reservationId===p.reservationId&&r.state==='RESERVED'));
    assert.ok(accepted);
    const repeats=await Promise.all(Array.from({length:6},()=>store.reserve(envelope,[accepted],NOW)));
    assert.ok(repeats.every(r=>r[0]?.state==='REPLAY'));
    await assert.rejects(store.reserve(envelope,[{...accepted,reservationId:randomUUID(),proposalRef:randomUUID(),perUnit:dims('1')}],NOW),{code:'23505'});
    await assert.rejects(store.reserve(envelope,[{...accepted,perUnit:dims('1')}],NOW),/IDEMPOTENCY_CONFLICT/);
    await assert.rejects(store.reserve({...envelope,envelopeId:randomUUID(),available:dims('999999')},[proposal('1')],NOW),/ENVELOPE_IDENTITY_CONFLICT/);
    await assert.rejects(store.reserve(envelope,[proposal('1')],'2026-10-08T13:31:00Z'),/ENVELOPE_STALE/);
    assert.equal((await store.reserve(envelope,[{...proposal('1'),quoteExpiresAt:NOW}],NOW))[0]?.state,'BLOCKED');
    // Simulated process failure before COMMIT must leave no reservation.
    const client=await pool.connect(),rolledBack=proposal('1');
    try {await client.query('BEGIN');await store.reserveInTransaction(client,envelope,[rolledBack],NOW);await client.query('ROLLBACK');}
    finally{client.release();}
    assert.equal((await pool.query('SELECT count(*)::integer n FROM trade.capital_reservation WHERE reservation_id=$1',[rolledBack.reservationId])).rows[0].n,0);
    const restarted=new Pool({connectionString:url,max:1});
    try{assert.equal((await new PostgresPortfolioCapitalStore(restarted).reserve(envelope,[accepted],NOW))[0]?.state,'REPLAY');}
    finally{await restarted.end();}
    // Missing/ambiguous broker state never frees capacity, nor does expiry alone.
    await assert.rejects(store.reconcileTerminal({eventId:randomUUID(),executionAccountId,reservationId:accepted.reservationId,
      observedAt:NOW,brokerOrder:{id:'synthetic',clientOrderId:'synthetic',quantity:1,filledQuantity:0,
        status:'UNKNOWN_SUBMISSION' as 'CANCELED',source:'ALPACA_PAPER_GET',responseHash:'c'.repeat(64)}}));
    assert.equal((await pool.query('SELECT remaining_quantity FROM trade.capital_reservation WHERE reservation_id=$1',[accepted.reservationId])).rows[0].remaining_quantity,1);
    const newer={...envelope,envelopeId:randomUUID(),observedAt:'2026-10-08T13:30:01Z'};
    await store.reserve(newer,[proposal('999999')],'2026-10-08T13:30:01Z');
    await assert.rejects(store.reserve(envelope,[proposal('1')],NOW),/ENVELOPE_SUPERSEDED/);
  }finally{
    await cleanAccount(pool,executionAccountId,accountHash);
  }
});

test('real PostgreSQL: one sovereign ordered batch admits all affordable proposals and rejects only the binding excess',
  {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const url=process.env.TEST_DATABASE_URL as string;
  assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname));
  const pool=new Pool({connectionString:url,max:2});
  const id=randomUUID(),hash=id.replaceAll('-','').repeat(2);
  try{
    await pool.query(`INSERT INTO trade.execution_account(execution_account_id,account_kind,provider_account_ref_hash,
      provider_account_ref_masked,account_ready) VALUES($1,'MASTER_API_KEY',$2,'synthetic',true)`,[id,hash]);
    const envelope:CapitalEnvelope={envelopeId:randomUUID(),executionAccountId:id,observedAt:NOW,expiresAt:'2026-10-08T13:31:00Z',
      evidenceHash:'b'.repeat(64),available:dims('25000'),reflected:{},policyVersion:'test-policy'};
    const proposals=[proposal('15000'),proposal('7000','THETA_HOLD_STRIKE'),proposal('3000','THETA_DEFINED_RISK'),proposal('1')];
    const result=await new PostgresPortfolioCapitalStore(pool).reserve(envelope,proposals,NOW);
    assert.deepEqual(result.map(r=>r.state),['RESERVED','RESERVED','RESERVED','BLOCKED']);
  }finally{
    await cleanAccount(pool,id,hash);
  }
});
