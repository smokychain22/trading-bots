import assert from 'node:assert/strict';
import test from 'node:test';
import { deterministicRuntimeUuid } from '../src/theta/postgres-theta-cycle-store.js';

test('runtime persistence IDs are deterministic UUIDs without exposing raw identifiers', () => {
  const first = deterministicRuntimeUuid('fusion:bot:hash');
  assert.equal(first, deterministicRuntimeUuid('fusion:bot:hash'));
  assert.notEqual(first, deterministicRuntimeUuid('fusion:bot:other'));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first.includes('fusion'), false);
});
