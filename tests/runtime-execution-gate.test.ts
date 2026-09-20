import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRuntimeExecutionGate } from '../src/theta/autonomous-runtime.js';

test('runtime gate reports quote blocker only when pricing authority is unavailable', () => {
  assert.equal(classifyRuntimeExecutionGate({
    executionQuoteAuthorityReady: false, newRiskSubmissionEnabled: true,
    managementPolicyProviderReady: true, firstCanarySubmissionAvailable: true,
  }), 'EXTERNAL_QUOTE_BLOCKER');
});

test('runtime gate reports locked for policy, control, or canary locks after pricing qualifies', () => {
  assert.equal(classifyRuntimeExecutionGate({
    executionQuoteAuthorityReady: true, newRiskSubmissionEnabled: false,
    managementPolicyProviderReady: true, firstCanarySubmissionAvailable: true,
  }), 'LOCKED');
  assert.equal(classifyRuntimeExecutionGate({
    executionQuoteAuthorityReady: true, newRiskSubmissionEnabled: true,
    managementPolicyProviderReady: true, firstCanarySubmissionAvailable: false,
  }), 'LOCKED');
});

test('runtime gate reports active only when every new-risk control is ready', () => {
  assert.equal(classifyRuntimeExecutionGate({
    executionQuoteAuthorityReady: true, newRiskSubmissionEnabled: true,
    managementPolicyProviderReady: true, firstCanarySubmissionAvailable: true,
  }), 'ACTIVE');
});
