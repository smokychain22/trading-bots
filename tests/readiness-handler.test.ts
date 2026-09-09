import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesOperatorToken } from '../src/providers/readiness-handler.js';

test('requires an exact bearer token match', () => {
  const token = 'a'.repeat(48);
  assert.equal(matchesOperatorToken(`Bearer ${token}`, token), true);
  assert.equal(matchesOperatorToken(`Bearer ${token}x`, token), false);
  assert.equal(matchesOperatorToken(token, token), false);
  assert.equal(matchesOperatorToken('', token), false);
});
