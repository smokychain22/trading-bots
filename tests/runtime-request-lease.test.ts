import assert from 'node:assert/strict';
import test from 'node:test';
import { maximumRuntimeRequestDurationMs, runtimeRequestLeaseDurationMs,
  runtimeRequestLeaseExpiresAt } from '../src/theta/runtime-request-lease.js';

test('primary worker lease outlives the bounded server request', () => {
  const startedAt = new Date('2026-09-23T14:00:00.000Z');
  const expiresAt = Date.parse(runtimeRequestLeaseExpiresAt(startedAt));
  assert.ok(runtimeRequestLeaseDurationMs > maximumRuntimeRequestDurationMs);
  assert.equal(expiresAt - startedAt.getTime(), runtimeRequestLeaseDurationMs);
});

test('invalid lease start fails closed', () => {
  assert.throws(() => runtimeRequestLeaseExpiresAt(new Date(Number.NaN)), /RUNTIME_LEASE_START_INVALID/);
});
