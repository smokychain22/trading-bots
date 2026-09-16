import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aivenBootstrapConfirmation,
  matchesAivenBootstrapConfirmation,
} from '../src/database/target-migration.js';

test('Aiven migration requires the exact bounded bootstrap confirmation', () => {
  assert.equal(matchesAivenBootstrapConfirmation(aivenBootstrapConfirmation), true);
  assert.equal(matchesAivenBootstrapConfirmation(undefined), false);
  assert.equal(matchesAivenBootstrapConfirmation('AIVEN_BOOTSTRAP'), false);
  assert.equal(matchesAivenBootstrapConfirmation(['AIVEN_BOOTSTRAP_050']), false);
});
