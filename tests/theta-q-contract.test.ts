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
      },
      ownershipScore: 0.72,
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
