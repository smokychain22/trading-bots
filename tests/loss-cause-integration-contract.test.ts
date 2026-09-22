import assert from 'node:assert/strict';
import test from 'node:test';
import { assessLossCauses, type LossCauseEvidence } from '../src/research/loss-cause-integration-contract.js';

const ASOF = '2026-09-22T14:00:00Z';

function evidence(overrides: Partial<LossCauseEvidence> = {}): LossCauseEvidence {
  return {
    cause: 'UNDERLYING_DECLINE', evidenceQuality: 'KNOWN', severity: 0.4, persistenceCycles: 2, confidence: 0.8,
    thesisImpact: 'DEGRADES_THESIS', actionInfluence: 'FAVORS_HOLD', hardSafetyOverride: false,
    sourceEvidenceIds: ['ev-1'], detail: 'underlying declined 3% over 2 cycles', ...overrides,
  };
}

test('assembles a real assessment from caller-supplied evidence, no inference of its own', () => {
  const result = assessLossCauses('pos-1', ASOF, -150, [evidence()]);
  assert.equal(result.causes.length, 1);
  assert.equal(result.hardSafetyOverrideActive, false);
  assert.equal(result.brokerAuthority, false);
});

test('CORE CLAIM: same observed P&L, different cause, different action-frontier influence is a valid distinct assessment', () => {
  const declineDriven = assessLossCauses('pos-1', ASOF, -150, [
    evidence({ cause: 'UNDERLYING_DECLINE', actionInfluence: 'FAVORS_HOLD', thesisImpact: 'DEGRADES_THESIS' }),
  ]);
  const ivDriven = assessLossCauses('pos-2', ASOF, -150, [
    evidence({ cause: 'IV_EXPANSION', actionInfluence: 'FAVORS_CLOSE', thesisImpact: 'NEUTRAL_TO_THESIS',
      detail: 'IV expanded sharply, mark moved against short premium despite stable underlying' }),
  ]);
  assert.equal(declineDriven.observedNetPnl, ivDriven.observedNetPnl);
  assert.notEqual(declineDriven.causes[0]?.actionInfluence, ivDriven.causes[0]?.actionInfluence);
  assert.notEqual(declineDriven.causes[0]?.thesisImpact, ivDriven.causes[0]?.thesisImpact);
});

test('multiple simultaneous causes at the same P&L are each preserved individually, never merged into one', () => {
  const result = assessLossCauses('pos-1', ASOF, -300, [
    evidence({ cause: 'UNDERLYING_DECLINE' }),
    evidence({ cause: 'LIQUIDITY_DETERIORATION', actionInfluence: 'FAVORS_CLOSE', severity: 0.9 }),
  ]);
  assert.equal(result.causes.length, 2);
  assert.ok(result.causes.some((c) => c.cause === 'UNDERLYING_DECLINE'));
  assert.ok(result.causes.some((c) => c.cause === 'LIQUIDITY_DETERIORATION'));
});

test('hardSafetyOverrideActive is true when ANY cause reports it (exit supremacy), regardless of other causes', () => {
  const result = assessLossCauses('pos-1', ASOF, -50, [
    evidence({ cause: 'UNDERLYING_DECLINE', severity: 0.1, hardSafetyOverride: false }),
    evidence({ cause: 'PORTFOLIO_STRESS', severity: 0.95, hardSafetyOverride: true }),
  ]);
  assert.equal(result.hardSafetyOverrideActive, true);
});

test('ADVERSARIAL: a hard safety override cannot be claimed on PROVIDER_LIMITED evidence -- fails closed, never silently accepted', () => {
  assert.throws(() => assessLossCauses('pos-1', ASOF, -50, [
    evidence({ cause: 'EVENT_DETERIORATION', evidenceQuality: 'PROVIDER_LIMITED', hardSafetyOverride: true }),
  ]), /LOSS_CAUSE_HARD_OVERRIDE_WITHOUT_KNOWN_EVIDENCE/);
});

test('ADVERSARIAL: severity outside [0,1] is rejected, never clamped silently', () => {
  assert.throws(() => assessLossCauses('pos-1', ASOF, -50, [evidence({ severity: 1.5 })]), /LOSS_CAUSE_INVALID_SEVERITY/);
  assert.throws(() => assessLossCauses('pos-1', ASOF, -50, [evidence({ severity: -0.1 })]), /LOSS_CAUSE_INVALID_SEVERITY/);
});

test('ADVERSARIAL: confidence outside [0,1] is rejected', () => {
  assert.throws(() => assessLossCauses('pos-1', ASOF, -50, [evidence({ confidence: 2 })]), /LOSS_CAUSE_INVALID_CONFIDENCE/);
});

test('ADVERSARIAL: negative or non-integer persistenceCycles is rejected', () => {
  assert.throws(() => assessLossCauses('pos-1', ASOF, -50, [evidence({ persistenceCycles: -1 })]), /LOSS_CAUSE_INVALID_PERSISTENCE/);
  assert.throws(() => assessLossCauses('pos-1', ASOF, -50, [evidence({ persistenceCycles: 1.5 })]), /LOSS_CAUSE_INVALID_PERSISTENCE/);
});

test('ADVERSARIAL: a duplicate cause row is rejected, never silently overwriting the first', () => {
  assert.throws(() => assessLossCauses('pos-1', ASOF, -50, [
    evidence({ cause: 'IV_EXPANSION' }), evidence({ cause: 'IV_EXPANSION', severity: 0.9 }),
  ]), /LOSS_CAUSE_DUPLICATE_CAUSE_ROW/);
});

test('an evaluated-but-unknown-quality cause is preserved as evidenceQuality=UNKNOWN, never dropped or defaulted to NEUTRAL', () => {
  const result = assessLossCauses('pos-1', ASOF, -50, [
    evidence({ cause: 'EXECUTION_DETERIORATION', evidenceQuality: 'UNKNOWN', severity: null, confidence: null, actionInfluence: 'UNKNOWN' }),
  ]);
  assert.equal(result.causes[0]?.evidenceQuality, 'UNKNOWN');
  assert.equal(result.causes[0]?.severity, null);
});
