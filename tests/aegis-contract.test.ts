import assert from 'node:assert/strict';
import test from 'node:test';
import { isActionPermitted, parseAegisAssessmentResponse } from '../src/theta/aegis-contract.js';

const EXIT_ACTIONS = ['CLOSE', 'CANCEL', 'BUY_TO_CLOSE', 'RECONCILE', 'REDUCE_POSITION', 'SAFETY_EXIT'];

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 'theta-aegis-runtime-v1',
  decisionId: 'decision-1',
  snapshotId: 'snapshot-1',
  timestamp: new Date().toISOString(),
  policyVersion: 'v1',
  families: [{ family: 'PER_TRADE', state: 'ALLOW_FULL', reasons: [] }],
  newRiskState: 'ALLOW_FULL',
  reasons: [],
  permittedActions: [...EXIT_ACTIONS, 'OPEN_CSP'],
  ...overrides,
});

test('exit-supremacy actions must always be present in permittedActions', () => {
  const payload = basePayload({ permittedActions: ['OPEN_CSP'] }); // missing exit actions
  assert.throws(() => parseAegisAssessmentResponse(payload));
});

test('HARD_VETO with exit actions present still validates', () => {
  const payload = basePayload({
    families: [{ family: 'PER_TRADE', state: 'HARD_VETO', reasons: [] }],
    newRiskState: 'HARD_VETO',
    permittedActions: [...EXIT_ACTIONS],
  });
  const response = parseAegisAssessmentResponse(payload);
  assert.equal(response.newRiskState, 'HARD_VETO');
  assert.equal(isActionPermitted(response, 'CLOSE'), true);
  assert.equal(isActionPermitted(response, 'OPEN_CSP'), false);
});

test('newRiskState must equal the strictest family state', () => {
  const payload = basePayload({
    families: [
      { family: 'PER_TRADE', state: 'ALLOW_FULL', reasons: [] },
      { family: 'SECTOR', state: 'HOLD_ONLY', reasons: [] },
    ],
    newRiskState: 'ALLOW_FULL', // wrong -- should be HOLD_ONLY
    permittedActions: [...EXIT_ACTIONS],
  });
  assert.throws(() => parseAegisAssessmentResponse(payload));
});

test('reduced state permits reduced actions, exit supremacy holds', () => {
  const payload = basePayload({
    families: [{ family: 'SECTOR', state: 'ALLOW_REDUCED', reasons: [] }],
    newRiskState: 'ALLOW_REDUCED',
    permittedActions: [...EXIT_ACTIONS, 'OPEN_CSP_REDUCED'],
  });
  const response = parseAegisAssessmentResponse(payload);
  assert.equal(isActionPermitted(response, 'CLOSE'), true);
  assert.equal(isActionPermitted(response, 'OPEN_CSP_REDUCED'), true);
});
