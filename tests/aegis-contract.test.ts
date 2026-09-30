import assert from 'node:assert/strict';
import test from 'node:test';
import { isActionPermitted, parseAegisAssessmentResponse, riskFamilySchema } from '../src/theta/aegis-contract.js';

const EXIT_ACTIONS = ['CLOSE', 'CANCEL', 'BUY_TO_CLOSE', 'RECONCILE', 'REDUCE_POSITION', 'SAFETY_EXIT'];

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 'theta-aegis-runtime-v1',
  decisionId: 'decision-1',
  snapshotId: 'snapshot-1',
  timestamp: new Date().toISOString(),
  policyVersion: 'v1',
  compoundStressHoldCount: 2,
  policyConfigurationHash: 'a'.repeat(64),
  families: riskFamilySchema.options.map(family => ({ family, state: 'ALLOW_FULL', reasons: [] })),
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
    families: riskFamilySchema.options.map(family => ({ family, state: family === 'PER_TRADE' ? 'HARD_VETO' : 'ALLOW_FULL', reasons: [] })),
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
    families: riskFamilySchema.options.map(family => ({ family, state: family === 'SECTOR' ? 'HOLD_ONLY' : 'ALLOW_FULL', reasons: [] })),
    newRiskState: 'ALLOW_FULL', // wrong -- should be HOLD_ONLY
    permittedActions: [...EXIT_ACTIONS],
  });
  assert.throws(() => parseAegisAssessmentResponse(payload));
});

test('reduced state permits reduced actions, exit supremacy holds', () => {
  const payload = basePayload({
    families: riskFamilySchema.options.map(family => ({ family, state: family === 'SECTOR' ? 'ALLOW_REDUCED' : 'ALLOW_FULL', reasons: [] })),
    newRiskState: 'ALLOW_REDUCED',
    permittedActions: [...EXIT_ACTIONS, 'OPEN_CSP_REDUCED'],
  });
  const response = parseAegisAssessmentResponse(payload);
  assert.equal(isActionPermitted(response, 'CLOSE'), true);
  assert.equal(isActionPermitted(response, 'OPEN_CSP_REDUCED'), true);
});

test('AEGIS rejects omitted duplicated extra and renamed families even when the reported state is permissive', () => {
  const families = riskFamilySchema.options.map(family => ({ family, state: 'ALLOW_FULL', reasons: [] }));
  assert.equal(families.length, 12);
  for (let index = 0; index < families.length; index++) {
    assert.throws(() => parseAegisAssessmentResponse(basePayload({ families: families.filter((_, i) => i !== index) })));
    const duplicate = [...families];
    const replacement = families[(index + 1) % families.length];
    assert.ok(replacement);
    duplicate[index] = replacement;
    assert.throws(() => parseAegisAssessmentResponse(basePayload({ families: duplicate })));
  }
  assert.throws(() => parseAegisAssessmentResponse(basePayload({ families: [...families, families[0]] })));
  assert.throws(() => parseAegisAssessmentResponse(basePayload({ families: [{ ...families[0], family: 'UNREVIEWED' }, ...families.slice(1)] })));
  assert.equal(parseAegisAssessmentResponse(basePayload({ families: [...families].reverse() })).newRiskState, 'ALLOW_FULL');
});

test('AEGIS response cannot be reused across candidate snapshot decision time or policy', () => {
  const payload = basePayload();
  const expected = { decisionId: payload.decisionId, snapshotId: payload.snapshotId,
    timestamp: payload.timestamp, policyVersion: payload.policyVersion };
  assert.equal(parseAegisAssessmentResponse(payload, expected).snapshotId, payload.snapshotId);
  for (const field of ['decisionId', 'snapshotId', 'timestamp', 'policyVersion'] as const) {
    assert.throws(() => parseAegisAssessmentResponse(payload, { ...expected, [field]: 'different' }), /IDENTITY_MISMATCH/);
  }
});
