import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { capitalAdmission, capitalEnvelopeSchema, capitalProposalSchema, capitalFootprint, moneyUnits,
  type CapitalEnvelope, type CapitalProposal } from '../src/execution/portfolio-capital-reservation.js';

export const dimensions = (amount: string) => ({ CASH:amount,BROKER:amount,PORTFOLIO:amount,ASSIGNMENT:amount,
  'TICKER:XLE':amount,'SECTOR:ENERGY':amount,'CORRELATION:ENERGY':amount });
export const envelopeFixture = (amount='25000'): CapitalEnvelope => ({ envelopeId:randomUUID(),executionAccountId:randomUUID(),
  observedAt:'2026-10-08T13:30:00Z',expiresAt:'2026-10-08T13:31:00Z',evidenceHash:'a'.repeat(64),
  available:dimensions(amount),reflected:{},policyVersion:'existing-test-policy' });
export const proposalFixture = (amount='15000', strategy: CapitalProposal['strategy']='THETA_CONVENTIONAL'): CapitalProposal => ({
  reservationId:randomUUID(),proposalRef:randomUUID(),decisionId:randomUUID(),candidateRef:randomUUID(),strategy,
  quantity:1,canonicalMaximumQuantity:1,quoteExpiresAt:'2026-10-08T13:31:00Z',perUnit:dimensions(amount),authorityHash:'b'.repeat(64) });

test('Q/H/D share the same envelope, not three copies of the full balance',()=>{
  const e=envelopeFixture('24000'), q=proposalFixture(),h=proposalFixture('7000','THETA_HOLD_STRIKE'),d=proposalFixture('3000','THETA_DEFINED_RISK');
  const held=[{reservationId:q.reservationId,proposal:q,remainingQuantity:1}];
  assert.deepEqual(capitalAdmission(e,held,h),[]);
  assert.ok(capitalAdmission(e,[...held,{reservationId:h.reservationId,proposal:h,remainingQuantity:1}],d).includes('CAPITAL_EXHAUSTED:CASH'));
  assert.deepEqual(capitalAdmission(envelopeFixture('25000'),[...held,{reservationId:h.reservationId,proposal:h,remainingQuantity:1}],d),[]);
});
test('reflected pending broker commitment is counted once; the unreflected portion stays reserved',()=>{
  const e=envelopeFixture('10000'), q=proposalFixture('7000');
  e.reflected[q.reservationId]=dimensions('4000');
  const held=[{reservationId:q.reservationId,proposal:q,remainingQuantity:1}];
  assert.deepEqual(capitalAdmission(e,held,proposalFixture('7000')),[]);
  assert.ok(capitalAdmission(e,held,proposalFixture('7000.00000001')).length);
  e.reflected[q.reservationId]=dimensions('7001');
  assert.throws(()=>capitalAdmission(e,held,proposalFixture()),/REFLECTION_EXCEEDS/);
});
test('same underlying and correlation limits bind independently from cash',()=>{
  const e=envelopeFixture('100000'), q=proposalFixture();
  e.available['CORRELATION:ENERGY']='16999'; e.available['TICKER:XLE']='18000';
  const reasons=capitalAdmission(e,[{reservationId:q.reservationId,proposal:q,remainingQuantity:1}],proposalFixture('2000'));
  assert.deepEqual(reasons,['CAPITAL_EXHAUSTED:CORRELATION:ENERGY']);
});
test('unknown capacities, malformed money, duplicate commitment and increased quantity fail closed',()=>{
  const e=envelopeFixture(), p=proposalFixture(); delete e.available.BROKER;
  assert.deepEqual(capitalAdmission(e,[],p),['CAPITAL_DIMENSION_MISSING:BROKER']);
  assert.throws(()=>moneyUnits('NaN')); assert.throws(()=>moneyUnits('-1')); assert.throws(()=>moneyUnits('0.000000001'));
  assert.throws(()=>capitalProposalSchema.parse({...p,quantity:2}));
  assert.throws(()=>capitalProposalSchema.parse({...p,perUnit:{CASH:'1'}}));
  assert.throws(()=>capitalEnvelopeSchema.parse({...e,expiresAt:e.observedAt}));
  const held={reservationId:p.reservationId,proposal:p,remainingQuantity:1};
  assert.throws(()=>capitalAdmission(e,[held,held],p),/DUPLICATE/);
});
test('CSP full assignment collateral and credit-spread max loss include multiplier and costs exactly once',()=>{
  assert.equal(capitalFootprint({shortStrike:'150',multiplier:100,costsPerPackage:'1.5'}),'15001.50000000');
  assert.equal(capitalFootprint({shortStrike:'57',longStrike:'52',minimumCreditPerShare:'1.20',multiplier:100,costsPerPackage:'2'}),'382.00000000');
  assert.throws(()=>capitalFootprint({shortStrike:'57',longStrike:'58',minimumCreditPerShare:'1',multiplier:100,costsPerPackage:'0'}));
});
