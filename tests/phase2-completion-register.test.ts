import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { certifyExecutedRequirement, evidenceSourceHash, type ReviewedRequirementBinding } from '../src/operations/executed-requirement-evidence.js';

test('Phase-2 denominator is explicit and cannot inherit a global certificate',()=>{
 const register=JSON.parse(readFileSync('docs/operations/THETA_PHASE2_COMPLETION_REGISTER.json','utf8'));
 const bindings=JSON.parse(readFileSync('docs/operations/THETA_PHASE2_REVIEWED_TEST_BINDINGS.json','utf8')) as ReviewedRequirementBinding[];
 const { artifactHash, ...body }=JSON.parse(readFileSync('docs/operations/evidence/THETA_PHASE2_EXECUTED_TESTS.json','utf8'));
 assert.equal(artifactHash,createHash('sha256').update(JSON.stringify(body)).digest('hex'));
 const rows=register.requirements as Record<string,unknown>[];
 assert.equal(new Set(rows.map(r=>r.ID)).size,rows.length);
 assert.equal(register.PHASE2_TOTAL,rows.length);
 const code=rows.filter(r=>r.CODE_SOLVABLE===true);
 assert.equal(register.PHASE2_CODE_SOLVABLE,code.length);
 const complete=code.filter(r=>r.CLOSURE_STATE==='CLOSED_ENGINEERING');
 assert.equal(register.PHASE2_CODE_SOLVABLE_COMPLETE,complete.length);
 assert.equal(register.PHASE2_CODE_SOLVABLE_REMAINING,code.length-complete.length);
 for(const row of rows){
  for(const field of ['ID','AREA','REQUIREMENT','CURRENT_STATUS','SOURCE_AUTHORITY','TEST_AUTHORITY',
   'RUNTIME_EVIDENCE','BLOCKER_CLASS','CODE_SOLVABLE','CONFIG_SOLVABLE','OFFLINE_TESTABLE',
   'CURRENT_MARKET_REQUIRED','PROVIDER_LIMITED','OWNER_GATED','FIX_REQUIRED','FIX_COMMIT','TEST_RESULT','CLOSURE_STATE']){
   assert.ok(Object.hasOwn(row,field),`${row.ID}:${field}`);
  }
  for(const file of [...row.SOURCE_AUTHORITY as string[],...row.TEST_AUTHORITY as string[]]){
   assert.ok(existsSync(file),`${row.ID}:missing ${file}`);
  }
  if(row.CLOSURE_STATE==='CLOSED_ENGINEERING'){
   assert.equal(typeof row.TEST_RESULT,'object',`${row.ID}:require executed evidence, not a label`);
   const result=row.TEST_RESULT as Record<string,unknown>;
   assert.equal(result.failed,0);assert.ok(Number(result.passed)>0);
   assert.ok(result.command&&result.artifactHash&&result.sourceHashes);
   assert.equal(result.artifactHash,artifactHash,`${row.ID}:wrong artifact`);
   assert.equal(body.executionSucceeded,true);
   const binding=bindings.find(binding=>binding.id===row.ID);
   assert.ok(binding,`${row.ID}:review missing`);
   const recorded=body.results.find((record: { requirementId: string })=>record.requirementId===row.ID);
   assert.ok(recorded,`${row.ID}:executed evidence missing`);
   const currentHashes=Object.fromEntries(Object.keys(recorded.sourceHashes)
    .map(path=>[path,evidenceSourceHash(readFileSync(path,'utf8'))]));
   assert.deepEqual(recorded.sourceHashes,currentHashes,`${row.ID}:source changed since proof`);
   assert.deepEqual(recorded,certifyExecutedRequirement(binding,recorded.executedTests,currentHashes));
   assert.equal(recorded.state,'PASS');
   assert.equal(recorded.runtimeProven,false);
   assert.deepEqual(result.sourceHashes,recorded.sourceHashes);
   assert.equal(result.passed,recorded.passed);
   if(['2.2.FAULT_MATRIX','2.4.FRESH_CYCLE'].includes(String(row.ID))){
    const reference=row.DISPOSABLE_DB_EVIDENCE as Record<string,string>;
    assert.ok(reference,`${row.ID}:disposable execution required`);
    const {artifactHash:dbHash,...dbBody}=JSON.parse(readFileSync(reference.artifactPath,'utf8'));
    assert.equal(dbHash,createHash('sha256').update(JSON.stringify(dbBody)).digest('hex'));
    assert.equal(dbHash,reference.artifactHash);
    assert.equal(dbBody.sourceSha,reference.sourceSha);
    assert.equal(dbBody.ciRun,reference.ciRun);
    assert.equal(dbBody.currentWorkerProven,false);
    const proof=dbBody.runs.find((run:{binding:ReviewedRequirementBinding})=>run.binding.id===row.ID);
    assert.ok(proof,`${row.ID}:reviewed disposable case binding required`);
    const hashes=Object.fromEntries(Object.keys(proof.result.sourceHashes)
     .map(path=>[path,evidenceSourceHash(readFileSync(path,'utf8'))]));
    assert.deepEqual(proof.result.sourceHashes,hashes);
    assert.deepEqual(proof.result,certifyExecutedRequirement(proof.binding,proof.result.executedTests,hashes));
    assert.equal(proof.result.state,'PASS');
   }
  }
 }
});
