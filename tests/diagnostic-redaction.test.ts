import assert from 'node:assert/strict';
import test from 'node:test';
import { redactDiagnosticText, redactDiagnosticValue } from '../src/security/diagnostic-redaction.js';

test('database URLs and URI userinfo are never retained in diagnostic text', () => {
  const text = 'connect postgres://synthetic-user:synthetic-password@db.example.invalid:5432/test?sslmode=require '
    + 'then https://synthetic-user:synthetic-password@example.invalid/path';
  const redacted = redactDiagnosticText(text);
  assert.ok(!redacted.includes('synthetic-password'));
  assert.ok(!redacted.includes('synthetic-user'));
  assert.ok(redacted.includes('[REDACTED_DATABASE_URL]'));
  assert.ok(redacted.includes('[REDACTED_AUTHENTICATED_URL]'));
});

test('nested environment and receipt fields redact by name before serialization', () => {
  const diagnostic = { environment: { AIVEN_DATABASE_URL: 'synthetic-value', apiKey: 'synthetic-key',
    nested: [{ accessToken: 'synthetic-token', safeCount: 2 }] }, receipt: { status: 'FAILED' } };
  const output = redactDiagnosticValue(diagnostic);
  assert.deepEqual(output, { environment: { AIVEN_DATABASE_URL: '[REDACTED]', apiKey: '[REDACTED]',
    nested: [{ accessToken: '[REDACTED]', safeCount: 2 }] }, receipt: { status: 'FAILED' } });
});

test('error messages, stacks, bearer headers and assignments are scrubbed', () => {
  const error = new Error('DATABASE_URL="postgres://synthetic-user:synthetic-password@db.example.invalid/test"');
  error.stack = 'Error: token=synthetic-token\nAuthorization: Bearer synthetic-bearer-value';
  const output = JSON.stringify(redactDiagnosticValue({ error }));
  for (const value of ['synthetic-password', 'synthetic-user', 'synthetic-token', 'synthetic-bearer-value']) {
    assert.ok(!output.includes(value));
  }
  assert.ok(output.includes('[REDACTED]'));
});

test('circular and unsupported diagnostic objects cannot invoke custom serializers', () => {
  const cyclic: Record<string, unknown> = { state: 'FAILED' };
  cyclic.self = cyclic;
  const unsupported = { toJSON: () => { throw new Error('should never serialize'); } };
  assert.deepEqual(redactDiagnosticValue(cyclic), { state: 'FAILED', self: '[CIRCULAR]' });
  assert.equal(redactDiagnosticValue(new Date('2026-10-09T00:00:00Z')), '[UNSUPPORTED_OBJECT]');
  assert.deepEqual(redactDiagnosticValue(unsupported), { toJSON: '[UNSUPPORTED_VALUE]' });
});
