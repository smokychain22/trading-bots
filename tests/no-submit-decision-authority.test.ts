import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { classifyNoSubmitDecisionAuthority } from '../src/theta/no-submit-decision-authority.js';
import { brokerMutationAllowedForEvidence, type LocalEvidenceEnvelope } from '../src/theta/local-evidence-spool.js';

for (const computedAction of ['GLOBAL_WAIT','OPEN_FULL',null]) {
  test(`database failure preserves ${computedAction} only as provisional evidence`,()=>{
    const result=classifyNoSubmitDecisionAuthority({databaseFailure:'POSTGRES_CONNECTION_TERMINATED',
      scanComplete:true,computedAction});
    assert.equal(result.outcome,'INFRASTRUCTURE_DEFERRED');
    assert.equal(result.canonicalAction,null);
    assert.equal(result.provisionalAction,computedAction);
    assert.equal(result.canonicalPersistence,false);
    assert.equal(result.exitCode,1);
    assert.equal(result.executionEligible,false);
  });
}
test('incomplete enumeration cannot certify a global WAIT',()=>{
  const result=classifyNoSubmitDecisionAuthority({databaseFailure:null,scanComplete:false,computedAction:'GLOBAL_WAIT'});
  assert.equal(result.outcome,'PROVIDER_DEFERRED');
  assert.equal(result.canonicalAction,null);
  assert.equal(result.exitCode,1);
});
test('a complete persisted scan may report WAIT but still cannot authorize a broker action',()=>{
  const result=classifyNoSubmitDecisionAuthority({databaseFailure:null,scanComplete:true,computedAction:'GLOBAL_WAIT'});
  assert.equal(result.outcome,'COMPLETE_DECISION');
  assert.equal(result.canonicalAction,'GLOBAL_WAIT');
  assert.equal(result.exitCode,0);
  assert.equal(result.executionEligible,false);
});
test('a complete scan without a computed action cannot claim complete decision evidence',()=>{
  const result=classifyNoSubmitDecisionAuthority({databaseFailure:null,scanComplete:true,computedAction:null});
  assert.equal(result.outcome,'SYSTEM_HOLD');
  assert.equal(result.primaryStop,'CANONICAL_ACTION_MISSING');
  assert.equal(result.exitCode,1);
  assert.equal(result.canonicalPersistence,false);
});
test('backfilled or persisted local evidence never becomes broker authority',()=>{
  for(const state of ['PERSISTED_POSTGRES','BACKFILLED_POSTGRES','SPOOLED_LOCAL_PENDING_DB','CORRUPT'] as const){
    assert.equal(brokerMutationAllowedForEvidence({postgresPersistenceState:state} as LocalEvidenceEnvelope),false);
  }
});

test('a required provider failure or SYSTEM_HOLD cannot be certified by complete enumeration',()=>{
  for(const action of ['WAIT','GLOBAL_WAIT','ACTION_READY']){
    const result=classifyNoSubmitDecisionAuthority({databaseFailure:null,scanComplete:true,
      computedAction:action,requiredProviderBlockers:['ALPACA_CORPORATE_ACTION_READ_FAILED']});
    assert.equal(result.outcome,'PROVIDER_DEFERRED');
    assert.equal(result.canonicalAction,null);
    assert.equal(result.provisionalAction,action);
    assert.equal(result.exitCode,1);
  }
  const hold=classifyNoSubmitDecisionAuthority({databaseFailure:null,scanComplete:true,computedAction:'SYSTEM_HOLD'});
  assert.equal(hold.outcome,'SYSTEM_HOLD');
  assert.equal(hold.canonicalPersistence,false);
});

test('probe source preserves schema authority and original failure before fallback',()=>{
  // Wiring assertion only. This is not a claim of a live broker/database run.
  const source=readFileSync(new URL('../tools/theta-no-submit-probe.ts',import.meta.url),'utf8');
  assert.match(source,/assessRuntimeSchemaCompatibility\(\{/);
  assert.match(source,/const schema = schemaCompatibility\.observedHead/);
  assert.match(source,/spoolEvidence\('PROVIDER_STATE_READY',\{marketOpen:clock.isOpen/);
  assert.ok(source.indexOf("spoolEvidence('CYCLE_FAILED',{probeStage:failedProbeStage")
    < source.indexOf("probeStage='DATABASE_INDEPENDENT_PROVIDER_OBSERVATION'"));
  assert.doesNotMatch(source,/canonicalAction:symbol\.canonicalAction/);
  assert.doesNotMatch(source,/WHERE version IN/);
  assert.equal(source.match(/observe:observeDatabaseRead\(probeStage\)/g)?.length,2);
  assert.match(source,/spoolEvidence\('DATABASE_CLIENT_OBSERVED'/);
  assert.match(source,/dnsMs:null,tcpMs:null,tlsMs:null,pgStartupMs:null/);
});
