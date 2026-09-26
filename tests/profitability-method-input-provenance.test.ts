import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyMethodInputProvenance } from '../src/theta/profitability-method-input-provenance.js';

// Phase 1 Zero-Unknown Reclosure Pass 3 continuation (items 12-16): a
// method may execute while its decisive inputs are only partially real --
// that must never collapse into a single execution flag.
const executed = [
  'CURRENT_DECISION_STATE', 'STRATEGY_APPLICABILITY_ROUTER', 'CONVENTIONAL_CANDIDATE_ENUMERATION',
  'AEGIS_RISK_PERMISSION', 'CONSTRAINED_QUANTITY_SIZING', 'CANONICAL_ENTRY_SELECTION',
];

test('theta-shadow-once.ts\'s real config shape (CALLER_MANUAL router portfolio, CALLER_MANUAL AEGIS, real market data) classifies as MANUAL/PARTIAL_REAL, never REAL', () => {
  const rows = classifyMethodInputProvenance({
    executedMethodIds: executed,
    routerPortfolioOrigin: 'CALLER_MANUAL',
    aegisInputsOrigin: 'CALLER_MANUAL',
    marketDataOrigin: 'REAL_PROVIDER',
  });
  const byId = new Map(rows.map((r) => [r.methodId, r]));
  assert.equal(byId.get('CURRENT_DECISION_STATE')?.inputRealness, 'MANUAL');
  assert.equal(byId.get('STRATEGY_APPLICABILITY_ROUTER')?.inputRealness, 'MANUAL',
    'a hardcoded routerPortfolio must keep the router MANUAL even though it genuinely executes');
  assert.equal(byId.get('CONVENTIONAL_CANDIDATE_ENUMERATION')?.inputRealness, 'PARTIAL_REAL',
    'real market data plus a manually-gated router must be PARTIAL_REAL, never full REAL');
  assert.equal(byId.get('AEGIS_RISK_PERMISSION')?.inputRealness, 'PARTIAL_REAL',
    'CALLER_MANUAL AEGIS input is a documented real/manual mix, not a full-manual value');
  assert.equal(byId.get('CONSTRAINED_QUANTITY_SIZING')?.inputRealness, 'PARTIAL_REAL');
  assert.equal(byId.get('CANONICAL_ENTRY_SELECTION')?.inputRealness, 'PARTIAL_REAL',
    'selection executing is never itself proof of full-real inputs -- it inherits the weakest real input feeding it');
});

test('a fully real deployment (router derived from a real account read, AEGIS fully derived, real market data) classifies REAL, not capped at PARTIAL_REAL', () => {
  const rows = classifyMethodInputProvenance({
    executedMethodIds: executed,
    routerPortfolioOrigin: 'DERIVED_FROM_REAL',
    aegisInputsOrigin: 'DERIVED_FROM_REAL',
    marketDataOrigin: 'REAL_PROVIDER',
  });
  const byId = new Map(rows.map((r) => [r.methodId, r]));
  assert.equal(byId.get('STRATEGY_APPLICABILITY_ROUTER')?.inputRealness, 'REAL');
  assert.equal(byId.get('CONVENTIONAL_CANDIDATE_ENUMERATION')?.inputRealness, 'REAL');
  assert.equal(byId.get('AEGIS_RISK_PERMISSION')?.inputRealness, 'REAL');
  assert.equal(byId.get('CANONICAL_ENTRY_SELECTION')?.inputRealness, 'REAL');
});

test('an undeclared routerPortfolioOrigin (older caller, field omitted) is UNKNOWN, never silently assumed real or manual', () => {
  const rows = classifyMethodInputProvenance({
    executedMethodIds: executed, routerPortfolioOrigin: undefined,
    aegisInputsOrigin: 'CALLER_MANUAL', marketDataOrigin: 'REAL_PROVIDER',
  });
  const router = rows.find((r) => r.methodId === 'STRATEGY_APPLICABILITY_ROUTER');
  assert.equal(router?.inputRealness, 'UNKNOWN');
});

test('executed reflects the actual executedMethodIds list, independent of input realness', () => {
  const rows = classifyMethodInputProvenance({
    executedMethodIds: ['STRATEGY_APPLICABILITY_ROUTER'],
    routerPortfolioOrigin: 'CALLER_MANUAL', aegisInputsOrigin: 'CALLER_MANUAL', marketDataOrigin: 'REAL_PROVIDER',
  });
  assert.equal(rows.find((r) => r.methodId === 'STRATEGY_APPLICABILITY_ROUTER')?.executed, true);
  assert.equal(rows.find((r) => r.methodId === 'AEGIS_RISK_PERMISSION')?.executed, false);
});
