import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Pool } from 'pg';
import { ensureMasterShadowContext } from '../src/research/master-shadow-context.js';
import { PostgresCheckedOutClientLostError } from '../src/theta/runtime-postgres-client.js';
import { loadPersistenceContext } from '../src/research/production-shadow-runtime.js';

test('actual persistence-context path reads normalized broker evidence before acquiring a transaction',async()=>{
  const order:string[]=[],released:boolean[]=[],inserts:unknown[][]=[];
  const query=async(sql:string,values:unknown[]=[])=>{
    order.push(sql);
    if(sql.includes('FROM copy.follower_account'))return {rowCount:1,rows:[{workspace_id:'workspace',
      token_secret_id:'synthetic-ref',provider_account_ref:'synthetic-id',connection_status:'CONNECTED',
      disconnected_at:null,account_status:'ACTIVE'}]};
    if(sql.includes('SELECT provider_connection_id'))return {rowCount:1,rows:[{provider_connection_id:'connection'}]};
    if(sql.includes('SELECT account_id'))return {rowCount:1,rows:[{account_id:'account'}]};
    if(sql.includes('AS id,config_hash'))return {rowCount:1,rows:[{id:values[0],config_hash:values[3]}]};
    if(sql.includes('SELECT bot_instance_id'))return {rowCount:1,rows:[{bot_instance_id:'bot'}]};
    if(sql.includes('INSERT INTO trade.account_snapshot')){
      inserts.push(values);return {rowCount:1,rows:[{account_snapshot_id:42}]};
    }
    return {rowCount:0,rows:[]};
  };
  const client=Object.assign(new EventEmitter(),{query,release:(destroy=false)=>{released.push(destroy);order.push('RELEASE');}});
  const pool={options:{max:1,connectionTimeoutMillis:8000},totalCount:0,idleCount:0,waitingCount:0,
    connect:async()=>{order.push('ACQUIRE');return client;},query} as unknown as Pool;
  let tick=0;
  const result=await loadPersistenceContext(pool,{tradingApiBase:'https://paper-api.alpaca.markets',
    marketDataApiBase:'https://data.alpaca.markets',apiKey:'SYNTHETIC',apiSecret:'SYNTHETIC',
    fetchImpl:async()=>{order.push('BROKER_GET');return new Response(JSON.stringify({id:'synthetic-id',
      equity:'',cash:false,buying_power:'100',options_buying_power:'0',options_trading_level:2}));}},
    ()=>tick++===0?'2026-09-30T15:00:00.000Z':'2026-09-30T15:00:02.000Z');
  assert.equal(result.accountSnapshotId,42);
  assert.deepEqual(order.slice(0,3),['BROKER_GET','ACQUIRE','BEGIN']);
  assert.deepEqual(inserts[0],['account',null,null,100,0,2,'2026-09-30T15:00:02.000Z']);
  assert.ok(order.indexOf('RELEASE')<order.findIndex(sql=>sql.includes('INSERT INTO trade.account_snapshot')));
  assert.deepEqual(released,[false]);
});

test('failed master identity closes the transaction and releases, failed rollback discards',async()=>{
  for(const rollbackFails of [false,true]){
    const statements:string[]=[],released:boolean[]=[];
    const client=Object.assign(new EventEmitter(),{query:async(sql:string)=>{
      statements.push(sql);
      if(sql==='ROLLBACK'&&rollbackFails)throw new Error('synthetic rollback failure');
      return {rows:[],rowCount:0};
    },release:(destroy=false)=>released.push(destroy)});
    let acquired=0;
    const pool={options:{max:1,connectionTimeoutMillis:8000},totalCount:0,idleCount:0,waitingCount:0,
      connect:async()=>{acquired++;return client;}} as unknown as Pool;
    await assert.rejects(ensureMasterShadowContext(pool,'synthetic-id'),rollbackFails
      ?PostgresCheckedOutClientLostError:/MASTER_THETA_PAPER_NOT_DESIGNATED/);
    assert.equal(acquired,1);assert.equal(statements[0],'BEGIN');
    assert.equal(statements.at(-1),'ROLLBACK');assert.deepEqual(released,[rollbackFails]);
    assert.equal(client.listenerCount('error'),0);
  }
});
