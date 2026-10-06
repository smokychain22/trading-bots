import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LocalEvidenceSpool, brokerMutationAllowedForEvidence, type LocalEvidenceBackfillTarget,
  type LocalEvidenceEnvelope } from '../src/theta/local-evidence-spool.js';

const SHA='1234567890abcdef1234567890abcdef12345678';
const input=(sequenceNumber:number,payload:unknown={stage:'Q_READY'})=>({
  decisionCycleId:'cycle-1',snapshotId:'snapshot-1',decisionAsOf:'2026-09-24T14:00:00.000Z',sourceSha:SHA,
  workerId:'worker-1',sequenceNumber,payloadType:sequenceNumber===0?'ACCOUNT_READY':'Q_READY',payload,
  providerObservedAt:{ALPACA:'2026-09-24T14:00:00.000Z'},receivedAt:'2026-09-24T14:00:01.000Z',
  computedAt:'2026-09-24T14:00:02.000Z',
});

function harness(){
  const root=mkdtempSync(join(tmpdir(),'theta-spool-'));
  const spool=new LocalEvidenceSpool(join(root,'spool.sqlite'));
  return {spool,cleanup:()=>{spool.close();rmSync(root,{recursive:true,force:true});}};
}

test('durable spool maintains a restart-safe hash chain and forbids local-only broker mutation',()=>{
  const {spool,cleanup}=harness();
  const first=spool.append(input(0));
  const second=spool.append(input(1));
  assert.equal(first.previousEnvelopeHash,null);
  assert.equal(second.previousEnvelopeHash,first.envelopeHash);
  assert.equal(spool.verify().valid,true);
  assert.equal(brokerMutationAllowedForEvidence(second),false);
  cleanup();
});

test('spool survives process-style reopen and returns the same idempotent envelope',()=>{
  const root=mkdtempSync(join(tmpdir(),'theta-spool-reopen-'));
  const path=join(root,'spool.sqlite');
  const firstSpool=new LocalEvidenceSpool(path);
  const first=firstSpool.append(input(0));
  firstSpool.close();
  const reopened=new LocalEvidenceSpool(path);
  try{
    const duplicate=reopened.append({...input(0),envelopeId:first.envelopeId});
    assert.equal(duplicate.envelopeHash,first.envelopeHash);
    assert.equal(reopened.pending().length,1);
  }finally{reopened.close();rmSync(root,{recursive:true,force:true});}
});

test('backfill is idempotent, verifies ambiguous writes, and unlocks no broker mutation itself',async()=>{
  const {spool,cleanup}=harness();
  try{
    const one=spool.append(input(0));
    const two=spool.append(input(1));
    const records=new Map<string,LocalEvidenceEnvelope>();
    const target:LocalEvidenceBackfillTarget={
      hasEnvelope:async(id,hash)=>records.get(id)?.envelopeHash===hash,
      insertEnvelope:async(envelope)=>{records.set(envelope.envelopeId,envelope);},
    };
    const first=await spool.backfill(target,SHA);
    assert.deepEqual(first,{attempted:2,inserted:2,alreadyPresent:0,conflicts:0,remaining:0});
    const second=await spool.backfill(target,SHA);
    assert.deepEqual(second,{attempted:0,inserted:0,alreadyPresent:0,conflicts:0,remaining:0});
    assert.equal(records.size,2);
    assert.equal(brokerMutationAllowedForEvidence(one),false);
    assert.equal(brokerMutationAllowedForEvidence(two),false);
    const reloaded=spool.listByPayloadType('Q_READY');
    assert.equal(reloaded.length,1);
    assert.equal(reloaded[0]?.postgresPersistenceState,'BACKFILLED_POSTGRES');
    assert.ok(reloaded[0]);
    assert.equal(brokerMutationAllowedForEvidence(reloaded[0]),false);
  }finally{cleanup();}
});

test('identity conflicts and secrets fail closed',()=>{
  const {spool,cleanup}=harness();
  try{
    spool.append(input(0));
    assert.throws(()=>spool.append(input(0,{stage:'DIFFERENT'})),/IDENTITY_CONFLICT/);
    assert.throws(()=>spool.append(input(1,{apiKey:'secret'})),/SECRET_KEY_REJECTED/);
    assert.throws(()=>spool.append(input(2,{value:'postgres://user:password@example.test/db'})),/SECRET_VALUE_REJECTED/);
  }finally{cleanup();}
});

test('database circuit requires two successful probes before HEALTHY',()=>{
  const {spool,cleanup}=harness();
  try{
    assert.equal(spool.recordDatabaseFailure('2026-09-24T14:01:00Z',false),'SPOOL_MODE');
    assert.equal(spool.recordDatabaseProbeSuccess('2026-09-24T14:02:00Z'),'RECOVERING');
    assert.equal(spool.recordDatabaseProbeSuccess('2026-09-24T14:03:00Z'),'HEALTHY');
    assert.equal(spool.circuitState().state,'HEALTHY');
  }finally{cleanup();}
});

test('spool returns bounded typed history without treating corrupt rows as evidence',()=>{
  const {spool,cleanup}=harness();
  try{
    spool.append({...input(0),payloadType:'RISK_OBSERVATIONS_READY',payload:{observations:[{id:'one'}]}});
    spool.append({...input(1),payloadType:'Q_READY'});
    const rows=spool.listByPayloadType('RISK_OBSERVATIONS_READY');
    assert.equal(rows.length,1);
    assert.equal(rows[0]?.payloadType,'RISK_OBSERVATIONS_READY');
    assert.throws(()=>spool.listByPayloadType('bad payload type'),/PAYLOADTYPE_INVALID/);
  }finally{cleanup();}
});

test('NO UNBOUNDED LOCAL PATH: drained cycles leave the laptop after the retention window; pending cycles never do; the outage spool has a byte cap', async ()=>{
  const {spool,cleanup}=harness();
  try{
    spool.append(input(0)); spool.append(input(1));
    spool.append({...input(0),decisionCycleId:'cycle-pending'});
    const durable=new Set<string>();
    const target:LocalEvidenceBackfillTarget={hasEnvelope:async(id)=>durable.has(id),insertEnvelope:async(envelope:LocalEvidenceEnvelope)=>{
      if(envelope.decisionCycleId==='cycle-pending')throw new Error('DB_DOWN');durable.add(envelope.envelopeId);}};
    await assert.rejects(()=>spool.backfill(target,SHA),/DB_DOWN/);
    // inside the window nothing is deleted, and a cycle with a pending envelope is never deleted
    assert.equal(spool.pruneDurable(7,new Date('2026-09-25T00:00:00.000Z')),0);
    const removed=spool.pruneDurable(7,new Date('2099-01-01T00:00:00.000Z'));
    assert.equal(removed,2,'only the fully durable cycle-1 leaves');
    assert.equal(spool.pending().length,1);
    assert.equal(spool.pending()[0]?.decisionCycleId,'cycle-pending');
    assert.equal(spool.verify().valid,true,'whole-cycle deletion keeps the remaining hash chains intact');
  }finally{cleanup();}
  const root=mkdtempSync(join(tmpdir(),'theta-spool-cap-'));
  const tiny=new LocalEvidenceSpool(join(root,'spool.sqlite'),48*1024);
  try{
    assert.throws(()=>{for(let i=0;i<400;i+=1)tiny.append({...input(i),payload:{stage:'Q_READY',filler:'x'.repeat(500)}});},/LOCAL_EVIDENCE_SPOOL_CAP_REACHED/);
  }finally{tiny.close();rmSync(root,{recursive:true,force:true});}
});
