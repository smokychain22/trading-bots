import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLocalWorkerIdentity, parseLocalWorkerOperation } from '../src/theta/autonomous-runtime-handler.js';

test('local worker identity is absent when no identity headers are supplied', () => {
  assert.deepEqual(parseLocalWorkerIdentity({ headers: {} }), { kind: 'ABSENT' });
});

test('local worker identity requires all three validated headers', () => {
  assert.deepEqual(parseLocalWorkerIdentity({
    headers: { 'x-theta-worker-id': 'local-worker-1' },
  }), { kind: 'INVALID' });
  assert.deepEqual(parseLocalWorkerIdentity({
    headers: {
      'x-theta-worker-id': 'local-worker-1',
      'x-theta-host-id': 'host-1',
      'x-theta-build-sha': 'not-a-sha',
    },
  }), { kind: 'INVALID' });
});

test('local worker identity accepts a complete sanitized identity', () => {
  assert.deepEqual(parseLocalWorkerIdentity({
    headers: {
      'x-theta-worker-id': 'local-worker-1',
      'x-theta-host-id': 'host-1',
      'x-theta-build-sha': '38f1f6e31758fc1cf130f5a69501b110a17df709',
    },
  }), {
    kind: 'VALID',
    identity: {
      workerId: 'local-worker-1',
      hostId: 'host-1',
      buildSha: '38f1f6e31758fc1cf130f5a69501b110a17df709',
    },
  });
});

test('local worker operation accepts only the runtime and read-only evidence selectors', () => {
  assert.equal(parseLocalWorkerOperation({ headers: {} }), 'RUNTIME_CYCLE');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'provider-evidence-readiness',
  } }), 'PROVIDER_EVIDENCE_READINESS');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'optionomics-provider-qualification',
  } }), 'OPTIONOMICS_PROVIDER_QUALIFICATION');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'optionomics-quote-qualification',
  } }), 'OPTIONOMICS_QUOTE_QUALIFICATION');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'optionomics-mcp-qualification',
  } }), 'OPTIONOMICS_MCP_QUALIFICATION');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'database-target-preflight',
  } }), 'DATABASE_TARGET_PREFLIGHT');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'database-source-preflight',
  } }), 'DATABASE_SOURCE_PREFLIGHT');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'database-target-migrate',
  } }), 'DATABASE_TARGET_MIGRATE');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'submit-order',
  } }), 'INVALID');
});
