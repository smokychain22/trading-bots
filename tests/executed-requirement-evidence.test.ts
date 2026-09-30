import assert from 'node:assert/strict';
import test from 'node:test';
import { certifyExecutedRequirement, evidenceSourceHash, type ExecutedTestEvent } from '../src/operations/executed-requirement-evidence.js';

const binding={id:'SYNTHETIC',reviewedBehavior:'The actual consumer preserves missing evidence.',
  sources:['src/consumer.ts'],tests:[{file:'tests/consumer.test.ts',names:['unknown is not zero']}]};
const hashes={'src/consumer.ts':evidenceSourceHash('consumer'),'tests/consumer.test.ts':evidenceSourceHash('tests')};
const passed:ExecutedTestEvent={file:'tests/consumer.test.ts',name:'unknown is not zero',state:'PASS'};

test('closure requires the exact executed file and case with bound source and test hashes',()=>{
  const receipt=certifyExecutedRequirement(binding,[passed],hashes);
  assert.equal(receipt.state,'PASS');assert.equal(receipt.passed,1);
  assert.equal(receipt.runtimeProven,false);assert.equal(receipt.brokerAuthorized,false);
  for(const events of [[],[{...passed,file:'tests/different.test.ts'}],[{...passed,name:'global CI pass'}],
    [{...passed,state:'SKIPPED' as const}],[{...passed,state:'FAIL' as const}],[passed,passed]]){
    assert.equal(certifyExecutedRequirement(binding,events,hashes).state,'NOT_PROVEN');
  }
  assert.equal(certifyExecutedRequirement(binding,[passed],{}).state,'NOT_PROVEN');
  assert.equal(certifyExecutedRequirement({...binding,reviewedBehavior:''},[passed],hashes).state,'NOT_PROVEN');
});

test('a failing companion prevents a selected pass from laundering the suite failure',()=>{
  assert.equal(certifyExecutedRequirement(binding,[passed,{...passed,name:'companion',state:'FAIL'}],hashes).state,'NOT_PROVEN');
});

test('source evidence normalizes checkout newlines without normalizing semantic content',()=>{
  assert.equal(evidenceSourceHash('a\r\nb\r\n'),evidenceSourceHash('a\nb\n'));
  assert.notEqual(evidenceSourceHash('a\nb'),evidenceSourceHash('a\n b'));
});
