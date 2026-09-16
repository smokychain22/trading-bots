import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDatabaseTargetError, describeDatabaseEndpoint } from '../src/database/target-preflight.js';

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
  assert.deepEqual(classifyDatabaseTargetError({ code: '53000', message: 'quota details' }), {
    failureCode: '53000', failureClass: 'RESOURCE_QUOTA',
  });
});

test('database endpoint diagnostics expose routing metadata but no credentials', () => {
  assert.deepEqual(describeDatabaseEndpoint('postgres://user:secret@db.example.test:5432/theta?sslmode=require'), {
    protocol: 'postgres:', hostname: 'db.example.test', port: '5432', databaseNamePresent: true, sslRequired: true,
  });
  assert.deepEqual(describeDatabaseEndpoint('not a url'), {
    protocol: null, hostname: null, port: null, databaseNamePresent: false, sslRequired: false,
  });
});
