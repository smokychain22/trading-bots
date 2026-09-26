import assert from 'node:assert/strict';
import test from 'node:test';

import { parseThetaQResponse, thetaQContractVersion } from '../src/theta/theta-q-contract.js';

const snapshotHash = 'b'.repeat(64);

function responseFixture() {
  return {
    contractVersion: thetaQContractVersion,
    fusionSnapshotHash: snapshotHash,
    candidates: [{
      candidateId: 'candidate-1',
      rank: 1,
      actionFeasible: true,
      quantity: 2,
      economics: {
        max_profit: 150,
        break_even_price: 48.5,
        secured_collateral_per_contract: 5000,
        credit_collateral_ratio: 0.03,
        ev_net: null,
        ev_net_unknown_reason: 'No calibrated entry-outcome model is available.',
        commission_per_contract: 0.65,
        fees_per_contract: 0.05,
        est_slippage_per_contract: 1.0,
        cost_model_version: 'TEST-COST-1',
      },
      ownershipScore: 0.72,
      eligibilityBasis: 'EMPIRICAL_OWNERSHIP',
      paperBootstrapPolicyVersion: null,
      paperBootstrapAllowedUnknownComponents: [],
      paperBootstrapReasonCodes: [],
      reasons: [{ code: 'OWNERSHIP_ACCEPTABLE', polarity: 1, detail: 'synthetic fixture' }],
    }],
    wait: { candidateId: 'WAIT', actionFeasible: true, quantity: 0 },
    recommendation: {
      actionCode: 'OPEN_CSP',
      selectedCandidateId: 'candidate-1',
      quantity: 2,
      executionAuthorized: false,
      requiresAegis: true,
      requiresFreshAlpacaBbo: true,
    },
  };
}

test('accepts a THETA-Q result tied to the expected FusionSnapshot', () => {
  const response = parseThetaQResponse(responseFixture(), snapshotHash);
  assert.equal(response.recommendation.executionAuthorized, false);
});

// Phase 3 Final Closure B: the versioned cost model must reach the TS side
// as real structured data, not only as a Python-side string fragment.
test('the versioned cost model (commission/fees/slippage/version) parses through as real structured data, distinct from gross max_profit', () => {
  const response = parseThetaQResponse(responseFixture(), snapshotHash);
  const economics = response.candidates[0]?.economics;
  assert.ok(economics);
  assert.equal(economics.commission_per_contract, 0.65);
  assert.equal(economics.fees_per_contract, 0.05);
  assert.equal(economics.est_slippage_per_contract, 1.0);
  assert.equal(economics.cost_model_version, 'TEST-COST-1');
  // Gross fields must remain untouched by the presence of cost data.
  assert.equal(economics.max_profit, 150);
});

test('the cost model fields are nullable (a candidate never sent to the real Q bridge has no real cost-model data, and null is honest, not a fabricated version)', () => {
  const fixture = responseFixture();
  const candidate = fixture.candidates[0];
  assert.ok(candidate?.economics);
  candidate.economics = {
    ...candidate.economics,
    commission_per_contract: null, fees_per_contract: null, est_slippage_per_contract: null, cost_model_version: null,
  };
  const response = parseThetaQResponse(fixture, snapshotHash);
  assert.equal(response.candidates[0]?.economics?.cost_model_version, null);
});

test('rejects a response tied to another FusionSnapshot', () => {
  assert.throws(() => parseThetaQResponse(responseFixture(), 'c'.repeat(64)), /different FusionSnapshot/);
});

test('rejects quantity on an infeasible candidate', () => {
  const response = responseFixture();
  const candidate = response.candidates[0];
  assert.ok(candidate);
  candidate.actionFeasible = false;
  assert.throws(() => parseThetaQResponse(response, snapshotHash), /quantity must be zero/);
});

test('rejects malformed WAIT decisions', () => {
  const response = responseFixture();
  response.recommendation.actionCode = 'WAIT';
  assert.throws(() => parseThetaQResponse(response, snapshotHash), /WAIT must select WAIT/);
});
