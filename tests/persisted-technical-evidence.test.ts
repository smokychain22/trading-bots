import assert from 'node:assert/strict';
import test from 'node:test';
import { persistedTechnicalEvidence } from '../src/theta/postgres-theta-cycle-store.js';

// Phase 2 Pass B Final Closure C (directive sections 16-20): TREND/MOMENTUM
// truthful semantics. Previously `technical.trend` silently aliased
// `regimeState` (a regime is not a trend measurement) and
// `technical.momentum` was a hardcoded null with no real computation
// anywhere -- indistinguishable from "measured zero." This proves the fix
// without a Postgres pool: the object this function returns is exactly
// what gets persisted.

test('TREND/MOMENTUM TRUTHFUL SEMANTICS: regimeState is preserved under its own name, never mislabeled as trend', () => {
  const evidence = persistedTechnicalEvidence('RISK_ON');
  assert.equal(evidence.regimeState, 'RISK_ON');
  assert.equal(evidence.trend, null);
});

test('TREND/MOMENTUM TRUTHFUL SEMANTICS: both fields carry an explicit NOT_IMPLEMENTED status, never a bare null that could be mistaken for a real zero measurement', () => {
  const evidence = persistedTechnicalEvidence('RISK_OFF');
  assert.equal(evidence.trendStatus, 'NOT_IMPLEMENTED');
  assert.equal(evidence.momentumStatus, 'NOT_IMPLEMENTED');
  assert.equal(evidence.momentum, null);
});

test('TREND/MOMENTUM TRUTHFUL SEMANTICS: a missing regimeState becomes null, never a fabricated default regime', () => {
  const evidence = persistedTechnicalEvidence(undefined);
  assert.equal(evidence.regimeState, null);
});
