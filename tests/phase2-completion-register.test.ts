import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('Phase-2 denominator is explicit and cannot inherit a global certificate',()=>{
 const register=JSON.parse(readFileSync('docs/operations/THETA_PHASE2_COMPLETION_REGISTER.json','utf8'));
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
  }
 }
});
