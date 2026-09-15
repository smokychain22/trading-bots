import assert from 'node:assert/strict';
import test from 'node:test';
import {PostgresOperatorControlStore} from '../../src/customer/operator-control.js';
test('operator store rejects stale state and replays one idempotency key',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const connectionString=process.env.TEST_DATABASE_URL;assert.ok(connectionString);const url=new URL(connectionString);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'Disposable local database only');
  const store=new PostgresOperatorControlStore(connectionString);const key=`p2f-test-${Date.now()}`;
  try{const current=await store.current(true);const first=await store.apply({actorRef:'test-operator',command:'PAUSE_NEW_ENTRIES',
    idempotencyKey:key,confirmed:true,requestedAt:new Date().toISOString(),defaultPaused:true,observedStateVersion:current.stateVersion,reason:null});
    const replay=await store.apply({actorRef:'test-operator',command:'PAUSE_NEW_ENTRIES',idempotencyKey:key,confirmed:true,
      requestedAt:new Date().toISOString(),defaultPaused:true,observedStateVersion:current.stateVersion,reason:null});
    assert.equal(replay.stateVersion,first.stateVersion);
    await assert.rejects(()=>store.apply({actorRef:'test-operator',command:'RESUME_NEW_ENTRIES',idempotencyKey:`${key}-stale`,confirmed:true,
      requestedAt:new Date().toISOString(),defaultPaused:true,observedStateVersion:current.stateVersion,reason:null}),/OPERATOR_STATE_VERSION_STALE/);
  }finally{await store.close();}
});
