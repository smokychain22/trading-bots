import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDatabaseTargetError } from '../src/database/target-preflight.js';

test('database target failure classification returns only bounded non-secret metadata', () => {
  assert.deepEqual(classifyDatabaseTargetError({ code: '28P01', message: 'secret text' }), {
    failureCode: '28P01', failureClass: 'AUTHENTICATION',
  });
  assert.deepEqual(classifyDatabaseTargetError({ code: 'SELF_SIGNED_CERT_IN_CHAIN' }), {
    failureCode: 'SELF_SIGNED_CERT_IN_CHAIN', failureClass: 'TLS_CERTIFICATE',
  });
  assert.deepEqual(classifyDatabaseTargetError(new Error('connect timeout to a private host')), {
    failureCode: 'UNKNOWN', failureClass: 'TIMEOUT',
  });
});
