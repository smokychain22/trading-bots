import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesMasterRecoveryConfirmation } from '../src/database/master-paper-bootstrap.js';

test('master Paper recovery requires the exact bounded confirmation', () => {
  assert.equal(matchesMasterRecoveryConfirmation('AIVEN_RECOVER_MASTER_THETA_PAPER'), true);
  assert.equal(matchesMasterRecoveryConfirmation('MASTER_THETA_PAPER'), false);
  assert.equal(matchesMasterRecoveryConfirmation(undefined), false);
  assert.equal(matchesMasterRecoveryConfirmation(['AIVEN_RECOVER_MASTER_THETA_PAPER']), false);
});
