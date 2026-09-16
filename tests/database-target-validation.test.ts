import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDatabaseTargetError } from '../src/database/target-preflight.js';

test('database invariant failures preserve only their bounded invariant identifier', () => {
  assert.deepEqual(classifyDatabaseTargetError({ code: 'INV_003_FAILED', message: 'private detail' }), {
    failureCode: 'INV_003_FAILED', failureClass: 'UNKNOWN',
  });
});
