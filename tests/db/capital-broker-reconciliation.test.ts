import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import type { BrokerActivity, BrokerOrderSnapshot } from '../../src/execution/broker.js';
import { PostgresBrokerReconciliationStore } from '../../src/execution/broker-reconciliation-worker.js';
import { classifyBrokerFactBatch } from '../../src/execution/broker-fact-impact.js';
import { PostgresPortfolioCapitalStore } from '../../src/execution/postgres-portfolio-capital-store.js';

test('canonical reconciliation releases only proven unfilled units, retains gaps, and replays fills under the account lock',
  {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const url=process.env.TEST_DATABASE_URL as string;
  assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname));
  const pool=new Pool({connectionString:url,max:2});
  const account=randomUUID(),connection=randomUUID(),intent=randomUUID(),broker=randomUUID(),decision=randomUUID();
  const provider=`synthetic-${account}`,hash=createHash('sha256').update(provider).digest('hex');
  const now=()=>new Date(Date.now()+2000).toISOString();
  const reservationId=randomUUID(),capital=new PostgresPortfolioCapitalStore(pool),store=new PostgresBrokerReconciliationStore(pool);
  const dims={CASH:'7000',BROKER:'7000',PORTFOLIO:'7000',ASSIGNMENT:'7000','TICKER:XLE':'7000',
    'SECTOR:ENERGY':'7000','CORRELATION:ENERGY':'7000'};
  const order:BrokerOrderSnapshot={id:`synthetic-${broker}`,clientOrderId:`synthetic-${intent}`,
    symbol:'XLE261120P00057000',qty:2,filledQty:1,filledAvgPrice:0.28,side:'sell',positionIntent:'sell_to_open',
    status:'canceled',limitPrice:0.28,submittedAt:now(),replacedBy:null,replaces:null};
  const fill:BrokerActivity={id:`synthetic-fill-${broker}`,activityType:'FILL',symbol:order.symbol,
    quantity:1,price:0.28,date:now(),orderId:order.id};
  const snapshots:string[]=[];
  const persist=async(raw:BrokerOrderSnapshot,activities:BrokerActivity[]=[])=>{
    const matches=await store.matchOrders(hash,[raw]);
    assert.equal(matches.matched.length,1);
    assert.equal(matches.matched[0]?.capitalOrderEvidence?.filledQty,raw.filledQty);
    const snapshotId=randomUUID();snapshots.push(snapshotId);
    return store.persist({snapshotId,connectionId:connection,correlationId:randomUUID(),providerAccountRefHash:hash,
      accountStatus:'ACTIVE',marketClock:{timestamp:now(),isOpen:true,nextOpen:null,nextClose:null},calendarSessions:[],
      positionCount:0,openOrderCount:raw.status==='pending_cancel'?1:0,activityCount:activities.length,
      positions:[],activities,matchedOrders:matches.matched,missingLocalIntentIds:[],unmatchedFacts:[],
      factImpactSummary:classifyBrokerFactBatch([]),observedAt:now(),brokerEvidenceReceivedAt:now(),payloadHash:'a'.repeat(64)});
  };
  const remaining=async()=>Number((await pool.query('SELECT remaining_quantity FROM trade.capital_reservation WHERE reservation_id=$1',[reservationId])).rows[0].remaining_quantity);
  try {
    const setup=await pool.connect();
    try {
      await setup.query('BEGIN');await setup.query("SET LOCAL session_replication_role='replica'");
      // Only unrelated upstream identities are synthetic. Release, fill and
      // reconciliation transactions below run with normal constraints/triggers.
      await setup.query(`INSERT INTO copy.follower_account(follower_account_id,workspace_id,provider_account_ref,
        oauth_secret_ref,account_role,participation) VALUES($1,$2,$3,'synthetic','FOLLOWER_THETA_PAPER','STOP_NEW_TRADES_MANAGE_EXISTING')`,
      [connection,randomUUID(),provider]);
      await setup.query(`INSERT INTO trade.execution_account(execution_account_id,account_kind,provider_account_ref_hash,
        provider_account_ref_masked,account_ready) VALUES($1,'MASTER_API_KEY',$2,'synthetic',true)`,[account,hash]);
      await setup.query(`INSERT INTO trade.order_intent(order_intent_id,execution_account_id,decision_id,client_order_id,
        status,instrument_type,option_contract_id,broker_symbol,side,quantity,theta_action,position_intent,canonical_quantity,paper_evidence_quantity)
        VALUES($1,$2,$3,$4,'PARTIAL','OPTION',$5,$6,'sell',2,'OPEN_CSP','SELL_TO_OPEN',2,2)`,
      [intent,account,decision,order.clientOrderId,randomUUID(),order.symbol]);
      await setup.query(`INSERT INTO trade.broker_order(broker_order_id,order_intent_id,provider_order_id,broker_status)
        VALUES($1,$2,$3,'partially_filled')`,[broker,intent,order.id]);
      await setup.query('COMMIT');
    } catch(e){await setup.query('ROLLBACK');throw e;}finally{setup.release();}
    const at=now();
    await capital.reserve({envelopeId:randomUUID(),executionAccountId:account,observedAt:at,
      expiresAt:new Date(Date.parse(at)+45000).toISOString(),evidenceHash:'b'.repeat(64),
      available:Object.fromEntries(Object.keys(dims).map(k=>[k,'25000'])),reflected:{},policyVersion:'test-policy'},
    [{reservationId,proposalRef:randomUUID(),decisionId:decision,candidateRef:randomUUID(),strategy:'THETA_CONVENTIONAL',
      quantity:2,canonicalMaximumQuantity:2,quoteExpiresAt:new Date(Date.parse(at)+45000).toISOString(),perUnit:dims,authorityHash:'c'.repeat(64)}],at);
    const binding=await pool.connect();
    try{await binding.query('BEGIN');await capital.bindIntentInTransaction(binding,account,reservationId,intent);await binding.query('COMMIT');}
    catch(e){await binding.query('ROLLBACK');throw e;}finally{binding.release();}

    await persist({...order,status:'pending_cancel'});
    assert.equal(await remaining(),2,'pending cancellation releases nothing');
    assert.equal((await persist(order)).capitalReconciliationBlockedCount,1);
    assert.equal(await remaining(),2,'a missing immutable fill cannot become zero');
    assert.equal((await pool.query(`SELECT detail_json->>'reason' reason FROM trade.reconciliation_event
      WHERE order_intent_id=$1 AND state='QUARANTINED'`,[intent])).rows[0].reason,'CAPITAL_TERMINAL_LEDGER_MISMATCH');
    assert.equal((await pool.query('SELECT count(*)::int n FROM trade.broker_reconciliation_snapshot WHERE connection_id=$1',[connection])).rows[0].n,2,
      'management snapshots survive a classified capital-ledger refusal');
    await pool.query('UPDATE trade.execution_account SET account_ready=false WHERE execution_account_id=$1',[account]);
    assert.equal((await persist(order)).capitalReconciliationBlockedCount,1);
    assert.equal(await remaining(),2,'local account readiness loss cannot release an obligation or drop monitoring');
    await pool.query('UPDATE trade.execution_account SET account_ready=true WHERE execution_account_id=$1',[account]);
    assert.equal((await persist(order,[fill])).capitalReconciliationBlockedCount,0);
    assert.equal(await remaining(),1,'only the canceled unfilled contract is released');
    assert.equal((await pool.query(`SELECT count(*)::int n FROM trade.reconciliation_event
      WHERE order_intent_id=$1 AND state='QUARANTINED' AND resolved_at IS NULL`,[intent])).rows[0].n,0,
      'verified recovery resolves only this capital incident, preserving its history');
    await Promise.all([persist(order,[fill]),persist(order,[fill])]);
    assert.equal(await remaining(),1,'duplicate workers cannot release the filled obligation');
    assert.equal((await pool.query('SELECT count(*)::int n FROM trade.fill WHERE broker_order_id=$1',[broker])).rows[0].n,1);
    assert.equal((await pool.query('SELECT fees FROM trade.fill WHERE broker_order_id=$1',[broker])).rows[0].fees,null);
    await persist({...order,symbol:'SPY261120P00500000'});
    await persist({...order,positionIntent:'buy_to_close',side:'buy'});
    assert.equal(await remaining(),1,'wrong contract or side cannot free capital');
    await persist({...order,status:'replaced',replacedBy:'unknown-replacement'});
    assert.equal(await remaining(),1,'replacement uncertainty retains the remaining obligation');
    await persist({...order,orderClass:'mleg',legs:[]});
    assert.equal(await remaining(),1,'native parent quantities cannot release leg exposure');
    const reasons=(await pool.query("SELECT detail_json->>'reason' reason FROM trade.reconciliation_event WHERE order_intent_id=$1",[intent])).rows.map(r=>r.reason);
    assert.ok(reasons.includes('CAPITAL_PACKAGE_RECONCILIATION_REQUIRED'));
    assert.ok(reasons.includes('CAPITAL_TERMINAL_STATUS_UNQUALIFIED'));
    assert.ok(reasons.includes('CAPITAL_TERMINAL_CONTRACT_OR_SIDE_CONFLICT'));
    // Ledger and release share one transaction, so an outer failure restores
    // the claim even after successful inner verification.
    const c=await pool.connect();
    try {
      await c.query('BEGIN');
      await capital.reconcileTerminalInTransaction(c,{eventId:randomUUID(),executionAccountId:account,reservationId,
        observedAt:now(),brokerOrder:{id:order.id,clientOrderId:order.clientOrderId,quantity:2,filledQuantity:1,
          status:'CANCELED',source:'ALPACA_PAPER_GET',responseHash:'d'.repeat(64)}});
      await c.query('ROLLBACK');
    }finally{c.release();}
    assert.equal(await remaining(),1);
    assert.equal(pool.waitingCount,0,'all concurrent transactions drain');
  } finally {
    const c=await pool.connect();
    try{
      await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
      await c.query('DELETE FROM trade.capital_reservation_event WHERE reservation_id=$1',[reservationId]);
      await c.query('DELETE FROM trade.capital_reservation WHERE provider_account_ref_hash=$1',[hash]);
      await c.query('DELETE FROM trade.capital_envelope WHERE provider_account_ref_hash=$1',[hash]);
      await c.query('DELETE FROM trade.reconciliation_event WHERE order_intent_id=$1',[intent]);
      await c.query('DELETE FROM trade.broker_order_event WHERE broker_order_id=$1',[broker]);
      await c.query('DELETE FROM trade.fill WHERE broker_order_id=$1',[broker]);
      await c.query('DELETE FROM trade.broker_activity_fact WHERE connection_id=$1',[connection]);
      await c.query('DELETE FROM trade.broker_reconciliation_snapshot WHERE reconciliation_snapshot_id=ANY($1::uuid[])',[snapshots]);
      await c.query('DELETE FROM trade.broker_order WHERE broker_order_id=$1',[broker]);
      await c.query('DELETE FROM trade.order_intent WHERE order_intent_id=$1',[intent]);
      await c.query('DELETE FROM trade.execution_account WHERE execution_account_id=$1',[account]);
      await c.query('DELETE FROM copy.follower_account WHERE follower_account_id=$1',[connection]);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');await Promise.reject(e);}finally{c.release();await pool.end();}
  }
});
