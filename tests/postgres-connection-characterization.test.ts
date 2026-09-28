import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFreshPostgresAttemptReceipt, classifyFreshPostgresFailurePhase,
  executeFreshPostgresLifecycle, summarizeFreshPostgresCampaign,
  type FreshPostgresLifecycleBoundaries } from '../src/theta/postgres-connection-characterization.js';

const boundaries=(override:Partial<FreshPostgresLifecycleBoundaries>={}):FreshPostgresLifecycleBoundaries=>({
  connectStartedAtMs:0,dnsEndedAtMs:5,tcpConnectedAtMs:15,tlsStartedAtMs:16,tlsSecureAtMs:25,
  postgresReadyAtMs:40,firstQueryStartedAtMs:41,firstQueryEndedAtMs:45,closeStartedAtMs:46,closeEndedAtMs:47,
  sslExpected:true,...override});

test('fresh connection phases keep DNS TCP TLS and PostgreSQL startup distinct',()=>{
  assert.equal(classifyFreshPostgresFailurePhase(boundaries({dnsEndedAtMs:null,tcpConnectedAtMs:null})),'DNS');
  assert.equal(classifyFreshPostgresFailurePhase(boundaries({tcpConnectedAtMs:null})),'TCP');
  assert.equal(classifyFreshPostgresFailurePhase(boundaries({tlsSecureAtMs:null})),'TLS');
  assert.equal(classifyFreshPostgresFailurePhase(boundaries({postgresReadyAtMs:null})),'POSTGRES_STARTUP');
  assert.equal(classifyFreshPostgresFailurePhase(boundaries({firstQueryEndedAtMs:null})),'FIRST_QUERY');
});

test('unavailable DNS and TLS boundaries remain null rather than fabricated',()=>{
  const receipt=buildFreshPostgresAttemptReceipt({attemptId:1,observedAt:'2026-09-28T00:00:00.000Z',
    boundaries:boundaries({dnsEndedAtMs:null,tlsStartedAtMs:null,tlsSecureAtMs:null,sslExpected:false}),
    dnsFailed:false,tlsFailed:false,errorCode:null,postmasterStart:'stable',databaseConnections:2,
    activeConnections:1,idleConnections:1,idleInTransactionConnections:0,lockWaitingConnections:0,
    longTransactionConnections:0,backendPid:1});
  assert.equal(receipt.dnsState,'UNAVAILABLE');
  assert.equal(receipt.dnsMs,null);
  assert.equal(receipt.tcpIncludesDns,true);
  assert.equal(receipt.tlsState,'NOT_APPLICABLE');
  assert.equal(receipt.tlsMs,null);
});

test('slow query after a successful connection is not a connection establishment failure',()=>{
  const receipt=buildFreshPostgresAttemptReceipt({attemptId:1,observedAt:'2026-09-28T00:00:00.000Z',
    boundaries:boundaries({postgresReadyAtMs:40,firstQueryStartedAtMs:41,firstQueryEndedAtMs:null,
      closeStartedAtMs:5_050,closeEndedAtMs:5_051}),dnsFailed:false,tlsFailed:false,
    errorCode:'POSTGRES_57014',postmasterStart:null,databaseConnections:null,activeConnections:null,
    idleConnections:null,idleInTransactionConnections:null,lockWaitingConnections:null,
    longTransactionConnections:null,backendPid:null});
  assert.equal(receipt.totalConnectionMs,40);
  assert.equal(receipt.failurePhase,'FIRST_QUERY');
});

test('client close runs after physical connection failure',async()=>{
  let closes=0;
  const result=await executeFreshPostgresLifecycle({connect:async()=>{throw new Error('connect failed');},
    firstQuery:async()=>1,close:async()=>{closes++;}});
  assert.equal(closes,1);
  assert.equal(result.queryResult,null);
  assert.match(String(result.error),/connect failed/);
});

test('campaign summary uses meaningful percentile minimums and failure classes',()=>{
  const attempts=Array.from({length:20},(_,index)=>buildFreshPostgresAttemptReceipt({attemptId:index+1,
    observedAt:`2026-09-28T00:00:${String(index).padStart(2,'0')}.000Z`,
    boundaries:boundaries({postgresReadyAtMs:100+index*10,firstQueryStartedAtMs:300,firstQueryEndedAtMs:301,
      closeStartedAtMs:302,closeEndedAtMs:303}),dnsFailed:false,tlsFailed:false,errorCode:null,
    postmasterStart:'stable',databaseConnections:2,activeConnections:1,idleConnections:1,
    idleInTransactionConnections:0,lockWaitingConnections:0,longTransactionConnections:0,backendPid:index+1}));
  const summary=summarizeFreshPostgresCampaign(attempts);
  assert.equal(summary.sampleN,20);
  assert.equal(summary.p95Ms,280);
  assert.equal(summary.p99Ms,null);
  assert.equal(summary.postmasterStable,true);
});
