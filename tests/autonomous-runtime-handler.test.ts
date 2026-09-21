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

test('local worker operation accepts the bounded runtime, evidence, and owner authorization selectors', () => {
  assert.equal(parseLocalWorkerOperation({ headers: {} }), 'RUNTIME_CYCLE');
  assert.equal(parseLocalWorkerOperation({ headers: { 'x-theta-operation': 'runtime-core-cycle' } }), 'RUNTIME_CORE_CYCLE');
  assert.equal(parseLocalWorkerOperation({ headers: { 'x-theta-operation': 'runtime-broker-cycle' } }), 'RUNTIME_BROKER_CYCLE');
  assert.equal(parseLocalWorkerOperation({ headers: { 'x-theta-operation': 'runtime-lifecycle-cycle' } }), 'RUNTIME_LIFECYCLE_CYCLE');
  assert.equal(parseLocalWorkerOperation({ headers: { 'x-theta-operation': 'runtime-management-cycle' } }), 'RUNTIME_MANAGEMENT_CYCLE');
  assert.equal(parseLocalWorkerOperation({ headers: { 'x-theta-operation': 'runtime-observation-cycle' } }), 'RUNTIME_OBSERVATION_CYCLE');
  assert.equal(parseLocalWorkerOperation({ headers: { 'x-theta-operation': 'runtime-evidence-cycle' } }), 'RUNTIME_EVIDENCE_CYCLE');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'runtime-zero-trade-diagnostic',
  } }), 'RUNTIME_ZERO_TRADE_DIAGNOSTIC');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'risk-policy-empirical-study',
  } }), 'RISK_POLICY_EMPIRICAL_STUDY');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'provider-evidence-readiness',
  } }), 'PROVIDER_EVIDENCE_READINESS');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'alpaca-indicative-quote-qualification',
  } }), 'ALPACA_INDICATIVE_QUOTE_QUALIFICATION');
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
    'x-theta-operation': 'master-paper-authorize',
  } }), 'MASTER_PAPER_AUTHORIZE');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'first-paper-canary-activate',
  } }), 'FIRST_PAPER_CANARY_ACTIVATE');
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
    'x-theta-operation': 'database-target-validate',
  } }), 'DATABASE_TARGET_VALIDATE');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'database-event-revision-inspect',
  } }), 'DATABASE_EVENT_REVISION_INSPECT');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'alpaca-corporate-action-capture',
  } }), 'ALPACA_CORPORATE_ACTION_CAPTURE');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'canonical-event-export',
  } }), 'CANONICAL_EVENT_EXPORT');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'database-legacy-import',
  } }), 'DATABASE_LEGACY_IMPORT');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'database-legacy-inventory',
  } }), 'DATABASE_LEGACY_INVENTORY');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'database-legacy-promote',
  } }), 'DATABASE_LEGACY_PROMOTE');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'database-legacy-reconstruction-import',
  } }), 'DATABASE_LEGACY_RECONSTRUCTION_IMPORT');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'database-local-forensic-import',
  } }), 'DATABASE_LOCAL_FORENSIC_IMPORT');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'database-target-bootstrap-master',
  } }), 'DATABASE_TARGET_BOOTSTRAP_MASTER');
  assert.equal(parseLocalWorkerOperation({ headers: {
    'x-theta-operation': 'submit-order',
  } }), 'INVALID');
});
