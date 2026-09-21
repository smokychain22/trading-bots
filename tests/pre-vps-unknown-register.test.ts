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
    avoidableUnknownCount: 1, openUnknownCount: 1, auditCoverage: 'COMPLETE', preVpsReady: false,
  });
});

test('partial coverage never claims readiness', () => {
  const register: UnknownRegister = { schemaVersion: 'theta-pre-vps-unknown-register-v1', auditCoverage: 'PARTIAL', entries: [{ ...entry, currentStatus: 'RESOLVED' }] };
  assert.equal(assessUnknownRegister(register).preVpsReady, false);
});

test('safety-critical unknown cannot be deferred', () => {
  const register: UnknownRegister = { schemaVersion: 'theta-pre-vps-unknown-register-v1', auditCoverage: 'PARTIAL', entries: [{ ...entry, currentStatus: 'DEFERRED' }] };
  assert.throws(() => assessUnknownRegister(register), /SAFETY_CRITICAL_UNKNOWN_DEFERRED/);
});
