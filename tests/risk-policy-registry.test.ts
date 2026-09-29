import assert from 'node:assert/strict';
import test from 'node:test';
import { RISK_POLICY_REGISTRY, validateRiskPolicyRegistry } from '../src/theta/risk-policy-registry.js';

test('risk policy registry distinguishes active bootstrap, research, and genuinely missing authority', () => {
  assert.equal(RISK_POLICY_REGISTRY.length, 5);
  assert.equal(RISK_POLICY_REGISTRY.filter((entry) => entry.status === 'PAPER_BOOTSTRAP_ACTIVE').length, 3);
  assert.equal(RISK_POLICY_REGISTRY.filter((entry) => entry.status === 'RESEARCH_CANDIDATE').length, 1);
  assert.deepEqual(RISK_POLICY_REGISTRY.filter((entry) => entry.status === 'MISSING').map((entry) => entry.key), ['SECTOR_MAPPING']);
});

test('approved policy without versioned evidence is rejected', () => {
  assert.throws(() => validateRiskPolicyRegistry([{
    key: 'SEVERE_DRAWDOWN', status: 'APPROVED', policyVersion: null, evidenceReference: null, blocker: null,
  }]), /lacks versioned evidence/);
});

test('research candidates require a named promotion blocker and active bootstrap policies cannot retain one', () => {
  assert.throws(() => validateRiskPolicyRegistry([{
    key: 'SEVERE_DRAWDOWN', status: 'RESEARCH_CANDIDATE', policyVersion: 'v1', evidenceReference: 'source', blocker: null,
  }]), /must name its promotion blocker/);
  assert.throws(() => validateRiskPolicyRegistry([{
    key: 'IV_SHOCK', status: 'PAPER_BOOTSTRAP_ACTIVE', policyVersion: 'v1', evidenceReference: 'source', blocker: 'STALE_BLOCKER',
  }]), /cannot retain a source blocker/);
});
