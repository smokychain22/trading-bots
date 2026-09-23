import assert from 'node:assert/strict';
import test from 'node:test';
import { assessUnknownRegister, type UnknownRegister } from '../src/theta/pre-vps-unknown-register.js';

const entry = {
  field: 'event.knownAt', strategy: 'THETA_ALL', stage: 'EVENT', source: 'test',
  category: 'CONSUMER_WIRING_DEFECT' as const, reason: 'not wired', safetyCritical: true,
  paperEntryRequired: true, provider: 'OPTIONOMICS', producer: null, persistence: null,
  consumer: null, remediation: 'wire after PIT verification', currentStatus: 'OPEN' as const,
};

test('avoidable unknown blocks readiness even when audit coverage is complete', () => {
  const register: UnknownRegister = { schemaVersion: 'theta-pre-vps-unknown-register-v1', auditCoverage: 'COMPLETE', entries: [entry] };
  assert.deepEqual(assessUnknownRegister(register), {
    avoidableUnknownCount: 1, openUnknownCount: 1, unresolvedSafetyCriticalCount: 1,
    unresolvedPaperEntryCount: 1, auditCoverage: 'COMPLETE', preVpsReady: false,
  });
});

test('a provider-limited Paper safety field cannot pass through the avoidable-only readiness check', () => {
  const register: UnknownRegister = { schemaVersion: 'theta-pre-vps-unknown-register-v1', auditCoverage: 'COMPLETE',
    entries: [{ ...entry, category: 'PROVIDER_NOT_CAPABLE' }] };
  assert.deepEqual(assessUnknownRegister(register), {
    avoidableUnknownCount: 0, openUnknownCount: 1, unresolvedSafetyCriticalCount: 1,
    unresolvedPaperEntryCount: 1, auditCoverage: 'COMPLETE', preVpsReady: false,
  });
});

test('a non-safety empirical outcome can remain open without falsely blocking engineering readiness', () => {
  const register: UnknownRegister = { schemaVersion: 'theta-pre-vps-unknown-register-v1', auditCoverage: 'COMPLETE',
    entries: [{ ...entry, category: 'EMPIRICAL_OUTCOME_NOT_YET_OBSERVED', safetyCritical: false,
      paperEntryRequired: false }] };
  assert.equal(assessUnknownRegister(register).preVpsReady, true);
});

test('partial coverage never claims readiness', () => {
  const register: UnknownRegister = { schemaVersion: 'theta-pre-vps-unknown-register-v1', auditCoverage: 'PARTIAL', entries: [{ ...entry, currentStatus: 'RESOLVED' }] };
  assert.equal(assessUnknownRegister(register).preVpsReady, false);
});

test('safety-critical unknown cannot be deferred', () => {
  const register: UnknownRegister = { schemaVersion: 'theta-pre-vps-unknown-register-v1', auditCoverage: 'PARTIAL', entries: [{ ...entry, currentStatus: 'DEFERRED' }] };
  assert.throws(() => assessUnknownRegister(register), /SAFETY_CRITICAL_UNKNOWN_DEFERRED/);
});
