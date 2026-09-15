import assert from 'node:assert/strict';
import test from 'node:test';
import { createPromotedManagementPolicyProvider, validateExplicitPromotion } from '../src/theta/promoted-management-policy-provider.js';

test('Production management provider is unavailable without an explicitly promoted empirical receipt',()=>{
  const provider=createPromotedManagementPolicyProvider(null,async()=>null);
  assert.equal(provider,null);
});

test('an invalid or incomplete promotion artifact cannot become a provider',()=>{
  const artifact={receipt:{},promotion:{state:'PROMOTED',policyVersion:'x',datasetHash:'0'.repeat(64),approvedBy:'owner',
    approvedAt:'2026-09-15T00:00:00.000Z',governanceVersion:'v1',contentHash:'0'.repeat(64)}};
  assert.deepEqual(validateExplicitPromotion(artifact as never),['PROMOTION_RECEIPT_INVALID']);
  assert.equal(createPromotedManagementPolicyProvider(artifact as never,async()=>null),null);
});
