import assert from 'node:assert/strict';
import test from 'node:test';
import { RISK_POLICY_REGISTRY, validateRiskPolicyRegistry } from '../src/theta/risk-policy-registry.js';

test('canonical risk policies remain explicitly missing until authority is supplied', () => {
  assert.equal(RISK_POLICY_REGISTRY.length, 5);
  assert.ok(RISK_POLICY_REGISTRY.every((entry) => entry.status === 'MISSING'));
});

test('approved policy without versioned evidence is rejected', () => {
  assert.throws(() => validateRiskPolicyRegistry([{
    key: 'SEVERE_DRAWDOWN', status: 'APPROVED', policyVersion: null, evidenceReference: null, blocker: null,
  }]), /lacks versioned evidence/);
});
