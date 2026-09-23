import assert from 'node:assert/strict';
import test from 'node:test';
import { decisionCriticalEvidenceFields, validateDecisionCriticalEvidenceRegistry } from '../src/theta/decision-critical-evidence-registry.js';

test('decision-critical nullable and tri-state Paper surface has a complete machine-checked denominator',()=>{
  const result=validateDecisionCriticalEvidenceRegistry();
  assert.equal(result.coverage,'COMPLETE');
  assert.ok(result.fieldCount>=40);
  for(const required of ['universe.unsupportedCorporateActionPending','universe.eventNear','event.prospectiveKnownAt',
    'event.earningsDistanceTradingSessions','event.earningsDistanceDays','instrument.classification',
    'contract.deliverable','aegis.stressIvShockDetected','aegis.stressSpreadWideningDetected','execution.preSubmitQuote']){
    assert.equal(decisionCriticalEvidenceFields.filter((entry)=>entry.field===required).length,1,required);
  }
});

test('registry validation rejects duplicate or incomplete fields',()=>{
  assert.throws(()=>validateDecisionCriticalEvidenceRegistry([decisionCriticalEvidenceFields[0] as never,
    decisionCriticalEvidenceFields[0] as never]),/DUPLICATE/);
  assert.throws(()=>validateDecisionCriticalEvidenceRegistry([{...(decisionCriticalEvidenceFields[0] as object),producer:''} as never]),/INCOMPLETE/);
});
