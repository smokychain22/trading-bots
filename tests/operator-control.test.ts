import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import { applyOperatorControl,PostgresOperatorControlStore,type OperatorControlState } from '../src/customer/operator-control.js';

const initial:OperatorControlState={newEntriesPaused:false,emergencyExecutionLock:false,brokerSubmissionBlocked:false,
  reconciliationEnabled:true,managementEnabled:true,source:'DEFAULT',asOf:null,stateVersion:0};

test('persisted missing or contradictory execution controls fail closed and always release the read client',async()=>{
  const good={resulting_state_json:{newEntriesPaused:true,emergencyExecutionLock:false,brokerSubmissionBlocked:true},
    requested_at:new Date('2026-09-30T15:00:00Z'),state_version:'1'};
  for(const row of [good,{...good,resulting_state_json:{}},{...good,resulting_state_json:null},
    {...good,resulting_state_json:{...good.resulting_state_json,newEntriesPaused:'false'}},
    {...good,resulting_state_json:{...good.resulting_state_json,brokerSubmissionBlocked:false}},
    {...good,state_version:''},{...good,state_version:null},{...good,requested_at:undefined}]){
    let releases=0;
    const client=Object.assign(new EventEmitter(),{query:async()=>({rows:[row],rowCount:1}),release:()=>{releases++;}});
    const pool={connect:async()=>client} as unknown as Pool;
    const store=new PostgresOperatorControlStore(pool);
    if(row===good){const state=await store.current(true);assert.equal(state.newEntriesPaused,true);assert.equal(state.stateVersion,1);}
    else await assert.rejects(store.current(true),/OPERATOR_CONTROL_PERSISTED_STATE_INVALID/);
    assert.equal(releases,1);
  }
});

test('idempotent control replay cannot bypass persisted-state validation',async()=>{
  const queries:string[]=[];let releases=0;
  const client=Object.assign(new EventEmitter(),{query:async(sql:string)=>{
    queries.push(sql);return sql.includes('WHERE idempotency_key')?{rows:[{resulting_state_json:{}}],rowCount:1}:{rows:[],rowCount:0};
  },release:()=>{releases++;}});
  const store=new PostgresOperatorControlStore({connect:async()=>client} as unknown as Pool);
  await assert.rejects(store.apply({actorRef:'synthetic',command:'PAUSE_NEW_ENTRIES',idempotencyKey:'synthetic-idempotency',
    confirmed:true,requestedAt:'2026-09-30T15:00:00Z',defaultPaused:true,observedStateVersion:0,reason:null}),
  /OPERATOR_CONTROL_PERSISTED_STATE_INVALID/);
  assert.ok(queries.includes('ROLLBACK'));assert.equal(queries.includes('COMMIT'),false);assert.equal(releases,1);
});
test('pause blocks new broker submissions while management and reconciliation remain active',()=>{
  const state=applyOperatorControl(initial,'PAUSE_NEW_ENTRIES','2026-09-15T14:00:00Z');
  assert.equal(state.brokerSubmissionBlocked,true);assert.equal(state.managementEnabled,true);assert.equal(state.reconciliationEnabled,true);
});
test('emergency lock cannot be cleared by ordinary resume',()=>{
  const locked=applyOperatorControl(initial,'EMERGENCY_EXECUTION_LOCK','2026-09-15T14:00:00Z');
  const resumed=applyOperatorControl(locked,'RESUME_NEW_ENTRIES','2026-09-15T14:01:00Z');
  assert.equal(resumed.emergencyExecutionLock,true);assert.equal(resumed.brokerSubmissionBlocked,true);
});
test('dedicated emergency clear keeps submissions blocked and increments state version',()=>{
  const locked=applyOperatorControl(initial,'EMERGENCY_EXECUTION_LOCK','2026-09-15T14:00:00Z');
  const cleared=applyOperatorControl(locked,'CLEAR_EMERGENCY_LOCK','2026-09-15T14:01:00Z');
  assert.equal(cleared.emergencyExecutionLock,false);assert.equal(cleared.newEntriesPaused,true);
  assert.equal(cleared.brokerSubmissionBlocked,true);assert.equal(cleared.stateVersion,2);
});
