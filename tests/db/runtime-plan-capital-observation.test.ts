import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { produceRuntimePlanCapitalObservation } from '../../src/execution/runtime-plan-capital-observation.js';
import type { BrokerReconciliationResult } from '../../src/execution/broker-reconciliation-worker.js';
import type { ApprovedMasterPaperActionPlan } from '../../src/execution/master-paper-action-handoff.js';
import { customerStoreFromPool, readOnlyMasterCredentialStoreFromPool } from '../../src/customer/customer-store.js';

test('real PostgreSQL observation identity binds the current master, reconciliation and physical execution account',{
  skip:!process.env.TEST_DATABASE_URL,
},async()=>{
  const connectionString=process.env.TEST_DATABASE_URL;
  assert.ok(connectionString&&['127.0.0.1','localhost'].includes(new URL(connectionString).hostname));
  const pool=new Pool({connectionString,max:1}),client=await pool.connect();
  const at='2026-10-08T13:30:00.000Z',symbol='XLE261120P00057000';
  try {
    await client.query('BEGIN');
    // Upstream fixture only, fully rolled back. The actual identity SELECT
    // executes unchanged. All provider functions below are immediate synthetic
    // reads, so no live provider waits or broker mutation occur in this test.
    await client.query("SET LOCAL session_replication_role='replica'");
    let master=(await client.query("SELECT follower_account_id,provider_account_ref FROM copy.follower_account WHERE account_role='MASTER_THETA_PAPER'")).rows[0];
    if(!master) {
      master={follower_account_id:randomUUID(),provider_account_ref:`synthetic-${randomUUID()}`};
      await client.query(`INSERT INTO copy.follower_account(follower_account_id,workspace_id,provider_account_ref,
        oauth_secret_ref,account_role,participation) VALUES($1,$2,$3,'synthetic','MASTER_THETA_PAPER','STOP_NEW_TRADES_MANAGE_EXISTING')`,
      [master.follower_account_id,randomUUID(),master.provider_account_ref]);
    }
    await client.query("UPDATE copy.follower_account SET environment='PAPER',connection_status='CONNECTED',account_ready=true WHERE follower_account_id=$1",[master.follower_account_id]);
    const execution=(await client.query(`INSERT INTO trade.execution_account(execution_account_id,account_kind,
      provider_account_ref_hash,provider_account_ref_masked,account_ready) VALUES($1,'MASTER_API_KEY',
      encode(digest($2,'sha256'),'hex'),'synthetic',true) ON CONFLICT(provider_account_ref_hash)
      DO UPDATE SET account_ready=true RETURNING execution_account_id`,[randomUUID(),master.provider_account_ref])).rows[0];
    const snapshotId=randomUUID();
    await client.query(`INSERT INTO trade.broker_reconciliation_snapshot(reconciliation_snapshot_id,connection_id,
      correlation_id,environment,broker_host,observed_at,data_quality,payload_hash)
      VALUES($1,$2,$3,'PAPER','paper-api.alpaca.markets',$4,'GOOD',$5)`,
    [snapshotId,master.follower_account_id,randomUUID(),at,'a'.repeat(64)]);
    const input={pool:{query:client.query.bind(client)} as unknown as Pool,
      alpaca:{tradingApiBase:'https://paper-api.alpaca.markets',marketDataApiBase:'https://data.alpaca.markets',apiKey:'synthetic',apiSecret:'synthetic'},
      plan:{executionAccountId:execution.execution_account_id,symbol,underlying:'XLE'} as ApprovedMasterPaperActionPlan,
      reconciliation:{snapshotId,dataQuality:'GOOD',localOnlyIntentCount:0,capitalReconciliationBlockedCount:0,
        brokerFactImpactSummary:{currentEconomicExposureCount:1,currentReconciliationDefectCount:0,unknownCurrentImpactCount:0}} as BrokerReconciliationResult,
      now:()=>at};
    const providers={account:async()=>({providerAccountId:master.provider_account_ref,requestedAt:at,accountBlocked:false,
      snapshot:{accountStatus:'ACTIVE',tradingBlocked:false,receivedAt:at} as Awaited<ReturnType<typeof import('../../src/theta/alpaca-provider.js').fetchMasterAccountEvidence>>['snapshot'],
      capitalDecimals:{equity:'100000',cash:'100000',optionsBuyingPower:'94300'}}),
      positions:async()=>[],orders:async()=>[],contract:async()=>({symbol,strikePrice:57,expirationDate:'2026-11-20',
        optionType:'PUT' as const,multiplier:100,underlyingSymbol:'XLE',rootSymbol:'XLE',
        deliverables:[{type:'equity',symbol:'XLE',amount:100,allocationPercentage:100}]})};
    assert.equal((await produceRuntimePlanCapitalObservation(input,providers)).state,'READY');
    const tokenId=randomUUID(),customerId=randomUUID();
    await client.query(`INSERT INTO copy.alpaca_oauth_token(token_secret_id,customer_id,key_ref,ciphertext,iv,auth_tag,scope)
      VALUES($1,$2,'synthetic',$3,$4,$5,'synthetic')`,[tokenId,customerId,Buffer.from('synthetic'),Buffer.alloc(12),Buffer.alloc(16)]);
    await client.query(`UPDATE copy.follower_account SET token_secret_id=$1,customer_id=$2,
      connection_method='PAPER_API_KEY_PRIVATE_BETA' WHERE follower_account_id=$3`,[tokenId,customerId,master.follower_account_id]);
    const credentialPool={query:client.query.bind(client)} as unknown as Pool;
    const observed=await readOnlyMasterCredentialStoreFromPool(credentialPool).getMasterCredential();
    assert.equal(observed?.providerAccountRef,master.provider_account_ref);
    assert.equal((await client.query('SELECT last_used_at FROM copy.alpaca_oauth_token WHERE token_secret_id=$1',[tokenId])).rows[0].last_used_at,null);
    const runtimeCredential=await customerStoreFromPool(credentialPool).getMasterCredential();
    assert.deepEqual(runtimeCredential,observed,'runtime and diagnostic must select identical encrypted master records');
    assert.ok((await client.query('SELECT last_used_at FROM copy.alpaca_oauth_token WHERE token_secret_id=$1',[tokenId])).rows[0].last_used_at instanceof Date);
    const wrong=await produceRuntimePlanCapitalObservation({...input,plan:{...input.plan,executionAccountId:randomUUID()}},providers);
    assert.deepEqual(wrong,{state:'BLOCKED',reasons:['CAPITAL_ACCOUNT_RECONCILIATION_IDENTITY_UNQUALIFIED']});
    await client.query("UPDATE copy.follower_account SET account_ready=false WHERE follower_account_id=$1",[master.follower_account_id]);
    assert.equal((await produceRuntimePlanCapitalObservation(input,providers)).state,'BLOCKED');
  } finally {try{await client.query('ROLLBACK');}finally{client.release();await pool.end();}}
});
