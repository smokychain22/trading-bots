import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { certifyExecutedRequirement, evidenceSourceHash,
  type ReviewedRequirementBinding, type ExecutedTestEvent } from '../src/operations/executed-requirement-evidence.js';

// Review bindings are intentional source/behavior assertions. Test execution
// supplies evidence for them, it does not invent coverage from a global PASS.
const bindings=JSON.parse(readFileSync('docs/operations/THETA_PHASE2_REVIEWED_TEST_BINDINGS.json','utf8')) as ReviewedRequirementBinding[];
const files=[...new Set(bindings.flatMap(binding=>binding.tests.map(test=>test.file)))].sort();
const sourcePaths=[...new Set(bindings.flatMap(binding=>[...binding.sources,...binding.tests.map(test=>test.file)]))].sort();
const captureHashes=()=>Object.fromEntries(sourcePaths.map(file=>[file,evidenceSourceHash(readFileSync(file,'utf8'))]));
const hashes=captureHashes();
const environment={...process.env};
for(const key of Object.keys(environment))if(/(?:^TEST_DATABASE_URL$|^THETA_.*TEST.*DATABASE|^THETA_RUNTIME_FAULT_DATABASE_URL$)/.test(key))delete environment[key];
if(files.some(file=>!/^tests\/[a-z0-9-]+\.test\.ts$/.test(file)))throw new Error('OFFLINE_TEST_FILE_REQUIRED');
const child=spawnSync(process.execPath,['--import','tsx','--test','--test-reporter=./tools/theta-test-evidence-reporter.mjs',...files],
  {encoding:'utf8',timeout:240_000,maxBuffer:16*1024*1024,env:environment});
const events:ExecutedTestEvent[]=child.stdout.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
if(JSON.stringify(hashes)!==JSON.stringify(captureHashes()))throw new Error('SOURCE_CHANGED_DURING_EVIDENCE_EXECUTION');
const results=bindings.map(binding=>certifyExecutedRequirement(binding,events,hashes));
const revision=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
if(revision.status!==0||!/^[a-f0-9]{40}$/.test(revision.stdout.trim()))throw new Error('SOURCE_REVISION_UNAVAILABLE');
const body={version:'theta-phase2-executed-evidence-v1',observedAt:new Date().toISOString(),
  checkoutHead:revision.stdout.trim(),identityAuthority:'PER_FILE_HASHES_INCLUDE_UNCOMMITTED_CHANGES',
  command:'node --import tsx tools/theta-phase2-executed-evidence.ts',
  testCommand:[process.execPath,'--import','tsx','--test','--test-reporter=./tools/theta-test-evidence-reporter.mjs',...files].slice(1),
  executionSucceeded:child.status===0&&!child.error, results,
  passed:events.filter(event=>event.state==='PASS').length,failed:events.filter(event=>event.state==='FAIL').length,
  skipped:events.filter(event=>event.state==='SKIPPED'||event.state==='TODO').length,
  brokerMutations:0,providerRequests:0,scope:'DETERMINISTIC_SOURCE_TESTS_NOT_L7'};
const receipt={...body,artifactHash:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
const output=resolve('docs/operations/evidence/THETA_PHASE2_EXECUTED_TESTS.json');
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');
// Refresh only already-reviewed engineering rows. A failed rerun invalidates
// the old receipt and never silently preserves a previous PASS.
const registerPath='docs/operations/THETA_PHASE2_COMPLETION_REGISTER.json';
const register=JSON.parse(readFileSync(registerPath,'utf8'));
for(const row of register.requirements){
  const result=results.find(result=>result.requirementId===row.ID);
  if(!result||row.CLOSURE_STATE!=='CLOSED_ENGINEERING')continue;
  row.TEST_RESULT={...result,command:body.command,artifactPath:'docs/operations/evidence/THETA_PHASE2_EXECUTED_TESTS.json',artifactHash:receipt.artifactHash};
  if(!body.executionSucceeded||result.state!=='PASS'){
    row.CLOSURE_STATE=row.CURRENT_STATUS='EVIDENCE_INVALIDATED';
    row.BLOCKER_CLASS='EXECUTED_REQUIREMENT_NOT_PROVEN';
  }
}
register.PHASE2_CODE_SOLVABLE_COMPLETE=register.requirements.filter((row:{CODE_SOLVABLE:boolean;CLOSURE_STATE:string})=>row.CODE_SOLVABLE&&row.CLOSURE_STATE==='CLOSED_ENGINEERING').length;
register.PHASE2_CODE_SOLVABLE_REMAINING=register.PHASE2_CODE_SOLVABLE-register.PHASE2_CODE_SOLVABLE_COMPLETE;
writeFileSync(registerPath,JSON.stringify(register,null,2)+'\n');
console.log(JSON.stringify({output,executionSucceeded:body.executionSucceeded,passed:body.passed,failed:body.failed,
  requirements:results.map(row=>({id:row.requirementId,state:row.state,blockers:row.blockers}))}));
if(!body.executionSucceeded||results.some(result=>result.state!=='PASS'))process.exitCode=1;
